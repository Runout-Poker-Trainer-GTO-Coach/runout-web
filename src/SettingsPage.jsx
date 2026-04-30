import {
  AlertCircle,
  BadgePercent,
  Infinity as InfinityIcon,
  Loader2,
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
  applyBulkUnlimitedDisable,
  applyBulkUnlimitedEnable,
} from './bulkUnlimitedSessions.js'
import {
  db,
  firebaseReady,
  settingsCollectionName,
  settingsDocumentId,
  usersCollectionName,
} from './firebase'
import {
  APP_SETTINGS_DEFAULTS,
  APP_SETTINGS_FIELDS,
} from './settingsConstants.js'

/**
 * @param {Record<string, unknown> | undefined} data
 */
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
    unlimitedSessions: t(APP_SETTINGS_FIELDS.unlimitedSessions),
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

export default function SettingsPage() {
  const [loading, setLoading] = useState(!!firebaseReady)
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState(/** @type {string | null} */ (null))

  const [values, setValues] = useState(() => ({ ...APP_SETTINGS_DEFAULTS }))
  const [saved, setSaved] = useState(() => ({ ...APP_SETTINGS_DEFAULTS }))

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
    const prevUnlimited = saved.unlimitedSessions
    const nextUnlimited = values.unlimitedSessions
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
      if (prevUnlimited !== nextUnlimited) {
        if (nextUnlimited) {
          await applyBulkUnlimitedEnable(db, usersCollectionName)
        } else {
          await applyBulkUnlimitedDisable(db, usersCollectionName)
        }
      }
      setSaved({ ...values })
    } catch (e) {
      setError(e?.message || 'Failed to save settings')
    } finally {
      setSaving(false)
    }
  }, [values, dirty, saved.unlimitedSessions])

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
              App-wide flags: discount screens and unlimited training sessions.
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
              eyebrow="Sessions"
              title="Unlimited sessions for everyone"
              description="When on, all users who are not already set to unlimited get unlimited training sessions (tagged so you can revert only that group later). Manual per-user overrides stay respected when you turn this off."
              icon={
                <InfinityIcon
                  className="size-5 text-amber-700"
                  strokeWidth={2}
                  aria-hidden
                />
              }
            >
              <SettingToggle
                id="set-unlimited-sessions-all"
                title="All users — unlimited sessions"
                description="Save to apply: grants unlimited to users who do not already have it, or removes unlimited only from users granted by this toggle (not from manual grants)."
                checked={values.unlimitedSessions}
                onChange={(c) => patch({ unlimitedSessions: c })}
                disabled={saving}
                icon={
                  <InfinityIcon
                    className="size-5 text-slate-700"
                    strokeWidth={2}
                    aria-hidden
                  />
                }
              />
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
  "unlimitedSessions": false,
  "updatedAt": "<Firestore Timestamp>"
}`}
              </pre>
            </details>
          </>
        )}
      </div>
    </div>
  )
}
