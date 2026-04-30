/**
 * Merge Firestore document id with document fields without clobbering a numeric
 * `id` field stored on the document (e.g. question #42).
 *
 * @param {string} docId
 * @param {Record<string, unknown>} data
 */
export function questionDocToRow(docId, data) {
  return { firestoreDocId: docId, ...data }
}

/** Question column + search: first non-empty string among these keys only. */
const QUESTION_TEXT_KEYS = [
  'question',
  'questionText',
  'text',
  'title',
  'prompt',
  'body',
  'label',
  'name',
  'content',
]

/**
 * Preview string for the Question column (aligned with search).
 *
 * @param {Record<string, unknown>} data Document fields (may include `id` as number).
 */
export function questionPreviewText(data) {
  for (const k of QUESTION_TEXT_KEYS) {
    const v = data[k]
    if (typeof v === 'string' && v.trim()) return v.trim()
  }
  return ''
}

/**
 * @param {unknown} v
 */
function partScalarForSearch(v) {
  if (v === undefined || v === null || v === '') return ''
  if (typeof v === 'string') return v.trim()
  if (typeof v === 'number' || typeof v === 'boolean') return String(v)
  if (typeof v === 'object') {
    try {
      return JSON.stringify(v)
    } catch {
      return ''
    }
  }
  return String(v)
}

/**
 * Search only fields reflected in the Questions table: doc id, question text,
 * context, question_type (not reports or other document fields).
 *
 * @param {{ firestoreDocId: string } & Record<string, unknown>} row
 * @param {string} q lowercased trimmed query
 */
export function questionRowMatchesSearch(row, q) {
  if (!q) return true
  const parts = [
    row.firestoreDocId,
    questionPreviewText(row),
    typeof row.context === 'string' && row.context.trim()
      ? row.context.trim()
      : '',
    partScalarForSearch(row.question_type),
  ].filter(Boolean)
  const blob = parts.join(' ').toLowerCase()
  return blob.includes(q)
}

/**
 * @param {Record<string, unknown>} row
 */
export function formatOptionsSummary(row) {
  const parts = [1, 2, 3, 4]
    .map((n) => row[`option_${n}`])
    .filter((v) => typeof v === 'string' && v.trim())
  return parts.length ? parts.join(' · ') : '—'
}

/**
 * @param {unknown} v
 */
export function displayScalar(v) {
  if (v === undefined || v === null || v === '') return '—'
  if (typeof v === 'boolean') return v ? 'Yes' : 'No'
  return String(v)
}
