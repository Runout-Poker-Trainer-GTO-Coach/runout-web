import {
  AlertCircle,
  AlertTriangle,
  BadgePercent,
  Bot,
  Cpu,
  DollarSign,
  Gauge,
  Globe,
  Loader2,
  Power,
  RotateCcw,
  Save,
  Settings,
  Smartphone,
} from 'lucide-react'
import { useCallback, useEffect, useMemo, useState } from 'react'
import {
  doc,
  getDoc,
  serverTimestamp,
  setDoc,
} from 'firebase/firestore'
import {
  db,
  firebaseReady,
  settingsCollectionName,
  settingsDocumentId,
} from './firebase'
import {
  AI_CHAT_BOT_MODELS,
  AI_CHAT_BOT_STATUS_DEFAULTS,
  AI_CHAT_BOT_STATUS_FIELDS,
  APP_SETTINGS_DEFAULTS,
  APP_SETTINGS_FIELDS,
  estimateChatBotPromptCostUsd,
} from './settingsConstants.js'
import PercentageSlider from './PercentageSlider.jsx'

/**
 * @param {Record<string, unknown> | undefined} data
 */
/**
 * Coerce any stored value into an integer percentage clamped to 0–100.
 * @param {unknown} v
 * @returns {number}
 */
function clampPercentage(v) {
  const n = typeof v === 'number' ? v : Number(v)
  if (!Number.isFinite(n)) return 0
  return Math.max(0, Math.min(100, Math.round(n)))
}

/**
 * Non-negative USD amount, rounded to the cent. Missing/invalid values fall
 * back to the configured default (not 0) — a fresh Firestore document has no
 * value here yet, and 0 would silently mean "no AI spend allowed all day."
 */
function clampUsd(v) {
  const n = typeof v === 'number' ? v : Number(v)
  if (!Number.isFinite(n) || n < 0) {
    return APP_SETTINGS_DEFAULTS.aiChatBotMaxCostPerDayUsd
  }
  return Math.round(n * 100) / 100
}

/** Falls back to the default model if the stored value isn't a known one. */
function clampChatBotModel(v) {
  return AI_CHAT_BOT_MODELS.some((m) => m.id === v)
    ? v
    : APP_SETTINGS_DEFAULTS.aiChatBotModel
}

function parseSettings(data) {
  const d =
    data && typeof data === 'object'
      ? /** @type {Record<string, unknown>} */ (data)
      : {}
  const t = (k) => d[k] === true
  return {
    ...APP_SETTINGS_DEFAULTS,
    showDiscountScreenIos: t(APP_SETTINGS_FIELDS.showDiscountScreenIos),
    showDiscountScreenAndroid: t(APP_SETTINGS_FIELDS.showDiscountScreenAndroid),
    app2WebPercentage: clampPercentage(
      d[APP_SETTINGS_FIELDS.app2WebPercentage],
    ),
    aiChatBotEnabled: t(APP_SETTINGS_FIELDS.aiChatBotEnabled),
    aiChatBotModel: clampChatBotModel(d[APP_SETTINGS_FIELDS.aiChatBotModel]),
    aiChatBotMaxCostPerDayUsd: clampUsd(
      d[APP_SETTINGS_FIELDS.aiChatBotMaxCostPerDayUsd],
    ),
  }
}

/**
 * Parses the read-only AI chat bot usage fields — written by the chat bot
 * backend, never by this page. Kept separate from `parseSettings`/`values`
 * so a normal settings save can never overwrite live spend tracking.
 */
