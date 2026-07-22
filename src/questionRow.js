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

/**
 * Soft-delete flag on question docs. Accepted values: `true` (deleted, set
 * explicitly by the delete action in EditQuestionsPage.jsx) or absent (never
 * deleted — reads the same as `false`). There is no un-delete UI; this flag
 * is one-way from the admin's perspective. A soft-deleted doc must never
 * surface in any question list/table.
 *
 * ⚠️ Delete must ONLY ever set this flag + `updatedAt` (merge update). Never
 * implement "delete" by blanking/overwriting the doc's other fields — that
 * destroys the question's content for no reason. isDeleted is a flag layered
 * on top of an intact document, not a replacement for it.
 *
 * @param {Record<string, unknown>} row
 */
export function isDeletedQuestionRow(row) {
  return row?.isDeleted === true
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
 * context, question_type (not reports or other document fields). Pass
 * `includeAnswerExplanation` to also match `answer_explanation` (used by the
 * Edit Questions screen, which shows/edits that field).
 *
 * @param {{ firestoreDocId: string } & Record<string, unknown>} row
 * @param {string} q lowercased trimmed query
 * @param {{ includeAnswerExplanation?: boolean }} [opts]
 */
export function questionRowMatchesSearch(row, q, opts) {
  if (!q) return true
  const parts = [
    row.firestoreDocId,
    questionPreviewText(row),
    typeof row.context === 'string' && row.context.trim()
      ? row.context.trim()
      : '',
    partScalarForSearch(row.question_type),
    opts?.includeAnswerExplanation &&
    typeof row.answer_explanation === 'string' &&
    row.answer_explanation.trim()
      ? row.answer_explanation.trim()
      : '',
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

/** @param {unknown} v */
function toFiniteNumber(v) {
  if (typeof v === 'number' && Number.isFinite(v)) return v
  if (typeof v === 'string' && v.trim() !== '') {
    const n = Number(v)
    if (Number.isFinite(n)) return n
  }
  return null
}

/**
 * Reads the precomputed `correctAnswers` / `wrongAnswers` fields written
 * directly onto each question doc (see .secrets/write-question-answer-stats.js)
 * — no per-user data is fetched or joined here, just two numbers already on
 * the row.
 *
 * @param {unknown} row
 */
export function answerStatsForRow(row) {
  const r = /** @type {Record<string, unknown>} */ (row) ?? {}
  const correct = toFiniteNumber(r.correctAnswers) ?? 0
  const wrong = toFiniteNumber(r.wrongAnswers) ?? 0
  const total = correct + wrong
  const pct = total > 0 ? Math.round((correct / total) * 100) : null
  return { correct, wrong, pct }
}

/** @param {number | null} pct */
export function answerPctToneClass(pct) {
  if (pct == null) return 'text-slate-500 ring-slate-200/80 bg-slate-50'
  if (pct >= 70) return 'text-emerald-800 ring-emerald-200 bg-emerald-50'
  if (pct >= 40) return 'text-amber-800 ring-amber-200 bg-amber-50'
  return 'text-rose-800 ring-rose-200 bg-rose-50'
}
