import {
  AlertCircle,
  BadgeCheck,
  CheckCircle2,
  Download,
  Gift,
  Inbox,
  Infinity as InfinityIcon,
  Loader2,
  PanelRight,
  Search,
  SearchX,
  Timer,
  UsersRound,
  X,
  XCircle,
} from 'lucide-react'
import { useCallback, useEffect, useMemo, useState } from 'react'
import { collection, doc, getDocs, updateDoc } from 'firebase/firestore'
import { USER_AUTO_UNLIMITED_FIELD } from './bulkUnlimitedSessions.js'
import { db, firebaseReady, usersCollectionName } from './firebase'
import { downloadCsv, rowsToCsv } from './csv'
import {
  AUDIENCE_EXPORT_FIELDS,
  AUDIENCE_MULTI_ID_FIELD_CONFIG,
  AUDIENCE_SEGMENT_SPECS,
  ONBOARDING_QUESTION_BY_FIELD,
} from './userFields'
import OnboardingUserDetailModal from './OnboardingUserDetailModal.jsx'
import { normalizeUserForExport } from './normalizeUser'
import { AUDIENCE_FILTER_UNSET as UNSET } from './audienceConstants'
import AudienceMultiIdSelect from './AudienceMultiIdSelect.jsx'
import AudienceScalarSelect from './AudienceScalarSelect.jsx'
import { fetchPurchaseStatusBySubscriptions } from './fetchCustomersAxios.js'

function docToRow(id, data) {
  return { id, ...data }
}

/**
 * @param {Array<Record<string, unknown>>} rows
 * @param {string} fieldKey
 * @param {string} allLabel
 */
function buildSegmentOptions(rows, fieldKey, allLabel) {
  let hasEmpty = false
  const uniq = new Set()
  for (const r of rows) {
    const s = String(r[fieldKey] ?? '').trim()
    if (!s) hasEmpty = true
    else uniq.add(s)
  }
  /** @type {{ value: string, label: string }[]} */
  const out = [{ value: 'all', label: allLabel }]
  if (hasEmpty) out.push({ value: UNSET, label: 'Not set (empty)' })
  for (const v of Array.from(uniq).sort()) {
    out.push({ value: v, label: v })
  }
  return out
}

/**
 * Multi-select (OR): no selection → no filter; otherwise user matches if any
 * selected option applies (including UNSET for empty onboarding value).
 *
 * @param {Record<string, unknown>} row
 * @param {string} idKey
 * @param {string[]} selectedIds
 */
function rowMatchesMultiIdSegment(row, idKey, selectedIds) {
  if (!selectedIds || selectedIds.length === 0) return true
  const list = Array.isArray(row[idKey]) ? row[idKey] : []
  return selectedIds.some((sel) => {
    if (sel === UNSET) return list.length === 0
    return list.includes(sel)
  })
}

/**
 * @param {Record<string, unknown>} row
 * @param {string} key
 * @param {string} filter
 */
function rowMatchesSegment(row, key, filter) {
  if (filter === 'all') return true
  const v = String(row[key] ?? '').trim()
  if (filter === UNSET) return v === ''
  return v === filter
}

/**
 * @param {Record<string, unknown>} row
 * @param {{ key: string }} spec
 * @param {string} scalarFilter
 * @param {string[]} multiSelected
 * @param {Record<string, string[]>} multiFilters
 */
function rowMatchesAudienceSpec(row, spec, scalarFilter, multiFilters) {
  const multi = AUDIENCE_MULTI_ID_FIELD_CONFIG[spec.key]
  if (multi) {
    return rowMatchesMultiIdSegment(
      row,
      multi.idKey,
      multiFilters[spec.key] ?? [],
    )
  }
  return rowMatchesSegment(row, spec.key, scalarFilter)
}

/**
 * @param {Record<string, unknown>} row
 * @param {string} q
 */
/** @param {'all' | 'purchased'} mode */
function rowMatchesPurchaseFilter(row, mode) {
  if (mode === 'all') return true
  return row.isPurchased === true
}

/** @param {'all' | 'unlimited'} mode */
function rowMatchesSessionFilter(row, mode) {
  if (mode === 'unlimited') return row.canDoUnlimitedSessions === true
  return true
}

/** @param {'all' | 'free'} mode */
function rowMatchesFreeAccessFilter(row, mode) {
  if (mode === 'free') return row.freeAccess === true
  return true
}

/** @param {'all' | 'with_question_stats'} mode */
function rowMatchesQuestionStatsFilter(row, mode) {
  if (mode === 'all') return true
  const stats = toRecord(row.sessionStats)
  if (!stats) return false
  if (Array.isArray(stats.selectedQuestions) && stats.selectedQuestions.length > 0) {
    return true
  }
  const selectedCount = toFiniteNumber(stats.selectedQuestionCount)
  return typeof selectedCount === 'number' && selectedCount > 0
}

function rowMatchesSearch(row, q) {
  if (!q) return true
  const ql = q.trim().toLowerCase()
  if (!ql) return true
  const parts = []
  for (const { key } of AUDIENCE_EXPORT_FIELDS) {
    const v = row[key]
    if (typeof v === 'boolean') parts.push(v ? 'yes' : 'no')
    else parts.push(String(v ?? ''))
  }
  for (const k of [
    'struggleAreaIds',
    'goalIds',
    'leastFamiliarAreaIds',
    'formatsList',
    'trainingTimePerDayList',
  ]) {
    const arr = row[k]
    if (Array.isArray(arr)) parts.push(arr.join(' '))
  }
  parts.push(String(row.name ?? ''), String(row.email ?? ''))
  return parts.join(' ').toLowerCase().includes(ql)
}

function hasEmail(email) {
  return typeof email === 'string' && email.trim() !== ''
}

const DEBUG_DOC_ID = 'z9lbnkt9icUIyeCw04u3wvJfWtP2'

function debugJsonReplacer(_key, value) {
  if (value && typeof value === 'object' && typeof value.toDate === 'function') {
    try {
      return value.toDate().toISOString()
    } catch {
      return value
    }
  }
  return value
}

/**
 * @param {unknown} value
 * @returns {Record<string, unknown> | null}
 */
function toRecord(value) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return null
  return /** @type {Record<string, unknown>} */ (value)
}

/**
 * @param {unknown} value
 * @returns {number | null}
 */
function toFiniteNumber(value) {
  if (typeof value === 'number' && Number.isFinite(value)) return value
  if (typeof value === 'string' && value.trim() !== '') {
    const parsed = Number(value)
    if (Number.isFinite(parsed)) return parsed
  }
  return null
}

/**
 * @param {string} value
 */
function prettyKey(value) {
  return String(value)
    .replace(/([a-z0-9])([A-Z])/g, '$1 $2')
    .replace(/[_-]+/g, ' ')
    .trim()
    .replace(/\b\w/g, (ch) => ch.toUpperCase())
}

/**
 * @param {unknown} value
 * @returns {string[]}
 */