function parseChatBotStatus(data) {
  const d =
    data && typeof data === 'object'
      ? /** @type {Record<string, unknown>} */ (data)
      : {}
  const rawCost = d[AI_CHAT_BOT_STATUS_FIELDS.aiChatBotTodayCostUsd]
  const n = typeof rawCost === 'number' ? rawCost : Number(rawCost)
  const rawDate = d[AI_CHAT_BOT_STATUS_FIELDS.aiChatBotCostDate]
  return {
    aiChatBotTodayCostUsd:
      Number.isFinite(n) && n >= 0
        ? n
        : AI_CHAT_BOT_STATUS_DEFAULTS.aiChatBotTodayCostUsd,
    aiChatBotCostDate:
      typeof rawDate === 'string' && rawDate
        ? rawDate
        : AI_CHAT_BOT_STATUS_DEFAULTS.aiChatBotCostDate,
    aiChatBotDailyCapReached:
      d[AI_CHAT_BOT_STATUS_FIELDS.aiChatBotDailyCapReached] === true,
  }
}

/**
 * @param {{
 *   id: string
 *   title: string
 *   description: string
 *   checked: boolean
 *   onChange: (next: boolean) => void
 *   disabled?: boolean
 *   icon: import('react').ReactNode
 * }} props
 */
function SettingToggle({
  id,
  title,
  description,
  checked,
  onChange,
  disabled,
  icon,
}) {
  return (
    <div className="flex flex-col gap-3 rounded-xl border border-slate-100/90 bg-white/80 p-4 shadow-sm ring-1 ring-slate-900/[0.03] sm:flex-row sm:items-center sm:justify-between">
      <div className="flex min-w-0 items-center gap-3">
        <div className="flex size-10 shrink-0 items-center justify-center rounded-xl bg-gradient-to-br from-slate-50 to-white shadow-sm ring-1 ring-slate-200/80">
          {icon}
        </div>
        <div className="min-w-0">
          <p className="text-sm font-semibold text-slate-900">{title}</p>
          <p className="text-xs leading-snug text-slate-500">{description}</p>
        </div>
      </div>
      <div className="flex items-center gap-3 self-end sm:self-center">
        <span
          className="w-9 text-right text-xs font-semibold tabular-nums text-slate-600"
          aria-live="polite"
        >
          {checked ? 'On' : 'Off'}
        </span>
        <label
          htmlFor={id}
          className="relative inline-flex h-7 w-12 shrink-0 cursor-pointer items-center"
        >
          <input
            id={id}
            type="checkbox"
            checked={checked}
            onChange={(e) => onChange(e.target.checked)}
            disabled={disabled}
            className="peer sr-only"
          />
          <span
            className="absolute inset-0 rounded-full bg-slate-200 transition peer-checked:bg-emerald-500 peer-focus-visible:outline peer-focus-visible:outline-2 peer-focus-visible:outline-offset-2 peer-focus-visible:outline-emerald-500 peer-disabled:opacity-50"
            aria-hidden
          />
          <span
            className="pointer-events-none absolute left-1 top-1 size-5 rounded-full bg-white shadow transition peer-checked:left-6"
            aria-hidden
          />
        </label>
      </div>
    </div>
  )
}

/**
 * @param {{
 *   title: string
 *   eyebrow: string
 *   description?: string
 *   children: import('react').ReactNode
 *   icon: import('react').ReactNode
 * }} props
 */
function SettingsCard({ title, eyebrow, description, children, icon }) {
  return (
    <section className="overflow-hidden rounded-2xl border border-slate-200/80 bg-white/90 shadow-[0_8px_30px_-12px_rgba(15,23,42,0.08)] ring-1 ring-slate-900/[0.04]">
      <div className="border-b border-slate-100/90 bg-gradient-to-r from-emerald-50/80 via-white to-teal-50/40 px-5 py-4">
        <div className="flex items-start gap-3">
          <div className="flex size-10 shrink-0 items-center justify-center rounded-xl bg-white shadow-sm ring-1 ring-emerald-100/90">
            {icon}
          </div>
          <div className="min-w-0">
            <p className="text-[11px] font-bold uppercase tracking-[0.14em] text-emerald-800/90">
              {eyebrow}
            </p>
            <h2 className="mt-0.5 text-base font-semibold tracking-tight text-slate-900">
              {title}
            </h2>
            {description ? (
              <p className="mt-1 text-xs leading-relaxed text-slate-600">
                {description}
              </p>
            ) : null}
          </div>
        </div>
      </div>
      <div className="space-y-3 p-5">{children}</div>
    </section>
  )
}

