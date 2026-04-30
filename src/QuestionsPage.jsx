import {
  AlertCircle,
  ArrowDownWideNarrow,
  ArrowUpNarrowWide,
  ChevronsUpDown,
  Check,
  Filter,
  Flag,
  Inbox,
  Loader2,
  StickyNote,
  MessageCircleQuestion,
  Search,
  SearchX,
  X,
} from 'lucide-react'
import { useCallback, useEffect, useMemo, useState } from 'react'
import { collection, doc, getDocs, updateDoc } from 'firebase/firestore'
import {
  db,
  firebaseReady,
  questionsCollectionName,
  usersCollectionName,
} from './firebase'
import {
  aggregateQuestionAnswerStats,
  answerPercentCorrect,
  buildNumericQuestionIdMap,
} from './questionAnswerStats.js'
import {
  displayScalar,
  questionDocToRow,
  questionPreviewText,
  questionRowMatchesSearch,
} from './questionRow.js'

/** @param {number | null} pct */
function answerPctToneClass(pct) {
  if (pct == null) return 'text-slate-500'
  if (pct >= 70) return 'text-emerald-700'
  if (pct >= 40) return 'text-amber-700'
  return 'text-rose-700'
}

/**
 * Ascending doc id: pure digit ids sort numerically (1 … n); those before other ids;
 * remainder uses localeCompare with numeric option.
 *
 * @param {{ firestoreDocId: string }} a
 * @param {{ firestoreDocId: string }} b
 */
function compareFirestoreDocIdAsc(a, b) {
  const idA = String(a.firestoreDocId ?? '')
  const idB = String(b.firestoreDocId ?? '')
  const allDigits = (s) => /^\d+$/.test(s)
  const digA = allDigits(idA)
  const digB = allDigits(idB)
  if (digA && digB) {
    const na = Number(idA)
    const nb = Number(idB)
    if (na !== nb) return na - nb
    return idA.localeCompare(idB)
  }
  if (digA !== digB) return digA ? -1 : 1
  return idA.localeCompare(idB, undefined, { numeric: true, sensitivity: 'base' })
}

/**
 * @param {{ firestoreDocId: string } & Record<string, unknown>} row
 * @param {Map<number, { correct: number, wrong: number }>} answerStatsByQuestionId
 * @param {Map<string, number>} numericQuestionIdMap
 * @returns {number | null} Percent correct, or null if not comparable
 */
function answerPercentForSortRow(row, answerStatsByQuestionId, numericQuestionIdMap) {
  const qid = numericQuestionIdMap.get(row.firestoreDocId)
  if (qid == null) return null
  const ansStats = answerStatsByQuestionId.get(qid)
  if (!ansStats) return null
  return answerPercentCorrect(ansStats.correct, ansStats.wrong)
}

/**
 * @param {'none' | 'count_desc' | 'count_asc'} reportSort
 * @param {'none' | 'pct_desc' | 'pct_asc'} answerSort
 * @param {Array<{ firestoreDocId: string } & Record<string, unknown>>} rows
 * @param {Map<number, { correct: number, wrong: number }>} answerStatsByQuestionId
 * @param {Map<string, number>} numericQuestionIdMap
 */
function sortQuestionRows(
  reportSort,
  answerSort,
  rows,
  answerStatsByQuestionId,
  numericQuestionIdMap,
) {
  const copy = [...rows]
  copy.sort((a, b) => {
    if (reportSort !== 'none') {
      const ca = getReportsArray(a).length
      const cb = getReportsArray(b).length
      const rd =
        reportSort === 'count_desc' ? cb - ca : ca - cb
      if (rd !== 0) return rd
    }
    if (answerSort !== 'none') {
      const pa = answerPercentForSortRow(
        a,
        answerStatsByQuestionId,
        numericQuestionIdMap,
      )
      const pb = answerPercentForSortRow(
        b,
        answerStatsByQuestionId,
        numericQuestionIdMap,
      )
      if (pa == null && pb == null) {
        /* fall through to doc id */
      } else {
        if (pa == null) return 1
        if (pb == null) return -1
        const ad =
          answerSort === 'pct_desc' ? pb - pa : pa - pb
        if (ad !== 0) return ad
      }
    }
    return compareFirestoreDocIdAsc(a, b)
  })
  return copy
}

/**
 * Firestore sometimes deserializes arrays as objects with numeric keys; normalize to a real array.
 * @param {unknown} v
 */
function normalizeReportsField(v) {
  if (Array.isArray(v)) return v
  if (v && typeof v === 'object' && !Array.isArray(v)) {
    const o = /** @type {Record<string, unknown>} */ (v)
    const keys = Object.keys(o).filter((k) => /^\d+$/.test(k))
    if (keys.length > 0) {
      return keys
        .sort((a, b) => Number(a) - Number(b))
        .map((k) => o[k])
    }
  }
  return []
}