function stringList(value) {
  if (Array.isArray(value)) {
    return value
      .map((item) => String(item ?? '').trim())
      .filter(Boolean)
  }
  const t = String(value ?? '').trim()
  return t ? [t] : []
}

/**
 * @param {unknown} value
 */
function formatDateTime(value) {
  const text =
    typeof value === 'string'
      ? value.trim()
      : value && typeof value === 'object' && typeof value.toDate === 'function'
        ? value.toDate().toISOString()
        : ''
  if (!text) return ''
  const date = new Date(text)
  if (Number.isNaN(date.getTime())) return text
  return date.toLocaleString()
}

/**
 * @param {{ row: (Record<string, unknown> & { id: string }) | null, onClose: () => void }} props
 */
function AudienceSessionStatsModal({ row, onClose }) {
  useEffect(() => {
    if (!row) return
    const prev = document.body.style.overflow
    document.body.style.overflow = 'hidden'
    const onKey = (e) => {
      if (e.key === 'Escape') onClose()
    }
    window.addEventListener('keydown', onKey)
    return () => {
      document.body.style.overflow = prev
      window.removeEventListener('keydown', onKey)
    }
  }, [row, onClose])

  if (!row) return null
  const stats = toRecord(row.sessionStats)
  const filters = toRecord(stats?.filters)
  const selectedQuestions = Array.isArray(stats?.selectedQuestions)
    ? stats.selectedQuestions
    : []
  const selectedQuestionCounts = selectedQuestions.reduce(
    (acc, q) => {
      const zone = String(toRecord(q)?.zone ?? '')
        .trim()
        .toLowerCase()
      if (zone === 'stretch') acc.stretch += 1
      else if (zone === 'confidence') acc.confidence += 1
      else if (zone === 'deep') acc.deep += 1
      else if (zone === 'outside') acc.outside += 1
      else if (zone === 'training') acc.training += 1
      return acc
    },
    { stretch: 0, confidence: 0, deep: 0, outside: 0, training: 0 },
  )
  const filterEntries = filters ? Object.entries(filters) : []
  const statsUpdated =
    formatDateTime(stats?.capturedAt) ||
    formatDateTime(row.sessionStatsUpdatedAt) ||
    formatDateTime(row.updatedAt)

  return (
    <div
      className="fixed inset-0 z-[2100] flex items-end justify-center p-0 sm:items-center sm:p-6"
      role="dialog"
      aria-modal="true"
      aria-labelledby="session-stats-modal-title"
    >
      <button
        type="button"
        className="absolute inset-0 cursor-pointer bg-slate-950/55 backdrop-blur-[3px]"
        onClick={onClose}
        aria-label="Close session stats"
      />
      <div className="relative flex max-h-[min(92vh,860px)] w-full max-w-2xl flex-col overflow-hidden rounded-t-[1.25rem] border border-white/20 bg-gradient-to-br from-white via-teal-50/30 to-white shadow-[0_25px_50px_-12px_rgba(15,23,42,0.25)] sm:rounded-2xl">
        <div className="shrink-0 border-b border-teal-100/80 bg-white/70 px-5 pb-4 pt-5">
          <div className="flex items-start justify-between gap-4">
            <div className="min-w-0">
              <p className="inline-flex rounded-full bg-teal-50 px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wider text-teal-900 ring-1 ring-teal-200/80">
                User session stats
              </p>
              <h2
                id="session-stats-modal-title"
                className="mt-2 truncate text-xl font-semibold tracking-tight text-slate-900"
              >
                {String(row.name ?? '').trim() || String(row.email ?? 'User')}
              </h2>
              <p className="mt-1 truncate font-mono text-xs text-slate-600">
                {String(row.email ?? '') || '—'}
              </p>
            </div>
            <button
              type="button"
              onClick={onClose}
              className="shrink-0 cursor-pointer rounded-xl border border-slate-200/90 bg-white/90 p-2 text-slate-500 shadow-sm transition hover:border-slate-300 hover:bg-slate-50 hover:text-slate-900 focus:outline-none focus-visible:ring-2 focus-visible:ring-slate-400 focus-visible:ring-offset-2"
              aria-label="Close session stats"
            >
              <X className="size-5" strokeWidth={2} aria-hidden />
            </button>
          </div>
        </div>
        <div className="min-h-0 flex-1 overflow-y-auto px-5 py-5">
          {!stats ? (
            <div className="rounded-xl border border-slate-200/90 bg-white p-4 text-sm text-slate-600">
              No session stats found for this user.
            </div>
          ) : (
            <>
              <dl className="grid grid-cols-1 gap-3 sm:grid-cols-3">
                <div className="rounded-xl border border-slate-100 bg-gradient-to-b from-white to-slate-50 px-3.5 py-3 shadow-sm">
                  <dt className="text-[11px] font-semibold uppercase tracking-wide text-slate-500">
                    ELO
                  </dt>
                  <dd className="mt-1 font-mono text-lg font-semibold text-slate-900">
                    {toFiniteNumber(stats.userEloRating) ?? '—'}
                  </dd>
                </div>
                <div className="rounded-xl border border-slate-100 bg-gradient-to-b from-white to-slate-50 px-3.5 py-3 shadow-sm">
                  <dt className="text-[11px] font-semibold uppercase tracking-wide text-slate-500">
                    Selected / requested
                  </dt>
                  <dd className="mt-1 font-mono text-lg font-semibold text-slate-900">
                    {toFiniteNumber(stats.selectedQuestionCount) ?? '—'} /{' '}
                    {toFiniteNumber(stats.requestedQuestionCount) ?? '—'}
                  </dd>
                </div>
                <div className="rounded-xl border border-slate-100 bg-gradient-to-b from-white to-slate-50 px-3.5 py-3 shadow-sm">
                  <dt className="text-[11px] font-semibold uppercase tracking-wide text-slate-500">
                    Pool
                  </dt>
                  <dd className="mt-1 font-mono text-lg font-semibold text-slate-900">
                    {toFiniteNumber(stats.effectiveFilteredPoolCount) ?? '—'}
                  </dd>
                </div>
              </dl>
              {(filterEntries.length > 0 || selectedQuestions.length > 0) ? (
                <div className="mt-5 space-y-4">
                  {filterEntries.length > 0 ? (
                    <section className="rounded-xl border border-slate-100 bg-white p-3.5 shadow-sm">
                      <p className="text-[11px] font-semibold uppercase tracking-[0.08em] text-slate-500">
                        Filters
                      </p>
                      <div className="mt-2.5 grid grid-cols-1 gap-2.5 sm:grid-cols-2">
                        {filterEntries.map(([key, value]) => {
                          const items = stringList(value)
                          return (
                            <div
                              key={key}
                              className="rounded-lg border border-slate-100 bg-slate-50/70 p-2.5"
                            >
                              <p className="text-[11px] font-medium text-slate-600">
                                {prettyKey(key)}
                              </p>
                              <div className="mt-1.5 flex flex-wrap gap-1.5">
                                {items.length > 0 ? (
                                  items.map((item) => (
                                    <span
                                      key={`${key}-${item}`}
                                      className="inline-flex rounded-md bg-white px-2 py-1 text-[11px] font-medium text-slate-700 ring-1 ring-slate-200"
                                    >
                                      {item}
                                    </span>
                                  ))
                                ) : (
                                  <span className="text-[11px] text-slate-400">—</span>
                                )}
                              </div>
                            </div>
                          )
                        })}
                      </div>
                    </section>
                  ) : null}
                  {selectedQuestions.length > 0 ? (
                    <section className="rounded-xl border border-slate-100 bg-white p-3.5 shadow-sm">
                      <p className="text-[11px] font-semibold uppercase tracking-[0.08em] text-slate-500">
                        Selected question types
                      </p>
                      <dl className="mt-2.5 grid grid-cols-2 gap-2 sm:grid-cols-3 lg:grid-cols-6">
                        <div className="rounded-lg border border-slate-100 bg-slate-50/70 px-2.5 py-2">
                          <dt className="text-[10px] font-medium uppercase tracking-wide text-slate-500">
                            Total
                          </dt>
                          <dd className="mt-1 font-mono text-base font-semibold text-slate-900">
                            {selectedQuestions.length}
                          </dd>
                        </div>
                        <div className="rounded-lg border border-amber-100 bg-amber-50/70 px-2.5 py-2">
                          <dt className="text-[10px] font-medium uppercase tracking-wide text-amber-700">
                            Stretch
                          </dt>
                          <dd className="mt-1 font-mono text-base font-semibold text-amber-900">
                            {selectedQuestionCounts.stretch}
                          </dd>
                        </div>
                        <div className="rounded-lg border border-emerald-100 bg-emerald-50/70 px-2.5 py-2">
                          <dt className="text-[10px] font-medium uppercase tracking-wide text-emerald-700">
                            Confidence
                          </dt>
                          <dd className="mt-1 font-mono text-base font-semibold text-emerald-900">
                            {selectedQuestionCounts.confidence}
                          </dd>
                        </div>
                        <div className="rounded-lg border border-blue-100 bg-blue-50/70 px-2.5 py-2">
                          <dt className="text-[10px] font-medium uppercase tracking-wide text-blue-700">
                            Training
                          </dt>
                          <dd className="mt-1 font-mono text-base font-semibold text-blue-900">
                            {selectedQuestionCounts.training}
                          </dd>
                        </div>
                        <div className="rounded-lg border border-purple-100 bg-purple-50/70 px-2.5 py-2">
                          <dt className="text-[10px] font-medium uppercase tracking-wide text-purple-700">
                            Deep
                          </dt>
                          <dd className="mt-1 font-mono text-base font-semibold text-purple-900">
                            {selectedQuestionCounts.deep}
                          </dd>
                        </div>
                        <div className="rounded-lg border border-cyan-100 bg-cyan-50/70 px-2.5 py-2">
                          <dt className="text-[10px] font-medium uppercase tracking-wide text-cyan-700">
                            Outside
                          </dt>
                          <dd className="mt-1 font-mono text-base font-semibold text-cyan-900">
                            {selectedQuestionCounts.outside}
                          </dd>
                        </div>
                      </dl>
                    </section>
                  ) : null}
                  {selectedQuestions.length > 0 ? (
                    <section className="rounded-xl border border-slate-100 bg-white p-3.5 shadow-sm">
                      <p className="text-[11px] font-semibold uppercase tracking-[0.08em] text-slate-500">
                        Selected questions
                      </p>
                      <ul className="mt-2.5 space-y-2">
                        {selectedQuestions.map((q, idx) => {
                          const question = toRecord(q)
                          const id =
                            question?.sourceId ??
                            question?.id ??
                            `question-${idx + 1}`
                          const zone = String(question?.zone ?? '—')
                          const elo = toFiniteNumber(question?.eloRating)
                          const expected = toFiniteNumber(question?.expectedCorrectPct)
                          const zoneTone =
                            zone === 'deep'
                              ? 'bg-purple-100 text-purple-800 ring-purple-200'
                              : zone === 'stretch'
                                ? 'bg-amber-100 text-amber-800 ring-amber-200'
                                : zone === 'training'
                                  ? 'bg-blue-100 text-blue-800 ring-blue-200'
                                  : 'bg-emerald-100 text-emerald-800 ring-emerald-200'
                          return (
                            <li
                              key={String(id)}
                              className="rounded-lg border border-slate-100 bg-slate-50/70 p-2.5"
                            >
                              <div className="flex items-center justify-between gap-2">
                                <span className="font-mono text-[11px] font-semibold text-slate-800">
                                  #{String(id)}
                                </span>
                                <span
                                  className={`inline-flex rounded-full px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wide ring-1 ${zoneTone}`}
                                >
                                  {zone}
                                </span>
                              </div>
                              <div className="mt-2 flex items-center gap-2">
                                <span className="rounded-md bg-white px-2 py-1 font-mono text-[11px] text-slate-700 ring-1 ring-slate-200">
                                  ELO {elo ?? '—'}
                                </span>
                                <span className="rounded-md bg-white px-2 py-1 font-mono text-[11px] text-slate-700 ring-1 ring-slate-200">
                                  Expected correct {expected ?? '—'}% chance
                                </span>
                              </div>
                            </li>
                          )
                        })}
                      </ul>
                    </section>
                  ) : null}
                </div>
              ) : null}
              {statsUpdated ? (
                <p className="mt-4 text-[11px] text-slate-500">
                  Last updated: {statsUpdated}
                </p>
              ) : null}
            </>
          )}
        </div>
      </div>
    </div>
  )
}

