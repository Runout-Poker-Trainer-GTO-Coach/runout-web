/**
 * Onboarding survey copy → Firestore field under `onboarding` on each user.
 * (Also used as CSV column keys after `normalizeUserForExport`.)
 */
export const ONBOARDING_QUESTION_FIELD_MAP = [
  ['What is your current poker level?', 'skillLevel'],
  ['How often do you currently play poker?', 'playFrequency'],
  [
    'Which formats are you most interested in studying?',
    'formats',
  ],
  ['Do you prefer to focus on live or online play?', 'liveOrOnline'],
  [
    'How confident are you in your preflop ranges?',
    'preflopConfidence',
  ],
  [
    'How do you primarily approach postflop decisions?',
    'postflopApproach',
  ],
  [
    'Which areas do you struggle with the most right now?',
    'struggleAreas',
  ],
  ['What are your goals with Runout Poker?', 'goals'],
  [
    'How much time do you want to train each day?',
    'trainingTimePerDay',
  ],
  [
    'How comfortable are you with which hands to play preflop?',
    'preflopComfort',
  ],
  [
    'How do you usually decide what to do after the flop?',
    'postflopDecide',
  ],
  [
    'Which areas are you least familiar with?',
    'leastFamiliarAreas',
  ],
]

/** Field name → exact survey question copy (for Audience filter labels). */
export const ONBOARDING_QUESTION_BY_FIELD = Object.fromEntries(
  ONBOARDING_QUESTION_FIELD_MAP.map(([question, key]) => [key, question]),
)

/** Admin-only columns (no survey question). */
const DETAIL_MODAL_ADMIN_LABELS = {
  email: 'Email',
  name: 'Name',
  isPurchased: 'Purchase status',
  sessionCount: 'Session count',
  canDoUnlimitedSessions: 'Unlimited training sessions',
  freeAccess: 'Free access',
}

/**
 * Detail modal: show full survey question when available; else a clear admin title.
 *
 * @param {string} fieldKey
 * @param {string} shortLabel — from export field list (CSV column title)
 */
export function detailModalLabelForField(fieldKey, shortLabel) {
  const q = ONBOARDING_QUESTION_BY_FIELD[fieldKey]
  if (typeof q === 'string' && q.trim() !== '') return q
  const admin = DETAIL_MODAL_ADMIN_LABELS[fieldKey]
  if (admin) return admin
  return shortLabel
}

/**
 * "Which areas do you struggle with the most right now?" — keep in sync with app STRUGGLE_OPTIONS.
 * @type {readonly { id: string, title: string, description: string }[]}
 */
export const STRUGGLE_AREA_OPTIONS = [
  { id: 'preflop', title: 'Preflop', description: '' },
  {
    id: 'facing_aggression',
    title: 'Facing aggression',
    description: 'Bets, raises, and check-raises',
  },
  { id: 'postflop', title: 'Postflop decision-making', description: '' },
  {
    id: 'bluff_semi_bluff',
    title: 'Selecting bluff / semi-bluff spots',
    description: '',
  },
  { id: 'defending_blinds', title: 'Defending blinds', description: '' },
  { id: 'playing_oop', title: 'Playing out of position', description: '' },
  { id: 'bet_sizing', title: 'Bet sizing', description: '' },
  { id: 'multiway', title: 'Multiway pots', description: '' },
  { id: 'exploitative', title: 'Exploitative adjustments', description: '' },
  { id: 'deep_stack', title: 'Deep stack play', description: '' },
  { id: 'short_stack', title: 'Short stack play', description: '' },
  { id: 'poker_math', title: 'Poker math', description: '' },
  {
    id: 'emotional_control',
    title: 'Emotional control / tilt',
    description: '',
  },
]

/**
 * `onboarding.struggleAreas` — id → display label (title; add description when set).
 * @type {Record<string, string>}
 */
export const STRUGGLE_AREA_ID_LABELS = Object.fromEntries(
  STRUGGLE_AREA_OPTIONS.map(({ id, title, description }) => {
    const d = typeof description === 'string' ? description.trim() : ''
    return [id, d ? `${title} (${d})` : title]
  }),
)

/**
 * `onboarding.goals` — Firestore stores an array of these ids (multi-select).
 * @type {Record<string, string>}
 */
export const GOAL_ID_LABELS = {
  increase_winrate: 'Increase win-rate',
  consistently_profitable: 'Become consistently profitable',
  play_disciplined: 'Play more disciplined',
  go_deep_tournaments: 'Go deep in tournaments often',
  feel_confident: 'Feel confident playing with anyone',
  stop_second_guessing: 'Stop second-guessing decisions',
  become_pro: 'Become a professional',
}

/**
 * "Which areas are you least familiar with?" — keep in sync with app onboarding OPTIONS.
 * @type {readonly { id: string, title: string, description: string }[]}
 */