/** @param {unknown} row */
function getReportsArray(row) {
  if (!row || typeof row !== 'object') return []
  return normalizeReportsField(/** @type {Record<string, unknown>} */ (row).reports)
}

/** @param {unknown} row */
function hasReports(row) {
  return getReportsArray(row).length > 0
}

/** @param {unknown} row */
function reportCountsValue(row) {
  if (!row || typeof row !== 'object') return 0
  const v = /** @type {Record<string, unknown>} */ (row).reportCounts
  if (v == null || v === '') return 0
  const n = Number(v)
  return Number.isFinite(n) ? n : 0
}

/**
 * List rows that have non-empty question text (see {@link questionPreviewText}) and/or non-empty `context`.
 * @param {Record<string, unknown>} row
 */
function rowHasQuestionOrContext(row) {
  const hasQ = questionPreviewText(row) !== ''
  const hasCtx =
    typeof row.context === 'string' && row.context.trim() !== ''
  return hasQ || hasCtx
}

/** @param {unknown} v */
function formatReportDate(v) {
  if (v == null) return '—'
  if (typeof v === 'string') return v
  if (typeof v === 'object' && v !== null && 'toDate' in v) {
    try {
      return /** @type {{ toDate: () => Date }} */ (v).toDate().toISOString()
    } catch {
      return '—'
    }
  }
  return String(v)
}

const LEGACY_REPORT_META = 'From Old Version'

/**
 * @param {unknown} value
 * @returns {{ display: string, legacy: boolean }}
 */
function reportMetaField(value) {
  const s = String(value ?? '').trim()
  if (s !== '') return { display: s, legacy: false }
  return { display: LEGACY_REPORT_META, legacy: true }
}

/**
 * @param {Record<string, unknown>} r
 */
function reportSummaryLines(r) {
  const issue = r.issueType != null ? String(r.issueType) : ''
  const details = r.details != null ? String(r.details) : ''
  const uid = r.userId != null ? String(r.userId) : ''
  const appVersion = r.appVersion != null ? String(r.appVersion) : ''
  const deviceType = r.deviceType != null ? String(r.deviceType) : ''
  const at = formatReportDate(r.submittedAt)
  return { issue, details, uid, appVersion, deviceType, at }
}

/**
 * @param {unknown} rep
 * @param {string} notesTrimmed
 */
function mergeReportAdminNotes(rep, notesTrimmed) {
  const base =
    rep && typeof rep === 'object' && !Array.isArray(rep) ? { ...rep } : {}
  if (notesTrimmed) base.adminNotes = notesTrimmed
  else delete base.adminNotes
  return base
}

/**
 * Non-empty adminNotes per report for the questions table (uses same report order as the modal).
 * @param {unknown[]} reports
 */
function reportsAdminNotesForTable(reports) {
  /** @type {{ key: number, prefix: string, text: string }[]} */
  const lines = []
  const multi = reports.length > 1
  for (let i = 0; i < reports.length; i++) {
    const r = reports[i]
    if (!r || typeof r !== 'object' || Array.isArray(r)) continue
    const raw = /** @type {Record<string, unknown>} */ (r).adminNotes
    const text = typeof raw === 'string' ? raw.trim() : ''
    if (!text) continue
    lines.push({
      key: i,
      prefix: multi ? `${i + 1}.` : '',
      text,
    })
  }
  const title = lines
    .map((l) => (l.prefix ? `${l.prefix} ${l.text}` : l.text))
    .join('\n\n')
  return { lines, title }
}

