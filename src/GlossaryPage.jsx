import {
  AlertCircle,
  BookMarked,
  ChevronDown,
  Filter,
  Loader2,
  Search,
  SearchX,
  Star,
} from 'lucide-react'
import { useEffect, useMemo, useState } from 'react'

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
    /** @type {Array<Record<string, unknown>>} */ ([]),
  )
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState(/** @type {string | null} */ (null))
  const [searchQuery, setSearchQuery] = useState('')
  const [importanceFilter, setImportanceFilter] = useState('all')
  const [expandedIndex, setExpandedIndex] = useState(
    /** @type {number | null} */ (null),
  )

  useEffect(() => {
    let cancelled = false

    fetch(GLOSSARY_URL)
      .then((res) => {
        if (!res.ok) throw new Error(`Glossary request returned ${res.status}`)
        return res.json()
      })
      .then((data) => {
        if (cancelled) return
        setTerms(Array.isArray(data) ? data : [])
      })
      .catch((e) => {
        if (!cancelled) {
          setError(e?.message || 'Failed to load glossary')
        }
      })
      .finally(() => {
        if (!cancelled) setLoading(false)
      })

    return () => {
      cancelled = true
    }
  }, [])

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
                  {`${displayTerms.length} term${displayTerms.length === 1 ? '' : 's'} shown${
                    hasActiveFilters ? ` of ${usableTerms.length}` : ''
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
          className={`mt-0.5 size-4 shrink-0 text-slate-400 transition-transform sm:mt-0 ${
            expanded ? 'rotate-180' : ''
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
