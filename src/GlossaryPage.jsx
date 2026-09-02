import {
  AlertCircle,
  AlertTriangle,
  BookMarked,
  Check,
  ChevronDown,
  Eye,
  EyeOff,
  FileUp,
  Filter,
  Loader2,
  Minus,
  Plus,
  RefreshCw,
  Search,
  SearchX,
  Star,
  Upload,
  X,
} from 'lucide-react'
import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { doc, increment, serverTimestamp, updateDoc } from 'firebase/firestore'
import {
  db,
  settingsCollectionName,
  settingsDocumentId,
} from './firebase'
import { csvToGlossaryEntries, diffGlossaryEntries } from './glossaryCsv.js'
import { publishGlossaryToR2 } from './glossaryR2.js'

/**
 * Public, unauthenticated JSON — same R2-hosted glossary the mobile app
 * reads from. No admin write path; this page is a read-only browser.
 */
const GLOSSARY_URL =
  'https://pub-045157849fb842d7a7cc22bc4033169d.r2.dev/glossary/pokerGlossary.en.json'

/** @param {unknown} v */
function asStr(v) {
  if (v == null) return ''
  if (typeof v === 'string') return v
  return String(v)
}

/** Count of ⭐ characters in the raw `Importance` string — 0 if blank/unset. */
function importanceLevel(v) {
  const s = asStr(v)
  return [...s].filter((ch) => ch === '⭐').length
}

/**
 * @param {Record<string, unknown>} row
 * @param {string} q lowercased query
 */
function rowMatchesQuery(row, q) {
  if (!q) return true
  const fields = [
    row.Term,
    row.Definition,
    row['Specific Situation'],
    row['Why It Matters'],
    row['Examples of Term Usage'],
  ]
  for (const f of fields) {
    if (f == null) continue
    if (String(f).toLowerCase().includes(q)) return true
  }
  return false
}

/**
 * A handful of rows in the source sheet are section dividers (e.g. "Alias
 * rows below:") that carry a Term but no body content at all — not real
 * glossary entries. Filtered out rather than rendered as empty cards.
 * @param {Record<string, unknown>} row
 */
function hasBody(row) {
  return Boolean(
    asStr(row.Definition).trim() ||
    asStr(row['Specific Situation']).trim() ||
    asStr(row['Why It Matters']).trim() ||
    asStr(row['Examples of Term Usage']).trim(),
  )
}

