import {
  AlertCircle,
  Check,
  CircleAlert,
  Eye,
  Filter,
  Flag,
  Inbox,
  Layers,
  Loader2,
  Mail,
  MessageSquareWarning,
  Search,
  SearchX,
  Smartphone,
  StickyNote,
  X,
} from 'lucide-react'
import { useCallback, useEffect, useMemo, useState } from 'react'
import {
  collection,
  deleteField,
  doc,
  getDocs,
  serverTimestamp,
  updateDoc,
} from 'firebase/firestore'
import {
  beginnerFlowReportsCollectionName,
  db,
  firebaseReady,
} from './firebase'

const ACTIVE = 'active'
const RESOLVED = 'resolved'

/**
 * Same four-value issue type used on question/lesson reports, stored raw on
 * the Firestore doc.
 */
const ISSUE_TYPE_LABELS = {
  display_issue: 'Display issue',
  typo_or_error: 'Typo or error',
  answer_incorrect: 'Content accuracy issue',
  other: 'Other',
}

function issueTypeLabel(v) {
  const key = typeof v === 'string' ? v.trim() : ''
  return ISSUE_TYPE_LABELS[key] || key || 'Unspecified'
}

/**
 * Reports without an explicit `status` are treated as Active — the field
 * doesn't exist on the doc until an admin resolves it here.
 * @param {unknown} v
 * @returns {'active' | 'resolved'}
 */
function normalizeStatus(v) {
  const s = typeof v === 'string' ? v.trim().toLowerCase() : ''
  return s === RESOLVED ? RESOLVED : ACTIVE
}

/** @param {unknown} v */
function asStr(v) {
  if (v == null) return ''
  if (typeof v === 'string') return v
  return String(v)
}

/** @param {unknown} v */
function formatSubmittedAt(v) {
  if (v == null) return '—'
  if (typeof v === 'string') {
    const d = new Date(v)
    if (!Number.isNaN(d.getTime())) return d.toLocaleString()
    return v
  }
  if (typeof v === 'object' && v !== null && 'toDate' in v) {
    try {
      return /** @type {{ toDate: () => Date }} */ (v).toDate().toLocaleString()
    } catch {
      return '—'
    }
  }
  if (typeof v === 'number') {
    const d = new Date(v)
    if (!Number.isNaN(d.getTime())) return d.toLocaleString()
  }
  return String(v)
}

/**
 * Timestamp (ms since epoch) used for sorting newest-first.
 * @param {unknown} v
 */
function submittedAtMs(v) {
  if (v == null) return 0
  if (typeof v === 'string') {
    const t = Date.parse(v)
    return Number.isFinite(t) ? t : 0
  }
  if (typeof v === 'number' && Number.isFinite(v)) return v
  if (typeof v === 'object' && v !== null && 'toDate' in v) {
    try {
      return /** @type {{ toDate: () => Date }} */ (v).toDate().getTime()
    } catch {
      return 0
    }
  }
  return 0
}

/**
 * One-line lesson identifier: "Lesson 1 — How Poker Works".
 * @param {Record<string, unknown>} row
 */
function lessonLabel(row) {
  const idRaw = row.lessonId
  const id =
    typeof idRaw === 'number' && Number.isFinite(idRaw)
      ? String(idRaw)
      : asStr(idRaw).trim()
  const numberRaw = row.lessonNumber
  const number =
    typeof numberRaw === 'number' && Number.isFinite(numberRaw)
      ? String(numberRaw)
      : ''
  const title = asStr(row.lessonTitle).trim()
  const label = number || id
  if (label && title) return `Lesson ${label} — ${title}`
  if (label) return `Lesson ${label}`
  if (title) return title
  return '(no lesson)'
}

/**
 * "Beat 4 of 12 · guided" — beatIndex is 0-based in the source data.
 * @param {Record<string, unknown>} row
 */
function beatLabel(row) {
  const idxRaw = row.beatIndex
  const idx =
    typeof idxRaw === 'number' && Number.isFinite(idxRaw)
      ? idxRaw
      : Number.parseInt(asStr(idxRaw), 10)
  const totalRaw = row.totalBeats
  const total =
    typeof totalRaw === 'number' && Number.isFinite(totalRaw)
      ? totalRaw
      : Number.parseInt(asStr(totalRaw), 10)
  const mode = asStr(row.beatMode).trim()

  const human = Number.isFinite(idx) ? idx + 1 : null
  let core = ''
  if (human != null && Number.isFinite(total)) core = `Beat ${human} of ${total}`
  else if (human != null) core = `Beat ${human}`
  else if (Number.isFinite(total)) core = `${total} beats`
  return mode ? (core ? `${core} · ${mode}` : mode) : core || '—'
}

/**
 * Stable grouping key for "the same lesson" — falls back to title-based
 * identity if `lessonId` is missing.
 * @param {Record<string, unknown>} row
 */
function lessonGroupKey(row) {
  const id = asStr(row.lessonId).trim().toLowerCase()
  if (id) return `l:${id}`
  return `t:${asStr(row.lessonTitle).trim().toLowerCase()}`
}

/**
 * Stable grouping key for "the same beat within a lesson".
 * @param {Record<string, unknown>} row
 */
function beatGroupKey(row) {
  return `${lessonGroupKey(row)}|i:${asStr(row.beatIndex).trim()}`
}

/**
 * @param {Record<string, unknown>} row
 * @param {string} q lowercased query
 */
function rowMatchesQuery(row, q) {
  if (!q) return true
  const fields = [
    row.firestoreDocId,
    row.lessonTitle,
    row.lessonId,
    row.unitId,
    row.rank,
    row.issueType,
    row.details,
    row.userEmail,
    row.userId,
    row.beatMode,
    row.coachText,
    row.appVersion,
    row.deviceType,
  ]
  for (const f of fields) {
    if (f == null) continue
    if (String(f).toLowerCase().includes(q)) return true
  }
  return false
}

