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
 * Fully dynamic — no hardcoded header names. Whatever the CSV's own header
 * row says becomes the JSON field name, verbatim (trimmed), for every
 * column. This means a sheet re-shape (rename a column, add one, remove
 * one) never breaks parsing — there is nothing here for a new header name
 * to fail to match. The one exception: `Term` is treated as the entry's
 * lookup key everywhere downstream (this page's search/dedupe, the mobile
 * app's getGlossaryEntryByTerm) — see `deriveGlossaryTitles` for the
 * title/description/other role assignment used to publish
 * config/app.glossaryTitles alongside this data.
 * @param {string[]} headerRow already-trimmed header cells
 * @returns {string[]} the non-blank header cells, in column order
 */
function realFieldNames(headerRow) {
  return headerRow.filter((h) => h.trim() !== '')
}

/**
 * A row counts as a real glossary entry only if its first column (the
 * title/Term field) is non-empty AND at least one other column has
 * content. The source sheet has occasionally included blank
 * section-divider rows (e.g. "Alias rows below:") that carry a title but
 * no content — those are dropped, not published.
 * @param {Record<string, string>} entry
 * @param {string[]} fieldNames column names in order — fieldNames[0] is the title field
 */
function isRealEntry(entry, fieldNames) {
  const titleField = fieldNames[0]
  if (!titleField || !entry[titleField]?.trim()) return false
  return fieldNames
    .slice(1)
    .some((field) => entry[field]?.trim())
}

/**
 * Column-position role assignment, published to config/app.glossaryTitles
 * so the mobile app knows which JSON key is the title, which is the
 * description, and what the remaining "other" fields are called — without
 * either side hardcoding field names. Column 1 = title, column 2 =
 * description, everything after = other.
 * @param {string[]} fieldNames real (non-blank) header names, in column order
 * @returns {{ titleKey: string | null, descriptionKey: string | null, otherKeys: string[] }}
 */
export function deriveGlossaryTitles(fieldNames) {
  return {
    titleKey: fieldNames[0] ?? null,
    descriptionKey: fieldNames[1] ?? null,
    otherKeys: fieldNames.slice(2),
  }
}

/**
 * @typedef {{
 *   entries: Array<Record<string, string>>
 *   droppedRows: Array<{ line: number, reason: string }>
 *   headerRow: string[]
 *   fieldNames: string[]
 * }} GlossaryCsvResult
 */

/**
 * Parses the glossary CSV export into the JSON shape the app publishes.
 * Every column in the CSV's own header row becomes a field, verbatim —
 * nothing is dropped or renamed (blank trailing header cells, which real
 * exports sometimes have from a trailing `,,`, are excluded from
 * `fieldNames`/`entries` but preserved as empty strings in `headerRow`).
 * @param {string} csvText
 * @returns {GlossaryCsvResult}
 */
export function csvToGlossaryEntries(csvText) {
  const rows = parseCsv(csvText)
  if (rows.length === 0) {
    return { entries: [], droppedRows: [], headerRow: [], fieldNames: [] }
  }

  const headerRow = rows[0].map((h) => h.trim())
  const fieldNames = realFieldNames(headerRow)
  // Column index -> field name, skipping blank header cells entirely
  // (a blank-headed column's data is never read into any entry).
  /** @type {Array<string | null>} */
  const columnFields = headerRow.map((h) => (h.trim() !== '' ? h.trim() : null))

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
    for (const field of fieldNames) entry[field] = ''
    columnFields.forEach((field, idx) => {
      if (field) entry[field] = (raw[idx] ?? '').trim()
    })

    if (!isRealEntry(entry, fieldNames)) {
      const titleField = fieldNames[0]
      const titleValue = titleField ? entry[titleField]?.trim() : ''
      droppedRows.push({
        line: r + 1,
        reason: titleValue
          ? `"${titleValue}" has no content in any other column — likely a sheet section divider, not a real entry`
          : 'empty row',
      })
      continue
    }

    entries.push(entry)
  }

  return { entries, droppedRows, headerRow, fieldNames }
}

/**
 * Diffs a freshly-parsed CSV entry list against the currently-published
 * glossary so the upload preview can show what will actually change.
 * `currentEntries` is keyed by `currentTitleField` (whatever column 1
 * WAS, per the currently-live config/app.glossaryTitles) and
 * `nextEntries` by `nextFieldNames[0]` (whatever column 1 IS in the file
 * just parsed) — these can genuinely differ if this publish is itself
 * changing which column is the title, so using the wrong one for either
 * side would silently mismatch every entry (everything shows as
 * added+removed instead of correctly matched changed/unchanged pairs).
 * Content comparison uses `nextFieldNames` (the new upload's own column
 * list) — a field that existed in the old published data but isn't in
 * the new header is a structural change (a dropped column), not
 * something re-litigated per-row here.
 * @param {Array<Record<string, unknown>>} currentEntries
 * @param {string} currentTitleField the CURRENTLY-PUBLISHED data's title field
 * @param {Array<Record<string, string>>} nextEntries
 * @param {string[]} nextFieldNames the NEW upload's field names, in column order
 */
export function diffGlossaryEntries(currentEntries, currentTitleField, nextEntries, nextFieldNames) {
  const nextTitleField = nextFieldNames[0]
  const currentByTerm = new Map(
    currentEntries.map((e) => [
      String(currentTitleField ? e[currentTitleField] : '').trim().toLowerCase(),
      e,
    ]),
  )
  const nextByTerm = new Map(
    nextEntries.map((e) => [(nextTitleField ? e[nextTitleField] : '').trim().toLowerCase(), e]),
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
    const isChanged = nextFieldNames.some((field) => {
      const currVal = String(curr[field] ?? '').trim()
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