export default function GlossaryPage() {
  const [terms, setTerms] = useState(
    /** @type {Array<Record<string, unknown>>} */([]),
  )
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState(/** @type {string | null} */(null))
  const [searchQuery, setSearchQuery] = useState('')
  const [importanceFilter, setImportanceFilter] = useState('all')
  const [expandedIndex, setExpandedIndex] = useState(
    /** @type {number | null} */(null),
  )
  const [uploadModalOpen, setUploadModalOpen] = useState(false)

  // Guards against a stale response landing after a newer one — relevant
  // once loadGlossary is also called manually (post-publish reload), not
  // just once on mount.
  const loadRequestId = useRef(0)

  // Pure fetch — callers are responsible for setting loading/error state
  // themselves before invoking this, so each call site's setState calls
  // stay directly visible in the effect/handler that makes them.
  const loadGlossary = useCallback(() => {
    const requestId = ++loadRequestId.current
    // no-store: the browser's default HTTP cache was serving stale content
    // after a publish — a plain fetch() could return an old cached copy
    // even after a full page reload, while curl/cache:'no-store' saw the
    // real current file.
    return fetch(GLOSSARY_URL, { cache: 'no-store' })
      .then((res) => {
        if (!res.ok) throw new Error(`Glossary request returned ${res.status}`)
        return res.json()
      })
      .then((data) => {
        if (loadRequestId.current !== requestId) return
        setTerms(Array.isArray(data) ? data : [])
      })
      .catch((e) => {
        if (loadRequestId.current !== requestId) return
        setError(e?.message || 'Failed to load glossary')
      })
      .finally(() => {
        if (loadRequestId.current === requestId) setLoading(false)
      })
  }, [])

  // No setLoading(true)/setError(null) here — `loading` already starts
  // true and `error` starts null, so resetting them on mount would be a
  // redundant synchronous setState inside the effect body.
  useEffect(() => {
    loadGlossary()
  }, [loadGlossary])

  // A handful of rows are section dividers from the source sheet (e.g.
  // "Alias rows below:") with a Term but no body — not real entries.
  const usableTerms = useMemo(() => terms.filter(hasBody), [terms])

  const displayTerms = useMemo(() => {
    const q = searchQuery.trim().toLowerCase()
    return terms
      .map((t, index) => ({ term: t, index }))
      .filter(({ term }) => hasBody(term))
      .filter(({ term }) => {
        if (importanceFilter === 'all') return true
        return importanceLevel(term.Importance) === Number(importanceFilter)
      })
      .filter(({ term }) => rowMatchesQuery(term, q))
      .sort((a, b) =>
        asStr(a.term.Term).localeCompare(asStr(b.term.Term), undefined, {
          sensitivity: 'base',
        }),
      )
  }, [terms, searchQuery, importanceFilter])

  const hasActiveFilters =
    searchQuery.trim() !== '' || importanceFilter !== 'all'

  return (
    <div className="px-4 py-6 sm:px-6 lg:px-8 lg:py-8">
      <header className="mb-8 flex flex-col gap-5 lg:flex-row lg:items-end lg:justify-between">
        <div className="flex items-start gap-3 sm:items-center sm:gap-4">
          <div className="flex size-11 shrink-0 items-center justify-center rounded-xl bg-white shadow-md shadow-slate-900/[0.04] ring-1 ring-slate-200/90 sm:size-12">
            <BookMarked
              className="size-5 text-violet-600 sm:size-6"
              strokeWidth={2}
              aria-hidden
            />
          </div>
          <div>
            <h1 className="text-2xl font-semibold tracking-tight text-slate-900 sm:text-3xl">
              Glossary
            </h1>
            <p className="mt-1 flex flex-wrap items-center gap-2 text-sm text-slate-600">
              {usableTerms.length > 0 ? (
                <span className="inline-flex items-center gap-1.5">
                  <span className="inline-flex size-1.5 rounded-full bg-violet-500" />
                  {`${displayTerms.length} term${displayTerms.length === 1 ? '' : 's'} shown${hasActiveFilters ? ` of ${usableTerms.length}` : ''
                    }`}
                </span>
              ) : !loading ? (
                <span>Poker terms shown in the app</span>
              ) : null}
            </p>
          </div>
        </div>
        <div className="flex flex-col gap-3 sm:flex-row sm:flex-wrap sm:items-stretch">
          <div className="relative w-full min-w-[11rem] sm:w-auto">
            <Filter
              className="pointer-events-none absolute left-3 top-1/2 size-4 -translate-y-1/2 text-slate-400"
              strokeWidth={2}
              aria-hidden
            />
            <label className="sr-only" htmlFor="glossary-importance-filter">
              Filter by importance
            </label>
            <select
              id="glossary-importance-filter"
              value={importanceFilter}
              onChange={(e) => setImportanceFilter(e.target.value)}
              className="w-full cursor-pointer appearance-none rounded-xl border border-slate-200 bg-white py-2.5 pl-10 pr-3 text-sm text-slate-900 shadow-sm outline-none transition hover:border-slate-300 focus:border-violet-400 focus:ring-4 focus:ring-violet-500/15 sm:min-w-[11rem]"
            >
              <option value="all">All importance</option>
              <option value="5">⭐⭐⭐⭐⭐ (5)</option>
              <option value="4">⭐⭐⭐⭐ (4)</option>
              <option value="3">⭐⭐⭐ (3)</option>
              <option value="2">⭐⭐ (2)</option>
              <option value="1">⭐ (1)</option>
              <option value="0">Unrated</option>
            </select>
          </div>
          <div className="relative w-full min-w-[220px] sm:min-w-[22rem] sm:max-w-xl sm:flex-1 lg:max-w-2xl">
            <Search
              className="pointer-events-none absolute left-3 top-1/2 size-4 -translate-y-1/2 text-slate-400"
              strokeWidth={2}
              aria-hidden
            />
            <input
              id="glossary-search"
              type="search"
              placeholder="Search terms and definitions…"
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              className="w-full rounded-xl border border-slate-200 bg-white py-2.5 pl-10 pr-3 text-sm text-slate-900 shadow-sm outline-none placeholder:text-slate-400 focus:border-violet-400 focus:ring-4 focus:ring-violet-500/15"
            />
          </div>
          <button
            type="button"
            onClick={() => setUploadModalOpen(true)}
            className="inline-flex shrink-0 cursor-pointer items-center justify-center gap-2 rounded-xl bg-gradient-to-b from-violet-500 to-violet-600 px-4 py-2.5 text-sm font-semibold text-white shadow-md shadow-violet-900/20 transition hover:from-violet-600 hover:to-violet-700 focus:outline-none focus-visible:ring-2 focus-visible:ring-violet-500 focus-visible:ring-offset-2"
          >
            <Upload className="size-4 shrink-0" strokeWidth={2.25} aria-hidden />
            Upload CSV
          </button>
        </div>
      </header>

      {error ? (
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
      ) : null}

      {loading ? (
        <div className="flex flex-col items-center justify-center gap-4 rounded-2xl border border-slate-200/90 bg-white/90 py-24 shadow-lg shadow-slate-900/[0.04]">
          <Loader2
            className="size-10 animate-spin text-violet-600"
            strokeWidth={2}
            aria-hidden
          />
          <p className="text-sm font-medium text-slate-600">
            Loading glossary…
          </p>
        </div>
      ) : displayTerms.length === 0 ? (
        <div className="flex flex-col items-center justify-center gap-3 rounded-2xl border border-dashed border-slate-200 bg-white/70 py-24 text-center">
          <SearchX className="size-9 text-slate-300" strokeWidth={1.5} aria-hidden />
          <p className="text-sm font-medium text-slate-600">
            No terms match your filters.
          </p>
        </div>
      ) : (
        <ul className="flex flex-col gap-2.5">
          {displayTerms.map(({ term, index }) => (
            <GlossaryTermCard
              key={index}
              term={term}
              expanded={expandedIndex === index}
              onToggle={() =>
                setExpandedIndex((curr) => (curr === index ? null : index))
              }
            />
          ))}
        </ul>
      )}

      {uploadModalOpen ? (
        <GlossaryUploadModal
          currentTerms={terms}
          onClose={() => setUploadModalOpen(false)}
          onPublished={() => {
            setUploadModalOpen(false)
            setLoading(true)
            setError(null)
            loadGlossary()
          }}
        />
      ) : null}
    </div>
  )
}