/**
 * @param {{ busy: boolean, onCancel: () => void, onConfirm: () => void }} props
 */
function ResetChatBotSpendModal({ busy, onCancel, onConfirm }) {
  return (
    <div
      className="fixed inset-0 z-[55] flex items-end justify-center bg-slate-900/50 p-0 backdrop-blur-sm sm:items-center sm:p-4"
      role="presentation"
      onClick={() => {
        if (!busy) onCancel()
      }}
    >
      <div
        role="dialog"
        aria-modal="true"
        aria-labelledby="reset-chat-bot-spend-title"
        className="w-full max-w-md rounded-t-2xl border border-amber-200 bg-white shadow-2xl sm:rounded-2xl"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-start gap-3 border-b border-amber-100 bg-amber-50/70 px-5 py-4">
          <div className="flex size-10 shrink-0 items-center justify-center rounded-xl bg-amber-500 text-white shadow-md shadow-amber-900/25">
            <RotateCcw className="size-5" strokeWidth={2.25} aria-hidden />
          </div>
          <div className="min-w-0 flex-1">
            <h2
              id="reset-chat-bot-spend-title"
              className="text-base font-semibold text-amber-900"
            >
              Reset today's AI spend?
            </h2>
            <p className="mt-0.5 text-xs leading-relaxed text-amber-800/80">
              Sets today's tracked spend back to $0.00 and clears the
              cap-reached flag. The chat bot keeps tracking new usage from
              here — this doesn't change the daily cap itself.
            </p>
          </div>
        </div>
        <div className="flex items-center justify-end gap-2 px-5 py-4">
          <button
            type="button"
            onClick={onCancel}
            disabled={busy}
            className="cursor-pointer rounded-xl border border-slate-200 bg-white px-4 py-2 text-sm font-semibold text-slate-700 shadow-sm transition hover:bg-slate-50 focus:outline-none focus-visible:ring-2 focus-visible:ring-slate-400 disabled:cursor-not-allowed disabled:opacity-50"
          >
            Cancel
          </button>
          <button
            type="button"
            onClick={onConfirm}
            disabled={busy}
            className="inline-flex cursor-pointer items-center gap-2 rounded-xl bg-gradient-to-b from-amber-500 to-amber-600 px-4 py-2 text-sm font-semibold text-white shadow-md shadow-amber-900/25 transition hover:from-amber-600 hover:to-amber-700 focus:outline-none focus-visible:ring-2 focus-visible:ring-amber-500 focus-visible:ring-offset-2 disabled:cursor-not-allowed disabled:opacity-50"
          >
            {busy ? (
              <>
                <Loader2
                  className="size-4 animate-spin"
                  strokeWidth={2}
                  aria-hidden
                />
                Resetting…
              </>
            ) : (
              <>
                <RotateCcw className="size-4" strokeWidth={2} aria-hidden />
                Reset
              </>
            )}
          </button>
        </div>
      </div>
    </div>
  )
}

