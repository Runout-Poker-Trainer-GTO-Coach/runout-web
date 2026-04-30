import {
  GOAL_ID_LABELS,
  LEAST_FAMILIAR_AREA_ID_LABELS,
  STRUGGLE_AREA_ID_LABELS,
} from './userFields.js'

/**
 * @param {unknown} raw
 * @returns {Record<string, unknown> | null}
 */
function parseOnboarding(raw) {
  if (raw == null) return null
  if (typeof raw === 'string') {
    try {
      const parsed = JSON.parse(raw)
      return parsed && typeof parsed === 'object' ? parsed : null
    } catch {
      return null
    }
  }
  if (typeof raw === 'object') return /** @type {Record<string, unknown>} */ (raw)
  return null
}

/**
 * @param {unknown} v
 */
function onboardingScalar(v) {
  if (v == null || v === '') return ''
  if (typeof v === 'string' || typeof v === 'number' || typeof v === 'boolean')
    return String(v).trim()
  return ''
}

/**
 * Arrays (e.g. formats) → comma-separated for table/CSV.
 * @param {unknown} v
 */
function onboardingArrayJoined(v) {
  if (v == null) return ''
  if (Array.isArray(v)) {
    return v
      .map((x) => (x != null ? String(x).trim() : ''))
      .filter(Boolean)
      .join(', ')
  }
  if (typeof v === 'string') return v.trim()
  return String(v)
}

/**
 * @param {unknown} v
 * @returns {number | null}
 */
function sessionCountFromDoc(v) {
  if (v == null) return null
  if (typeof v === 'number' && !Number.isNaN(v)) return Math.trunc(v)
  if (typeof v === 'string' && v.trim() !== '') {
    const n = Number(v)
    if (Number.isFinite(n)) return Math.trunc(n)
  }
  return null
}

/**
 * @param {unknown} v
 * @returns {Record<string, unknown> | null}
 */
function asRecord(v) {
  if (!v || typeof v !== 'object' || Array.isArray(v)) return null
  return /** @type {Record<string, unknown>} */ (v)
}

/**
 * @param {unknown} v
 * @returns {string}
 */
function toIsoString(v) {
  if (typeof v === 'string') return v.trim()
  if (v && typeof v === 'object' && typeof v.toDate === 'function') {
    try {
      return v.toDate().toISOString()
    } catch {
      return ''
    }
  }
  return ''
}

/**
 * @param {unknown} v
 */
function looksLikeSessionStats(v) {
  const rec = asRecord(v)
  if (!rec) return false
  const hasElo =
    typeof rec.userEloRating === 'number' || typeof rec.userEloRating === 'string'
  const hasSelected =
    typeof rec.selectedQuestionCount === 'number' ||
    typeof rec.selectedQuestionCount === 'string'
  const hasRequested =
    typeof rec.requestedQuestionCount === 'number' ||
    typeof rec.requestedQuestionCount === 'string'
  return hasElo || hasSelected || hasRequested
}

/**
 * @param {Record<string, unknown> & { id: string }} doc
 */
function extractSessionStatsSnapshot(doc) {
  if (looksLikeSessionStats(doc.sessionStats)) {
    return {
      sessionStats: /** @type {Record<string, unknown>} */ (doc.sessionStats),
      updatedAt: toIsoString(doc.updatedAt),
    }
  }

  for (const value of Object.values(doc)) {
    const rec = asRecord(value)
    if (!rec) continue
    if (looksLikeSessionStats(rec.sessionStats)) {
      return {
        sessionStats: /** @type {Record<string, unknown>} */ (rec.sessionStats),
        updatedAt: toIsoString(rec.updatedAt) || toIsoString(doc.updatedAt),
      }
    }
    if (looksLikeSessionStats(rec)) {
      return {
        sessionStats: rec,
        updatedAt: toIsoString(rec.updatedAt) || toIsoString(doc.updatedAt),
      }
    }
  }

  return { sessionStats: null, updatedAt: '' }
}