/**
 * @param {unknown} value
 * @param {boolean} purchaseLoading
 */
function audiencePurchaseCell(value, purchaseLoading) {
  if (purchaseLoading) {
    return (
      <span className="inline-flex items-center gap-2 text-slate-500">
        <Loader2
          className="size-4 animate-spin text-teal-600"
          strokeWidth={2}
          aria-label="Loading purchase status"
        />
        <span className="text-xs">Syncing…</span>
      </span>
    )
  }
  if (value === undefined || value === null) {
    return <span className="text-slate-400">—</span>
  }
  if (typeof value === 'boolean') {
    return <PurchasedYesNoBadge value={value} />
  }
  return (
    <span className="font-mono text-xs text-slate-700">{String(value)}</span>
  )
}

/** Same purchase Yes/No treatment as Users table. */
function PurchasedYesNoBadge({ value }) {
  if (value) {
    return (
      <span className="inline-flex items-center gap-1.5 rounded-md bg-emerald-100 px-2 py-1 font-sans text-xs font-bold uppercase tracking-wide text-emerald-900 ring-1 ring-emerald-300/80 shadow-sm shadow-emerald-900/5">
        <CheckCircle2
          className="size-4 shrink-0 text-emerald-600"
          strokeWidth={2.25}
          aria-hidden
        />
        Yes
      </span>
    )
  }
  return (
    <span className="inline-flex items-center gap-1.5 font-sans text-xs font-normal text-slate-500">
      <XCircle className="size-3 shrink-0 text-slate-400" strokeWidth={2} aria-hidden />
      No
    </span>
  )
}

