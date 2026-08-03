/**
 * Field names on the app settings Firestore document (`config/app` by default).
 */
export const APP_SETTINGS_FIELDS = {
  showDiscountScreenIos: 'showDiscountScreenIos',
  showDiscountScreenAndroid: 'showDiscountScreenAndroid',
  /** Percentage (0–100) of users who should see the App2Web (web checkout) option. 0 hides it for everyone, 100 shows it to all. */
  app2WebPercentage: 'app2WebPercentage',
  /** Whether the in-app AI chat bot is enabled at all. */
  aiChatBotEnabled: 'aiChatBotEnabled',
  /** Which Claude model powers the AI chat bot — see AI_CHAT_BOT_MODELS. */
  aiChatBotModel: 'aiChatBotModel',
  /** Hard cap on total AI chat bot spend per day (USD), across all users. */
  aiChatBotMaxCostPerDayUsd: 'aiChatBotMaxCostPerDayUsd',
}

/** @type {Record<keyof typeof APP_SETTINGS_FIELDS, boolean | number | string>} */
export const APP_SETTINGS_DEFAULTS = {
  showDiscountScreenIos: false,
  showDiscountScreenAndroid: false,
  app2WebPercentage: 0,
  aiChatBotEnabled: false,
  aiChatBotModel: 'claude-sonnet-5',
  aiChatBotMaxCostPerDayUsd: 10,
}

/**
 * Read-only AI chat bot usage fields on the same document — written by the
 * chat bot backend as it runs, not by this admin page. Deliberately kept out
 * of APP_SETTINGS_FIELDS/APP_SETTINGS_DEFAULTS: those drive the Settings page
 * save button, and writing these back would clobber live spend tracking with
 * a stale value from whenever the page happened to load.
 */
export const AI_CHAT_BOT_STATUS_FIELDS = {
  aiChatBotTodayCostUsd: 'aiChatBotTodayCostUsd',
  aiChatBotCostDate: 'aiChatBotCostDate',
  aiChatBotDailyCapReached: 'aiChatBotDailyCapReached',
}

export const AI_CHAT_BOT_STATUS_DEFAULTS = {
  aiChatBotTodayCostUsd: 0,
  aiChatBotCostDate: /** @type {string | null} */ (null),
  aiChatBotDailyCapReached: false,
}

/** Selectable Claude models for the AI chat bot feature. */
export const AI_CHAT_BOT_MODELS = [
  { id: 'claude-haiku-4-5', label: 'Claude Haiku 4.5 — fastest, cheapest' },
  { id: 'claude-sonnet-5', label: 'Claude Sonnet 5 — balanced' },
  { id: 'claude-opus-4-8', label: 'Claude Opus 4.8 — most capable' },
]

/**
 * USD price per 1M tokens, for the admin-facing cost estimate only — not used
 * for real billing. Sonnet 5 is shown at introductory pricing (through
 * 2026-08-31); refresh from platform.claude.com/docs/en/pricing after that.
 */
export const AI_CHAT_BOT_MODEL_PRICING_PER_MILLION = {
  'claude-haiku-4-5': { input: 1.0, output: 5.0 },
  'claude-sonnet-5': { input: 2.0, output: 10.0 },
  'claude-opus-4-8': { input: 5.0, output: 25.0 },
}

/**
 * Rough estimate only, for the admin UI — treats `tokens` as input tokens
 * (the prompt itself); the model's response is billed separately at the
 * (higher) output rate.
 * @param {string} modelId
 * @param {number} [tokens]
 * @returns {number | null}
 */
export function estimateChatBotPromptCostUsd(modelId, tokens = 700) {
  const pricing = AI_CHAT_BOT_MODEL_PRICING_PER_MILLION[modelId]
  if (!pricing) return null
  return (tokens / 1_000_000) * pricing.input
}
