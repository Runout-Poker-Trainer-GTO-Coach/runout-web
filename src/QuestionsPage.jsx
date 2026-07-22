import {
  AlertCircle,
  ArrowDownWideNarrow,
  ArrowUpNarrowWide,
  Check,
  ChevronsUpDown,
  Filter,
  Flag,
  Inbox,
  Loader2,
  Pencil,
  StickyNote,
  MessageCircleQuestion,
  Search,
  SearchX,
  X,
} from 'lucide-react'
import { useCallback, useEffect, useMemo, useState } from 'react'
import { collection, getDocs } from 'firebase/firestore'
import { db, firebaseReady, questionsCollectionName } from './firebase'
import {
  answerPctToneClass,
  answerStatsForRow,
  displayScalar,
  isDeletedQuestionRow,
  questionDocToRow,
  questionPreviewText,
  questionRowMatchesSearch,
} from './questionRow.js'
import ReportsModal from './ReportsModal.jsx'

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
 * @param {'none' | 'asc' | 'desc'} docIdSort
 * @param {'none' | 'count_desc' | 'count_asc'} reportSort
 * @param {Array<{ firestoreDocId: string } & Record<string, unknown>>} rows
 */
function sortQuestionRows(docIdSort, reportSort, rows) {
  const copy = [...rows]
  copy.sort((a, b) => {
    // An explicit doc-id sort is the primary ordering when active.
    if (docIdSort !== 'none') {
      const d = compareFirestoreDocIdAsc(a, b)
      return docIdSort === 'asc' ? d : -d
    }
    if (reportSort !== 'none') {
      const ca = getReportsArray(a).length
      const cb = getReportsArray(b).length
      const rd =
        reportSort === 'count_desc' ? cb - ca : ca - cb
      if (rd !== 0) return rd
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

/**
 * @param {{ onEditClick?: () => void }} [props]
 */
export default function QuestionsPage({ onEditClick } = {}) {
  const [rows, setRows] = useState(
    /** @type {Array<{ firestoreDocId: string } & Record<string, unknown>>} */ (
      []
    ),
  )
  const [loading, setLoading] = useState(!!firebaseReady)
  const [error, setError] = useState(null)
  const [searchQuery, setSearchQuery] = useState('')
  const [reportFilter, setReportFilter] = useState('reported')
  /** @type {({ firestoreDocId: string } & Record<string, unknown>) | null} */
  const [viewingReportsRow, setViewingReportsRow] = useState(null)
  const [reportSort, setReportSort] = useState(
    /** @type {'none' | 'count_desc' | 'count_asc'} */ ('count_desc'),
  )
  const [docIdSort, setDocIdSort] = useState(
    /** @type {'none' | 'asc' | 'desc'} */ ('none'),
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

  const displayRows = useMemo(
    () => sortQuestionRows(docIdSort, reportSort, filteredRows),
    [filteredRows, reportSort, docIdSort],
  )

  const cycleDocIdSort = useCallback(() => {
    setDocIdSort((s) => (s === 'none' ? 'asc' : s === 'asc' ? 'desc' : 'none'))
    // Doc-id sort is the primary ordering — clear the other column sort so
    // the header arrows stay truthful about what's actually sorting the list.
    setReportSort('none')
  }, [])

  const cycleReportSort = useCallback(() => {
    setReportSort((s) =>
      s === 'count_desc'
        ? 'count_asc'
        : s === 'count_asc'
          ? 'none'
          : 'count_desc',
    )
    setDocIdSort('none')
  }, [])

  const hasSearch = searchQuery.trim() !== ''
  const hasActiveFilters = hasSearch || reportFilter === 'reported'

  const openReportsModal = useCallback((row) => {
    if (getReportsArray(row).length === 0) return
    setViewingReportsRow(row)
  }, [])

  const closeReportsModal = useCallback(() => {
    setViewingReportsRow(null)
  }, [])

  // Keeps the table's row data (badge counts, filters) in sync after a
  // resolve/notes-save inside the shared modal.
  const handleReportsChange = useCallback((firestoreDocId, nextReports) => {
    setRows((prev) =>
      prev.map((r) =>
        r.firestoreDocId === firestoreDocId ? { ...r, reports: nextReports } : r,
      ),
    )
  }, [])

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
        const qSnap = await getDocs(collection(db, questionsCollectionName))
        if (cancelled) return
        const list = qSnap.docs
          .map((d) => questionDocToRow(d.id, d.data()))
          .filter((r) => !isDeletedQuestionRow(r))
        setRows(list)
      } catch (e) {
        if (!cancelled) {
          setError(e?.message || 'Failed to load questions')
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
          {onEditClick ? (
            <button
              type="button"
              onClick={onEditClick}
              className="inline-flex shrink-0 cursor-pointer items-center justify-center gap-1.5 rounded-xl border border-violet-200 bg-violet-50 px-4 py-2.5 text-sm font-semibold text-violet-900 shadow-sm transition hover:border-violet-300 hover:bg-violet-100/80 focus:outline-none focus-visible:ring-2 focus-visible:ring-violet-500 focus-visible:ring-offset-2"
            >
              <Pencil
                className="size-4 shrink-0"
                strokeWidth={2.25}
                aria-hidden
              />
              Edit Questions
            </button>
          ) : null}
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
                    <button
                      type="button"
                      onClick={cycleDocIdSort}
                      className="group inline-flex max-w-full cursor-pointer items-center gap-1.5 rounded-lg text-left transition hover:text-violet-800 focus:outline-none focus-visible:ring-2 focus-visible:ring-violet-500 focus-visible:ring-offset-2"
                      title={
                        docIdSort === 'none'
                          ? 'Sort by doc ID (ascending)'
                          : docIdSort === 'asc'
                            ? 'Sorted: doc ID ascending — click for descending'
                            : 'Sorted: doc ID descending — click to clear sort'
                      }
                      aria-sort={
                        docIdSort === 'asc'
                          ? 'ascending'
                          : docIdSort === 'desc'
                            ? 'descending'
                            : 'none'
                      }
                    >
                      <span>Doc ID</span>
                      {docIdSort === 'asc' ? (
                        <ArrowUpNarrowWide
                          className="size-3.5 shrink-0 text-violet-600"
                          strokeWidth={2.25}
                          aria-hidden
                        />
                      ) : docIdSort === 'desc' ? (
                        <ArrowDownWideNarrow
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
                    Answer stats
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
                  const { lines: noteLines, title: notesTitle } =
                    reportsAdminNotesForTable(reports)
                  const {
                    correct: ansCorrect,
                    wrong: ansWrong,
                    pct: ansPct,
                  } = answerStatsForRow(row)
                  const ansTotal = ansCorrect + ansWrong
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
                        {ansTotal > 0 ? (
                          <span
                            className={`inline-flex items-center gap-1.5 rounded-full px-2 py-0.5 text-[11px] font-semibold tabular-nums ring-1 ${answerPctToneClass(ansPct)}`}
                            title={`Graded attempts: ${ansCorrect.toLocaleString()} correct, ${ansWrong.toLocaleString()} wrong (${ansPct}% correct)`}
                          >
                            <Check
                              className="size-3 shrink-0"
                              strokeWidth={2.5}
                              aria-hidden
                            />
                            {ansCorrect.toLocaleString()}
                            <X
                              className="size-3 shrink-0 opacity-70"
                              strokeWidth={2.5}
                              aria-hidden
                            />
                            {ansWrong.toLocaleString()}
                            <span className="opacity-60">·</span>
                            <span>{ansPct}%</span>
                          </span>
                        ) : (
                          <span className="text-slate-400">—</span>
                        )}
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

      <ReportsModal
        row={viewingReportsRow}
        onClose={closeReportsModal}
        onReportsChange={handleReportsChange}
      />
    </div>
  )
}