export const LEAST_FAMILIAR_AREA_OPTIONS = [
  { id: 'everything_new', title: "Everything, I'm new!", description: '' },
  { id: 'preflop', title: 'Preflop', description: '' },
  { id: 'understanding_board', title: 'Understanding the board', description: '' },
  {
    id: 'facing_aggression',
    title: 'Facing aggression',
    description: 'Bets, raises, and check-raises',
  },
  { id: 'postflop', title: 'Postflop decision-making', description: '' },
  { id: 'bluff_spots', title: 'Selecting bluff spots', description: '' },
  { id: 'playing_too_many', title: 'Playing too many hands', description: '' },
  {
    id: 'knowing_opponent',
    title: 'Knowing what my opponent may have',
    description: '',
  },
  { id: 'how_much_bet', title: 'How much to bet', description: '' },
  {
    id: 'handling_draws',
    title: 'Handling draws (mine or theirs)',
    description: '',
  },
  { id: 'emotional_control', title: 'Emotional control', description: '' },
  { id: 'poker_math', title: 'Poker math', description: '' },
]

/**
 * `onboarding.leastFamiliarAreas` — id → display label (title; add description when set).
 * @type {Record<string, string>}
 */
export const LEAST_FAMILIAR_AREA_ID_LABELS = Object.fromEntries(
  LEAST_FAMILIAR_AREA_OPTIONS.map(({ id, title, description }) => {
    const d = typeof description === 'string' ? description.trim() : ''
    return [
      id,
      d ? `${title} (${d})` : title,
    ]
  }),
)

/**
 * Multi-select id fields: known ids → display label, used by the user
 * Detail modal to render each as tags instead of a raw joined string.
 * Row data must include `idKey` arrays from `normalizeUserForExport`.
 *
 * @type {Record<string, { idKey: string, idLabelMap: Record<string, string> }>}
 */
export const AUDIENCE_MULTI_ID_FIELD_CONFIG = {
  struggleAreas: {
    idKey: 'struggleAreaIds',
    idLabelMap: STRUGGLE_AREA_ID_LABELS,
  },
  goals: {
    idKey: 'goalIds',
    idLabelMap: GOAL_ID_LABELS,
  },
  leastFamiliarAreas: {
    idKey: 'leastFamiliarAreaIds',
    idLabelMap: LEAST_FAMILIAR_AREA_ID_LABELS,
  },
}

/**
 * Multi-select fields stored as plain string arrays (not id→label maps).
 * Value is the key on the normalized row that holds `string[]` for tag UI.
 *
 * @type {Record<string, string>}
 */
export const ONBOARDING_STRING_MULTI_FIELDS = {
  formats: 'formatsList',
  trainingTimePerDay: 'trainingTimePerDayList',
}

export const USER_EXPORT_FIELDS = [
  { key: 'email', label: 'email' },
  { key: 'isPurchased', label: 'is Purchased' },
  { key: 'sessionCount', label: 'Session count' },
  { key: 'skillLevel', label: 'Skill level' },
  { key: 'playFrequency', label: 'Play frequency' },
  { key: 'formats', label: 'Formats' },
  { key: 'liveOrOnline', label: 'Live / online' },
  { key: 'preflopConfidence', label: 'Preflop confidence' },
  { key: 'postflopApproach', label: 'Postflop approach' },
  { key: 'struggleAreas', label: 'Struggle areas' },
  { key: 'goals', label: 'Goals' },
  { key: 'trainingTimePerDay', label: 'Training time / day' },
  { key: 'preflopComfort', label: 'Preflop comfort' },
  { key: 'postflopDecide', label: 'Postflop decide' },
  { key: 'leastFamiliarAreas', label: 'Least familiar areas' },
  { key: 'canDoUnlimitedSessions', label: 'Unlimited sessions' },
  { key: 'freeAccess', label: 'Free access' },
]

/** Audience table + CSV (emails + onboarding + purchased). */
export const AUDIENCE_EXPORT_FIELDS = [
  { key: 'email', label: 'Email' },
  { key: 'name', label: 'Name' },
  { key: 'skillLevel', label: 'Skill level' },
  { key: 'playFrequency', label: 'Play frequency' },
  { key: 'formats', label: 'Formats' },
  { key: 'liveOrOnline', label: 'Live or online' },
  { key: 'preflopConfidence', label: 'Preflop confidence' },
  { key: 'postflopApproach', label: 'Postflop approach' },
  { key: 'struggleAreas', label: 'Struggle areas' },
  { key: 'goals', label: 'Goals' },
  { key: 'trainingTimePerDay', label: 'Training time / day' },
  { key: 'preflopComfort', label: 'Preflop comfort' },
  { key: 'postflopDecide', label: 'Postflop decide' },
  { key: 'leastFamiliarAreas', label: 'Least familiar areas' },
  { key: 'isPurchased', label: 'Purchased' },
  { key: 'sessionCount', label: 'Session count' },
  { key: 'canDoUnlimitedSessions', label: 'Unlimited sessions' },
  { key: 'freeAccess', label: 'Free access' },
]