function initialSegmentFilters() {
  return Object.fromEntries(
    AUDIENCE_SEGMENT_SPECS.filter((s) => !AUDIENCE_MULTI_ID_FIELD_CONFIG[s.key]).map(
      (s) => [s.key, 'all'],
    ),
  )
}

function initialMultiIdFilters() {
  return /** @type {Record<string, string[]>} */ (
    Object.fromEntries(
      Object.keys(AUDIENCE_MULTI_ID_FIELD_CONFIG).map((k) => [k, []]),
    )
  )
}

export default function AudiencePage() {
  const [rows, setRows] = useState(
    /** @type {Array<Record<string, unknown> & { id: string }>} */ ([]),
  )
  const [loading, setLoading] = useState(!!firebaseReady)
  const [error, setError] = useState(null)
  const [searchQuery, setSearchQuery] = useState('')
  const [filters, setFilters] = useState(
    /** @type {Record<string, string>} */ (initialSegmentFilters),
  )
  const [multiIdFilters, setMultiIdFilters] = useState(
    /** @type {Record<string, string[]>} */ (initialMultiIdFilters),
  )
  const [detailRow, setDetailRow] = useState(
    /** @type {(typeof rows)[0] | null} */ (null),
  )
  const [sessionStatsRow, setSessionStatsRow] = useState(
    /** @type {(typeof rows)[0] | null} */ (null),
  )
  const [purchaseFilter, setPurchaseFilter] = useState(
    /** @type {'all' | 'purchased'} */ ('purchased'),
  )
  const [sessionFilter, setSessionFilter] = useState(
    /** @type {'all' | 'unlimited'} */ ('all'),
  )
  const [purchasePendingIds, setPurchasePendingIds] = useState(
    /** @type {Record<string, true>} */ ({}),
  )
  const [sessionUpdatePendingIds, setSessionUpdatePendingIds] = useState(
    /** @type {Record<string, true>} */ ({}),
  )
  const [freeAccessFilter, setFreeAccessFilter] = useState(
    /** @type {'all' | 'free'} */ ('all'),
  )
  const [questionStatsFilter, setQuestionStatsFilter] = useState(
    /** @type {'all' | 'with_question_stats'} */ ('all'),
  )
  const [freeAccessUpdatePendingIds, setFreeAccessUpdatePendingIds] = useState(
    /** @type {Record<string, true>} */ ({}),
  )

  const purchaseSyncPending = Object.keys(purchasePendingIds).length > 0

  const toggleUnlimitedSessions = useCallback(async (userId, currentlyEnabled) => {
    if (!db) return
    const next = !currentlyEnabled
    setSessionUpdatePendingIds((p) => ({ ...p, [userId]: true }))
    setRows((prev) =>
      prev.map((r) =>
        r.id === userId ? { ...r, canDoUnlimitedSessions: next } : r,
      ),
    )
    setDetailRow((d) =>
      d?.id === userId ? { ...d, canDoUnlimitedSessions: next } : d,
    )
    try {
      await updateDoc(doc(db, usersCollectionName, userId), {
        canDoUnlimitedSessions: next,
        [USER_AUTO_UNLIMITED_FIELD]: false,
      })
    } catch (e) {
      setRows((prev) =>
        prev.map((r) =>
          r.id === userId
            ? { ...r, canDoUnlimitedSessions: currentlyEnabled }
            : r,
        ),
      )
      setDetailRow((d) =>
        d?.id === userId
          ? { ...d, canDoUnlimitedSessions: currentlyEnabled }
          : d,
      )
      setError(e?.message || 'Failed to update unlimited sessions')
    } finally {
      setSessionUpdatePendingIds((p) => {
        const n = { ...p }
        delete n[userId]
        return n
      })
    }
  }, [])

  const toggleFreeAccess = useCallback(async (userId, currentlyEnabled) => {
    if (!db) return
    const next = !currentlyEnabled
    setFreeAccessUpdatePendingIds((p) => ({ ...p, [userId]: true }))
    setRows((prev) =>
      prev.map((r) => (r.id === userId ? { ...r, freeAccess: next } : r)),
    )
    setDetailRow((d) => (d?.id === userId ? { ...d, freeAccess: next } : d))
    try {
      await updateDoc(doc(db, usersCollectionName, userId), {
        freeAccess: next,
      })
    } catch (e) {
      setRows((prev) =>
        prev.map((r) =>
          r.id === userId ? { ...r, freeAccess: currentlyEnabled } : r,
        ),
      )
      setDetailRow((d) =>
        d?.id === userId ? { ...d, freeAccess: currentlyEnabled } : d,
      )
      setError(e?.message || 'Failed to update free access')
    } finally {
      setFreeAccessUpdatePendingIds((p) => {
        const n = { ...p }
        delete n[userId]
        return n
      })
    }
  }, [])

  const segmentOptionsMap = useMemo(() => {
    /** @type {Record<string, { value: string, label: string }[]>} */
    const m = {}
    for (const s of AUDIENCE_SEGMENT_SPECS) {
      if (AUDIENCE_MULTI_ID_FIELD_CONFIG[s.key]) continue
      m[s.key] = buildSegmentOptions(rows, s.key, s.allLabel)
    }
    return m
  }, [rows])

  const filteredRows = useMemo(() => {
    const q = searchQuery.trim().toLowerCase()
    return rows.filter(
      (row) =>
        rowMatchesPurchaseFilter(row, purchaseFilter) &&
        rowMatchesSessionFilter(row, sessionFilter) &&
        rowMatchesFreeAccessFilter(row, freeAccessFilter) &&
        rowMatchesQuestionStatsFilter(row, questionStatsFilter) &&
        AUDIENCE_SEGMENT_SPECS.every((s) =>
          rowMatchesAudienceSpec(
            row,
            s,
            filters[s.key] ?? 'all',
            multiIdFilters,
          ),
        ) &&
        rowMatchesSearch(row, q),
    )
  }, [rows, filters, multiIdFilters, searchQuery, purchaseFilter, sessionFilter, freeAccessFilter, questionStatsFilter])

  useEffect(() => {
    const matchedUser = rows.find((user) => user.id === DEBUG_DOC_ID)
    if (matchedUser) {
      console.log('User for doc ID', DEBUG_DOC_ID, matchedUser)
    }
  }, [rows])

  const hasActiveFilters =
    searchQuery.trim() !== '' ||
    purchaseFilter !== 'all' ||
    sessionFilter !== 'all' ||
    freeAccessFilter !== 'all' ||
    questionStatsFilter !== 'all' ||
    Object.values(multiIdFilters).some((a) => a.length > 0) ||
    AUDIENCE_SEGMENT_SPECS.some(
      (s) =>
        !AUDIENCE_MULTI_ID_FIELD_CONFIG[s.key] &&
        filters[s.key] !== 'all',
    )

  const clearMultiId = useCallback((specKey) => {
    setMultiIdFilters((prev) => ({ ...prev, [specKey]: [] }))
  }, [])

  useEffect(() => {
    if (!firebaseReady || !db) {
      setLoading(false)
      return
    }

    let cancelled = false
    setLoading(true)
    setError(null)
    setPurchasePendingIds({})

    ;(async () => {
      let next = []
      try {
        const snap = await getDocs(collection(db, usersCollectionName))
        if (cancelled) return
        const debugDoc = snap.docs.find((d) => d.id === DEBUG_DOC_ID)
        if (debugDoc) {
          const rawData = debugDoc.data()
          const fieldNames = Object.keys(rawData).sort()
          console.group(`Raw Firestore user record: ${DEBUG_DOC_ID}`)
          console.log('docId', debugDoc.id)
          console.log('fieldCount', fieldNames.length)
          console.log('fieldNames', fieldNames)
          for (const key of fieldNames) {
            console.log(`field:${key}`, rawData[key])
          }
          console.dir(rawData, { depth: null })
          console.log(
            'rawData JSON (full)',
            JSON.stringify(rawData, debugJsonReplacer, 2),
          )
          console.groupEnd()
        }
        next = snap.docs
          .map((d) => normalizeUserForExport(docToRow(d.id, d.data())))
          .filter((row) => hasEmail(row.email))
        if (!cancelled) setRows(next)
      } catch (e) {
        if (!cancelled) {
          setError(e?.message || 'Failed to load users')
          setRows([])
        }
      } finally {
        if (!cancelled) setLoading(false)
      }

      if (cancelled) return

      const apiKey = import.meta.env.VITE_REVENUECAT_SECRET_API_KEY?.trim()
      const projectId = import.meta.env.VITE_REVENUECAT_PROJECT_ID?.trim()
      const usersNeedingPurchaseSync = next.filter(
        (r) => typeof r.isPurchased !== 'boolean',
      )
      if (apiKey && projectId && usersNeedingPurchaseSync.length > 0) {
        if (!cancelled) {
          setPurchasePendingIds(
            Object.fromEntries(usersNeedingPurchaseSync.map((r) => [r.id, true])),
          )
        }
        await fetchPurchaseStatusBySubscriptions({
          apiKey,
          projectId,
          customerIds: usersNeedingPurchaseSync.map((r) => r.id),
          concurrency: 5,
          onProgress: (id, purchased) => {
            if (cancelled) return
            setRows((prev) =>
              prev.map((r) =>
                r.id === id ? { ...r, isPurchased: purchased } : r,
              ),
            )
            setPurchasePendingIds((prev) => {
              const n = { ...prev }
              delete n[id]
              return n
            })
          },
        })
      }
    })()

    return () => {
      cancelled = true
    }
  }, [])

  const handleExport = useCallback(() => {
    if (filteredRows.length === 0 || purchaseSyncPending) return
    const csv = rowsToCsv(filteredRows, AUDIENCE_EXPORT_FIELDS)
    const stamp = new Date().toISOString().slice(0, 19).replace(/[:T]/g, '-')
    downloadCsv(`users-${stamp}.csv`, csv)
  }, [filteredRows, purchaseSyncPending])

  return (
    <div className="min-h-[calc(100vh-3rem)] bg-gradient-to-b from-teal-50/40 via-slate-50/90 to-slate-100/80 px-4 py-6 sm:px-6 lg:px-8 lg:py-10">
      <header className="mb-8 flex flex-col gap-6">
        <div className="flex flex-col gap-4 sm:flex-row sm:items-start sm:justify-between sm:gap-6">
          <div className="flex min-w-0 items-start gap-3 sm:items-center sm:gap-4">
            <div className="flex size-11 shrink-0 items-center justify-center rounded-2xl bg-white shadow-lg shadow-teal-900/[0.07] ring-1 ring-teal-100/80 sm:size-12">
              <UsersRound
                className="size-5 text-teal-600 sm:size-6"
                strokeWidth={2}
                aria-hidden
              />
            </div>
            <div className="min-w-0">
              <h1 className="bg-gradient-to-r from-slate-900 to-slate-700 bg-clip-text text-2xl font-semibold tracking-tight text-transparent sm:text-3xl">
                Users
              </h1>
              <p className="mt-1 flex items-center gap-1.5 text-sm text-slate-600">
                {rows.length > 0 ? (
                  <>
                    <span className="inline-flex size-1.5 rounded-full bg-teal-500" />
                    {`${filteredRows.length} shown${
                      hasActiveFilters ? ` of ${rows.length} with email` : ''
                    }`}
                  </>
                ) : !loading ? (
                  <span>Collection: {usersCollectionName}</span>
                ) : null}
              </p>
              <p className="mt-1.5 max-w-2xl text-xs leading-relaxed text-slate-500">
                Each filter matches a field on the user’s{' '}
                <code className="rounded bg-slate-100 px-1 py-0.5 font-mono text-[11px] text-slate-700">
                  onboarding
                </code>{' '}
                document. Export CSV for mail tools.
              </p>
            </div>
          </div>
          <div className="flex w-full max-w-full flex-row flex-nowrap items-start justify-end gap-3 overflow-x-auto pb-0.5 sm:ml-auto sm:w-auto sm:shrink-0 sm:gap-4">
            <fieldset className="flex shrink-0 flex-col gap-2 rounded-xl border border-teal-200/90 bg-white/95 px-3 py-2.5 shadow-md shadow-teal-900/[0.04] ring-1 ring-teal-500/10 backdrop-blur-sm sm:py-2 sm:pl-3 sm:pr-4">
              <legend className="sr-only">Filter by purchase</legend>
              <div className="flex min-w-0 items-center gap-2 text-slate-700">
                <BadgeCheck
                  className="size-4 shrink-0 text-teal-600"
                  strokeWidth={2}
                  aria-hidden
                />
                <span className="text-sm font-medium">Purchase</span>
              </div>
              <div className="flex flex-col gap-2 sm:flex-row sm:items-center sm:gap-4">
                <label className="flex cursor-pointer items-center gap-2 text-sm text-slate-800">
                  <input
                    type="radio"
                    name="audience-purchase-filter"
                    checked={purchaseFilter === 'all'}
                    onChange={() => setPurchaseFilter('all')}
                    className="size-4 shrink-0 cursor-pointer border-slate-300 text-teal-600 focus:ring-teal-500"
                  />
                  All users
                </label>
                <label className="flex cursor-pointer items-center gap-2 text-sm text-slate-800">
                  <input
                    type="radio"
                    name="audience-purchase-filter"
                    checked={purchaseFilter === 'purchased'}
                    onChange={() => setPurchaseFilter('purchased')}
                    className="size-4 shrink-0 cursor-pointer border-slate-300 text-teal-600 focus:ring-teal-500"
                  />
                  Purchased only
                </label>
              </div>
            </fieldset>
            <fieldset className="flex shrink-0 flex-col gap-2 rounded-xl border border-teal-200/90 bg-white/95 px-3 py-2.5 shadow-md shadow-teal-900/[0.04] ring-1 ring-teal-500/10 backdrop-blur-sm sm:py-2 sm:pl-3 sm:pr-4">
              <legend className="sr-only">Filter by session type</legend>
              <div className="flex min-w-0 items-center gap-2 text-slate-700">
                <Timer
                  className="size-4 shrink-0 text-teal-600"
                  strokeWidth={2}
                  aria-hidden
                />
                <span className="text-sm font-medium">Sessions</span>
              </div>
              <div className="flex flex-col gap-2 sm:flex-row sm:flex-wrap sm:items-center sm:gap-x-4 sm:gap-y-2">
                <label className="flex cursor-pointer items-center gap-2 text-sm text-slate-800">
                  <input
                    type="radio"
                    name="audience-session-filter"
                    checked={sessionFilter === 'all'}
                    onChange={() => setSessionFilter('all')}
                    className="size-4 shrink-0 cursor-pointer border-slate-300 text-teal-600 focus:ring-teal-500"
                  />
                  All users
                </label>
                <label className="flex cursor-pointer items-center gap-2 text-sm text-slate-800">
                  <input
                    type="radio"
                    name="audience-session-filter"
                    checked={sessionFilter === 'unlimited'}
                    onChange={() => setSessionFilter('unlimited')}
                    className="size-4 shrink-0 cursor-pointer border-slate-300 text-teal-600 focus:ring-teal-500"
                  />
                  Unlimited sessions
                </label>
              </div>
            </fieldset>
            <fieldset className="flex shrink-0 flex-col gap-2 rounded-xl border border-teal-200/90 bg-white/95 px-3 py-2.5 shadow-md shadow-teal-900/[0.04] ring-1 ring-teal-500/10 backdrop-blur-sm sm:py-2 sm:pl-3 sm:pr-4">
              <legend className="sr-only">Filter by free access</legend>
              <div className="flex min-w-0 items-center gap-2 text-slate-700">
                <Gift
                  className="size-4 shrink-0 text-teal-600"
                  strokeWidth={2}
                  aria-hidden
                />
                <span className="text-sm font-medium">Free Access</span>
              </div>
              <div className="flex flex-col gap-2 sm:flex-row sm:flex-wrap sm:items-center sm:gap-x-4 sm:gap-y-2">
                <label className="flex cursor-pointer items-center gap-2 text-sm text-slate-800">
                  <input
                    type="radio"
                    name="audience-free-access-filter"
                    checked={freeAccessFilter === 'all'}
                    onChange={() => setFreeAccessFilter('all')}
                    className="size-4 shrink-0 cursor-pointer border-slate-300 text-teal-600 focus:ring-teal-500"
                  />
                  All users
                </label>
                <label className="flex cursor-pointer items-center gap-2 text-sm text-slate-800">
                  <input
                    type="radio"
                    name="audience-free-access-filter"
                    checked={freeAccessFilter === 'free'}
                    onChange={() => setFreeAccessFilter('free')}
                    className="size-4 shrink-0 cursor-pointer border-slate-300 text-teal-600 focus:ring-teal-500"
                  />
                  Free access only
                </label>
              </div>
            </fieldset>
            <fieldset className="flex shrink-0 flex-col gap-2 rounded-xl border border-teal-200/90 bg-white/95 px-3 py-2.5 shadow-md shadow-teal-900/[0.04] ring-1 ring-teal-500/10 backdrop-blur-sm sm:py-2 sm:pl-3 sm:pr-4">
              <legend className="sr-only">Filter by question stats</legend>
              <div className="flex min-w-0 items-center gap-2 text-slate-700">
                <span className="text-sm font-medium">Question stats</span>
              </div>
              <div className="flex flex-col gap-2 sm:flex-row sm:flex-wrap sm:items-center sm:gap-x-4 sm:gap-y-2">
                <label className="flex cursor-pointer items-center gap-2 text-sm text-slate-800">
                  <input
                    type="radio"
                    name="audience-question-stats-filter"
                    checked={questionStatsFilter === 'all'}
                    onChange={() => setQuestionStatsFilter('all')}
                    className="size-4 shrink-0 cursor-pointer border-slate-300 text-teal-600 focus:ring-teal-500"
                  />
                  All users
                </label>
                <label className="flex cursor-pointer items-center gap-2 text-sm text-slate-800">
                  <input
                    type="radio"
                    name="audience-question-stats-filter"
                    checked={questionStatsFilter === 'with_question_stats'}
                    onChange={() => setQuestionStatsFilter('with_question_stats')}
                    className="size-4 shrink-0 cursor-pointer border-slate-300 text-teal-600 focus:ring-teal-500"
                  />
                  Has question stats
                </label>
              </div>
            </fieldset>
          </div>
        </div>

        <div className="relative z-[998] flex flex-col gap-3 sm:flex-row sm:flex-wrap sm:items-center">
          <label className="sr-only" htmlFor="audience-search">
            Search
          </label>
          <div className="relative min-w-0 flex-1 sm:min-w-[16rem]">
            <Search
              className="pointer-events-none absolute left-3 top-1/2 size-4 -translate-y-1/2 text-slate-400"
              strokeWidth={2}
              aria-hidden
            />
            <input
              id="audience-search"
              type="search"
              placeholder="Search name, email, or any onboarding value…"
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              className="w-full rounded-xl border border-slate-200/90 bg-white/90 py-2.5 pl-10 pr-3 text-sm text-slate-900 shadow-md shadow-slate-900/[0.03] outline-none backdrop-blur-sm placeholder:text-slate-400 focus:border-teal-400 focus:ring-4 focus:ring-teal-500/15"
            />
          </div>
          <button
            type="button"
            onClick={handleExport}
            disabled={
              loading || filteredRows.length === 0 || purchaseSyncPending
            }
            className="inline-flex shrink-0 cursor-pointer items-center justify-center gap-2 rounded-xl bg-gradient-to-b from-teal-500 to-teal-600 px-4 py-2.5 text-sm font-semibold text-white shadow-lg shadow-teal-900/20 transition hover:from-teal-600 hover:to-teal-700 focus:outline-none focus-visible:ring-2 focus-visible:ring-teal-500 focus-visible:ring-offset-2 disabled:cursor-not-allowed disabled:opacity-45"
          >
            <Download className="size-4" strokeWidth={2} aria-hidden />
            Export CSV
          </button>
        </div>

        <div className="relative z-[999] rounded-2xl border border-teal-100/60 bg-white/90 p-4 shadow-[0_8px_30px_-8px_rgba(15,118,110,0.12)] ring-1 ring-teal-900/[0.04] backdrop-blur-sm">
            <p className="mb-4 text-[11px] font-semibold uppercase tracking-[0.14em] text-teal-800">
              Filter by answer
            </p>
            <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 xl:grid-cols-3 2xl:grid-cols-4">
              {AUDIENCE_SEGMENT_SPECS.map((spec, index) => {
                const question =
                  ONBOARDING_QUESTION_BY_FIELD[spec.key] ?? spec.ariaLabel
                const qn = index + 1
                const selectId = `audience-${spec.key}`
                const multiCfg = AUDIENCE_MULTI_ID_FIELD_CONFIG[spec.key]

                if (multiCfg) {
                  const selected = multiIdFilters[spec.key] ?? []
                  return (
                    <fieldset
                      key={spec.key}
                      className="flex min-w-0 flex-col gap-2 rounded-xl border border-slate-200/80 bg-slate-50/50 p-3"
                    >
                      <legend className="flex w-full min-w-0 gap-2.5 px-0 text-left">
                        <span
                          className="mt-0.5 inline-flex size-6 shrink-0 items-center justify-center rounded-md bg-teal-600 font-mono text-[10px] font-bold text-white"
                          aria-hidden
                        >
                          {qn}
                        </span>
                        <span className="min-w-0 text-sm font-semibold leading-snug text-slate-900">
                          {question}
                        </span>
                      </legend>
                      <AudienceMultiIdSelect
                        rows={rows}
                        idKey={multiCfg.idKey}
                        idLabelMap={multiCfg.idLabelMap}
                        valueIds={selected}
                        onIdsChange={(ids) =>
                          setMultiIdFilters((prev) => ({
                            ...prev,
                            [spec.key]: ids,
                          }))
                        }
                        onClear={() => clearMultiId(spec.key)}
                        inputId={selectId}
                        qn={qn}
                        question={question}
                      />
                    </fieldset>
                  )
                }

                return (
                  <div
                    key={spec.key}
                    className="flex min-w-0 flex-col gap-2.5 rounded-xl border border-slate-200/80 bg-slate-50/50 p-3"
                  >
                    <label
                      htmlFor={selectId}
                      className="flex min-w-0 cursor-pointer gap-2.5"
                    >
                      <span
                        className="mt-0.5 inline-flex size-6 shrink-0 items-center justify-center rounded-md bg-teal-600 font-mono text-[10px] font-bold text-white"
                        aria-hidden
                      >
                        {qn}
                      </span>
                      <span className="min-w-0 text-sm font-semibold leading-snug text-slate-900">
                        {question}
                      </span>
                    </label>
                    <div className="min-w-0">
                      <AudienceScalarSelect
                        options={segmentOptionsMap[spec.key] ?? []}
                        value={filters[spec.key] ?? 'all'}
                        onChange={(next) =>
                          setFilters((prev) => ({
                            ...prev,
                            [spec.key]: next,
                          }))
                        }
                        inputId={selectId}
                        qn={qn}
                        question={question}
                      />
                    </div>
                  </div>
                )
              })}
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

      <div className="relative z-0 overflow-hidden rounded-2xl border border-white/60 bg-white/85 shadow-[0_8px_40px_-12px_rgba(15,23,42,0.12)] ring-1 ring-slate-900/[0.04] backdrop-blur-md">
        {loading ? (
          <div className="flex flex-col items-center justify-center gap-4 py-24 text-slate-600">
            <Loader2
              className="size-9 animate-spin text-teal-600"
              strokeWidth={2}
              aria-hidden
            />
            <p className="text-sm font-medium">Loading users…</p>
          </div>
        ) : rows.length === 0 ? (
          <div className="flex flex-col items-center px-4 py-20 text-center">
            <div className="mb-4 flex size-14 items-center justify-center rounded-2xl bg-slate-100 text-slate-400 ring-1 ring-slate-200/80">
              <Inbox className="size-7" strokeWidth={1.75} aria-hidden />
            </div>
            <p className="max-w-sm text-sm text-slate-600">
              No users with an email in this collection.
            </p>
          </div>
        ) : filteredRows.length === 0 ? (
          <div className="flex flex-col items-center px-4 py-20 text-center">
            <div className="mb-4 flex size-14 items-center justify-center rounded-2xl bg-slate-100 text-slate-400 ring-1 ring-slate-200/80">
              <SearchX className="size-7" strokeWidth={1.75} aria-hidden />
            </div>
            <p className="text-sm font-medium text-slate-700">
              No users match your filters
            </p>
            <p className="mt-1 max-w-xs text-xs text-slate-500">
              Try loosening onboarding filters or clear the search field.
            </p>
          </div>
        ) : (
          <div className="overflow-x-auto">
                       <table className="w-full min-w-[44rem] text-left text-sm">
              <thead>
                <tr className="border-b border-slate-200/80 bg-gradient-to-b from-slate-50/95 to-slate-50/50">
                  <th
                    scope="col"
                    className="whitespace-nowrap px-5 py-3.5 text-left text-[11px] font-bold uppercase tracking-wider text-slate-500"
                  >
                    Name
                  </th>
                  <th
                    scope="col"
                    className="whitespace-nowrap px-5 py-3.5 text-left text-[11px] font-bold uppercase tracking-wider text-slate-500"
                  >
                    Email
                  </th>
                  <th
                    scope="col"
                    className="whitespace-nowrap px-5 py-3.5 text-left text-[11px] font-bold uppercase tracking-wider text-slate-500"
                  >
                    Skill level
                  </th>
                  <th
                    scope="col"
                    className="whitespace-nowrap px-5 py-3.5 text-left text-[11px] font-bold uppercase tracking-wider text-slate-500"
                  >
                    Purchased
                  </th>
                  <th
                    scope="col"
                    className="whitespace-nowrap px-5 py-3.5 text-left text-[11px] font-bold uppercase tracking-wider text-slate-500"
                  >
                    Session count
                  </th>
                  <th
                    scope="col"
                    className="whitespace-nowrap px-5 py-3.5 text-left text-[11px] font-bold uppercase tracking-wider text-slate-500"
                  >
                    Unlimited
                  </th>
                  <th
                    scope="col"
                    className="whitespace-nowrap px-5 py-3.5 text-left text-[11px] font-bold uppercase tracking-wider text-slate-500"
                  >
                    Free Access
                  </th>
                  <th
                    scope="col"
                    className="whitespace-nowrap px-5 py-3.5 text-right text-[11px] font-bold uppercase tracking-wider text-slate-500"
                  >
                    Actions
                  </th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100/90">
                {filteredRows.map((row) => {
                  const purchaseLoading = Boolean(purchasePendingIds[row.id])
                  const sessionPending = Boolean(sessionUpdatePendingIds[row.id])
                  const freeAccessPending = Boolean(freeAccessUpdatePendingIds[row.id])
                  const purchased = row.isPurchased
                  const skillRaw = String(row.skillLevel ?? '').trim()
                  const unlimitedOn = row.canDoUnlimitedSessions === true
                  const freeAccessOn = row.freeAccess === true
                  const sessionCountVal = row.sessionCount
                  const hasSessionStats = Boolean(toRecord(row.sessionStats))
                  return (
                    <tr
                      key={row.id}
                      className="transition-colors hover:bg-gradient-to-r hover:from-teal-50/45 hover:to-transparent"
                    >
                      <td className="max-w-[min(100vw,18rem)] truncate px-5 py-3.5 font-sans text-sm font-bold text-slate-900">
                        {String(row.name ?? '').trim() ? (
                          String(row.name ?? '')
                        ) : (
                          <span className="font-bold text-slate-400">—</span>
                        )}
                      </td>
                      <td className="max-w-[min(100vw,20rem)] truncate px-5 py-3.5 font-mono text-xs font-medium text-slate-900">
                        {String(row.email ?? '')}
                      </td>
                      <td
                        className="max-w-[12rem] truncate px-5 py-3.5 font-sans text-xs text-slate-800"
                        title={skillRaw || undefined}
                      >
                        {skillRaw || (
                          <span className="text-slate-400">—</span>
                        )}
                      </td>
                      <td className="px-5 py-3.5">
                        {audiencePurchaseCell(purchased, purchaseLoading)}
                      </td>
                      <td
                        className="whitespace-nowrap px-5 py-3.5 font-mono text-xs tabular-nums text-slate-800"
                        title={
                          sessionCountVal != null
                            ? String(sessionCountVal)
                            : undefined
                        }
                      >
                        {sessionCountVal != null ? (
                          sessionCountVal
                        ) : (
                          <span className="text-slate-400">—</span>
                        )}
                      </td>
                      <td className="whitespace-nowrap px-5 py-3.5">
                        <button
                          type="button"
                          disabled={sessionPending}
                          aria-pressed={unlimitedOn}
                          onClick={() =>
                            toggleUnlimitedSessions(row.id, unlimitedOn)
                          }
                          className={`inline-flex cursor-pointer items-center gap-1.5 rounded-lg border px-2.5 py-1.5 text-xs font-semibold transition focus:outline-none focus-visible:ring-2 focus-visible:ring-teal-500 focus-visible:ring-offset-2 disabled:cursor-wait disabled:opacity-60 ${
                            unlimitedOn
                              ? 'border-amber-300 bg-amber-50 text-amber-900 hover:bg-amber-100/90'
                              : 'border-slate-200 bg-white text-slate-700 shadow-sm hover:border-slate-300 hover:bg-slate-50'
                          }`}
                        >
                          {sessionPending ? (
                            <>
                              <Loader2
                                className="size-3.5 animate-spin"
                                strokeWidth={2}
                                aria-hidden
                              />
                              …
                            </>
                          ) : unlimitedOn ? (
                            <>
                              <InfinityIcon
                                className="size-3.5 shrink-0"
                                strokeWidth={2}
                                aria-hidden
                              />
                              Disable
                            </>
                          ) : (
                            <>
                              <Timer
                                className="size-3.5 shrink-0"
                                strokeWidth={2}
                                aria-hidden
                              />
                              Allow unlimited
                            </>
                          )}
                        </button>
                      </td>
                      <td className="whitespace-nowrap px-5 py-3.5">
                        <button
                          type="button"
                          disabled={freeAccessPending}
                          aria-pressed={freeAccessOn}
                          onClick={() => toggleFreeAccess(row.id, freeAccessOn)}
                          className={`inline-flex cursor-pointer items-center gap-1.5 rounded-lg border px-2.5 py-1.5 text-xs font-semibold transition focus:outline-none focus-visible:ring-2 focus-visible:ring-teal-500 focus-visible:ring-offset-2 disabled:cursor-wait disabled:opacity-60 ${
                            freeAccessOn
                              ? 'border-violet-300 bg-violet-50 text-violet-900 hover:bg-violet-100/90'
                              : 'border-slate-200 bg-white text-slate-700 shadow-sm hover:border-slate-300 hover:bg-slate-50'
                          }`}
                        >
                          {freeAccessPending ? (
                            <>
                              <Loader2
                                className="size-3.5 animate-spin"
                                strokeWidth={2}
                                aria-hidden
                              />
                              …
                            </>
                          ) : freeAccessOn ? (
                            <>
                              <Gift
                                className="size-3.5 shrink-0"
                                strokeWidth={2}
                                aria-hidden
                              />
                              Revoke
                            </>
                          ) : (
                            <>
                              <Gift
                                className="size-3.5 shrink-0"
                                strokeWidth={2}
                                aria-hidden
                              />
                              Grant free
                            </>
                          )}
                        </button>
                      </td>
                      <td className="whitespace-nowrap px-5 py-3 text-right">
                        <div className="inline-flex items-center gap-2">
                          <button
                            type="button"
                            disabled={!hasSessionStats}
                            onClick={() => setSessionStatsRow(row)}
                            className="inline-flex cursor-pointer items-center gap-1.5 rounded-full border border-slate-200 bg-white px-3.5 py-2 text-xs font-semibold text-slate-700 shadow-sm transition hover:border-slate-300 hover:bg-slate-50 focus:outline-none focus-visible:ring-2 focus-visible:ring-teal-500 focus-visible:ring-offset-2 disabled:cursor-not-allowed disabled:opacity-45"
                          >
                            Session stats
                          </button>
                          <button
                            type="button"
                            onClick={() => setDetailRow(row)}
                            className="inline-flex cursor-pointer items-center gap-1.5 rounded-full bg-teal-600 px-3.5 py-2 text-xs font-semibold text-white shadow-md shadow-teal-900/20 transition hover:bg-teal-700 hover:shadow-lg focus:outline-none focus-visible:ring-2 focus-visible:ring-teal-500 focus-visible:ring-offset-2 active:scale-[0.98]"
                          >
                            Detail
                            <PanelRight
                              className="size-3.5 opacity-90"
                              strokeWidth={2}
                              aria-hidden
                            />
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

      <OnboardingUserDetailModal
        row={detailRow}
        onClose={() => setDetailRow(null)}
        mode="audience"
        tagVariant="teal"
        fields={AUDIENCE_EXPORT_FIELDS}
        purchasePending={
          detailRow ? Boolean(purchasePendingIds[detailRow.id]) : false
        }
        sessionPending={
          detailRow ? Boolean(sessionUpdatePendingIds[detailRow.id]) : false
        }
        freeAccessPending={
          detailRow ? Boolean(freeAccessUpdatePendingIds[detailRow.id]) : false
        }
        onToggleUnlimited={toggleUnlimitedSessions}
        onToggleFreeAccess={toggleFreeAccess}
      />
      <AudienceSessionStatsModal
        row={sessionStatsRow}
        onClose={() => setSessionStatsRow(null)}
      />
    </div>
  )
}