export default function QuestionsPage() {
  const [rows, setRows] = useState(
    /** @type {Array<{ firestoreDocId: string } & Record<string, unknown>>} */ (
      []
    ),
  )
  const [loading, setLoading] = useState(!!firebaseReady)
  const [error, setError] = useState(null)
  const [searchQuery, setSearchQuery] = useState('')
  const [reportFilter, setReportFilter] = useState('reported')
  /** @type {{ firestoreDocId: string, questionPreview: string, reports: Record<string, unknown>[] } | null} */
  const [reportModal, setReportModal] = useState(null)
  const [resolvingKey, setResolvingKey] = useState(
    /** @type {string | null} */ (null),
  )
  const [notesSavingKey, setNotesSavingKey] = useState(
    /** @type {string | null} */ (null),
  )
  const [modalNoteDrafts, setModalNoteDrafts] = useState(
    /** @type {Record<string, string>} */ ({}),
  )
  const [answerStatsByQuestionId, setAnswerStatsByQuestionId] = useState(
    /** @type {Map<number, { correct: number, wrong: number }>} */ (new Map()),
  )
  const [answerStatsSort, setAnswerStatsSort] = useState(
    /** @type {'none' | 'pct_desc' | 'pct_asc'} */ ('none'),
  )
  const [reportSort, setReportSort] = useState(
    /** @type {'none' | 'count_desc' | 'count_asc'} */ ('count_desc'),
  )

  const questionsWithBody = useMemo(
    () => rows.filter((row) => rowHasQuestionOrContext(row)),
    [rows],
  )

  const filteredRows = useMemo(() => {
    let list = questionsWithBody
    if (reportFilter === 'reported') {
      list = list.filter((row) => hasReports(row))
    }
    const q = searchQuery.trim().toLowerCase()
    if (!q) return list
    return list.filter((row) => questionRowMatchesSearch(row, q))
  }, [questionsWithBody, searchQuery, reportFilter])

  const numericQuestionIdMap = useMemo(
    () => buildNumericQuestionIdMap(rows),
    [rows],
  )

  const displayRows = useMemo(
    () =>
      sortQuestionRows(
        reportSort,
        answerStatsSort,
        filteredRows,
        answerStatsByQuestionId,
        numericQuestionIdMap,
      ),
    [
      filteredRows,
      answerStatsByQuestionId,
      answerStatsSort,
      reportSort,
      numericQuestionIdMap,
    ],
  )

  const cycleReportSort = useCallback(() => {
    setReportSort((s) =>
      s === 'count_desc'
        ? 'count_asc'
        : s === 'count_asc'
          ? 'none'
          : 'count_desc',
    )
  }, [])

  const cycleAnswerStatsSort = useCallback(() => {
    setAnswerStatsSort((s) =>
      s === 'none' ? 'pct_desc' : s === 'pct_desc' ? 'pct_asc' : 'none',
    )
  }, [])

  const hasSearch = searchQuery.trim() !== ''
  const hasActiveFilters = hasSearch || reportFilter === 'reported'

  const openReportsModal = useCallback((row) => {
    const reports = getReportsArray(row)
    if (reports.length === 0) return
    const { firestoreDocId, ...data } = row
    setReportModal({
      firestoreDocId,
      questionPreview: questionPreviewText(data) || '(No question text)',
      reports: /** @type {Record<string, unknown>[]} */ ([...reports]),
    })
  }, [])

  const closeReportsModal = useCallback(() => {
    setReportModal(null)
  }, [])

  useEffect(() => {
    if (!reportModal) {
      setModalNoteDrafts({})
      return
    }
    const next = /** @type {Record<string, string>} */ ({})
    reportModal.reports.forEach((rep, i) => {
      const rk = `${reportModal.firestoreDocId}:${i}`
      next[rk] =
        typeof rep?.adminNotes === 'string' ? rep.adminNotes : ''
    })
    setModalNoteDrafts(next)
  }, [reportModal])

  const saveReportAdminNotes = useCallback(
    async (firestoreDocId, reportIndex, notesText) => {
      if (!db) return
      // Use modal state as source of truth — table rows can disagree when `reports`
      // is stored as a non-array shape that getReportsArray normalizes for display only.
      if (!reportModal || reportModal.firestoreDocId !== firestoreDocId) return

      const trimmed = notesText.trim()
      const key = `${firestoreDocId}:${reportIndex}`
      const current = reportModal.reports
      if (reportIndex < 0 || reportIndex >= current.length) {
        setError('Could not save notes (report is no longer in this view).')
        return
      }

      const prev = current.map((r) =>
        r && typeof r === 'object' && !Array.isArray(r) ? { ...r } : r,
      )
      const next = current.map((r, i) =>
        i !== reportIndex ? r : mergeReportAdminNotes(r, trimmed),
      )

      setNotesSavingKey(key)
      setError(null)

      setRows((rowsPrev) =>
        rowsPrev.map((r) =>
          r.firestoreDocId === firestoreDocId ? { ...r, reports: next } : r,
        ),
      )
      setReportModal((m) =>
        !m || m.firestoreDocId !== firestoreDocId
          ? m
          : {
              ...m,
              reports: /** @type {Record<string, unknown>[]} */ (next),
            },
      )

      try {
        await updateDoc(doc(db, questionsCollectionName, firestoreDocId), {
          reports: next,
        })
      } catch (e) {
        setRows((rowsPrev) =>
          rowsPrev.map((r) =>
            r.firestoreDocId === firestoreDocId ? { ...r, reports: prev } : r,
          ),
        )
        setReportModal((m) =>
          m?.firestoreDocId === firestoreDocId
            ? {
                ...m,
                reports: /** @type {Record<string, unknown>[]} */ (prev),
              }
            : m,
        )
        setError(e?.message || 'Failed to save admin notes')
      } finally {
        setNotesSavingKey(null)
      }
    },
    [reportModal],
  )

  const resolveReport = useCallback(
    async (firestoreDocId, reportIndex) => {
      if (!db) return
      if (!reportModal || reportModal.firestoreDocId !== firestoreDocId) return

      const key = `${firestoreDocId}:${reportIndex}`
      const current = reportModal.reports
      if (reportIndex < 0 || reportIndex >= current.length) return

      const prevReports = current.map((r) =>
        r && typeof r === 'object' && !Array.isArray(r) ? { ...r } : r,
      )
      const nextReports = current.filter((_, i) => i !== reportIndex)

      setResolvingKey(key)
      setError(null)

      setRows((rowsPrev) =>
        rowsPrev.map((r) =>
          r.firestoreDocId === firestoreDocId
            ? { ...r, reports: nextReports }
            : r,
        ),
      )
      setReportModal((m) => {
        if (!m || m.firestoreDocId !== firestoreDocId) return m
        return nextReports.length === 0
          ? null
          : { ...m, reports: nextReports }
      })

      try {
        await updateDoc(doc(db, questionsCollectionName, firestoreDocId), {
          reports: nextReports,
        })
      } catch (e) {
        setRows((rowsPrev) =>
          rowsPrev.map((r) =>
            r.firestoreDocId === firestoreDocId
              ? { ...r, reports: prevReports }
              : r,
          ),
        )
        setReportModal((m) =>
          m?.firestoreDocId === firestoreDocId
            ? {
                ...m,
                reports: /** @type {Record<string, unknown>[]} */ (prevReports),
              }
            : m,
        )
        setError(e?.message || 'Failed to resolve report')
      } finally {
        setResolvingKey(null)
      }
    },
    [reportModal],
  )

  useEffect(() => {
    if (!reportModal) return
    function onKey(e) {
      if (e.key === 'Escape') closeReportsModal()
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [reportModal, closeReportsModal])

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
        const [qSnap, userRows] = await Promise.all([
          getDocs(collection(db, questionsCollectionName)),
          getDocs(collection(db, usersCollectionName))
            .then((s) =>
              s.docs.map((d) =>
                /** @type {Record<string, unknown>} */ (d.data()),
              ),
            )
            .catch(() => /** @type {Record<string, unknown>[]} */ ([])),
        ])
        if (cancelled) return
        const list = qSnap.docs.map((d) => questionDocToRow(d.id, d.data()))
        setRows(list)
        setAnswerStatsByQuestionId(aggregateQuestionAnswerStats(userRows))
      } catch (e) {
        if (!cancelled) {
          setError(e?.message || 'Failed to load questions')
          setRows([])
          setAnswerStatsByQuestionId(new Map())
        }
      } finally {
        if (!cancelled) setLoading(false)
      }
    })()

    return () => {
      cancelled = true
    }
  }, [])

  return (
    <div className="px-4 py-6 sm:px-6 lg:px-8 lg:py-8">
      <header className="mb-8 flex flex-col gap-5 lg:flex-row lg:items-end lg:justify-between">
        <div className="flex items-start gap-3 sm:items-center sm:gap-4">
          <div className="flex size-11 shrink-0 items-center justify-center rounded-xl bg-white shadow-md shadow-slate-900/[0.04] ring-1 ring-slate-200/90 sm:size-12">
            <MessageCircleQuestion
              className="size-5 text-violet-600 sm:size-6"
              strokeWidth={2}
              aria-hidden
            />
          </div>
          <div>
            <h1 className="text-2xl font-semibold tracking-tight text-slate-900 sm:text-3xl">
              Questions
            </h1>
            <p className="mt-1 flex items-center gap-1.5 text-sm text-slate-600">
              {rows.length > 0 ? (
                <>
                  <span className="inline-flex size-1.5 rounded-full bg-violet-500" />
                  {`${displayRows.length} shown${
                    hasActiveFilters
                      ? ` of ${questionsWithBody.length} total`
                      : ''
                  }`}
                </>
              ) : !loading ? (
                <span>Collection: {questionsCollectionName}</span>
              ) : null}
            </p>
            <p className="mt-1.5 max-w-2xl text-xs leading-relaxed text-slate-500">
              Answer stats sum every graded attempt from{' '}
              <code className="rounded bg-slate-100 px-1 py-0.5 font-mono text-[11px] text-slate-700">
                {usersCollectionName}
              </code>{' '}
              session reviews, keyed by each question’s numeric{' '}
              <code className="rounded bg-slate-100 px-1 py-0.5 font-mono text-[11px] text-slate-700">
                id
              </code>
              .
            </p>
          </div>
        </div>
        <div className="flex flex-col gap-3 sm:flex-row sm:flex-wrap sm:items-stretch">
          <label className="sr-only" htmlFor="questions-report-filter">
            Filter by reports
          </label>
          <div className="relative w-full min-w-[12rem] sm:w-auto">
            <Filter
              className="pointer-events-none absolute left-3 top-1/2 size-4 -translate-y-1/2 text-slate-400"
              strokeWidth={2}
              aria-hidden
            />
            <select
              id="questions-report-filter"
              value={reportFilter}
              onChange={(e) => setReportFilter(e.target.value)}
              className="w-full cursor-pointer appearance-none rounded-xl border border-slate-200 bg-white py-2.5 pl-10 pr-3 text-sm text-slate-900 shadow-sm outline-none transition hover:border-slate-300 focus:border-violet-400 focus:ring-4 focus:ring-violet-500/15 sm:min-w-[12rem]"
            >
              <option value="all">All questions</option>
              <option value="reported">Reported only</option>
            </select>
          </div>
          <div className="relative w-full min-w-[220px] sm:min-w-[22rem] sm:max-w-xl sm:flex-1 lg:max-w-2xl">
            <Search
              className="pointer-events-none absolute left-3 top-1/2 size-4 -translate-y-1/2 text-slate-400"
              strokeWidth={2}
              aria-hidden
            />
            <input
              id="questions-search"
              type="search"
              placeholder="Search doc id, question, context, type…"
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              className="w-full rounded-xl border border-slate-200 bg-white py-2.5 pl-10 pr-3 text-sm text-slate-900 shadow-sm outline-none placeholder:text-slate-400 focus:border-violet-400 focus:ring-4 focus:ring-violet-500/15"
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
              className="size-9 animate-spin text-violet-600"
              strokeWidth={2}
              aria-hidden
            />
            <p className="text-sm font-medium">Loading questions…</p>
          </div>
        ) : rows.length === 0 ? (
          <div className="flex flex-col items-center px-4 py-20 text-center">
            <div className="mb-4 flex size-14 items-center justify-center rounded-2xl bg-slate-100 text-slate-400 ring-1 ring-slate-200/80">
              <Inbox className="size-7" strokeWidth={1.75} aria-hidden />
            </div>
            <p className="max-w-sm text-sm text-slate-600">
              No documents in the{' '}
              <code className="rounded bg-slate-100 px-1.5 py-0.5 font-mono text-xs text-slate-800">
                {questionsCollectionName}
              </code>{' '}
              collection.
            </p>
          </div>
        ) : questionsWithBody.length === 0 ? (
          <div className="flex flex-col items-center px-4 py-20 text-center">
            <div className="mb-4 flex size-14 items-center justify-center rounded-2xl bg-slate-100 text-slate-400 ring-1 ring-slate-200/80">
              <Inbox className="size-7" strokeWidth={1.75} aria-hidden />
            </div>
            <p className="max-w-sm text-sm font-medium text-slate-700">
              No questions with context or question text
            </p>
            <p className="mt-1 max-w-sm text-xs text-slate-500">
              {rows.length} document{rows.length === 1 ? '' : 's'} loaded; add
              at least one non-empty <span className="font-mono">context</span>{' '}
              or question field to show them here.
            </p>
          </div>
        ) : displayRows.length === 0 ? (
          <div className="flex flex-col items-center px-4 py-20 text-center">
            <div className="mb-4 flex size-14 items-center justify-center rounded-2xl bg-slate-100 text-slate-400 ring-1 ring-slate-200/80">
              <SearchX className="size-7" strokeWidth={1.75} aria-hidden />
            </div>
            <p className="text-sm font-medium text-slate-700">
              No questions match your filters
            </p>
            <p className="mt-1 max-w-xs text-xs text-slate-500">
              Try another filter, search, or clear the search field.
            </p>
          </div>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full min-w-[1120px] text-left text-sm">
              <thead>
                <tr className="border-b border-slate-200 bg-slate-50/90">
                  <th
                    scope="col"
                    className="whitespace-nowrap px-3 py-3.5 text-xs font-semibold uppercase tracking-wide text-slate-600 lg:px-4"
                  >
                    Doc ID
                  </th>
                  <th
                    scope="col"
                    className="min-w-[220px] px-3 py-3.5 text-xs font-semibold uppercase tracking-wide text-slate-600 lg:min-w-[280px] lg:px-4"
                  >
                    Question
                  </th>
                  <th
                    scope="col"
                    className="hidden min-w-[180px] px-3 py-3.5 text-xs font-semibold uppercase tracking-wide text-slate-600 xl:table-cell lg:px-4"
                  >
                    Context
                  </th>
                  <th
                    scope="col"
                    className="hidden whitespace-nowrap px-3 py-3.5 text-xs font-semibold uppercase tracking-wide text-slate-600 2xl:table-cell lg:px-4"
                  >
                    Type
                  </th>
                  <th
                    scope="col"
                    className="min-w-[140px] px-3 py-3.5 text-xs font-semibold uppercase tracking-wide text-slate-600 lg:px-4"
                  >
                    <button
                      type="button"
                      onClick={cycleAnswerStatsSort}
                      className="group inline-flex max-w-full cursor-pointer items-center gap-1.5 rounded-lg text-left transition hover:text-violet-800 focus:outline-none focus-visible:ring-2 focus-visible:ring-violet-500 focus-visible:ring-offset-2"
                      title={
                        answerStatsSort === 'none'
                          ? 'Sort by % correct (highest first)'
                          : answerStatsSort === 'pct_desc'
                            ? 'Sorted: highest % first — click for lowest % first'
                            : 'Sorted: lowest % first — click to clear sort'
                      }
                      aria-sort={
                        answerStatsSort === 'pct_desc'
                          ? 'descending'
                          : answerStatsSort === 'pct_asc'
                            ? 'ascending'
                            : 'none'
                      }
                    >
                      <span>Answer stats</span>
                      {answerStatsSort === 'pct_desc' ? (
                        <ArrowDownWideNarrow
                          className="size-3.5 shrink-0 text-violet-600"
                          strokeWidth={2.25}
                          aria-hidden
                        />
                      ) : answerStatsSort === 'pct_asc' ? (
                        <ArrowUpNarrowWide
                          className="size-3.5 shrink-0 text-violet-600"
                          strokeWidth={2.25}
                          aria-hidden
                        />
                      ) : (
                        <ChevronsUpDown
                          className="size-3.5 shrink-0 text-slate-400/70"
                          strokeWidth={2}
                          aria-hidden
                        />
                      )}
                    </button>
                  </th>
                  <th
                    scope="col"
                    className="min-w-[160px] max-w-[260px] px-3 py-3.5 text-xs font-semibold uppercase tracking-wide text-slate-600 lg:px-4"
                  >
                    <span className="inline-flex items-center gap-1.5">
                      <StickyNote
                        className="size-3.5 shrink-0 text-violet-600"
                        strokeWidth={2}
                        aria-hidden
                      />
                      Admin notes
                    </span>
                  </th>
                  <th
                    scope="col"
                    className="whitespace-nowrap px-3 py-3.5 text-center text-xs font-semibold uppercase tracking-wide text-slate-600 lg:px-4"
                  >
                    Report counts
                  </th>
                  <th
                    scope="col"
                    className="whitespace-nowrap px-3 py-3.5 text-center text-xs font-semibold uppercase tracking-wide text-slate-600 lg:px-4"
                  >
                    <button
                      type="button"
                      onClick={cycleReportSort}
                      className="group mx-auto inline-flex cursor-pointer items-center justify-center gap-1.5 rounded-lg text-center transition hover:text-violet-800 focus:outline-none focus-visible:ring-2 focus-visible:ring-violet-500 focus-visible:ring-offset-2"
                      title={
                        reportSort === 'none'
                          ? 'Sort by report count (most first)'
                          : reportSort === 'count_desc'
                            ? 'Sorted: most reports first — click for fewest first'
                            : 'Sorted: fewest reports first — click to clear sort'
                      }
                      aria-sort={
                        reportSort === 'count_desc'
                          ? 'descending'
                          : reportSort === 'count_asc'
                            ? 'ascending'
                            : 'none'
                      }
                    >
                      <span>Reports</span>
                      {reportSort === 'count_desc' ? (
                        <ArrowDownWideNarrow
                          className="size-3.5 shrink-0 text-violet-600"
                          strokeWidth={2.25}
                          aria-hidden
                        />
                      ) : reportSort === 'count_asc' ? (
                        <ArrowUpNarrowWide
                          className="size-3.5 shrink-0 text-violet-600"
                          strokeWidth={2.25}
                          aria-hidden
                        />
                      ) : (
                        <ChevronsUpDown
                          className="size-3.5 shrink-0 text-slate-400/70"
                          strokeWidth={2}
                          aria-hidden
                        />
                      )}
                    </button>
                  </th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100">
                {displayRows.map((row) => {
                  const { firestoreDocId, ...data } = row
                  const questionText = questionPreviewText(data)
                  const reports = getReportsArray(row)
                  const reportCount = reports.length
                  const qid = numericQuestionIdMap.get(row.firestoreDocId)
                  const ansStats =
                    qid != null ? answerStatsByQuestionId.get(qid) : undefined
                  const ansPct = ansStats
                    ? answerPercentCorrect(ansStats.correct, ansStats.wrong)
                    : null
                  const ansTotal =
                    ansStats != null
                      ? ansStats.correct + ansStats.wrong
                      : 0
                  const { lines: noteLines, title: notesTitle } =
                    reportsAdminNotesForTable(reports)
                  return (
                    <tr
                      key={firestoreDocId}
                      className="align-top transition-colors hover:bg-slate-50/80"
                    >
                      <td className="whitespace-nowrap px-3 py-3 font-mono text-xs text-slate-600 lg:px-4">
                        {firestoreDocId}
                      </td>
                      <td className="max-w-xs px-3 py-3 text-slate-800 lg:max-w-md lg:px-4">
                        {questionText ? (
                          <p
                            className="line-clamp-3 whitespace-pre-wrap break-words text-sm leading-snug"
                            title={questionText}
                          >
                            {questionText}
                          </p>
                        ) : (
                          <span className="text-slate-400">—</span>
                        )}
                      </td>
                      <td className="hidden max-w-[240px] px-3 py-3 text-xs text-slate-600 xl:table-cell lg:px-4">
                        {typeof row.context === 'string' && row.context ? (
                          <p
                            className="line-clamp-3 break-words leading-snug"
                            title={row.context}
                          >
                            {row.context}
                          </p>
                        ) : (
                          <span className="text-slate-400">—</span>
                        )}
                      </td>
                      <td className="hidden max-w-[140px] px-3 py-3 text-xs text-slate-600 2xl:table-cell lg:px-4">
                        <span className="line-clamp-2" title={String(row.question_type ?? '')}>
                          {displayScalar(row.question_type)}
                        </span>
                      </td>
                      <td className="px-3 py-3 align-top lg:px-4">
                        {qid == null ? (
                          <span className="text-xs text-slate-400">—</span>
                        ) : ansStats && ansTotal > 0 ? (
                          <div className="space-y-1">
                            <p className="flex flex-wrap items-center gap-x-2 gap-y-0.5 text-xs tabular-nums">
                              <span
                                className="inline-flex items-center gap-0.5 text-emerald-700"
                                title="Correct"
                              >
                                <Check
                                  className="size-3.5 shrink-0"
                                  strokeWidth={2.5}
                                  aria-hidden
                                />
                                {ansStats.correct}
                              </span>
                              <span className="text-slate-300" aria-hidden>
                                ·
                              </span>
                              <span
                                className="inline-flex items-center gap-0.5 text-rose-700"
                                title="Incorrect"
                              >
                                <X
                                  className="size-3.5 shrink-0"
                                  strokeWidth={2.5}
                                  aria-hidden
                                />
                                {ansStats.wrong}
                              </span>
                            </p>
                            <p
                              className={`text-xs font-semibold tabular-nums ${answerPctToneClass(ansPct)}`}
                            >
                              {ansPct}% correct
                            </p>
                          </div>
                        ) : (
                          <span
                            className="text-xs text-slate-400"
                            title="No graded attempts in user session data yet"
                          >
                            No data
                          </span>
                        )}
                      </td>
                      <td className="min-w-[160px] max-w-[260px] px-3 py-3 align-top lg:px-4">
                        {noteLines.length === 0 ? (
                          <span className="text-slate-400">—</span>
                        ) : (
                          <div
                            className="space-y-1.5 text-left"
                            title={notesTitle}
                          >
                            {noteLines.map((line) => (
                              <p
                                key={line.key}
                                className="line-clamp-3 text-xs leading-snug text-slate-700"
                              >
                                {line.prefix ? (
                                  <span className="font-medium text-slate-500">
                                    {line.prefix}{' '}
                                  </span>
                                ) : null}
                                {line.text}
                              </p>
                            ))}
                          </div>
                        )}
                      </td>
                      <td className="px-3 py-3 text-center tabular-nums text-slate-700 lg:px-4">
                        {reportCountsValue(row)}
                      </td>
                      <td className="px-3 py-3 text-center lg:px-4">
                        <button
                          type="button"
                          disabled={reportCount === 0}
                          onClick={() => openReportsModal(row)}
                          className={`inline-flex items-center justify-center gap-1.5 rounded-lg border px-2.5 py-1.5 text-xs font-semibold transition focus:outline-none focus-visible:ring-2 focus-visible:ring-violet-500 focus-visible:ring-offset-2 ${
                            reportCount > 0
                              ? 'cursor-pointer border-violet-200 bg-violet-50 text-violet-900 hover:border-violet-300 hover:bg-violet-100/80'
                              : 'cursor-not-allowed border-slate-100 bg-slate-50 text-slate-400'
                          }`}
                        >
                          <Flag className="size-3.5 shrink-0" strokeWidth={2} />
                          Reports
                          {reportCount > 0 ? (
                            <span className="tabular-nums">({reportCount})</span>
                          ) : null}
                        </button>
                      </td>
                    </tr>
                  )
                })}
              </tbody>
            </table>
          </div>
        )}
      </div>

      {reportModal ? (
        <div
          className="fixed inset-0 z-50 flex items-end justify-center bg-slate-900/40 p-0 backdrop-blur-sm sm:items-center sm:p-4"
          role="presentation"
          onClick={closeReportsModal}
        >
          <div
            role="dialog"
            aria-modal="true"
            aria-labelledby="reports-modal-title"
            className="flex max-h-[min(90vh,720px)] w-full max-w-lg flex-col rounded-t-2xl border border-slate-200 bg-white shadow-2xl sm:rounded-2xl"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="flex items-start justify-between gap-3 border-b border-slate-100 px-5 py-4">
              <div className="min-w-0">
                <h2
                  id="reports-modal-title"
                  className="text-lg font-semibold text-slate-900"
                >
                  Reports
                </h2>
                <p className="mt-1 font-mono text-xs text-slate-500">
                  {reportModal.firestoreDocId}
                </p>
                <p className="mt-2 line-clamp-3 text-sm text-slate-600">
                  {reportModal.questionPreview}
                </p>
              </div>
              <button
                type="button"
                onClick={closeReportsModal}
                className="shrink-0 cursor-pointer rounded-lg p-2 text-slate-500 transition hover:bg-slate-100 hover:text-slate-800 focus:outline-none focus-visible:ring-2 focus-visible:ring-violet-500"
                aria-label="Close"
              >
                <X className="size-5" strokeWidth={2} />
              </button>
            </div>
            <ul className="flex-1 overflow-y-auto px-3 py-3 sm:px-4 sm:py-4">
              {reportModal.reports.map((rep, index) => {
                const { issue, details, uid, appVersion, deviceType, at } =
                  reportSummaryLines(rep)
                const appMeta = reportMetaField(appVersion)
                const deviceMeta = reportMetaField(deviceType)
                const rk = `${reportModal.firestoreDocId}:${index}`
                const busy = resolvingKey === rk
                return (
                  <li
                    key={rk}
                    className="mb-3 list-none rounded-xl border border-slate-200 bg-slate-50/80 p-4 last:mb-0"
                  >
                    <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
                      <div className="min-w-0 flex-1 space-y-1.5 text-sm">
                        {issue ? (
                          <p>
                            <span className="font-semibold text-slate-700">
                              Type:{' '}
                            </span>
                            <span className="rounded-md bg-white px-1.5 py-0.5 font-mono text-xs text-violet-800 ring-1 ring-violet-100">
                              {issue}
                            </span>
                          </p>
                        ) : null}
                        {details ? (
                          <p className="break-words text-slate-700">
                            <span className="font-semibold text-slate-800">
                              Details:{' '}
                            </span>
                            {details}
                          </p>
                        ) : null}
                        {uid ? (
                          <p className="font-mono text-xs text-slate-500">
                            User: {uid}
                          </p>
                        ) : null}
                        <p className="font-mono text-xs text-slate-500">
                          App version:{' '}
                          <span
                            className={
                              appMeta.legacy ? 'italic text-slate-400' : undefined
                            }
                          >
                            {appMeta.display}
                          </span>
                        </p>
                        <p className="font-mono text-xs text-slate-500">
                          Device type:{' '}
                          <span
                            className={
                              deviceMeta.legacy
                                ? 'italic text-slate-400'
                                : undefined
                            }
                          >
                            {deviceMeta.display}
                          </span>
                        </p>
                        <p className="text-xs text-slate-500">Submitted: {at}</p>
                      </div>
                      <button
                        type="button"
                        disabled={resolvingKey !== null || notesSavingKey !== null}
                        onClick={() =>
                          resolveReport(reportModal.firestoreDocId, index)
                        }
                        className="shrink-0 cursor-pointer rounded-lg border border-emerald-200 bg-emerald-50 px-3 py-2 text-xs font-semibold text-emerald-900 transition hover:bg-emerald-100 focus:outline-none focus-visible:ring-2 focus-visible:ring-emerald-500 disabled:cursor-not-allowed disabled:opacity-50"
                      >
                        {busy ? (
                          <span className="inline-flex items-center gap-2">
                            <Loader2
                              className="size-3.5 animate-spin"
                              strokeWidth={2}
                            />
                            Resolving…
                          </span>
                        ) : (
                          'Resolve'
                        )}
                      </button>
                    </div>
                    <div className="mt-3 border-t border-slate-200/90 pt-3">
                      <label
                        htmlFor={`report-admin-notes-${rk}`}
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
                        id={`report-admin-notes-${rk}`}
                        rows={3}
                        value={modalNoteDrafts[rk] ?? ''}
                        onChange={(e) =>
                          setModalNoteDrafts((prev) => ({
                            ...prev,
                            [rk]: e.target.value,
                          }))
                        }
                        disabled={
                          resolvingKey !== null || notesSavingKey !== null
                        }
                        placeholder="Internal notes (saved on this report only)…"
                        className="mt-1.5 w-full resize-y rounded-lg border border-slate-200 bg-white px-3 py-2 text-sm text-slate-800 shadow-sm outline-none placeholder:text-slate-400 focus:border-violet-400 focus:ring-2 focus:ring-violet-500/20 disabled:cursor-not-allowed disabled:opacity-60"
                      />
                      <div className="mt-2 flex justify-end">
                        <button
                          type="button"
                          onClick={() =>
                            saveReportAdminNotes(
                              reportModal.firestoreDocId,
                              index,
                              modalNoteDrafts[rk] ?? '',
                            )
                          }
                          disabled={
                            resolvingKey !== null || notesSavingKey !== null
                          }
                          className="inline-flex cursor-pointer items-center gap-1.5 rounded-lg border border-violet-200 bg-violet-50 px-3 py-2 text-xs font-semibold text-violet-900 transition hover:bg-violet-100 focus:outline-none focus-visible:ring-2 focus-visible:ring-violet-500 disabled:cursor-not-allowed disabled:opacity-50"
                        >
                          {notesSavingKey === rk ? (
                            <span className="inline-flex items-center gap-2">
                              <Loader2
                                className="size-3.5 animate-spin"
                                strokeWidth={2}
                                aria-hidden
                              />
                              Saving…
                            </span>
                          ) : (
                            <>
                              <StickyNote
                                className="size-3.5 shrink-0"
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
              })}
            </ul>
          </div>
        </div>
      ) : null}
    </div>
  )
}
