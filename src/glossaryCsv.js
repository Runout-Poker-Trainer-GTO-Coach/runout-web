/**
 * RFC 4180 CSV parser and glossary-specific conversion, shared by the
 * Glossary page's upload flow. Handles quoted fields containing commas,
 * embedded newlines, and doubled-quote escaping (`""` -> `"`), all present
 * in the real glossary export.
 */

/**
 * Parses raw CSV text into rows of string cells. Quote-aware: a field
 * wrapped in `"..."` may contain commas, newlines, and `""` as an escaped
 * quote. Trailing `\r` from CRLF line endings is stripped.
 * @param {string} text
 * @returns {string[][]}
 */
export function parseCsv(text) {
  const rows = []
  let row = []
  let field = ''
  let inQuotes = false
  let i = 0
  const n = text.length

  while (i < n) {
    const ch = text[i]

    if (inQuotes) {
      if (ch === '"') {
        if (text[i + 1] === '"') {
          field += '"'
          i += 2
          continue
        }
        inQuotes = false
        i += 1
        continue
      }
      field += ch
      i += 1
      continue
    }

    if (ch === '"') {
      inQuotes = true
      i += 1
      continue
    }
    if (ch === ',') {
      row.push(field)
      field = ''
      i += 1
      continue
    }
    if (ch === '\r') {
      i += 1
      continue
    }
    if (ch === '\n') {
      row.push(field)
      rows.push(row)
      row = []
      field = ''
      i += 1
      continue
    }
    field += ch
    i += 1
  }

  // Final field/row, if the file doesn't end with a trailing newline.
  if (field !== '' || row.length > 0) {
    row.push(field)
    rows.push(row)
  }

  return rows
}

/**
 * The keys GlossaryPage.jsx (and the deployed R2 JSON) expect. The source
 * CSV's header names are mapped onto these — see `HEADER_ALIASES` below,
 * since the sheet's export has used slightly different header text at
 * different times ("Examples Usage" vs "Examples of Term Usage").
 */
export const GLOSSARY_JSON_FIELDS = [
  'Term',
  'Importance',
  'Definition',
  'Specific Situation',
  'Why It Matters',
  'Examples of Term Usage',
]

/** Maps a CSV header cell (trimmed) to its canonical JSON field name. */
const HEADER_ALIASES = {
  term: 'Term',
  importance: 'Importance',
  definition: 'Definition',
  'basic definition': 'Definition',
  'specific situation': 'Specific Situation',
  'why it matters': 'Why It Matters',
  'examples usage': 'Examples of Term Usage',
  'examples of term usage': 'Examples of Term Usage',
}

/**
 * A row counts as a real glossary entry only if it has a Term and at least
 * one body field populated. The source sheet has occasionally included
 * blank section-divider rows (e.g. "Alias rows below:") that carry a Term
 * but no content — those are dropped, not published.
 * @param {Record<string, string>} entry
 */
function isRealEntry(entry) {
  if (!entry.Term?.trim()) return false
  return Boolean(
    entry.Definition?.trim() ||
      entry['Specific Situation']?.trim() ||
      entry['Why It Matters']?.trim() ||
      entry['Examples of Term Usage']?.trim(),
  )
}

/**
 * @typedef {{
 *   entries: Array<Record<string, string>>
 *   droppedRows: Array<{ line: number, reason: string }>
 *   unmappedHeaders: string[]
 * }} GlossaryCsvResult
 */

/**
 * Parses the glossary CSV export into the JSON shape the app publishes.
 * @param {string} csvText
 * @returns {GlossaryCsvResult}
 */
export function csvToGlossaryEntries(csvText) {
  const rows = parseCsv(csvText)
  if (rows.length === 0) {
    return { entries: [], droppedRows: [], unmappedHeaders: [] }
  }

  const headerRow = rows[0]
  /** @type {Array<string | null>} */
  const columnFields = headerRow.map((h) => {
    const key = h.trim().toLowerCase()
    return HEADER_ALIASES[key] ?? null
  })
  const unmappedHeaders = headerRow.filter(
    (h, idx) => h.trim() !== '' && columnFields[idx] == null,
  )

  /** @type {Array<Record<string, string>>} */
  const entries = []
  /** @type {Array<{ line: number, reason: string }>} */
  const droppedRows = []

  for (let r = 1; r < rows.length; r++) {
    const raw = rows[r]
    // Skip fully-blank trailing lines some spreadsheet exports leave behind.
    if (raw.length === 1 && raw[0].trim() === '') continue

    /** @type {Record<string, string>} */
    const entry = {}
    for (const field of GLOSSARY_JSON_FIELDS) entry[field] = ''
    columnFields.forEach((field, idx) => {
      if (field) entry[field] = (raw[idx] ?? '').trim()
    })

    if (!isRealEntry(entry)) {
      droppedRows.push({
        line: r + 1,
        reason: entry.Term?.trim()
          ? `"${entry.Term.trim()}" has no definition or body content — likely a sheet section divider, not a real term`
          : 'empty row',
      })
      continue
    }

    entries.push(entry)
  }

  return { entries, droppedRows, unmappedHeaders }
}

/**
 * Diffs a freshly-parsed CSV entry list against the currently-published
 * glossary (whatever shape it's in — old or new key names both handled)
 * so the upload preview can show what will actually change.
 * @param {Array<Record<string, unknown>>} currentEntries
 * @param {Array<Record<string, string>>} nextEntries
 */
export function diffGlossaryEntries(currentEntries, nextEntries) {
  const currentByTerm = new Map(
    currentEntries.map((e) => [
      String(e.Term ?? '').trim().toLowerCase(),
      e,
    ]),
  )
  const nextByTerm = new Map(
    nextEntries.map((e) => [e.Term.trim().toLowerCase(), e]),
  )

  const added = []
  const removed = []
  const changed = []
  const unchanged = []

  for (const [key, next] of nextByTerm) {
    const curr = currentByTerm.get(key)
    if (!curr) {
      added.push(next)
      continue
    }
    const isChanged = GLOSSARY_JSON_FIELDS.some((field) => {
      const currVal =
        field === 'Definition'
          ? String(curr.Definition ?? curr['Basic Definition'] ?? '').trim()
          : String(curr[field] ?? '').trim()
      return currVal !== (next[field] ?? '').trim()
    })
    if (isChanged) changed.push({ term: next, prev: curr })
    else unchanged.push(next)
  }

  for (const [key, curr] of currentByTerm) {
    if (!nextByTerm.has(key)) removed.push(curr)
  }

  return { added, removed, changed, unchanged }
}