/**
 * @param {{
 *   term: Record<string, unknown>
 *   expanded: boolean
 *   onToggle: () => void
 * }} props
 */
function GlossaryTermCard({ term, expanded, onToggle }) {
  const name = asStr(term.Term).trim()
  const stars = importanceLevel(term.Importance)
  const definition = asStr(term.Definition).trim()
  const specificSituation = asStr(term['Specific Situation']).trim()
  const whyItMatters = asStr(term['Why It Matters']).trim()
  const examples = asStr(term['Examples of Term Usage']).trim()

  return (
    <li className="list-none overflow-hidden rounded-xl border border-slate-200 bg-white shadow-sm ring-1 ring-slate-900/[0.02]">
      <button
        type="button"
        onClick={onToggle}
        aria-expanded={expanded}
        className="flex w-full cursor-pointer items-start gap-3 px-4 py-3.5 text-left transition hover:bg-slate-50/80 focus:outline-none focus-visible:bg-violet-50/60 sm:items-center"
      >
        <ChevronDown
          className={`mt-0.5 size-4 shrink-0 text-slate-400 transition-transform sm:mt-0 ${expanded ? 'rotate-180' : ''
            }`}
          strokeWidth={2.25}
          aria-hidden
        />
        <div className="min-w-0 flex-1">
          <div className="flex flex-wrap items-center gap-x-2 gap-y-1">
            <p className="text-sm font-semibold text-slate-900">{name}</p>
            {stars > 0 ? (
              <span
                className="inline-flex items-center gap-0.5 text-amber-500"
                title={`Importance: ${stars} of 5`}
              >
                {Array.from({ length: stars }, (_, i) => (
                  <Star
                    key={i}
                    className="size-3 shrink-0 fill-amber-400 text-amber-400"
                    strokeWidth={0}
                    aria-hidden
                  />
                ))}
              </span>
            ) : null}
          </div>
          {!expanded ? (
            <p className="mt-0.5 line-clamp-1 text-xs text-slate-500">
              {definition || (
                <span className="italic text-slate-400">
                  (no definition provided)
                </span>
              )}
            </p>
          ) : null}
        </div>
      </button>

      {expanded ? (
        <div className="space-y-3 border-t border-slate-100 bg-slate-50/60 px-4 py-3.5 sm:px-5">
          <div>
            <dt className="text-[10px] font-semibold uppercase tracking-wide text-slate-500">
              Definition
            </dt>
            <dd className="mt-1 whitespace-pre-wrap text-sm leading-relaxed text-slate-800">
              {definition || (
                <span className="italic text-slate-400">
                  (no definition provided)
                </span>
              )}
            </dd>
          </div>

          {specificSituation ? (
            <div>
              <dt className="text-[10px] font-semibold uppercase tracking-wide text-slate-500">
                Specific Situation
              </dt>
              <dd className="mt-1 whitespace-pre-wrap rounded-lg border border-slate-200 bg-white px-3 py-2 text-sm leading-relaxed text-slate-700">
                {specificSituation}
              </dd>
            </div>
          ) : null}

          {whyItMatters ? (
            <div>
              <dt className="text-[10px] font-semibold uppercase tracking-wide text-slate-500">
                Why It Matters
              </dt>
              <dd className="mt-1 whitespace-pre-wrap rounded-lg border border-violet-100 bg-violet-50/50 px-3 py-2 text-sm leading-relaxed text-violet-950">
                {whyItMatters}
              </dd>
            </div>
          ) : null}

          {examples ? (
            <div>
              <dt className="text-[10px] font-semibold uppercase tracking-wide text-slate-500">
                Examples of Term Usage
              </dt>
              <dd className="mt-1 whitespace-pre-wrap text-sm italic leading-relaxed text-slate-600">
                {examples}
              </dd>
            </div>
          ) : null}
        </div>
      ) : null}
    </li>
  )
}