export default function BeginnerFlowReportsPage() {
  const [rows, setRows] = useState(
    /** @type {Array<{ firestoreDocId: string } & Record<string, unknown>>} */ ([]),
  )
  const [loading, setLoading] = useState(!!firebaseReady)
  const [error, setError] = useState(/** @type {string | null} */ (null))
  const [searchQuery, setSearchQuery] = useState('')
  const [issueFilter, setIssueFilter] = useState('all')
  const [statusFilter, setStatusFilter] = useState(
    /** @type {'all' | 'active' | 'resolved'} */ ('active'),
  )
  const [resolvingId, setResolvingId] = useState(
    /** @type {string | null} */ (null),
  )
  const [resolvingGroupKey, setResolvingGroupKey] = useState(
    /** @type {string | null} */ (null),
  )
  /** @type {[
   *   { key: string, reports: Array<{ firestoreDocId: string } & Record<string, unknown>> } | null,
   *   (v: any) => void
   * ]} */
  const [detailGroup, setDetailGroup] = useState(null)
  /** @type {[Record<string, string>, (v: any) => void]} */
  const [noteDrafts, setNoteDrafts] = useState({})
  const [notesSavingId, setNotesSavingId] = useState(
    /** @type {string | null} */ (null),
  )

  useEffect(() => {
    if (!firebaseReady || !db) {
      setLoading(false)
      return
    }

    let cancelled = false
    setLoading(true)
    setError(null)

    ;(async () => {
      try {
        const snap = await getDocs(
          collection(db, beginnerFlowReportsCollectionName),
        )
        if (cancelled) return
        const list = snap.docs.map((d) => ({
          firestoreDocId: d.id,
          ...d.data(),
        }))
        setRows(list)
      } catch (e) {
        if (!cancelled) {
          setError(e?.message || 'Failed to load beginner flow reports')
          setRows([])
        }
      } finally {
        if (!cancelled) setLoading(false)
      }
    })()

    return () => {
      cancelled = true
    }
  }, [])

  /**
   * Group every report by lesson + beat. Reports inside a group are sorted
   * newest-first.
   * @returns {Array<{ key: string, reports: Array<{ firestoreDocId: string } & Record<string, unknown>> }>}
   */
  const allGroups = useMemo(() => {
    /** @type {Map<string, { key: string, reports: Array<any> }>} */
    const map = new Map()
    for (const r of rows) {
      const key = beatGroupKey(r)
      let g = map.get(key)
      if (!g) {
        g = { key, reports: [] }
        map.set(key, g)
      }
      g.reports.push(r)
    }
    for (const g of map.values()) {
      g.reports.sort(
        (a, b) => submittedAtMs(b.submittedAt) - submittedAtMs(a.submittedAt),
      )
    }
    return Array.from(map.values())
  }, [rows])

  const issueCounts = useMemo(() => {
    /** @type {Record<string, number>} */
    const counts = {}
    for (const r of rows) {
      const key = asStr(r.issueType).trim()
      counts[key] = (counts[key] || 0) + 1
    }
    return counts
  }, [rows])

  /** Apply status + issue-type filter + search, then sort groups by latest submission. */
  const displayGroups = useMemo(() => {
    const q = searchQuery.trim().toLowerCase()
    return allGroups
      .filter((g) => {
        if (statusFilter === ACTIVE)
          return g.reports.some((r) => normalizeStatus(r.status) === ACTIVE)
        if (statusFilter === RESOLVED)
          return g.reports.every((r) => normalizeStatus(r.status) === RESOLVED)
        return true
      })
      .filter((g) => {
        if (issueFilter === 'all') return true
        return g.reports.some(
          (r) => asStr(r.issueType).trim() === issueFilter,
        )
      })
      .filter((g) => !q || g.reports.some((r) => rowMatchesQuery(r, q)))
      .sort((a, b) => {
        const aMs = Math.max(
          0,
          ...a.reports.map((r) => submittedAtMs(r.submittedAt)),
        )
        const bMs = Math.max(
          0,
          ...b.reports.map((r) => submittedAtMs(r.submittedAt)),
        )
        return bMs - aMs
      })
  }, [allGroups, searchQuery, issueFilter, statusFilter])

  const counts = useMemo(() => {
    let active = 0
    let resolved = 0
    for (const r of rows) {
      if (normalizeStatus(r.status) === RESOLVED) resolved++
      else active++
    }
    return { active, resolved, total: rows.length }
  }, [rows])

  const resolveReport = useCallback(
    async (firestoreDocId) => {
      if (!db) return
      setResolvingId(firestoreDocId)
      setError(null)

      const prevRow = rows.find((r) => r.firestoreDocId === firestoreDocId)

      setRows((prev) =>
        prev.map((r) =>
          r.firestoreDocId === firestoreDocId
            ? { ...r, status: RESOLVED, resolvedAt: new Date().toISOString() }
            : r,
        ),
      )

      try {
        await updateDoc(
          doc(db, beginnerFlowReportsCollectionName, firestoreDocId),
          {
            status: RESOLVED,
            resolvedAt: serverTimestamp(),
          },
        )
      } catch (e) {
        setRows((prev) =>
          prev.map((r) =>
            r.firestoreDocId === firestoreDocId && prevRow ? prevRow : r,
          ),
        )
        setError(e?.message || 'Failed to resolve report')
      } finally {
        setResolvingId(null)
      }
    },
    [rows],
  )

  const openDetail = useCallback((group) => {
    setDetailGroup(group)
    /** @type {Record<string, string>} */
    const drafts = {}
    for (const r of group.reports) {
      drafts[r.firestoreDocId] = asStr(r.adminNotes)
    }
    setNoteDrafts(drafts)
  }, [])

  const closeDetail = useCallback(() => {
    setDetailGroup(null)
    setNoteDrafts({})
  }, [])

  useEffect(() => {
    if (!detailGroup) return
    function onKey(e) {
      if (e.key === 'Escape') closeDetail()
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [detailGroup, closeDetail])

  // Keep the open modal in sync if rows update (e.g. after resolve/notes save).
  useEffect(() => {
    if (!detailGroup) return
    const fresh = allGroups.find((g) => g.key === detailGroup.key)
    if (!fresh) {
      setDetailGroup(null)
      return
    }
    if (fresh !== detailGroup) setDetailGroup(fresh)
  }, [allGroups, detailGroup])

  /** Bulk-resolve every still-active report in a group. */
  const resolveGroup = useCallback(
    async (group) => {
      if (!db) return
      const activeIds = group.reports
        .filter((r) => normalizeStatus(r.status) === ACTIVE)
        .map((r) => r.firestoreDocId)
      if (activeIds.length === 0) return

      setResolvingGroupKey(group.key)
      setError(null)

      const prevSnapshot = rows
      const nowIso = new Date().toISOString()

      setRows((prev) =>
        prev.map((r) =>
          activeIds.includes(r.firestoreDocId)
            ? { ...r, status: RESOLVED, resolvedAt: nowIso }
            : r,
        ),
      )

      try {
        await Promise.all(
          activeIds.map((id) =>
            updateDoc(doc(db, beginnerFlowReportsCollectionName, id), {
              status: RESOLVED,
              resolvedAt: serverTimestamp(),
            }),
          ),
        )
      } catch (e) {
        setRows(prevSnapshot)
        setError(e?.message || 'Failed to resolve group')
      } finally {
        setResolvingGroupKey(null)
      }
    },
    [rows],
  )

  const saveNotes = useCallback(
    async (firestoreDocId, notesText) => {
      if (!db) return
      const trimmed = notesText.trim()
      const prevRow = rows.find((r) => r.firestoreDocId === firestoreDocId)
      if (!prevRow) return

      setNotesSavingId(firestoreDocId)
      setError(null)

      setRows((prev) =>
        prev.map((r) =>
          r.firestoreDocId !== firestoreDocId
            ? r
            : trimmed
              ? { ...r, adminNotes: trimmed }
              : (() => {
                  const { adminNotes: _omit, ...rest } = r
                  return rest
                })(),
        ),
      )

      try {
        await updateDoc(
          doc(db, beginnerFlowReportsCollectionName, firestoreDocId),
          {
            adminNotes: trimmed ? trimmed : deleteField(),
          },
        )
      } catch (e) {
        setRows((prev) =>
          prev.map((r) => (r.firestoreDocId === firestoreDocId ? prevRow : r)),
        )
        setError(e?.message || 'Failed to save notes')
      } finally {
        setNotesSavingId(null)
      }
    },
    [rows],
  )

  const hasActiveFilters =
    searchQuery.trim() !== '' || issueFilter !== 'all' || statusFilter !== 'all'

  const showStatusColumn = statusFilter === 'all'

  return (
    <div className="px-4 py-6 sm:px-6 lg:px-8 lg:py-8">
      <header className="mb-8 flex flex-col gap-5 lg:flex-row lg:items-end lg:justify-between">
        <div className="flex items-start gap-3 sm:items-center sm:gap-4">
          <div className="flex size-11 shrink-0 items-center justify-center rounded-xl bg-white shadow-md shadow-slate-900/[0.04] ring-1 ring-slate-200/90 sm:size-12">
            <MessageSquareWarning
              className="size-5 text-orange-600 sm:size-6"
              strokeWidth={2}
              aria-hidden
            />
          </div>
          <div>
            <h1 className="text-2xl font-semibold tracking-tight text-slate-900 sm:text-3xl">
              Beginner Flow Reports
            </h1>
            <p className="mt-1 flex flex-wrap items-center gap-2 text-sm text-slate-600">
              {rows.length > 0 ? (
                <>
                  <span className="inline-flex items-center gap-1.5">
                    <span className="inline-flex size-1.5 rounded-full bg-orange-500" />
                    {`${displayGroups.length} group${
                      displayGroups.length === 1 ? '' : 's'
                    } shown${
                      hasActiveFilters
                        ? ` of ${allGroups.length} (${rows.length} reports)`
                        : ` · ${rows.length} reports`
                    }`}
                  </span>
                  <span
                    className="inline-flex items-center gap-1 rounded-full bg-amber-50 px-2 py-0.5 text-[11px] font-semibold text-amber-800 ring-1 ring-amber-200/80"
                    title="Reports with no `status` field, or status other than `resolved`"
                  >
                    <CircleAlert
                      className="size-3 shrink-0"
                      strokeWidth={2.25}
                      aria-hidden
                    />
                    {counts.active} active
                  </span>
                  <span className="inline-flex items-center gap-1 rounded-full bg-emerald-50 px-2 py-0.5 text-[11px] font-semibold text-emerald-800 ring-1 ring-emerald-200/80">
                    <Check
                      className="size-3 shrink-0"
                      strokeWidth={2.5}
                      aria-hidden
                    />
                    {counts.resolved} resolved
                  </span>
                </>
              ) : !loading ? (
                <span>Collection: {beginnerFlowReportsCollectionName}</span>
              ) : null}
            </p>
          </div>
        </div>
        <div className="flex flex-col gap-3 sm:flex-row sm:flex-wrap sm:items-stretch">
          <div className="relative w-full min-w-[12rem] sm:w-auto">
            <Filter
              className="pointer-events-none absolute left-3 top-1/2 size-4 -translate-y-1/2 text-slate-400"
              strokeWidth={2}
              aria-hidden
            />
            <label className="sr-only" htmlFor="beginner-flow-status-filter">
              Filter by status
            </label>
            <select
              id="beginner-flow-status-filter"
              value={statusFilter}
              onChange={(e) =>
                setStatusFilter(
                  /** @type {'all' | 'active' | 'resolved'} */ (e.target.value),
                )
              }
              className="w-full cursor-pointer appearance-none rounded-xl border border-slate-200 bg-white py-2.5 pl-10 pr-3 text-sm text-slate-900 shadow-sm outline-none transition hover:border-slate-300 focus:border-orange-400 focus:ring-4 focus:ring-orange-500/15 sm:min-w-[11rem]"
            >
              <option value="active">Active only</option>
              <option value="resolved">Resolved only</option>
              <option value="all">All reports</option>
            </select>
          </div>
          <div className="relative w-full min-w-[12rem] sm:w-auto">
            <label className="sr-only" htmlFor="beginner-flow-issue-filter">
              Filter by issue type
            </label>
            <select
              id="beginner-flow-issue-filter"
              value={issueFilter}
              onChange={(e) => setIssueFilter(e.target.value)}
              className="w-full cursor-pointer appearance-none rounded-xl border border-slate-200 bg-white py-2.5 px-3 text-sm text-slate-900 shadow-sm outline-none transition hover:border-slate-300 focus:border-orange-400 focus:ring-4 focus:ring-orange-500/15 sm:min-w-[11rem]"
            >
              <option value="all">All issue types</option>
              {Object.keys(ISSUE_TYPE_LABELS).map((key) => (
                <option key={key} value={key}>
                  {ISSUE_TYPE_LABELS[key]} ({issueCounts[key] || 0})
                </option>
              ))}
            </select>
          </div>
          <div className="relative w-full min-w-[220px] sm:min-w-[20rem] sm:max-w-xl sm:flex-1 lg:max-w-2xl">
            <Search
              className="pointer-events-none absolute left-3 top-1/2 size-4 -translate-y-1/2 text-slate-400"
              strokeWidth={2}
              aria-hidden
            />
            <input
              id="beginner-flow-search"
              type="search"
              placeholder="Search lesson, user, details, issue…"
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              className="w-full rounded-xl border border-slate-200 bg-white py-2.5 pl-10 pr-3 text-sm text-slate-900 shadow-sm outline-none placeholder:text-slate-400 focus:border-orange-400 focus:ring-4 focus:ring-orange-500/15"
            />
          </div>
        </div>
      </header>

      {error && (
        <div
          role="alert"
          className="mb-6 flex gap-3 rounded-xl border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-800"
        >
          <AlertCircle
            className="mt-0.5 size-4 shrink-0 text-red-600"
            strokeWidth={2}
          />
          <span>{error}</span>
        </div>
      )}

      <div className="overflow-hidden rounded-2xl border border-slate-200/90 bg-white shadow-lg shadow-slate-900/[0.04] ring-1 ring-slate-900/[0.02]">
        {loading ? (
          <div className="flex flex-col items-center justify-center gap-4 py-24 text-slate-600">
            <Loader2
              className="size-9 animate-spin text-orange-600"
              strokeWidth={2}
              aria-hidden
            />
            <p className="text-sm font-medium">
              Loading beginner flow reports…
            </p>
          </div>
        ) : rows.length === 0 ? (
          <div className="flex flex-col items-center px-4 py-20 text-center">
            <div className="mb-4 flex size-14 items-center justify-center rounded-2xl bg-slate-100 text-slate-400 ring-1 ring-slate-200/80">
              <Inbox className="size-7" strokeWidth={1.75} aria-hidden />
            </div>
            <p className="max-w-sm text-sm text-slate-600">
              No documents in the{' '}
              <code className="rounded bg-slate-100 px-1.5 py-0.5 font-mono text-xs text-slate-800">
                {beginnerFlowReportsCollectionName}
              </code>{' '}
              collection.
            </p>
          </div>
        ) : displayGroups.length === 0 ? (
          <div className="flex flex-col items-center px-4 py-20 text-center">
            <div className="mb-4 flex size-14 items-center justify-center rounded-2xl bg-slate-100 text-slate-400 ring-1 ring-slate-200/80">
              <SearchX className="size-7" strokeWidth={1.75} aria-hidden />
            </div>
            <p className="text-sm font-medium text-slate-700">
              No reports match your filters
            </p>
            <p className="mt-1 max-w-xs text-xs text-slate-500">
              Try another status, issue type, or search, or clear the search
              field.
            </p>
          </div>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full min-w-[880px] text-left text-sm">
              <thead>
                <tr className="border-b border-slate-200 bg-slate-50/90">
                  <th
                    scope="col"
                    className="whitespace-nowrap px-3 py-3.5 text-xs font-semibold uppercase tracking-wide text-slate-600 lg:px-4"
                  >
                    Submitted
                  </th>
                  <th
                    scope="col"
                    className="min-w-[260px] px-3 py-3.5 text-xs font-semibold uppercase tracking-wide text-slate-600 lg:min-w-[320px] lg:px-4"
                  >
                    Location
                  </th>
                  <th
                    scope="col"
                    className="whitespace-nowrap px-3 py-3.5 text-xs font-semibold uppercase tracking-wide text-slate-600 lg:px-4"
                  >
                    Issue
                  </th>
                  <th
                    scope="col"
                    className="min-w-[180px] px-3 py-3.5 text-xs font-semibold uppercase tracking-wide text-slate-600 lg:px-4"
                  >
                    User
                  </th>
                  <th
                    scope="col"
                    className="hidden whitespace-nowrap px-3 py-3.5 text-xs font-semibold uppercase tracking-wide text-slate-600 xl:table-cell lg:px-4"
                  >
                    Device
                  </th>
                  <th
                    scope="col"
                    className="whitespace-nowrap px-3 py-3.5 text-center text-xs font-semibold uppercase tracking-wide text-slate-600 lg:px-4"
                    title="Total reports for this lesson + beat."
                  >
                    <span className="inline-flex items-center gap-1.5">
                      <Flag
                        className="size-3.5 shrink-0 text-orange-600"
                        strokeWidth={2}
                        aria-hidden
                      />
                      Reports
                    </span>
                  </th>
                  {showStatusColumn ? (
                    <th
                      scope="col"
                      className="whitespace-nowrap px-3 py-3.5 text-center text-xs font-semibold uppercase tracking-wide text-slate-600 lg:px-4"
                    >
                      Status
                    </th>
                  ) : null}
                  <th
                    scope="col"
                    className="whitespace-nowrap px-3 py-3.5 text-center text-xs font-semibold uppercase tracking-wide text-slate-600 lg:px-4"
                  >
                    Action
                  </th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100">
                {displayGroups.map((group) => {
                  const latest = group.reports[0]
                  const totalCount = group.reports.length
                  const activeCount = group.reports.filter(
                    (r) => normalizeStatus(r.status) === ACTIVE,
                  ).length
                  const resolvedCount = totalCount - activeCount
                  const groupStatus = activeCount > 0 ? ACTIVE : RESOLVED
                  const isResolving = resolvingGroupKey === group.key

                  const lesson = lessonLabel(latest)
                  const beat = beatLabel(latest)
                  const rank = asStr(latest.rank).trim()

                  const distinctIssues = Array.from(
                    new Set(
                      group.reports
                        .map((r) => asStr(r.issueType).trim())
                        .filter(Boolean),
                    ),
                  )
                  const distinctEmails = Array.from(
                    new Set(
                      group.reports
                        .map((r) => asStr(r.userEmail).trim())
                        .filter(Boolean),
                    ),
                  )
                  const distinctDevices = Array.from(
                    new Set(
                      group.reports
                        .map((r) => asStr(r.deviceType).trim())
                        .filter(Boolean),
                    ),
                  )
                  const distinctAppVersions = Array.from(
                    new Set(
                      group.reports
                        .map((r) => asStr(r.appVersion).trim())
                        .filter(Boolean),
                    ),
                  )

                  return (
                    <tr
                      key={group.key}
                      className="align-top transition-colors hover:bg-slate-50/80"
                    >
                      <td className="whitespace-nowrap px-3 py-3 text-xs text-slate-600 lg:px-4">
                        <p
                          className="font-medium text-slate-700"
                          title={asStr(latest.submittedAt)}
                        >
                          {formatSubmittedAt(latest.submittedAt)}
                        </p>
                        <p className="mt-1 text-[10.5px] text-slate-400">
                          {totalCount > 1
                            ? `Latest of ${totalCount}`
                            : 'Single report'}
                        </p>
                      </td>
                      <td className="px-3 py-3 lg:px-4">
                        <div className="space-y-1.5">
                          <div className="flex flex-wrap items-center gap-1.5">
                            <span className="inline-flex items-center gap-1 rounded-md bg-orange-50 px-2 py-0.5 text-[11px] font-semibold text-orange-900 ring-1 ring-orange-100">
                              <Layers
                                className="size-3 shrink-0"
                                strokeWidth={2.25}
                                aria-hidden
                              />
                              {lesson}
                            </span>
                            {rank ? (
                              <span
                                className="rounded-md bg-slate-100 px-1.5 py-0.5 font-mono text-[10.5px] text-slate-600"
                                title="rank"
                              >
                                {rank}
                              </span>
                            ) : null}
                          </div>
                          <p className="text-xs text-slate-500" title={beat}>
                            {beat}
                          </p>
                        </div>
                      </td>
                      <td className="whitespace-nowrap px-3 py-3 lg:px-4">
                        {distinctIssues.length === 0 ? (
                          <span className="text-slate-400">—</span>
                        ) : distinctIssues.length === 1 ? (
                          <span className="rounded-md bg-rose-50 px-2 py-0.5 font-mono text-[11px] text-rose-800 ring-1 ring-rose-100">
                            {issueTypeLabel(distinctIssues[0])}
                          </span>
                        ) : (
                          <span
                            className="inline-flex items-center gap-1 rounded-md bg-rose-50 px-2 py-0.5 text-[11px] font-semibold text-rose-800 ring-1 ring-rose-100"
                            title={distinctIssues
                              .map(issueTypeLabel)
                              .join(', ')}
                          >
                            Multiple
                            <span className="rounded-full bg-rose-200/80 px-1.5 py-0.5 font-mono text-[10px] text-rose-900">
                              {distinctIssues.length}
                            </span>
                          </span>
                        )}
                      </td>
                      <td className="max-w-[220px] px-3 py-3 text-xs text-slate-600 lg:px-4">
                        {distinctEmails.length === 0 ? (
                          <span className="text-slate-400">—</span>
                        ) : distinctEmails.length === 1 ? (
                          <p
                            className="flex items-center gap-1.5 truncate text-slate-700"
                            title={distinctEmails[0]}
                          >
                            <Mail
                              className="size-3.5 shrink-0 text-slate-400"
                              strokeWidth={2}
                              aria-hidden
                            />
                            <span className="truncate">
                              {distinctEmails[0]}
                            </span>
                          </p>
                        ) : (
                          <p
                            className="inline-flex items-center gap-1.5 text-slate-700"
                            title={distinctEmails.join(', ')}
                          >
                            <Mail
                              className="size-3.5 shrink-0 text-slate-400"
                              strokeWidth={2}
                              aria-hidden
                            />
                            {distinctEmails.length} users
                          </p>
                        )}
                      </td>
                      <td className="hidden whitespace-nowrap px-3 py-3 text-xs text-slate-600 xl:table-cell lg:px-4">
                        {distinctDevices.length === 0 ? (
                          <span className="text-slate-400">—</span>
                        ) : distinctDevices.length === 1 ? (
                          <p className="inline-flex items-center gap-1.5 text-slate-700">
                            <Smartphone
                              className="size-3.5 shrink-0 text-slate-400"
                              strokeWidth={2}
                              aria-hidden
                            />
                            {distinctDevices[0]}
                          </p>
                        ) : (
                          <p
                            className="inline-flex items-center gap-1.5 text-slate-700"
                            title={distinctDevices.join(', ')}
                          >
                            <Smartphone
                              className="size-3.5 shrink-0 text-slate-400"
                              strokeWidth={2}
                              aria-hidden
                            />
                            Multiple
                          </p>
                        )}
                        {distinctAppVersions.length === 1 ? (
                          <p
                            className="mt-1 font-mono text-[10.5px] text-slate-500"
                            title={`App version ${distinctAppVersions[0]}`}
                          >
                            v{distinctAppVersions[0]}
                          </p>
                        ) : distinctAppVersions.length > 1 ? (
                          <p
                            className="mt-1 font-mono text-[10.5px] text-slate-500"
                            title={distinctAppVersions
                              .map((v) => `v${v}`)
                              .join(', ')}
                          >
                            v
                            {asStr(latest.appVersion).trim() ||
                              distinctAppVersions[0]}{' '}
                            <span className="not-italic text-slate-400">
                              +{distinctAppVersions.length - 1}
                            </span>
                          </p>
                        ) : null}
                      </td>
                      <td
                        className="whitespace-nowrap px-3 py-3 text-center align-middle lg:px-4"
                        title={`${totalCount} all-time report${totalCount === 1 ? '' : 's'} for this lesson + beat (includes resolved)`}
                      >
                        <span className="inline-flex items-center gap-1.5 rounded-lg bg-orange-50 px-3 py-1 ring-1 ring-orange-100">
                          <Flag
                            className="size-3.5 shrink-0 text-orange-600"
                            strokeWidth={2.25}
                            aria-hidden
                          />
                          <span className="text-base font-bold tabular-nums text-orange-900">
                            {totalCount}
                          </span>
                        </span>
                      </td>
                      {showStatusColumn ? (
                        <td className="px-3 py-3 text-center lg:px-4">
                          {groupStatus === RESOLVED ? (
                            <span className="inline-flex items-center gap-1 rounded-full bg-emerald-50 px-2.5 py-0.5 text-[11px] font-semibold text-emerald-800 ring-1 ring-emerald-200/80">
                              <Check
                                className="size-3 shrink-0"
                                strokeWidth={2.5}
                                aria-hidden
                              />
                              Resolved
                            </span>
                          ) : (
                            <span
                              className="inline-flex items-center gap-1 rounded-full bg-amber-50 px-2.5 py-0.5 text-[11px] font-semibold text-amber-800 ring-1 ring-amber-200/80"
                              title={
                                resolvedCount > 0
                                  ? `${activeCount} active · ${resolvedCount} resolved`
                                  : `${activeCount} active`
                              }
                            >
                              <CircleAlert
                                className="size-3 shrink-0"
                                strokeWidth={2.25}
                                aria-hidden
                              />
                              {totalCount > 1
                                ? `${activeCount}/${totalCount} active`
                                : 'Active'}
                            </span>
                          )}
                        </td>
                      ) : null}
                      <td className="px-3 py-3 text-center lg:px-4">
                        <div className="inline-flex flex-col items-stretch gap-1.5">
                          <button
                            type="button"
                            onClick={() => openDetail(group)}
                            className="inline-flex cursor-pointer items-center justify-center gap-1.5 rounded-lg border border-orange-200 bg-orange-50 px-2.5 py-1.5 text-xs font-semibold text-orange-900 transition hover:border-orange-300 hover:bg-orange-100/80 focus:outline-none focus-visible:ring-2 focus-visible:ring-orange-500 focus-visible:ring-offset-2"
                          >
                            <Eye
                              className="size-3.5 shrink-0"
                              strokeWidth={2.25}
                              aria-hidden
                            />
                            View
                            {totalCount > 1 ? (
                              <span className="rounded-full bg-orange-200/80 px-1.5 py-0.5 font-mono text-[10px] text-orange-900">
                                {totalCount}
                              </span>
                            ) : null}
                          </button>
                          <button
                            type="button"
                            disabled={activeCount === 0 || isResolving}
                            onClick={() => resolveGroup(group)}
                            className={`inline-flex items-center justify-center gap-1.5 rounded-lg border px-2.5 py-1.5 text-xs font-semibold transition focus:outline-none focus-visible:ring-2 focus-visible:ring-emerald-500 focus-visible:ring-offset-2 ${
                              activeCount === 0
                                ? 'cursor-not-allowed border-slate-100 bg-slate-50 text-slate-400'
                                : 'cursor-pointer border-emerald-200 bg-emerald-50 text-emerald-900 hover:border-emerald-300 hover:bg-emerald-100/80 disabled:cursor-wait disabled:opacity-60'
                            }`}
                            title={
                              activeCount > 1
                                ? `Resolve all ${activeCount} active reports in this group`
                                : undefined
                            }
                          >
                            {isResolving ? (
                              <>
                                <Loader2
                                  className="size-3.5 animate-spin"
                                  strokeWidth={2}
                                  aria-hidden
                                />
                                Resolving…
                              </>
                            ) : (
                              <>
                                <Check
                                  className="size-3.5 shrink-0"
                                  strokeWidth={2.25}
                                  aria-hidden
                                />
                                Resolve
                                {activeCount > 1 ? (
                                  <span className="rounded-full bg-emerald-200/80 px-1.5 py-0.5 font-mono text-[10px] text-emerald-900">
                                    {activeCount}
                                  </span>
                                ) : null}
                              </>
                            )}
                          </button>
                        </div>
                      </td>
                    </tr>
                  )
                })}
              </tbody>
            </table>
          </div>
        )}
      </div>

      {detailGroup ? (
        <ReportGroupModal
          group={detailGroup}
          noteDrafts={noteDrafts}
          onChangeNote={(docId, v) =>
            setNoteDrafts((prev) => ({ ...prev, [docId]: v }))
          }
          onSaveNote={(docId) => saveNotes(docId, noteDrafts[docId] ?? '')}
          onResolveOne={(docId) => resolveReport(docId)}
          onResolveGroup={() => resolveGroup(detailGroup)}
          onClose={closeDetail}
          savingNoteId={notesSavingId}
          resolvingId={resolvingId}
          resolvingGroup={resolvingGroupKey === detailGroup.key}
        />
      ) : null}
    </div>
  )
}

/**
 * @param {{
 *   group: { key: string, reports: Array<{ firestoreDocId: string } & Record<string, unknown>> }
 *   noteDrafts: Record<string, string>
 *   onChangeNote: (docId: string, v: string) => void
 *   onSaveNote: (docId: string) => void
 *   onResolveOne: (docId: string) => void
 *   onResolveGroup: () => void
 *   onClose: () => void
 *   savingNoteId: string | null
 *   resolvingId: string | null
 *   resolvingGroup: boolean
 * }} props
 */
function ReportGroupModal({
  group,
  noteDrafts,
  onChangeNote,
  onSaveNote,
  onResolveOne,
  onResolveGroup,
  onClose,
  savingNoteId,
  resolvingId,
  resolvingGroup,
}) {
  const head = group.reports[0]
  const lesson = lessonLabel(head)
  const beat = beatLabel(head)
  const rank = asStr(head.rank).trim()
  const totalCount = group.reports.length
  const activeCount = group.reports.filter(
    (r) => normalizeStatus(r.status) === ACTIVE,
  ).length
  const resolvedCount = totalCount - activeCount
  const anyBusy =
    resolvingGroup || resolvingId !== null || savingNoteId !== null

  return (
    <div
      className="fixed inset-0 z-50 flex items-end justify-center bg-slate-900/40 p-0 backdrop-blur-sm sm:items-center sm:p-4"
      role="presentation"
      onClick={onClose}
    >
      <div
        role="dialog"
        aria-modal="true"
        aria-labelledby="beginner-flow-report-modal-title"
        className="flex max-h-[min(92vh,820px)] w-full max-w-2xl flex-col rounded-t-2xl border border-slate-200 bg-white shadow-2xl sm:rounded-2xl"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-start justify-between gap-3 border-b border-slate-100 px-5 py-4">
          <div className="min-w-0">
            <div className="flex flex-wrap items-center gap-2">
              <h2
                id="beginner-flow-report-modal-title"
                className="text-lg font-semibold text-slate-900"
              >
                {totalCount > 1 ? `${totalCount} reports` : 'Report details'}
              </h2>
              <span className="inline-flex items-center gap-1 rounded-md bg-orange-50 px-2 py-0.5 text-[11px] font-semibold text-orange-900 ring-1 ring-orange-100">
                <Layers
                  className="size-3 shrink-0"
                  strokeWidth={2.25}
                  aria-hidden
                />
                {lesson}
              </span>
              {rank ? (
                <span
                  className="rounded-md bg-slate-100 px-1.5 py-0.5 font-mono text-[10.5px] text-slate-600"
                  title="rank"
                >
                  {rank}
                </span>
              ) : null}
            </div>
            <p className="mt-1 text-xs text-slate-500">{beat}</p>
            <div className="mt-2 flex flex-wrap gap-1.5 text-[11px]">
              {activeCount > 0 ? (
                <span className="inline-flex items-center gap-1 rounded-full bg-amber-50 px-2 py-0.5 font-semibold text-amber-800 ring-1 ring-amber-200/80">
                  <CircleAlert
                    className="size-3 shrink-0"
                    strokeWidth={2.25}
                    aria-hidden
                  />
                  {activeCount} active
                </span>
              ) : null}
              {resolvedCount > 0 ? (
                <span className="inline-flex items-center gap-1 rounded-full bg-emerald-50 px-2 py-0.5 font-semibold text-emerald-800 ring-1 ring-emerald-200/80">
                  <Check
                    className="size-3 shrink-0"
                    strokeWidth={2.5}
                    aria-hidden
                  />
                  {resolvedCount} resolved
                </span>
              ) : null}
            </div>
          </div>
          <button
            type="button"
            onClick={onClose}
            className="shrink-0 cursor-pointer rounded-lg p-2 text-slate-500 transition hover:bg-slate-100 hover:text-slate-800 focus:outline-none focus-visible:ring-2 focus-visible:ring-orange-500"
            aria-label="Close"
          >
            <X className="size-5" strokeWidth={2} />
          </button>
        </div>

        <ul className="flex-1 space-y-3 overflow-y-auto px-4 py-4 sm:px-5">
          {group.reports.map((rep, index) => (
            <ReportItemCard
              key={rep.firestoreDocId}
              report={rep}
              index={index}
              total={totalCount}
              noteDraft={noteDrafts[rep.firestoreDocId] ?? ''}
              onChangeNote={(v) => onChangeNote(rep.firestoreDocId, v)}
              onSaveNote={() => onSaveNote(rep.firestoreDocId)}
              onResolve={() => onResolveOne(rep.firestoreDocId)}
              saving={savingNoteId === rep.firestoreDocId}
              resolving={resolvingId === rep.firestoreDocId}
              anyBusy={anyBusy}
            />
          ))}
        </ul>

        <div className="flex flex-col-reverse gap-2 border-t border-slate-100 px-5 py-3 sm:flex-row sm:items-center sm:justify-between">
          <button
            type="button"
            onClick={onClose}
            className="cursor-pointer rounded-lg border border-slate-200 bg-white px-3 py-2 text-xs font-semibold text-slate-700 transition hover:border-slate-300 hover:bg-slate-50 focus:outline-none focus-visible:ring-2 focus-visible:ring-orange-500"
          >
            Close
          </button>
          {activeCount > 0 ? (
            <button
              type="button"
              disabled={anyBusy}
              onClick={onResolveGroup}
              className="inline-flex cursor-pointer items-center justify-center gap-1.5 rounded-lg border border-emerald-200 bg-emerald-50 px-3 py-2 text-xs font-semibold text-emerald-900 transition hover:border-emerald-300 hover:bg-emerald-100/80 focus:outline-none focus-visible:ring-2 focus-visible:ring-emerald-500 focus-visible:ring-offset-2 disabled:cursor-wait disabled:opacity-60"
            >
              {resolvingGroup ? (
                <>
                  <Loader2
                    className="size-3.5 animate-spin"
                    strokeWidth={2}
                    aria-hidden
                  />
                  Resolving all…
                </>
              ) : (
                <>
                  <Check
                    className="size-3.5 shrink-0"
                    strokeWidth={2.25}
                    aria-hidden
                  />
                  Resolve all {activeCount > 1 ? `(${activeCount})` : ''}
                </>
              )}
            </button>
          ) : null}
        </div>
      </div>
    </div>
  )
}

/**
 * @param {{
 *   report: { firestoreDocId: string } & Record<string, unknown>
 *   index: number
 *   total: number
 *   noteDraft: string
 *   onChangeNote: (v: string) => void
 *   onSaveNote: () => void
 *   onResolve: () => void
 *   saving: boolean
 *   resolving: boolean
 *   anyBusy: boolean
 * }} props
 */
function ReportItemCard({
  report,
  index,
  total,
  noteDraft,
  onChangeNote,
  onSaveNote,
  onResolve,
  saving,
  resolving,
  anyBusy,
}) {
  const status = normalizeStatus(report.status)
  const issue = asStr(report.issueType).trim()
  const details = asStr(report.details).trim()
  const userEmail = asStr(report.userEmail).trim()
  const userId = asStr(report.userId).trim()
  const deviceType = asStr(report.deviceType).trim()
  const appVersion = asStr(report.appVersion).trim()
  const coachText = asStr(report.coachText).trim()
  const savedNotes = asStr(report.adminNotes)
  const notesDirty = noteDraft !== savedNotes
  const inputId = `beginner-flow-report-notes-${report.firestoreDocId}`

  return (
    <li className="list-none rounded-xl border border-slate-200 bg-slate-50/70 p-3 sm:p-4">
      <div className="flex flex-wrap items-center justify-between gap-2 border-b border-slate-200/80 pb-2">
        <div className="flex flex-wrap items-center gap-2 text-xs">
          {total > 1 ? (
            <span className="rounded-full bg-slate-200/80 px-2 py-0.5 text-[10px] font-bold text-slate-700">
              #{index + 1}
            </span>
          ) : null}
          {status === RESOLVED ? (
            <span className="inline-flex items-center gap-1 rounded-full bg-emerald-50 px-2 py-0.5 text-[11px] font-semibold text-emerald-800 ring-1 ring-emerald-200/80">
              <Check className="size-3 shrink-0" strokeWidth={2.5} aria-hidden />
              Resolved
            </span>
          ) : (
            <span className="inline-flex items-center gap-1 rounded-full bg-amber-50 px-2 py-0.5 text-[11px] font-semibold text-amber-800 ring-1 ring-amber-200/80">
              <CircleAlert
                className="size-3 shrink-0"
                strokeWidth={2.25}
                aria-hidden
              />
              Active
            </span>
          )}
          {issue ? (
            <span className="rounded-md bg-rose-50 px-2 py-0.5 font-mono text-[11px] text-rose-800 ring-1 ring-rose-100">
              {issueTypeLabel(issue)}
            </span>
          ) : null}
          <span
            className="text-[11px] text-slate-500"
            title={asStr(report.submittedAt)}
          >
            {formatSubmittedAt(report.submittedAt)}
          </span>
        </div>
        <button
          type="button"
          disabled={status === RESOLVED || anyBusy}
          onClick={onResolve}
          className={`inline-flex shrink-0 items-center justify-center gap-1.5 rounded-lg border px-2.5 py-1 text-[11px] font-semibold transition focus:outline-none focus-visible:ring-2 focus-visible:ring-emerald-500 focus-visible:ring-offset-2 ${
            status === RESOLVED
              ? 'cursor-not-allowed border-slate-100 bg-slate-50 text-slate-400'
              : 'cursor-pointer border-emerald-200 bg-emerald-50 text-emerald-900 hover:border-emerald-300 hover:bg-emerald-100/80 disabled:cursor-wait disabled:opacity-60'
          }`}
        >
          {resolving ? (
            <>
              <Loader2 className="size-3 animate-spin" strokeWidth={2} aria-hidden />
              Resolving…
            </>
          ) : (
            <>
              <Check className="size-3 shrink-0" strokeWidth={2.25} aria-hidden />
              {status === RESOLVED ? 'Resolved' : 'Resolve'}
            </>
          )}
        </button>
      </div>

      <div className="mt-2.5 grid grid-cols-1 gap-x-4 gap-y-1.5 text-xs sm:grid-cols-2">
        <div>
          <dt className="font-semibold uppercase tracking-wide text-[10px] text-slate-500">
            User
          </dt>
          <dd className="mt-0.5 break-all text-slate-700">
            {userEmail || <span className="text-slate-400">— no email</span>}
            {userId ? (
              <p className="mt-0.5 font-mono text-[10.5px] text-slate-400">
                {userId}
              </p>
            ) : (
              <p className="mt-0.5 text-[10.5px] text-slate-400">
                Guest / no uid
              </p>
            )}
          </dd>
        </div>
        <div>
          <dt className="font-semibold uppercase tracking-wide text-[10px] text-slate-500">
            Device
          </dt>
          <dd className="mt-0.5 text-slate-700">
            {deviceType ? (
              <span className="inline-flex items-center gap-1.5">
                <Smartphone
                  className="size-3.5 shrink-0 text-slate-400"
                  strokeWidth={2}
                  aria-hidden
                />
                {deviceType}
              </span>
            ) : (
              <span className="text-slate-400">—</span>
            )}
            {appVersion ? (
              <p className="mt-0.5 font-mono text-[10.5px] text-slate-500">
                v{appVersion}
              </p>
            ) : null}
          </dd>
        </div>
      </div>

      <div className="mt-2.5">
        <dt className="font-semibold uppercase tracking-wide text-[10px] text-slate-500">
          Details from user
        </dt>
        <dd className="mt-1 whitespace-pre-wrap break-words rounded-lg border border-slate-200 bg-white px-3 py-2 text-sm text-slate-800">
          {details || (
            <span className="italic text-slate-400">
              (no details provided)
            </span>
          )}
        </dd>
      </div>

      {coachText ? (
        <div className="mt-2.5">
          <dt className="font-semibold uppercase tracking-wide text-[10px] text-slate-500">
            Coach line on screen
          </dt>
          <dd className="mt-1 whitespace-pre-wrap break-words rounded-lg border border-dashed border-slate-200 bg-white/60 px-3 py-2 text-sm italic text-slate-600">
            {coachText}
          </dd>
        </div>
      ) : null}

      <div className="mt-2.5">
        <label
          htmlFor={inputId}
          className="flex items-center gap-1.5 text-xs font-semibold text-slate-700"
        >
          <StickyNote
            className="size-3.5 shrink-0 text-violet-600"
            strokeWidth={2}
            aria-hidden
          />
          Admin notes
        </label>
        <textarea
          id={inputId}
          rows={3}
          value={noteDraft}
          onChange={(e) => onChangeNote(e.target.value)}
          disabled={anyBusy}
          placeholder="Internal notes for this report — visible only to admins…"
          className="mt-1.5 w-full resize-y rounded-lg border border-slate-200 bg-white px-3 py-2 text-sm text-slate-800 shadow-sm outline-none placeholder:text-slate-400 focus:border-orange-400 focus:ring-2 focus:ring-orange-500/20 disabled:cursor-not-allowed disabled:opacity-60"
        />
        <div className="mt-1.5 flex flex-wrap items-center justify-between gap-2">
          <p className="font-mono text-[10.5px] text-slate-400">
            {report.firestoreDocId}
          </p>
          <button
            type="button"
            onClick={onSaveNote}
            disabled={!notesDirty || anyBusy}
            className="inline-flex cursor-pointer items-center gap-1.5 rounded-lg border border-orange-200 bg-orange-50 px-2.5 py-1 text-[11px] font-semibold text-orange-900 transition hover:border-orange-300 hover:bg-orange-100/80 focus:outline-none focus-visible:ring-2 focus-visible:ring-orange-500 disabled:cursor-not-allowed disabled:opacity-50"
          >
            {saving ? (
              <>
                <Loader2
                  className="size-3 animate-spin"
                  strokeWidth={2}
                  aria-hidden
                />
                Saving…
              </>
            ) : (
              <>
                <StickyNote
                  className="size-3 shrink-0"
                  strokeWidth={2}
                  aria-hidden
                />
                Save notes
              </>
            )}
          </button>
        </div>
      </div>
    </li>
  )
}
