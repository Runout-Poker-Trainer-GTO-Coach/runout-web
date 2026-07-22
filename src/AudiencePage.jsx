import {
  AlertCircle,
  AlertTriangle,
  BarChart3,
  ChevronLeft,
  ChevronRight,
  Download,
  Inbox,
  Loader2,
  PanelRight,
  Search,
  Trash2,
  X,
} from 'lucide-react'
import { useCallback, useEffect, useRef, useState } from 'react'
import {
  collection,
  getCountFromServer,
  getDocs,
  limit,
  orderBy,
  query,
  startAfter,
  where,
} from 'firebase/firestore'
import { db, firebaseReady, usersCollectionName } from './firebase'
import { downloadCsv, rowsToCsv } from './csv'
import { deleteUserAccount } from './deleteUserApi.js'
import { AUDIENCE_EXPORT_FIELDS } from './userFields'
import OnboardingUserDetailModal from './OnboardingUserDetailModal.jsx'
import { normalizeUserForExport } from './normalizeUser'
import { fetchPurchaseStatusBySubscriptions } from './fetchCustomersAxios.js'

function docToRow(id, data) {
  return { id, ...data }
}

function hasEmail(email) {
  return typeof email === 'string' && email.trim() !== ''
}

const DEBUG_DOC_ID = 'z9lbnkt9icUIyeCw04u3wvJfWtP2'

/**
 * Users are paginated from Firestore (ordered by `email`) instead of loading
 * the whole collection — the prior full-collection getDocs() would time out
 * once the collection got large enough.
 */
const USERS_PAGE_SIZE = 50

/**
 * Builds the `where` constraints shared by both the page query and the
 * lightweight count query (count doesn't need orderBy/limit/cursor). Upper
 * bound uses U+F8FF (private-use area, sorts after virtually all normal
 * text) — the standard Firestore "starts with" prefix-range idiom. Used
 * for both email and name search — whichever field is currently active.
 *
 * @param {'email' | 'name'} field
 * @param {string} term trimmed, already-lowercased search term ('' = browse all)
 */
function fieldRangeConstraints(field, term) {
  if (!term) return []
  return [where(field, '>=', term), where(field, '<', term + '')]
}

/**
 * Firestore equality constraint for the Purchase toggle. Needs its own
 * composite index (with `email`/`name`) — see firestore.indexes.json — since
 * Firestore requires an exact index match for equality-filter-plus-orderBy
 * queries.
 *
 * @param {{ purchase: 'all' | 'purchased' }} f
 */