/**
 * @param {unknown} v
 * @returns {string[]}
 */
function normalizeIdList(v) {
  if (v == null) return []
  if (Array.isArray(v)) {
    return v.map((x) => String(x).trim()).filter(Boolean)
  }
  if (typeof v === 'string') {
    const t = v.trim()
    if (!t) return []
    return t
      .split(',')
      .map((s) => s.trim())
      .filter(Boolean)
  }
  return []
}

/**
 * Multi-select id arrays (struggleAreas, goals) → comma-separated labels.
 * Unknown ids are passed through as-is.
 *
 * @param {unknown} v
 * @param {Record<string, string>} idToLabel
 */
function onboardingIdsToLabels(v, idToLabel) {
  const ids = normalizeIdList(v)
  if (ids.length === 0) return ''
  return ids
    .map((id) => idToLabel[id] ?? id)
    .filter(Boolean)
    .join(', ')
}

/**
 * Flatten Firestore user doc for table + CSV. Onboarding answers live under
 * nested `onboarding` (see `ONBOARDING_QUESTION_FIELD_MAP` in `userFields.js`).
 *
 * @param {Record<string, unknown> & { id: string }} doc
 */
export function normalizeUserForExport(doc) {
  const onboarding = parseOnboarding(doc.onboarding)
  const OB = onboarding
  const sessionSnapshot = extractSessionStatsSnapshot(doc)

  return {
    id: doc.id,
    name: doc.name ?? doc.displayName ?? OB?.name ?? '',
    email: doc.email ?? '',
    isPurchased: doc.isPurchased,
    skillLevel: onboardingScalar(OB?.skillLevel ?? doc.skillLevel),
    playFrequency: onboardingScalar(OB?.playFrequency ?? doc.playFrequency),
    formatsList: normalizeIdList(OB?.formats ?? doc.formats),
    formats: onboardingArrayJoined(OB?.formats ?? doc.formats),
    liveOrOnline: onboardingScalar(OB?.liveOrOnline ?? doc.liveOrOnline),
    preflopConfidence: onboardingScalar(
      OB?.preflopConfidence ?? doc.preflopConfidence,
    ),
    postflopApproach: onboardingScalar(
      OB?.postflopApproach ?? doc.postflopApproach,
    ),
    struggleAreaIds: normalizeIdList(OB?.struggleAreas ?? doc.struggleAreas),
    struggleAreas: onboardingIdsToLabels(
      OB?.struggleAreas ?? doc.struggleAreas,
      STRUGGLE_AREA_ID_LABELS,
    ),
    goalIds: normalizeIdList(OB?.goals ?? doc.goals),
    goals: onboardingIdsToLabels(OB?.goals ?? doc.goals, GOAL_ID_LABELS),
    trainingTimePerDayList: normalizeIdList(
      OB?.trainingTimePerDay ?? doc.trainingTimePerDay,
    ),
    trainingTimePerDay: onboardingArrayJoined(
      OB?.trainingTimePerDay ?? doc.trainingTimePerDay,
    ),
    preflopComfort: onboardingScalar(OB?.preflopComfort ?? doc.preflopComfort),
    postflopDecide: onboardingScalar(OB?.postflopDecide ?? doc.postflopDecide),
    leastFamiliarAreaIds: normalizeIdList(
      OB?.leastFamiliarAreas ?? doc.leastFamiliarAreas,
    ),
    leastFamiliarAreas: onboardingIdsToLabels(
      OB?.leastFamiliarAreas ?? doc.leastFamiliarAreas,
      LEAST_FAMILIAR_AREA_ID_LABELS,
    ),
    sessionCount: sessionCountFromDoc(doc.sessionCount),
    canDoUnlimitedSessions: doc.canDoUnlimitedSessions === true,
    freeAccess: doc.freeAccess === true,
    sessionStats: sessionSnapshot.sessionStats,
    sessionStatsUpdatedAt: sessionSnapshot.updatedAt,
  }
}