export default function SettingsPage() {
  const [loading, setLoading] = useState(!!firebaseReady)
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState(/** @type {string | null} */ (null))

  const [values, setValues] = useState(() => ({ ...APP_SETTINGS_DEFAULTS }))
  const [saved, setSaved] = useState(() => ({ ...APP_SETTINGS_DEFAULTS }))
  const [chatBotStatus, setChatBotStatus] = useState(() => ({
    ...AI_CHAT_BOT_STATUS_DEFAULTS,
  }))
  const [resetSpendConfirmOpen, setResetSpendConfirmOpen] = useState(false)
  const [resetSpendBusy, setResetSpendBusy] = useState(false)

  const dirty = useMemo(
    () => JSON.stringify(values) !== JSON.stringify(saved),
    [values, saved],
  )

  const patch = useCallback(
    (/** @type {Partial<typeof APP_SETTINGS_DEFAULTS>} */ p) => {
      setValues((v) => ({ ...v, ...p }))
    },
    [],
  )

  const setApp2WebPercentage = useCallback(
    (/** @type {string | number} */ raw) => {
      patch({ app2WebPercentage: clampPercentage(raw) })
    },
    [patch],
  )

  const setAiChatBotModel = useCallback(
    (/** @type {string} */ raw) => {
      patch({ aiChatBotModel: clampChatBotModel(raw) })
    },
    [patch],
  )

  const setAiChatBotMaxCostPerDayUsd = useCallback(
    (/** @type {string | number} */ raw) => {
      patch({ aiChatBotMaxCostPerDayUsd: clampUsd(raw) })
    },
    [patch],
  )

  const estimatedPromptCost = useMemo(() => {
    const model = AI_CHAT_BOT_MODELS.find(
      (m) => m.id === values.aiChatBotModel,
    )
    return {
      label: model?.label ?? values.aiChatBotModel,
      usd: estimateChatBotPromptCostUsd(values.aiChatBotModel, 700) ?? 0,
    }
  }, [values.aiChatBotModel])

  const chatBotSpendPct = useMemo(() => {
    const cap = values.aiChatBotMaxCostPerDayUsd
    const spent = chatBotStatus.aiChatBotTodayCostUsd
    if (cap <= 0) return spent > 0 ? 100 : 0
    return Math.max(0, Math.min(100, (spent / cap) * 100))
  }, [chatBotStatus.aiChatBotTodayCostUsd, values.aiChatBotMaxCostPerDayUsd])

  useEffect(() => {
    if (!firebaseReady || !db) {
      setLoading(false)
      return
    }

    let cancelled = false
    setLoading(true)
    setError(null)

    ;(async () => {
      try {
        const ref = doc(db, settingsCollectionName, settingsDocumentId)
        const snap = await getDoc(ref)
        if (cancelled) return
        const next = parseSettings(snap.data())
        setValues(next)
        setSaved(next)
        setChatBotStatus(parseChatBotStatus(snap.data()))
      } catch (e) {
        if (!cancelled) {
          setError(e?.message || 'Failed to load settings')
        }
      } finally {
        if (!cancelled) setLoading(false)
      }
    })()

    return () => {
      cancelled = true
    }
  }, [])

  const handleSave = useCallback(async () => {
    if (!db || !dirty) return
    setSaving(true)
    setError(null)
    try {
      const ref = doc(db, settingsCollectionName, settingsDocumentId)
      /** @type {Record<string, unknown>} */
      const payload = { updatedAt: serverTimestamp() }
      for (const stateKey of /** @type {(keyof typeof APP_SETTINGS_FIELDS)[]} */ (
        Object.keys(APP_SETTINGS_FIELDS)
      )) {
        const fk = APP_SETTINGS_FIELDS[stateKey]
        payload[fk] = values[stateKey]
      }
      await setDoc(ref, payload, { merge: true })
      setSaved({ ...values })
    } catch (e) {
      setError(e?.message || 'Failed to save settings')
    } finally {
      setSaving(false)
    }
  }, [values, dirty])

  // Explicit, admin-triggered write to the otherwise-read-only chat bot
  // usage fields — distinct from handleSave, which never touches them (see
  // parseChatBotStatus above).
  const handleResetChatBotSpend = useCallback(async () => {
    if (!db) return
    setResetSpendBusy(true)
    setError(null)
    try {
      const ref = doc(db, settingsCollectionName, settingsDocumentId)
      const resetDate = new Date().toISOString().slice(0, 10)
      await setDoc(
        ref,
        {
          aiChatBotTodayCostUsd: 0,
          aiChatBotDailyCapReached: false,
          aiChatBotCostDate: resetDate,
          updatedAt: serverTimestamp(),
        },
        { merge: true },
      )
      setChatBotStatus({
        aiChatBotTodayCostUsd: 0,
        aiChatBotDailyCapReached: false,
        aiChatBotCostDate: resetDate,
      })
      setResetSpendConfirmOpen(false)
    } catch (e) {
      setError(e?.message || "Failed to reset today's AI spend")
    } finally {
      setResetSpendBusy(false)
    }
  }, [])

  const todayIso = new Date().toISOString().slice(0, 10)

  return (
    <div className="min-h-[calc(100vh-3rem)] bg-gradient-to-b from-emerald-50/35 via-slate-50/90 to-slate-100/80 px-4 py-6 sm:px-6 lg:px-8 lg:py-10">
      <header className="mx-auto mb-8 max-w-3xl">
        <div className="flex items-start gap-3 sm:items-center sm:gap-4">
          <div className="flex size-12 shrink-0 items-center justify-center rounded-2xl bg-white shadow-lg shadow-emerald-900/[0.06] ring-1 ring-emerald-100/90">
            <Settings
              className="size-6 text-emerald-600"
              strokeWidth={2}
              aria-hidden
            />
          </div>
          <div>
            <div className="flex flex-wrap items-center gap-2">
              <h1 className="bg-gradient-to-r from-slate-900 to-slate-700 bg-clip-text text-2xl font-semibold tracking-tight text-transparent sm:text-3xl">
                Settings
              </h1>
              <span className="rounded-full bg-emerald-100 px-2.5 py-0.5 text-[10px] font-bold uppercase tracking-wider text-emerald-900 ring-1 ring-emerald-200/80">
                Live config
              </span>
            </div>
            <p className="mt-1 max-w-xl text-sm text-slate-600">
              App-wide flags: discount screens, App2Web rollout, and the AI
              chat bot.
            </p>
          </div>
        </div>
      </header>

      {error && (
        <div
          role="alert"
          className="mx-auto mb-6 max-w-3xl flex gap-3 rounded-xl border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-800"
        >
          <AlertCircle
            className="mt-0.5 size-4 shrink-0 text-red-600"
            strokeWidth={2}
          />
          <span>{error}</span>
        </div>
      )}

      <div className="mx-auto max-w-3xl space-y-6">
        {loading ? (
          <div className="flex flex-col items-center justify-center gap-4 rounded-2xl border border-slate-200/90 bg-white/90 py-24 shadow-lg shadow-slate-900/[0.04]">
            <Loader2
              className="size-10 animate-spin text-emerald-600"
              strokeWidth={2}
              aria-hidden
            />
            <p className="text-sm font-medium text-slate-600">
              Loading settings…
            </p>
          </div>
        ) : (
          <>
            <SettingsCard
              eyebrow="Discount"
              title="Discount screen"
              description="When enabled, the app may show your discount flow on that platform."
              icon={
                <BadgePercent
                  className="size-5 text-emerald-700"
                  strokeWidth={2}
                  aria-hidden
                />
              }
            >
              <SettingToggle
                id="set-discount-ios"
                title="iOS"
                description="Show the discount screen on iPhone and iPad."
                checked={values.showDiscountScreenIos}
                onChange={(c) => patch({ showDiscountScreenIos: c })}
                disabled={saving}
                icon={
                  <Smartphone
                    className="size-5 text-slate-700"
                    strokeWidth={2}
                    aria-hidden
                  />
                }
              />
              {/*
              <SettingToggle
                id="set-discount-android"
                title="Android"
                description="Show the discount screen on Android devices."
                checked={values.showDiscountScreenAndroid}
                onChange={(c) => patch({ showDiscountScreenAndroid: c })}
                disabled={saving}
                icon={
                  <Tablet
                    className="size-5 text-slate-700"
                    strokeWidth={2}
                    aria-hidden
                  />
                }
              />
              */}
            </SettingsCard>

            <SettingsCard
              eyebrow="Paywall"
              title="App2Web option"
              description="Roll out the App2Web (web checkout) option to a share of users. The app reads app2WebPercentage from remote config and shows the option to that percentage of users."
              icon={
                <Globe
                  className="size-5 text-sky-700"
                  strokeWidth={2}
                  aria-hidden
                />
              }
            >
              <PercentageSlider
                id="set-app2web-percentage"
                title="Show App2Web to a percentage of users"
                description="0% hides it for everyone; 100% shows it to all users. Anything in between is a partial rollout."
                value={values.app2WebPercentage}
                onChange={setApp2WebPercentage}
                disabled={saving}
                icon={
                  <Globe
                    className="size-5 text-slate-700"
                    strokeWidth={2}
                    aria-hidden
                  />
                }
              />
            </SettingsCard>

            <SettingsCard
              eyebrow="AI"
              title="AI chat bot"
              description="Which Claude model powers the in-app chat bot, whether it's enabled, and a daily spend cap."
              icon={
                <Bot
                  className="size-5 text-emerald-700"
                  strokeWidth={2}
                  aria-hidden
                />
              }
            >
              <SettingToggle
                id="set-ai-chat-bot-enabled"
                title="Enable AI chat bot"
                description="When off, the chat bot is hidden from users entirely."
                checked={values.aiChatBotEnabled}
                onChange={(c) => patch({ aiChatBotEnabled: c })}
                disabled={saving}
                icon={
                  <Power
                    className="size-5 text-slate-700"
                    strokeWidth={2}
                    aria-hidden
                  />
                }
              />

              <div className="flex flex-col gap-3 rounded-xl border border-slate-100/90 bg-white/80 p-4 shadow-sm ring-1 ring-slate-900/[0.03] sm:flex-row sm:items-center sm:justify-between">
                <div className="flex min-w-0 items-center gap-3">
                  <div className="flex size-10 shrink-0 items-center justify-center rounded-xl bg-gradient-to-br from-slate-50 to-white shadow-sm ring-1 ring-slate-200/80">
                    <Cpu
                      className="size-5 text-slate-700"
                      strokeWidth={2}
                      aria-hidden
                    />
                  </div>
                  <div className="min-w-0">
                    <label
                      htmlFor="set-ai-chat-bot-model"
                      className="text-sm font-semibold text-slate-900"
                    >
                      Model
                    </label>
                    <p className="text-xs leading-snug text-slate-500">
                      Which Claude model powers the chat bot.
                    </p>
                  </div>
                </div>
                <select
                  id="set-ai-chat-bot-model"
                  value={values.aiChatBotModel}
                  onChange={(e) => setAiChatBotModel(e.target.value)}
                  disabled={saving}
                  className="w-full shrink-0 cursor-pointer rounded-lg border border-slate-200 bg-white px-3 py-2 text-sm font-semibold text-slate-900 shadow-sm outline-none transition focus:border-emerald-400 focus:ring-4 focus:ring-emerald-500/15 disabled:opacity-50 sm:w-auto"
                >
                  {AI_CHAT_BOT_MODELS.map((m) => (
                    <option key={m.id} value={m.id}>
                      {m.label}
                    </option>
                  ))}
                </select>
              </div>

              <div className="flex flex-col gap-3 rounded-xl border border-slate-100/90 bg-white/80 p-4 shadow-sm ring-1 ring-slate-900/[0.03] sm:flex-row sm:items-center sm:justify-between">
                <div className="flex min-w-0 items-center gap-3">
                  <div className="flex size-10 shrink-0 items-center justify-center rounded-xl bg-gradient-to-br from-slate-50 to-white shadow-sm ring-1 ring-slate-200/80">
                    <DollarSign
                      className="size-5 text-slate-700"
                      strokeWidth={2}
                      aria-hidden
                    />
                  </div>
                  <div className="min-w-0">
                    <label
                      htmlFor="set-ai-chat-bot-max-cost"
                      className="text-sm font-semibold text-slate-900"
                    >
                      Max cost per day
                    </label>
                    <p className="text-xs leading-snug text-slate-500">
                      Hard cap on total AI spend per day, across all users.
                    </p>
                  </div>
                </div>
                <div className="flex shrink-0 items-center gap-1">
                  <span
                    className="text-sm font-semibold text-slate-500"
                    aria-hidden
                  >
                    $
                  </span>
                  <input
                    id="set-ai-chat-bot-max-cost"
                    type="number"
                    min={0}
                    step={0.01}
                    inputMode="decimal"
                    value={values.aiChatBotMaxCostPerDayUsd}
                    onChange={(e) =>
                      setAiChatBotMaxCostPerDayUsd(e.target.value)
                    }
                    disabled={saving}
                    aria-label="Max cost per day in US dollars"
                    className="w-24 rounded-lg border border-slate-200 bg-white px-2 py-1.5 text-right text-sm font-semibold tabular-nums text-slate-900 shadow-sm outline-none transition focus:border-emerald-400 focus:ring-4 focus:ring-emerald-500/15 disabled:opacity-50"
                  />
                  <span
                    className="text-sm font-semibold text-slate-500"
                    aria-hidden
                  >
                    / day
                  </span>
                </div>
              </div>

              <div className="rounded-xl border border-slate-100/90 bg-white/80 p-4 shadow-sm ring-1 ring-slate-900/[0.03]">
                <div className="flex items-start justify-between gap-3">
                  <div className="flex min-w-0 items-center gap-3">
                    <div className="flex size-10 shrink-0 items-center justify-center rounded-xl bg-gradient-to-br from-slate-50 to-white shadow-sm ring-1 ring-slate-200/80">
                      <Gauge
                        className="size-5 text-slate-700"
                        strokeWidth={2}
                        aria-hidden
                      />
                    </div>
                    <div className="min-w-0">
                      <p className="text-sm font-semibold text-slate-900">
                        Today's spend
                      </p>
                      <p className="text-xs leading-snug text-slate-500">
                        Live usage tracked by the chat bot — read-only here.
                      </p>
                    </div>
                  </div>
                  <span
                    className={`inline-flex shrink-0 items-center gap-1.5 rounded-full px-2.5 py-1 text-xs font-bold ring-1 ${
                      chatBotStatus.aiChatBotDailyCapReached
                        ? 'bg-rose-50 text-rose-800 ring-rose-200'
                        : 'bg-emerald-50 text-emerald-800 ring-emerald-200/80'
                    }`}
                  >
                    {chatBotStatus.aiChatBotDailyCapReached ? (
                      <>
                        <AlertTriangle
                          className="size-3.5 shrink-0"
                          strokeWidth={2.25}
                          aria-hidden
                        />
                        Cap reached
                      </>
                    ) : (
                      'Under cap'
                    )}
                  </span>
                </div>

                <div className="mt-3">
                  <div className="flex items-baseline justify-between gap-2">
                    <span className="text-lg font-bold tabular-nums text-slate-900">
                      ${chatBotStatus.aiChatBotTodayCostUsd.toFixed(4)}
                    </span>
                    <span className="text-xs font-medium text-slate-500">
                      of ${values.aiChatBotMaxCostPerDayUsd.toFixed(2)} / day
                    </span>
                  </div>
                  <div
                    className="mt-1.5 h-2 w-full overflow-hidden rounded-full bg-slate-100"
                    role="progressbar"
                    aria-valuenow={Math.round(chatBotSpendPct)}
                    aria-valuemin={0}
                    aria-valuemax={100}
                    aria-label="Today's AI chat bot spend, percent of daily cap"
                  >
                    <div
                      className={`h-full rounded-full transition-all ${
                        chatBotStatus.aiChatBotDailyCapReached
                          ? 'bg-rose-500'
                          : 'bg-emerald-500'
                      }`}
                      style={{ width: `${chatBotSpendPct}%` }}
                    />
                  </div>
                </div>

                <div className="mt-2 flex items-center justify-between gap-2">
                  <p className="text-[11px] leading-snug text-slate-500">
                    {chatBotStatus.aiChatBotCostDate
                      ? `As of ${chatBotStatus.aiChatBotCostDate}${
                          chatBotStatus.aiChatBotCostDate === todayIso
                            ? ' (today)'
                            : ''
                        } — resets daily.`
                      : 'No spend recorded yet.'}
                  </p>
                  <button
                    type="button"
                    onClick={() => setResetSpendConfirmOpen(true)}
                    className="inline-flex shrink-0 cursor-pointer items-center gap-1 rounded-lg px-2 py-1 text-[11px] font-semibold text-slate-600 transition hover:bg-slate-100 hover:text-slate-900 focus:outline-none focus-visible:ring-2 focus-visible:ring-slate-400"
                  >
                    <RotateCcw
                      className="size-3 shrink-0"
                      strokeWidth={2.25}
                      aria-hidden
                    />
                    Reset
                  </button>
                </div>
              </div>

              <div className="rounded-xl border border-dashed border-slate-200/90 bg-slate-50/70 p-4">
                <p className="text-xs font-semibold text-slate-600">
                  Estimated cost per prompt — {estimatedPromptCost.label}
                </p>
                <p className="mt-1 text-lg font-bold tabular-nums text-slate-900">
                  ${estimatedPromptCost.usd.toFixed(4)}
                </p>
                <p className="mt-1 text-[11px] leading-snug text-slate-500">
                  Based on a 700-token prompt at this model's input price.
                  The reply is billed separately, at a higher per-token rate.
                </p>
              </div>
            </SettingsCard>

            <div className="sticky bottom-4 z-10 flex flex-col gap-3 rounded-2xl border border-slate-200/90 bg-white/95 px-4 py-4 shadow-[0_8px_40px_-12px_rgba(15,23,42,0.2)] backdrop-blur-md sm:flex-row sm:items-center sm:justify-between sm:px-5">
              <p className="text-sm font-medium text-slate-800">
                {dirty ? 'Unsaved changes' : 'All changes saved'}
              </p>
              <button
                type="button"
                onClick={handleSave}
                disabled={!dirty || saving}
                className="inline-flex cursor-pointer items-center justify-center gap-2 rounded-xl bg-gradient-to-b from-emerald-500 to-emerald-600 px-5 py-2.5 text-sm font-semibold text-white shadow-lg shadow-emerald-900/20 transition hover:from-emerald-600 hover:to-emerald-700 focus:outline-none focus-visible:ring-2 focus-visible:ring-emerald-500 focus-visible:ring-offset-2 disabled:cursor-not-allowed disabled:opacity-45"
              >
                {saving ? (
                  <>
                    <Loader2
                      className="size-4 animate-spin"
                      strokeWidth={2}
                      aria-hidden
                    />
                    Saving…
                  </>
                ) : (
                  <>
                    <Save className="size-4" strokeWidth={2} aria-hidden />
                    Save changes
                  </>
                )}
              </button>
            </div>

            <details className="rounded-xl border border-dashed border-slate-200/90 bg-slate-50/80 p-3">
              <summary className="cursor-pointer list-none text-xs font-medium text-slate-500 marker:content-none [&::-webkit-details-marker]:hidden">
                Dev
              </summary>
              <pre className="mt-2 overflow-x-auto rounded-lg border border-slate-200 bg-white p-3 font-mono text-[11px] leading-relaxed text-slate-800">
                {`{
  "showDiscountScreenIos": false,
  "showDiscountScreenAndroid": false,
  "app2WebPercentage": 0,
  "aiChatBotEnabled": false,
  "aiChatBotModel": "claude-sonnet-5",
  "aiChatBotMaxCostPerDayUsd": 10,
  "aiChatBotTodayCostUsd": 0,
  "aiChatBotCostDate": "<YYYY-MM-DD, written by the chat bot backend>",
  "aiChatBotDailyCapReached": false,
  "updatedAt": "<Firestore Timestamp>"
}`}
              </pre>
            </details>
          </>
        )}
      </div>

      {resetSpendConfirmOpen ? (
        <ResetChatBotSpendModal
          busy={resetSpendBusy}
          onCancel={() => {
            if (!resetSpendBusy) setResetSpendConfirmOpen(false)
          }}
          onConfirm={handleResetChatBotSpend}
        />
      ) : null}
    </div>
  )
}