function booleanFilterConstraints(f) {
  const constraints = []
  if (f.purchase === 'purchased') constraints.push(where('isPurchased', '==', true))
  return constraints
}

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
        className="absolute inset-0 cursor-pointer bg-slate-900/50 backdrop-blur-sm"
        onClick={onClose}
        aria-label="Close session stats"
      />
      <div className="relative flex max-h-[min(92vh,860px)] w-full max-w-2xl flex-col overflow-hidden rounded-t-2xl border border-slate-200/70 bg-white shadow-2xl sm:rounded-2xl">
        <div className="shrink-0 border-b border-slate-100 px-6 pb-4 pt-5">
          <div className="flex items-start justify-between gap-4">
            <div className="min-w-0">
              <p className="text-[11px] font-semibold uppercase tracking-wider text-emerald-600">
                Session stats
              </p>
              <h2
                id="session-stats-modal-title"
                className="mt-1 truncate text-lg font-semibold tracking-tight text-slate-900"
              >
                {String(row.name ?? '').trim() || String(row.email ?? 'User')}
              </h2>
              <p className="mt-0.5 truncate font-mono text-xs text-slate-500">
                {String(row.email ?? '') || '—'}
              </p>
            </div>
            <button
              type="button"
              onClick={onClose}
              className="shrink-0 cursor-pointer rounded-lg p-2 text-slate-400 transition-colors hover:bg-slate-100 hover:text-slate-700 focus:outline-none focus-visible:ring-2 focus-visible:ring-emerald-500 focus-visible:ring-offset-2"
              aria-label="Close session stats"
            >
              <X className="size-5" strokeWidth={2} aria-hidden />
            </button>
          </div>
        </div>
        <div className="min-h-0 flex-1 overflow-y-auto px-6 py-5">
          {!stats ? (
            <div className="rounded-xl border border-slate-200/90 bg-white p-4 text-sm text-slate-600">
              No session stats found for this user.
            </div>
          ) : (
            <>
              <dl className="grid grid-cols-1 gap-3 sm:grid-cols-3">
                <div className="rounded-lg border border-slate-200 bg-slate-50/60 px-3.5 py-3">
                  <dt className="text-[11px] font-medium text-slate-500">
                    ELO
                  </dt>
                  <dd className="mt-1 font-mono text-lg font-semibold text-slate-900">
                    {toFiniteNumber(stats.userEloRating) ?? '—'}
                  </dd>
                </div>
                <div className="rounded-lg border border-slate-200 bg-slate-50/60 px-3.5 py-3">
                  <dt className="text-[11px] font-medium text-slate-500">
                    Selected / requested
                  </dt>
                  <dd className="mt-1 font-mono text-lg font-semibold text-slate-900">
                    {toFiniteNumber(stats.selectedQuestionCount) ?? '—'} /{' '}
                    {toFiniteNumber(stats.requestedQuestionCount) ?? '—'}
                  </dd>
                </div>
                <div className="rounded-lg border border-slate-200 bg-slate-50/60 px-3.5 py-3">
                  <dt className="text-[11px] font-medium text-slate-500">
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
 * Confirms deleting a user's account via the deleteUser Cloud Function.
 * Requires typing the user's email — there's no undo once this succeeds.
 *
 * @param {{
 *   row: Record<string, unknown> | null
 *   busy: boolean
 *   error: string | null
 *   onCancel: () => void
 *   onConfirm: () => void
 * }} props
 */
function DeleteUserConfirmModal({ row, busy, error, onCancel, onConfirm }) {
  const [typed, setTyped] = useState('')
  const inputRef = useRef(/** @type {HTMLInputElement | null} */ (null))
  const email = String(row?.email ?? '').trim()
  const matches = typed.trim().toLowerCase() === email.toLowerCase()

  useEffect(() => {
    if (!row) return
    inputRef.current?.focus()
    const onKey = (e) => {
      if (e.key === 'Escape' && !busy) onCancel()
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [row, busy, onCancel])

  if (!row) return null

  return (
    <div
      className="fixed inset-0 z-[2100] flex items-end justify-center p-0 sm:items-center sm:p-6"
      role="dialog"
      aria-modal="true"
      aria-labelledby="delete-user-modal-title"
    >
      <button
        type="button"
        className="absolute inset-0 cursor-pointer bg-slate-950/55 backdrop-blur-[3px]"
        onClick={() => {
          if (!busy) onCancel()
        }}
        aria-label="Close"
      />
      <div className="relative flex w-full max-w-md flex-col rounded-t-2xl border border-rose-200 bg-white shadow-2xl sm:rounded-2xl">
        <div className="flex items-start gap-3 border-b border-rose-100 bg-rose-50/70 px-5 py-4">
          <div className="flex size-10 shrink-0 items-center justify-center rounded-xl bg-rose-600 text-white shadow-md shadow-rose-900/25">
            <AlertTriangle className="size-5" strokeWidth={2.25} aria-hidden />
          </div>
          <div className="min-w-0 flex-1">
            <h2
              id="delete-user-modal-title"
              className="text-base font-semibold text-rose-900"
            >
              Delete this user?
            </h2>
            <p className="text-xs text-rose-800/80">
              Calls the backend deleteUser function to remove their account.
              This cannot be undone from this screen.
            </p>
          </div>
          <button
            type="button"
            onClick={onCancel}
            disabled={busy}
            className="shrink-0 cursor-pointer rounded-lg p-1.5 text-rose-700 transition hover:bg-rose-100 focus:outline-none focus-visible:ring-2 focus-visible:ring-rose-500 disabled:cursor-not-allowed disabled:opacity-50"
            aria-label="Cancel"
          >
            <X className="size-5" strokeWidth={2} />
          </button>
        </div>

        <div className="space-y-3 px-5 py-4 text-sm">
          <div className="rounded-xl border border-slate-200 bg-slate-50/80 p-3">
            <p className="truncate font-mono text-xs text-slate-700" title={email}>
              {email || '(no email)'}
            </p>
            {String(row?.name ?? '').trim() ? (
              <p className="mt-1 truncate text-sm font-semibold text-slate-900">
                {String(row.name)}
              </p>
            ) : null}
          </div>

          <div>
            <label
              htmlFor="delete-user-confirm-input"
              className="block text-xs font-semibold text-slate-700"
            >
              To confirm, type the user's email below:
            </label>
            <input
              ref={inputRef}
              id="delete-user-confirm-input"
              type="text"
              autoComplete="off"
              value={typed}
              onChange={(e) => setTyped(e.target.value)}
              disabled={busy}
              placeholder={email}
              className={`mt-1.5 w-full rounded-lg border bg-white px-3 py-2 font-mono text-sm shadow-sm outline-none transition placeholder:text-slate-400 focus:ring-2 disabled:cursor-not-allowed disabled:opacity-60 ${
                typed.length === 0
                  ? 'border-slate-200 focus:border-rose-400 focus:ring-rose-500/15'
                  : matches
                    ? 'border-emerald-300 bg-emerald-50/50 focus:border-emerald-400 focus:ring-emerald-500/20'
                    : 'border-rose-300 focus:border-rose-400 focus:ring-rose-500/20'
              }`}
              onKeyDown={(e) => {
                if (e.key === 'Enter' && matches && !busy) onConfirm()
              }}
            />
          </div>

          {error ? (
            <div
              role="alert"
              className="flex gap-2 rounded-xl border border-red-200 bg-red-50 px-3 py-2 text-xs text-red-800"
            >
              <AlertCircle
                className="mt-0.5 size-3.5 shrink-0 text-red-600"
                strokeWidth={2}
              />
              <span>{error}</span>
            </div>
          ) : null}
        </div>

        <div className="flex flex-col-reverse gap-2 border-t border-slate-100 px-5 py-3 sm:flex-row sm:items-center sm:justify-end">
          <button
            type="button"
            onClick={onCancel}
            disabled={busy}
            className="cursor-pointer rounded-lg border border-slate-200 bg-white px-3 py-2 text-xs font-semibold text-slate-700 transition hover:border-slate-300 hover:bg-slate-50 focus:outline-none focus-visible:ring-2 focus-visible:ring-slate-400 disabled:cursor-not-allowed disabled:opacity-50"
          >
            Cancel
          </button>
          <button
            type="button"
            onClick={onConfirm}
            disabled={!matches || busy}
            className="inline-flex cursor-pointer items-center justify-center gap-1.5 rounded-lg bg-gradient-to-b from-rose-600 to-rose-700 px-4 py-2 text-xs font-semibold text-white shadow-md shadow-rose-900/25 transition hover:from-rose-700 hover:to-rose-800 focus:outline-none focus-visible:ring-2 focus-visible:ring-rose-500 focus-visible:ring-offset-2 disabled:cursor-not-allowed disabled:opacity-50"
          >
            {busy ? (
              <>
                <Loader2
                  className="size-3.5 animate-spin"
                  strokeWidth={2}
                  aria-hidden
                />
                Deleting…
              </>
            ) : (
              <>
                <Trash2 className="size-3.5 shrink-0" strokeWidth={2.25} aria-hidden />
                Delete
              </>
            )}
          </button>
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
      <span className="inline-flex items-center gap-2 text-slate-400">
        <Loader2
          className="size-3.5 animate-spin text-emerald-600"
          strokeWidth={2}
          aria-label="Loading purchase status"
        />
        <span className="text-xs">Syncing…</span>
      </span>
    )
  }
  if (value === undefined || value === null) {
    return <span className="text-slate-300">—</span>
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
      <span className="inline-flex items-center gap-1.5 text-xs font-medium text-emerald-700">
        <span className="size-1.5 shrink-0 rounded-full bg-emerald-500" aria-hidden />
        Purchased
      </span>
    )
  }
  return (
    <span className="inline-flex items-center gap-1.5 text-xs font-medium text-slate-400">
      <span className="size-1.5 shrink-0 rounded-full bg-slate-300" aria-hidden />
      No
    </span>
  )
}

export default function AudiencePage() {
  const [rows, setRows] = useState(
    /** @type {Array<Record<string, unknown> & { id: string }>} */ ([]),
  )
  const [loading, setLoading] = useState(!!firebaseReady)
  const [error, setError] = useState(null)
  // Draft text in the search box (updates every keystroke) vs. the term
  // actually driving the Firestore query (only updates on Search/Enter).
  // '' means "not searching — plain paginated browse".
  const [searchInput, setSearchInput] = useState('')
  const [activeSearch, setActiveSearch] = useState('')
  // Which field the search box currently targets (draft — the selector the
  // user sees; changing this alone fires nothing). `activeSearchField` is
  // the field the CURRENTLY LOADED page's query actually used, committed
  // together with `activeSearch` only when Search/Enter is pressed — Next/
  // Previous/filter changes must keep using this, not the live selector.
  const [searchField, setSearchField] = useState(/** @type {'email' | 'name'} */ ('email'))
  const [activeSearchField, setActiveSearchField] = useState(
    /** @type {'email' | 'name'} */ ('email'),
  )
  const [pageIndex, setPageIndex] = useState(0)
  // pageCursors[i] = the email/name value (whichever field is ordering the
  // current view) to startAfter() when fetching page i; null for page 0.
  // Populated one page ahead as each page loads, so both Next and Previous
  // always have their cursor ready before they're clicked.
  const [pageCursors, setPageCursors] = useState(
    /** @type {Array<string | null>} */ ([null]),
  )
  const [hasNextPage, setHasNextPage] = useState(false)
  const [totalCount, setTotalCount] = useState(/** @type {number | null} */ (null))
  const [detailRow, setDetailRow] = useState(
    /** @type {(typeof rows)[0] | null} */ (null),
  )
  const [sessionStatsRow, setSessionStatsRow] = useState(
    /** @type {(typeof rows)[0] | null} */ (null),
  )
  const [purchaseFilter, setPurchaseFilter] = useState(
    /** @type {'all' | 'purchased'} */ ('purchased'),
  )
  const [purchasePendingIds, setPurchasePendingIds] = useState(
    /** @type {Record<string, true>} */ ({}),
  )
  const [deletingUserRow, setDeletingUserRow] = useState(
    /** @type {Record<string, unknown> | null} */ (null),
  )
  const [deletingUserBusy, setDeletingUserBusy] = useState(false)
  // Scoped to this modal only — never shares state with the page-level
  // `error` banner, so a stale unrelated error can't leak into this dialog.
  const [deletingUserError, setDeletingUserError] = useState(
    /** @type {string | null} */ (null),
  )

  // Bundled into the client bundle like the other admin secrets in this
  // portal (RevenueCat key, AWS keys) — see .env.example. Button is disabled
  // below when this isn't configured.
  const deleteUserToken = import.meta.env.VITE_DELETE_USER_API_TOKEN?.trim()

  const purchaseSyncPending = Object.keys(purchasePendingIds).length > 0

  // Calls the deleteUser Cloud Function — a real backend account deletion,
  // not a local Firestore write. Only remove the row from view AFTER a
  // confirmed success response; there's nothing to optimistically roll back
  // to for an external, one-way delete like this one.
  const handleConfirmDeleteUser = useCallback(async () => {
    if (!deletingUserRow || !deleteUserToken) return
    const userId = deletingUserRow.id
    setDeletingUserBusy(true)
    setDeletingUserError(null)
    try {
      await deleteUserAccount({ token: deleteUserToken, uuid: userId })
      setRows((prev) => prev.filter((r) => r.id !== userId))
      setDetailRow((d) => (d?.id === userId ? null : d))
      setSessionStatsRow((d) => (d?.id === userId ? null : d))
      setDeletingUserRow(null)
    } catch (e) {
      setDeletingUserError(
        e?.response?.data?.message ||
          e?.response?.data?.error ||
          e?.message ||
          'Failed to delete user',
      )
    } finally {
      setDeletingUserBusy(false)
    }
  }, [deletingUserRow, deleteUserToken])

  useEffect(() => {
    const matchedUser = rows.find((user) => user.id === DEBUG_DOC_ID)
    if (matchedUser) {
      console.log('User for doc ID', DEBUG_DOC_ID, matchedUser)
    }
  }, [rows])

  // Guards against out-of-order responses when Next/Previous/Search are
  // clicked in quick succession — only the most recently issued request is
  // allowed to commit its results.
  const loadRequestIdRef = useRef(0)

  /**
   * Fetches one page of users from Firestore (ordered by email) and, when
   * starting a fresh browse/search session (page 0), refreshes the total
   * count via a cheap aggregation query.
   *
   * @param {number} targetPageIndex
   * @param {string} term trimmed + lowercased search term ('' = browse all)
   * @param {Array<string | null>} cursors pageCursors snapshot to read from
   */
  const loadPage = useCallback(async (targetPageIndex, term, searchField, cursors, boolFilters) => {
    if (!firebaseReady || !db) {
      setLoading(false)
      return
    }
    const requestId = ++loadRequestIdRef.current
    setLoading(true)
    setError(null)

    // Browsing (no term) always orders by email — the field toggle only
    // matters once a search is actually active.
    const orderField = term ? searchField : 'email'

    let next = []
    try {
      const cursorValue = cursors[targetPageIndex]
      const constraints = [
        ...fieldRangeConstraints(orderField, term),
        ...booleanFilterConstraints(boolFilters),
        orderBy(orderField),
        ...(cursorValue != null ? [startAfter(cursorValue)] : []),
        limit(USERS_PAGE_SIZE + 1),
      ]
      const snap = await getDocs(
        query(collection(db, usersCollectionName), ...constraints),
      )
      if (loadRequestIdRef.current !== requestId) return

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

      const pageDocs = snap.docs.slice(0, USERS_PAGE_SIZE)
      next = pageDocs
        .map((d) => normalizeUserForExport(docToRow(d.id, d.data())))
        .filter((row) => hasEmail(row.email))

      setRows(next)
      setPageIndex(targetPageIndex)
      setHasNextPage(snap.docs.length > USERS_PAGE_SIZE)
      if (pageDocs.length > 0) {
        const lastCursorValue = String(
          pageDocs[pageDocs.length - 1].data()[orderField] ?? '',
        )
        setPageCursors((prev) => {
          const nextCursors = [...prev]
          nextCursors[targetPageIndex + 1] = lastCursorValue
          return nextCursors
        })
      }
    } catch (e) {
      if (loadRequestIdRef.current !== requestId) return
      setError(e?.message || 'Failed to load users')
      setRows([])
      setHasNextPage(false)
      setLoading(false)
      return
    }

    // Total count — a lightweight aggregation query, only refreshed when
    // starting a fresh browse/search session, not on every page turn.
    if (targetPageIndex === 0) {
      try {
        const countSnap = await getCountFromServer(
          query(
            collection(db, usersCollectionName),
            ...fieldRangeConstraints(orderField, term),
            ...booleanFilterConstraints(boolFilters),
          ),
        )
        if (loadRequestIdRef.current === requestId) {
          setTotalCount(countSnap.data().count)
        }
      } catch {
        if (loadRequestIdRef.current === requestId) setTotalCount(null)
      }
    }

    if (loadRequestIdRef.current !== requestId) return
    setLoading(false)

    const apiKey = import.meta.env.VITE_REVENUECAT_SECRET_API_KEY?.trim()
    const projectId = import.meta.env.VITE_REVENUECAT_PROJECT_ID?.trim()
    const usersNeedingPurchaseSync = next.filter(
      (r) => typeof r.isPurchased !== 'boolean',
    )
    if (apiKey && projectId && usersNeedingPurchaseSync.length > 0) {
      setPurchasePendingIds(
        Object.fromEntries(usersNeedingPurchaseSync.map((r) => [r.id, true])),
      )
      await fetchPurchaseStatusBySubscriptions({
        apiKey,
        projectId,
        customerIds: usersNeedingPurchaseSync.map((r) => r.id),
        concurrency: 5,
        onProgress: (id, purchased) => {
          if (loadRequestIdRef.current !== requestId) return
          setRows((prev) =>
            prev.map((r) => (r.id === id ? { ...r, isPurchased: purchased } : r)),
          )
          setPurchasePendingIds((prev) => {
            const n = { ...prev }
            delete n[id]
            return n
          })
        },
      })
    }
  }, [])

  useEffect(() => {
    loadPage(0, '', 'email', [null], { purchase: purchaseFilter })
    // Mount-only load — intentionally NOT re-running when the filter state
    // below changes; the filter onChange handlers trigger their own reload.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  const goToNextPage = useCallback(() => {
    if (!hasNextPage || loading) return
    loadPage(pageIndex + 1, activeSearch, activeSearchField, pageCursors, {
      purchase: purchaseFilter,
    })
  }, [
    hasNextPage,
    loading,
    pageIndex,
    activeSearch,
    activeSearchField,
    pageCursors,
    purchaseFilter,
    loadPage,
  ])

  const goToPreviousPage = useCallback(() => {
    if (pageIndex === 0 || loading) return
    loadPage(pageIndex - 1, activeSearch, activeSearchField, pageCursors, {
      purchase: purchaseFilter,
    })
  }, [
    pageIndex,
    loading,
    activeSearch,
    activeSearchField,
    pageCursors,
    purchaseFilter,
    loadPage,
  ])

  const handleSearchSubmit = useCallback(() => {
    // Emails are consistently stored lowercase, so forcing lowercase there
    // is safe and forgiving. Names are stored in whatever case the user
    // entered them (~92% sampled start uppercase, e.g. "John Mangan") — a
    // Firestore prefix range is a plain byte comparison with no
    // case-folding, so lowercasing "John" to "john" would sort it AFTER
    // "John Mangan" and silently return zero matches. Name search is
    // therefore case-sensitive; only trim it.
    const term =
      searchField === 'name' ? searchInput.trim() : searchInput.trim().toLowerCase()
    setActiveSearch(term)
    setActiveSearchField(searchField)
    setPageCursors([null])
    loadPage(0, term, searchField, [null], { purchase: purchaseFilter })
  }, [searchInput, searchField, purchaseFilter, loadPage])

  const handleClearSearch = useCallback(() => {
    setSearchInput('')
    setActiveSearch('')
    setActiveSearchField('email')
    setPageCursors([null])
    loadPage(0, '', 'email', [null], { purchase: purchaseFilter })
  }, [purchaseFilter, loadPage])

  // Changing this toggle is a fresh Firestore query — reset to page 0 with a
  // clean cursor stack, same as starting a new search.
  const handlePurchaseFilterChange = useCallback(
    (next) => {
      setPurchaseFilter(next)
      setPageCursors([null])
      loadPage(0, activeSearch, activeSearchField, [null], { purchase: next })
    },
    [activeSearch, activeSearchField, loadPage],
  )

  const handleExport = useCallback(() => {
    if (rows.length === 0 || purchaseSyncPending) return
    const csv = rowsToCsv(rows, AUDIENCE_EXPORT_FIELDS)
    const stamp = new Date().toISOString().slice(0, 19).replace(/[:T]/g, '-')
    downloadCsv(`users-${stamp}.csv`, csv)
  }, [rows, purchaseSyncPending])

  return (
    <div className="min-h-[calc(100vh-3.5rem)] bg-slate-50 px-4 py-8 sm:px-6 lg:px-10">
      <div className="mx-auto max-w-[100rem]">
        <header className="mb-6 flex flex-col gap-5">
          <div className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
            <div className="min-w-0">
              <h1 className="text-[22px] font-semibold tracking-tight text-slate-900">
                Users
              </h1>
              <p className="mt-1 text-sm text-slate-500">
                {rows.length > 0
                  ? `${rows.length} shown on this page`
                  : !loading
                    ? `Collection: ${usersCollectionName}`
                    : ' '}
              </p>
            </div>

            <div
              role="radiogroup"
              aria-label="Filter by purchase"
              className="inline-flex shrink-0 items-center gap-0.5 self-start rounded-lg bg-slate-100 p-1"
            >
              <button
                type="button"
                role="radio"
                aria-checked={purchaseFilter === 'all'}
                onClick={() => handlePurchaseFilterChange('all')}
                className={`cursor-pointer rounded-md px-3.5 py-1.5 text-[13px] font-medium transition-colors ${
                  purchaseFilter === 'all'
                    ? 'bg-white text-slate-900 shadow-sm'
                    : 'text-slate-500 hover:text-slate-800'
                }`}
              >
                All users
              </button>
              <button
                type="button"
                role="radio"
                aria-checked={purchaseFilter === 'purchased'}
                onClick={() => handlePurchaseFilterChange('purchased')}
                className={`cursor-pointer rounded-md px-3.5 py-1.5 text-[13px] font-medium transition-colors ${
                  purchaseFilter === 'purchased'
                    ? 'bg-white text-slate-900 shadow-sm'
                    : 'text-slate-500 hover:text-slate-800'
                }`}
              >
                Purchased only
              </button>
            </div>
          </div>

          <div className="flex flex-col gap-3 sm:flex-row sm:flex-wrap sm:items-center">
            <div className="flex min-w-0 flex-1 items-center gap-0 rounded-lg border border-slate-200 bg-white shadow-sm sm:min-w-[22rem]">
              <label className="sr-only" htmlFor="audience-search-field">
                Search field
              </label>
              <select
                id="audience-search-field"
                value={searchField}
                onChange={(e) => setSearchField(e.target.value)}
                disabled={loading}
                title="Only ~29% of users have a name on file — email search covers everyone"
                className="shrink-0 cursor-pointer rounded-l-lg border-r border-slate-200 bg-transparent py-2.5 pl-3.5 pr-7 text-sm font-medium text-slate-600 outline-none disabled:cursor-not-allowed disabled:opacity-60"
              >
                <option value="email">Email</option>
                <option value="name">Name</option>
              </select>
              <label className="sr-only" htmlFor="audience-search">
                {searchField === 'name' ? 'Search by name' : 'Search by email'}
              </label>
              <div className="relative min-w-0 flex-1">
                <Search
                  className="pointer-events-none absolute left-3 top-1/2 size-4 -translate-y-1/2 text-slate-400"
                  strokeWidth={2}
                  aria-hidden
                />
                <input
                  id="audience-search"
                  type="search"
                  placeholder={
                    searchField === 'name'
                      ? 'Search by name (case-sensitive, e.g. "John")…'
                      : 'Search by email…'
                  }
                  value={searchInput}
                  onChange={(e) => setSearchInput(e.target.value)}
                  onKeyDown={(e) => {
                    if (e.key === 'Enter') handleSearchSubmit()
                  }}
                  disabled={loading}
                  className="w-full rounded-r-lg bg-transparent py-2.5 pl-10 pr-3 text-sm text-slate-900 outline-none placeholder:text-slate-400 disabled:cursor-not-allowed disabled:opacity-60"
                />
              </div>
            </div>
            <button
              type="button"
              onClick={handleSearchSubmit}
              disabled={loading}
              title="Only queries Firestore when you click this — typing alone does not search"
              className="inline-flex shrink-0 cursor-pointer items-center justify-center gap-1.5 rounded-lg bg-slate-900 px-4 py-2.5 text-sm font-semibold text-white shadow-sm transition-colors hover:bg-slate-800 focus:outline-none focus-visible:ring-2 focus-visible:ring-emerald-500 focus-visible:ring-offset-2 disabled:cursor-not-allowed disabled:opacity-45"
            >
              <Search className="size-4" strokeWidth={2} aria-hidden />
              Search
            </button>
            {activeSearch !== '' ? (
              <button
                type="button"
                onClick={handleClearSearch}
                disabled={loading}
                className="inline-flex shrink-0 cursor-pointer items-center justify-center gap-1.5 rounded-lg border border-slate-200 bg-white px-3.5 py-2.5 text-sm font-medium text-slate-600 shadow-sm transition-colors hover:border-slate-300 hover:bg-slate-50 focus:outline-none focus-visible:ring-2 focus-visible:ring-emerald-500 focus-visible:ring-offset-2 disabled:cursor-not-allowed disabled:opacity-45"
              >
                <X className="size-4" strokeWidth={2} aria-hidden />
                Clear
              </button>
            ) : null}
            <button
              type="button"
              onClick={handleExport}
              disabled={loading || rows.length === 0 || purchaseSyncPending}
              title="Exports only the currently loaded page — not the entire collection"
              className="inline-flex shrink-0 cursor-pointer items-center justify-center gap-1.5 rounded-lg border border-emerald-600 bg-emerald-600 px-4 py-2.5 text-sm font-semibold text-white shadow-sm transition-colors hover:bg-emerald-700 focus:outline-none focus-visible:ring-2 focus-visible:ring-emerald-500 focus-visible:ring-offset-2 disabled:cursor-not-allowed disabled:opacity-45 sm:ml-auto"
            >
              <Download className="size-4" strokeWidth={2} aria-hidden />
              Export page CSV
            </button>
          </div>

          <div className="flex flex-wrap items-center justify-between gap-3 text-sm">
            <p className="text-slate-500">
              {activeSearch ? (
                <>
                  {activeSearchField === 'name' ? 'Names' : 'Emails'} starting with{' '}
                  <span className="font-mono font-medium text-slate-800">
                    {activeSearch}
                  </span>
                  {totalCount != null ? ` · ${totalCount} match${totalCount === 1 ? '' : 'es'}` : null}
                </>
              ) : (
                <>Page {pageIndex + 1}{totalCount != null ? ` · ${totalCount.toLocaleString()} total users` : null}</>
              )}
            </p>
            <div className="flex items-center gap-2">
              <button
                type="button"
                onClick={goToPreviousPage}
                disabled={pageIndex === 0 || loading}
                className="inline-flex cursor-pointer items-center gap-1 rounded-lg border border-slate-200 bg-white px-3 py-1.5 text-xs font-semibold text-slate-600 shadow-sm transition-colors hover:border-slate-300 hover:bg-slate-50 focus:outline-none focus-visible:ring-2 focus-visible:ring-emerald-500 focus-visible:ring-offset-2 disabled:cursor-not-allowed disabled:opacity-40"
              >
                <ChevronLeft className="size-3.5" strokeWidth={2.25} aria-hidden />
                Previous
              </button>
              <button
                type="button"
                onClick={goToNextPage}
                disabled={!hasNextPage || loading}
                className="inline-flex cursor-pointer items-center gap-1 rounded-lg border border-slate-200 bg-white px-3 py-1.5 text-xs font-semibold text-slate-600 shadow-sm transition-colors hover:border-slate-300 hover:bg-slate-50 focus:outline-none focus-visible:ring-2 focus-visible:ring-emerald-500 focus-visible:ring-offset-2 disabled:cursor-not-allowed disabled:opacity-40"
              >
                Next
                <ChevronRight className="size-3.5" strokeWidth={2.25} aria-hidden />
              </button>
            </div>
          </div>
        </header>

        {error && (
          <div
            role="alert"
            className="mb-6 flex gap-3 rounded-lg border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-800"
          >
            <AlertCircle
              className="mt-0.5 size-4 shrink-0 text-red-600"
              strokeWidth={2}
            />
            <span>{error}</span>
          </div>
        )}

        <div className="overflow-hidden rounded-xl border border-slate-200 bg-white">
          {loading ? (
            <div className="flex flex-col items-center justify-center gap-4 py-24 text-slate-500">
              <Loader2
                className="size-7 animate-spin text-emerald-600"
                strokeWidth={2}
                aria-hidden
              />
              <p className="text-sm font-medium">Loading users…</p>
            </div>
          ) : rows.length === 0 ? (
            <div className="flex flex-col items-center px-4 py-20 text-center">
              <div className="mb-4 flex size-12 items-center justify-center rounded-xl bg-slate-100 text-slate-400">
                <Inbox className="size-6" strokeWidth={1.75} aria-hidden />
              </div>
              <p className="max-w-sm text-sm text-slate-500">
                No users with an email in this collection.
              </p>
            </div>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full min-w-[44rem] text-left text-sm">
                <thead>
                  <tr className="border-b border-slate-200">
                    <th
                      scope="col"
                      className="whitespace-nowrap px-5 py-3 text-left text-[11px] font-semibold uppercase tracking-wide text-slate-400"
                    >
                      Name
                    </th>
                    <th
                      scope="col"
                      className="whitespace-nowrap px-5 py-3 text-left text-[11px] font-semibold uppercase tracking-wide text-slate-400"
                    >
                      Email
                    </th>
                    <th
                      scope="col"
                      className="whitespace-nowrap px-5 py-3 text-left text-[11px] font-semibold uppercase tracking-wide text-slate-400"
                    >
                      Skill level
                    </th>
                    <th
                      scope="col"
                      className="whitespace-nowrap px-5 py-3 text-left text-[11px] font-semibold uppercase tracking-wide text-slate-400"
                    >
                      Purchased
                    </th>
                    <th
                      scope="col"
                      className="whitespace-nowrap px-5 py-3 text-left text-[11px] font-semibold uppercase tracking-wide text-slate-400"
                    >
                      Session count
                    </th>
                    <th
                      scope="col"
                      className="whitespace-nowrap px-5 py-3 text-right text-[11px] font-semibold uppercase tracking-wide text-slate-400"
                    >
                      Actions
                    </th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-100">
                  {rows.map((row) => {
                    const purchaseLoading = Boolean(purchasePendingIds[row.id])
                    const purchased = row.isPurchased
                    const skillRaw = String(row.skillLevel ?? '').trim()
                    const sessionCountVal = row.sessionCount
                    const hasSessionStats = Boolean(toRecord(row.sessionStats))
                    return (
                      <tr
                        key={row.id}
                        className="transition-colors hover:bg-slate-50/80"
                      >
                        <td className="max-w-[min(100vw,18rem)] truncate px-5 py-3 text-sm font-medium text-slate-900">
                          {String(row.name ?? '').trim() ? (
                            String(row.name ?? '')
                          ) : (
                            <span className="text-slate-300">—</span>
                          )}
                        </td>
                        <td className="max-w-[min(100vw,20rem)] truncate px-5 py-3 font-mono text-[13px] text-slate-600">
                          {String(row.email ?? '')}
                        </td>
                        <td
                          className="max-w-[12rem] truncate px-5 py-3 text-[13px] text-slate-600"
                          title={skillRaw || undefined}
                        >
                          {skillRaw || (
                            <span className="text-slate-300">—</span>
                          )}
                        </td>
                        <td className="px-5 py-3">
                          {audiencePurchaseCell(purchased, purchaseLoading)}
                        </td>
                        <td
                          className="whitespace-nowrap px-5 py-3 font-mono text-[13px] tabular-nums text-slate-600"
                          title={
                            sessionCountVal != null
                              ? String(sessionCountVal)
                              : undefined
                          }
                        >
                          {sessionCountVal != null ? (
                            sessionCountVal
                          ) : (
                            <span className="text-slate-300">—</span>
                          )}
                        </td>
                        <td className="whitespace-nowrap px-5 py-2.5 text-right">
                          <div className="inline-flex items-center gap-1.5">
                            <button
                              type="button"
                              disabled={!hasSessionStats}
                              onClick={() => setSessionStatsRow(row)}
                              title="Session stats"
                              aria-label="Session stats"
                              className="inline-flex size-8 cursor-pointer items-center justify-center rounded-md border border-slate-200 bg-white text-slate-500 transition-colors hover:border-slate-300 hover:bg-slate-50 hover:text-slate-800 focus:outline-none focus-visible:ring-2 focus-visible:ring-emerald-500 focus-visible:ring-offset-1 disabled:cursor-not-allowed disabled:opacity-30"
                            >
                              <BarChart3 className="size-4" strokeWidth={2} aria-hidden />
                            </button>
                            <button
                              type="button"
                              onClick={() => setDetailRow(row)}
                              title="View detail"
                              aria-label="View detail"
                              className="inline-flex size-8 cursor-pointer items-center justify-center rounded-md border border-slate-200 bg-white text-slate-500 transition-colors hover:border-slate-300 hover:bg-slate-50 hover:text-slate-800 focus:outline-none focus-visible:ring-2 focus-visible:ring-emerald-500 focus-visible:ring-offset-1"
                            >
                              <PanelRight className="size-4" strokeWidth={2} aria-hidden />
                            </button>
                            <button
                              type="button"
                              onClick={() => {
                                setDeletingUserError(null)
                                setDeletingUserRow(row)
                              }}
                              disabled={!deleteUserToken}
                              title={
                                deleteUserToken
                                  ? 'Delete this user'
                                  : 'Set VITE_DELETE_USER_API_TOKEN in .env to enable'
                              }
                              aria-label="Delete this user"
                              className="inline-flex size-8 cursor-pointer items-center justify-center rounded-md border border-slate-200 bg-white text-slate-500 transition-colors hover:border-rose-200 hover:bg-rose-50 hover:text-rose-600 focus:outline-none focus-visible:ring-2 focus-visible:ring-rose-500 focus-visible:ring-offset-1 disabled:cursor-not-allowed disabled:opacity-30"
                            >
                              <Trash2 className="size-4" strokeWidth={2} aria-hidden />
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
      </div>

      <OnboardingUserDetailModal
        row={detailRow}
        onClose={() => setDetailRow(null)}
        mode="audience"
        tagVariant="emerald"
        fields={AUDIENCE_EXPORT_FIELDS}
        purchasePending={
          detailRow ? Boolean(purchasePendingIds[detailRow.id]) : false
        }
      />
      <AudienceSessionStatsModal
        row={sessionStatsRow}
        onClose={() => setSessionStatsRow(null)}
      />
      <DeleteUserConfirmModal
        row={deletingUserRow}
        busy={deletingUserBusy}
        error={deletingUserError}
        onCancel={() => {
          if (!deletingUserBusy) setDeletingUserRow(null)
        }}
        onConfirm={handleConfirmDeleteUser}
      />
    </div>
  )
}
