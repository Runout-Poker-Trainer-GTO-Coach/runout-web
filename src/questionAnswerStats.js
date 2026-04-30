/**
 * Aggregates per-question correct/incorrect counts from user `sessionReviews`
 * (each session’s `answers` array with `questionId` / `questionNo` and `correct`).
 *
 * @param {Record<string, unknown>} raw
 * @returns {number | null}
 */
function coalesceAnswerQuestionId(raw) {
  const a1 = raw.questionId
  const a2 = raw.questionNo
  if (typeof a1 === 'number' && Number.isFinite(a1)) return a1
  if (typeof a2 === 'number' && Number.isFinite(a2)) return a2
  const n1 = Number(a1)
  if (Number.isFinite(n1)) return n1
  const n2 = Number(a2)
  if (Number.isFinite(n2)) return n2
  return null
}

/** Same base as mobile `resolveQuestionId` fallback. */
const SYNTHETIC_QUESTION_ID_BASE = 900000

/** @param {{ firestoreDocId: string }} a @param {{ firestoreDocId: string }} b */
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
 * Duplicate detection on question rows — aligned with mobile `rawQuestionIdentityKey`.
 *
 * @param {Record<string, unknown>} row
 * @param {number} index index in the pre-dedupe array (sorted list)
 */
function rawQuestionIdentityKey(row, index) {
  const id = row.id
  if (id == null || String(id).trim() === '') {
    return `__row__:${index}`
  }
  if (typeof id === 'number' && Number.isFinite(id)) {
    return `idn:${Math.round(id)}`
  }
  const s = String(id).trim()
  if (/^-?\d+$/.test(s)) {
    return `idn:${parseInt(s, 10)}`
  }
  return `ids:${s}`
}

/**
 * Same rules as mobile `resolveQuestionId`: string ids use `parseInt` only;
 * NaN → `900000 + index` (index = position among deduped keys, see {@link buildNumericQuestionIdMap}).
 *
 * @param {Record<string, unknown>} row
 * @param {number} index
 * @returns {number}
 */
export function numericQuestionIdFromRow(row, index = 0) {
  const id = row.id
  if (id == null) return SYNTHETIC_QUESTION_ID_BASE + index
  if (typeof id === 'number' && Number.isFinite(id)) return Math.round(id)
  const parsed = parseInt(String(id), 10)
  return Number.isNaN(parsed) ? SYNTHETIC_QUESTION_ID_BASE + index : parsed
}

/**
 * Stable numeric id per Firestore row for joining to session `questionId`, matching the app bank:
 * rows are sorted by doc id, then the same identity/dedupe index as the client uses for `900000 + index`.
 *
 * @param {Array<{ firestoreDocId: string } & Record<string, unknown>>} rows
 * @returns {Map<string, number>} firestoreDocId → numeric question id
 */
export function buildNumericQuestionIdMap(rows) {
  const sorted = [...rows].sort(compareFirestoreDocIdAsc)
  /** @type {Map<string, number>} */
  const keyToDedupeIndex = new Map()
  let nextIdx = 0
  /** @type {Map<string, number>} */
  const map = new Map()

  for (let i = 0; i < sorted.length; i++) {
    const row = sorted[i]
    const ik = rawQuestionIdentityKey(row, i)
    let dIdx = keyToDedupeIndex.get(ik)
    if (dIdx === undefined) {
      dIdx = nextIdx
      keyToDedupeIndex.set(ik, dIdx)
      nextIdx++
    }
    map.set(row.firestoreDocId, numericQuestionIdFromRow(row, dIdx))
  }
  return map
}

/** Emails omitted from session answer aggregates (internal / test accounts). */
const EXCLUDED_FROM_ANSWER_STATS_EMAILS = new Set(
  [
    'petarjic1010@gmail.com',
    'runout.test@gmail.com',
    'development@poker-wizard.com',
  ].map((e) => e.toLowerCase()),
)

/**
 * @param {Record<string, unknown>} user
 */
function isExcludedFromAnswerStats(user) {
  const raw = user.email
  if (typeof raw !== 'string') return false
  return EXCLUDED_FROM_ANSWER_STATS_EMAILS.has(raw.trim().toLowerCase())
}

/**
 * @param {Array<Record<string, unknown>>} userRows User document payloads (not including doc id)
 * @returns {Map<number, { correct: number, wrong: number }>}
 */
export function aggregateQuestionAnswerStats(userRows) {
  const map = new Map()

  function bump(qid, isCorrect) {
    let e = map.get(qid)
    if (!e) {
      e = { correct: 0, wrong: 0 }
      map.set(qid, e)
    }
    if (isCorrect) e.correct++
    else e.wrong++
  }

  for (const user of userRows) {
    if (isExcludedFromAnswerStats(user)) continue
    const sr = user.sessionReviews
    if (!sr || typeof sr !== 'object') continue
    for (const key of Object.keys(sr)) {
      const session = sr[key]
      if (!session || typeof session !== 'object') continue
      const answers = session.answers
      if (!Array.isArray(answers)) continue
      for (const raw of answers) {
        if (!raw || typeof raw !== 'object') continue
        const qid = coalesceAnswerQuestionId(raw)
        if (qid == null) continue
        if (raw.correct !== true && raw.correct !== false) continue
        bump(qid, raw.correct === true)
      }
    }
  }

  return map
}

/**
 * @param {number} correct
 * @param {number} wrong
 * @returns {number | null} Percent 0–100, or null if no attempts
 */
export function answerPercentCorrect(correct, wrong) {
  const total = correct + wrong
  if (total === 0) return null
  return Math.round((correct / total) * 100)
}