/** sessionStorage only — cleared when the tab closes, never persisted to disk. */
const R2_CREDS_SESSION_KEY = 'webportal:r2-glossary-creds'

function readSessionCreds() {
  try {
    const raw = sessionStorage.getItem(R2_CREDS_SESSION_KEY)
    if (!raw) return null
    const parsed = JSON.parse(raw)
    if (
      typeof parsed?.accountId === 'string' &&
      typeof parsed?.accessKeyId === 'string' &&
      typeof parsed?.secretAccessKey === 'string' &&
      typeof parsed?.bucketName === 'string'
    ) {
      return parsed
    }
    return null
  } catch {
    return null
  }
}

/**
 * Multi-step CSV upload flow: pick a file, review a diff against the live
 * glossary, then publish straight to R2 from the browser using credentials
 * pasted in for this session only (see the header warning in the UI —
 * never written to disk, never bundled, cleared on tab close).
 * @param {{
 *   currentTerms: Array<Record<string, unknown>>
 *   onClose: () => void
 *   onPublished: () => void
 * }} props
 */
function GlossaryUploadModal({ currentTerms, onClose, onPublished }) {
  const [step, setStep] = useState(
    /** @type {'pick' | 'preview' | 'credentials' | 'publishing' | 'done'} */(
      'pick'
    ),
  )
  const [fileName, setFileName] = useState('')
  const [parseError, setParseError] = useState(
    /** @type {string | null} */(null),
  )
  const [parsedEntries, setParsedEntries] = useState(
    /** @type {Array<Record<string, string>> | null} */(null),
  )
  const [droppedRows, setDroppedRows] = useState(
    /** @type {Array<{ line: number, reason: string }>} */([]),
  )
  const [unmappedHeaders, setUnmappedHeaders] = useState(
    /** @type {string[]} */([]),
  )
  const [showDropped, setShowDropped] = useState(false)
  const [showChanged, setShowChanged] = useState(false)

  // sessionStorage is synchronous, so hydrate from it via lazy initializers
  // rather than an effect — avoids an extra render and a same-render
  // synchronous setState.
  const [accountId, setAccountId] = useState(
    () => readSessionCreds()?.accountId ?? '',
  )
  const [accessKeyId, setAccessKeyId] = useState(
    () => readSessionCreds()?.accessKeyId ?? '',
  )
  const [secretAccessKey, setSecretAccessKey] = useState(
    () => readSessionCreds()?.secretAccessKey ?? '',
  )
  const [bucketName, setBucketName] = useState(
    () => readSessionCreds()?.bucketName ?? '',
  )
  const [showSecret, setShowSecret] = useState(false)
  const [rememberForSession, setRememberForSession] = useState(true)
  const [publishError, setPublishError] = useState(
    /** @type {string | null} */(null),
  )
  // Non-blocking — the R2 write already succeeded by the time this can
  // fail, so it's surfaced as a warning on the success screen, not an error
  // that reverts the flow back to the credentials step.
  const [syncVersionWarning, setSyncVersionWarning] = useState(
    /** @type {string | null} */ (null),
  )

  const fileInputRef = useRef(/** @type {HTMLInputElement | null} */(null))

  useEffect(() => {
    function onKey(e) {
      if (e.key === 'Escape' && step !== 'publishing') onClose()
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [onClose, step])

  const diff = useMemo(() => {
    if (!parsedEntries) return null
    return diffGlossaryEntries(currentTerms, parsedEntries)
  }, [currentTerms, parsedEntries])

  const handleFile = useCallback((file) => {
    if (!file) return
    setFileName(file.name)
    setParseError(null)
    setParsedEntries(null)

    const reader = new FileReader()
    reader.onload = () => {
      try {
        const text = String(reader.result ?? '')
        const { entries, droppedRows: dropped, unmappedHeaders: unmapped } =
          csvToGlossaryEntries(text)
        if (entries.length === 0) {
          setParseError(
            'No usable glossary entries found in this file. Check that it has Term, Definition, and the other expected columns.',
          )
          return
        }
        setParsedEntries(entries)
        setDroppedRows(dropped)
        setUnmappedHeaders(unmapped)
        setStep('preview')
      } catch (e) {
        setParseError(e?.message || 'Failed to parse this CSV file')
      }
    }
    reader.onerror = () => {
      setParseError('Failed to read this file')
    }
    reader.readAsText(file)
  }, [])

  const handlePublish = useCallback(async () => {
    if (!parsedEntries) return
    setPublishError(null)
    setSyncVersionWarning(null)
    setStep('publishing')

    const creds = {
      accountId: import.meta.env.VITE_R2_ACCOUNT_ID,
      accessKeyId: import.meta.env.VITE_R2_ACCESS_KEY_ID,
      secretAccessKey: import.meta.env.VITE_R2_SECRET_ACCESS_KEY,
      bucketName: import.meta.env.VITE_R2_BUCKET_NAME
    }
    console.log(creds)

    try {
      await publishGlossaryToR2(parsedEntries, creds)
      // R2 write succeeded — this is the primary action. Bumping
      // glossarySyncVersion lets the app detect a new glossary is
      // available; if this fails, the publish itself still succeeded, so
      // it's a warning on the done screen, not a reason to treat the
      // whole publish as failed.
      if (db) {
        try {
          await updateDoc(doc(db, settingsCollectionName, settingsDocumentId), {
            glossarySyncVersion: increment(1),
            updatedAt: serverTimestamp(),
          })
        } catch (e) {
          setSyncVersionWarning(
            e?.message ||
              'Published to R2, but failed to bump glossarySyncVersion',
          )
        }
      } else {
        setSyncVersionWarning(
          'Published to R2, but Firestore is not configured — glossarySyncVersion was not bumped',
        )
      }
      setStep('done')
    } catch (e) {
      setPublishError(e?.message || 'Failed to publish to R2')
      setStep('credentials')
    }
  }, [
    parsedEntries,
    accountId,
    accessKeyId,
    secretAccessKey,
    bucketName,
    rememberForSession,
  ])

  const credsComplete =
    accountId.trim() && accessKeyId.trim() && secretAccessKey.trim() && bucketName.trim()

  return (
    <div
      className="fixed inset-0 z-50 flex items-end justify-center bg-slate-900/40 p-0 backdrop-blur-sm sm:items-center sm:p-4"
      role="presentation"
      onClick={() => {
        if (step !== 'publishing') onClose()
      }}
    >
      <div
        role="dialog"
        aria-modal="true"
        aria-labelledby="glossary-upload-title"
        className="flex max-h-[min(92vh,860px)] w-full max-w-2xl flex-col rounded-t-2xl border border-slate-200 bg-white shadow-2xl sm:rounded-2xl"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-start justify-between gap-3 border-b border-slate-100 px-5 py-4">
          <div className="min-w-0">
            <h2
              id="glossary-upload-title"
              className="text-lg font-semibold text-slate-900"
            >
              Upload glossary CSV
            </h2>
            <p className="mt-0.5 text-xs text-slate-500">
              {step === 'pick'
                ? 'Choose a CSV export to convert and preview.'
                : step === 'preview'
                  ? `${fileName} · ${parsedEntries?.length ?? 0} terms parsed`
                  : step === 'credentials'
                    ? 'Publishes directly to the R2 bucket the app reads from.'
                    : step === 'publishing'
                      ? 'Publishing…'
                      : 'Published successfully.'}
            </p>
          </div>
          {step !== 'publishing' ? (
            <button
              type="button"
              onClick={onClose}
              className="shrink-0 cursor-pointer rounded-lg p-2 text-slate-500 transition hover:bg-slate-100 hover:text-slate-800 focus:outline-none focus-visible:ring-2 focus-visible:ring-violet-500"
              aria-label="Close"
            >
              <X className="size-5" strokeWidth={2} />
            </button>
          ) : null}
        </div>

        <div className="flex-1 overflow-y-auto px-5 py-4">
          {step === 'pick' ? (
            <div className="flex flex-col gap-4">
              <button
                type="button"
                onClick={() => fileInputRef.current?.click()}
                className="flex cursor-pointer flex-col items-center justify-center gap-3 rounded-xl border-2 border-dashed border-slate-300 bg-slate-50/70 px-6 py-14 text-center transition hover:border-violet-400 hover:bg-violet-50/40 focus:outline-none focus-visible:ring-2 focus-visible:ring-violet-500"
              >
                <FileUp
                  className="size-9 text-slate-400"
                  strokeWidth={1.5}
                  aria-hidden
                />
                <div>
                  <p className="text-sm font-semibold text-slate-700">
                    Click to choose a CSV file
                  </p>
                  <p className="mt-1 text-xs text-slate-500">
                    Expected columns: Term, Importance, Definition, Specific
                    Situation, Why It Matters, Examples Usage
                  </p>
                </div>
              </button>
              <input
                ref={fileInputRef}
                type="file"
                accept=".csv,text/csv"
                className="hidden"
                onChange={(e) => handleFile(e.target.files?.[0])}
              />
              {parseError ? (
                <div className="flex gap-2.5 rounded-xl border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-800">
                  <AlertCircle
                    className="mt-0.5 size-4 shrink-0 text-red-600"
                    strokeWidth={2}
                  />
                  <span>{parseError}</span>
                </div>
              ) : null}
            </div>
          ) : null}

          {step === 'preview' && diff ? (
            <div className="flex flex-col gap-4">
              <div className="grid grid-cols-2 gap-2.5 sm:grid-cols-4">
                <DiffStatTile
                  icon={Plus}
                  label="Added"
                  count={diff.added.length}
                  tone="emerald"
                />
                <DiffStatTile
                  icon={RefreshCw}
                  label="Changed"
                  count={diff.changed.length}
                  tone="amber"
                />
                <DiffStatTile
                  icon={Minus}
                  label="Removed"
                  count={diff.removed.length}
                  tone="rose"
                />
                <DiffStatTile
                  icon={Check}
                  label="Unchanged"
                  count={diff.unchanged.length}
                  tone="slate"
                />
              </div>

              {unmappedHeaders.length > 0 ? (
                <div className="flex gap-2.5 rounded-xl border border-amber-200 bg-amber-50 px-4 py-3 text-xs text-amber-900">
                  <AlertTriangle
                    className="mt-0.5 size-4 shrink-0 text-amber-600"
                    strokeWidth={2}
                  />
                  <span>
                    Unrecognized column{unmappedHeaders.length === 1 ? '' : 's'}{' '}
                    ignored: {unmappedHeaders.join(', ')}
                  </span>
                </div>
              ) : null}

              {droppedRows.length > 0 ? (
                <div className="rounded-xl border border-slate-200 bg-slate-50/70">
                  <button
                    type="button"
                    onClick={() => setShowDropped((v) => !v)}
                    className="flex w-full cursor-pointer items-center justify-between gap-2 px-4 py-2.5 text-left text-xs font-semibold text-slate-600"
                  >
                    <span>
                      {droppedRows.length} row
                      {droppedRows.length === 1 ? '' : 's'} skipped (no term
                      content)
                    </span>
                    <ChevronDown
                      className={`size-3.5 shrink-0 transition-transform ${showDropped ? 'rotate-180' : ''}`}
                      strokeWidth={2.25}
                      aria-hidden
                    />
                  </button>
                  {showDropped ? (
                    <ul className="space-y-1 border-t border-slate-200 px-4 py-2.5 text-[11px] text-slate-500">
                      {droppedRows.map((d) => (
                        <li key={d.line}>
                          Line {d.line}: {d.reason}
                        </li>
                      ))}
                    </ul>
                  ) : null}
                </div>
              ) : null}

              {diff.removed.length > 0 ? (
                <div className="rounded-xl border border-rose-200 bg-rose-50/60 px-4 py-3">
                  <p className="text-xs font-semibold text-rose-900">
                    These terms exist live but aren't in this CSV — publishing
                    will remove them:
                  </p>
                  <p className="mt-1.5 text-xs leading-relaxed text-rose-800">
                    {diff.removed
                      .map((r) => asStr(r.Term).trim())
                      .join(', ')}
                  </p>
                </div>
              ) : null}

              {diff.changed.length > 0 ? (
                <div className="rounded-xl border border-slate-200 bg-slate-50/70">
                  <button
                    type="button"
                    onClick={() => setShowChanged((v) => !v)}
                    className="flex w-full cursor-pointer items-center justify-between gap-2 px-4 py-2.5 text-left text-xs font-semibold text-slate-600"
                  >
                    <span>
                      Review {diff.changed.length} changed term
                      {diff.changed.length === 1 ? '' : 's'}
                    </span>
                    <ChevronDown
                      className={`size-3.5 shrink-0 transition-transform ${showChanged ? 'rotate-180' : ''}`}
                      strokeWidth={2.25}
                      aria-hidden
                    />
                  </button>
                  {showChanged ? (
                    <ul className="max-h-56 space-y-1 overflow-y-auto border-t border-slate-200 px-4 py-2.5 text-[11px] text-slate-600">
                      {diff.changed.map(({ term }) => (
                        <li key={term.Term}>{term.Term}</li>
                      ))}
                    </ul>
                  ) : null}
                </div>
              ) : null}

              {parseError ? (
                <div className="flex gap-2.5 rounded-xl border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-800">
                  <AlertCircle
                    className="mt-0.5 size-4 shrink-0 text-red-600"
                    strokeWidth={2}
                  />
                  <span>{parseError}</span>
                </div>
              ) : null}
            </div>
          ) : null}


          {step === 'done' ? (
            <div className="flex flex-col items-center justify-center gap-3 py-10 text-center">
              <div className="flex size-14 items-center justify-center rounded-full bg-emerald-100 text-emerald-700">
                <Check className="size-7" strokeWidth={2.5} aria-hidden />
              </div>
              <p className="text-sm font-semibold text-slate-800">
                Published {parsedEntries?.length ?? 0} terms to R2
              </p>
              <p className="max-w-sm text-xs text-slate-500">
                The live glossary will refresh automatically once this dialog
                closes. It may take a short while for Cloudflare's cache and
                the app to pick up the new file everywhere.
              </p>
              {syncVersionWarning ? (
                <div className="mt-1 flex max-w-sm gap-2 rounded-lg border border-amber-200 bg-amber-50 px-3 py-2 text-left text-xs text-amber-900">
                  <AlertTriangle
                    className="mt-0.5 size-3.5 shrink-0 text-amber-600"
                    strokeWidth={2}
                  />
                  <span>{syncVersionWarning}</span>
                </div>
              ) : (
                <p className="text-[11px] text-emerald-700">
                  glossarySyncVersion bumped in Firestore.
                </p>
              )}
            </div>
          ) : null}
        </div>

        <div className="flex items-center justify-between gap-2 border-t border-slate-100 px-5 py-3">
          <button
            type="button"
            onClick={onClose}
            disabled={step === 'publishing'}
            className="cursor-pointer rounded-lg border border-slate-200 bg-white px-3 py-2 text-xs font-semibold text-slate-700 transition hover:border-slate-300 hover:bg-slate-50 focus:outline-none focus-visible:ring-2 focus-visible:ring-violet-500 disabled:cursor-not-allowed disabled:opacity-50"
          >
            {step === 'done' ? 'Close' : 'Cancel'}
          </button>

          <div className="flex items-center gap-2">
            {step === 'preview' ? (
              <>
                <button
                  type="button"
                  onClick={() => {
                    setStep('pick')
                    setParsedEntries(null)
                  }}
                  className="cursor-pointer rounded-lg border border-slate-200 bg-white px-3 py-2 text-xs font-semibold text-slate-700 transition hover:border-slate-300 hover:bg-slate-50 focus:outline-none focus-visible:ring-2 focus-visible:ring-violet-500"
                >
                  Choose a different file
                </button>
                <button
                  type="button"
                  onClick={handlePublish}
                  className="inline-flex cursor-pointer items-center gap-1.5 rounded-lg bg-violet-600 px-4 py-2 text-xs font-semibold text-white shadow-sm transition hover:bg-violet-700 focus:outline-none focus-visible:ring-2 focus-visible:ring-violet-500 focus-visible:ring-offset-1 disabled:cursor-not-allowed disabled:opacity-50"
                >
                  <Upload className="size-3.5 shrink-0" strokeWidth={2.25} aria-hidden />
                  Publish to R2
                </button>
              </>
            ) : null}

            {step === 'publishing' ? (
              <span className="inline-flex items-center gap-1.5 rounded-lg bg-violet-100 px-4 py-2 text-xs font-semibold text-violet-800">
                <Loader2
                  className="size-3.5 shrink-0 animate-spin"
                  strokeWidth={2}
                  aria-hidden
                />
                Publishing…
              </span>
            ) : null}

            {step === 'done' ? (
              <button
                type="button"
                onClick={onPublished}
                className="inline-flex cursor-pointer items-center gap-1.5 rounded-lg bg-emerald-600 px-4 py-2 text-xs font-semibold text-white shadow-sm transition hover:bg-emerald-700 focus:outline-none focus-visible:ring-2 focus-visible:ring-emerald-500 focus-visible:ring-offset-1"
              >
                <Check className="size-3.5 shrink-0" strokeWidth={2.25} aria-hidden />
                Done — refresh list
              </button>
            ) : null}
          </div>
        </div>
      </div>
    </div>
  )
}

/**
 * @param {{
 *   icon: import('react').ComponentType<{ className?: string, strokeWidth?: number }>
 *   label: string
 *   count: number
 *   tone: 'emerald' | 'amber' | 'rose' | 'slate'
 * }} props
 */
function DiffStatTile(props) {
  // Not destructured-with-rename in the parameter list: this ESLint
  // config has no JSX-aware unused-vars check, and that specific shape
  // (`{ icon: Icon }`) false-positives as unused despite the JSX usage
  // below.
  const Icon = props.icon
  const { label, count, tone } = props
  const toneClasses = {
    emerald: 'bg-emerald-50 text-emerald-800 ring-emerald-200/80',
    amber: 'bg-amber-50 text-amber-800 ring-amber-200/80',
    rose: 'bg-rose-50 text-rose-800 ring-rose-200/80',
    slate: 'bg-slate-100 text-slate-600 ring-slate-200',
  }
  return (
    <div
      className={`flex flex-col items-center gap-1 rounded-xl px-3 py-3 ring-1 ${toneClasses[tone]}`}
    >
      <Icon className="size-4 shrink-0" strokeWidth={2.25} aria-hidden />
      <span className="text-lg font-bold tabular-nums">{count}</span>
      <span className="text-[10px] font-semibold uppercase tracking-wide">
        {label}
      </span>
    </div>
  )
}
