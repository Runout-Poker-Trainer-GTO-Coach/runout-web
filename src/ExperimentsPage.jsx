import {
  AlertCircle,
  Check,
  Code2,
  Equal,
  FlaskConical,
  Loader2,
  Save,
  Users,
} from 'lucide-react'
import { useCallback, useEffect, useMemo, useState } from 'react'
import { doc, getDoc, serverTimestamp, setDoc } from 'firebase/firestore'
import {
  db,
  firebaseReady,
  settingsCollectionName,
  settingsDocumentId,
} from './firebase'
import { EXPERIMENTS, EXPERIMENTS_FIELD } from './experimentsConstants.js'
import PercentageSlider from './PercentageSlider.jsx'

/**
 * @param {unknown} v
 * @returns {number}
 */
function clampPct(v) {
  const n = typeof v === 'number' ? v : Number(v)
  if (!Number.isFinite(n)) return 0
  return Math.max(0, Math.min(100, Math.round(n)))
}

/** Default allocation map: { [expKey]: { [doorKey]: pct } }. */
function defaultAllocations() {
  /** @type {Record<string, Record<string, number>>} */
  const out = {}
  for (const exp of EXPERIMENTS) out[exp.key] = { ...exp.defaults }
  return out
}

/** Overlay the stored `experiments` field onto the defaults (clamped). */
function parseExperiments(data) {
  const stored =
    data &&
    typeof data === 'object' &&
    data[EXPERIMENTS_FIELD] &&
    typeof data[EXPERIMENTS_FIELD] === 'object'
      ? /** @type {Record<string, Record<string, unknown>>} */ (
          data[EXPERIMENTS_FIELD]
        )
      : {}
  /** @type {Record<string, Record<string, number>>} */
  const out = {}
  for (const exp of EXPERIMENTS) {
    const s =
      stored[exp.key] && typeof stored[exp.key] === 'object'
        ? stored[exp.key]
        : {}
    /** @type {Record<string, number>} */
    const doors = {}
    for (const d of exp.doors) {
      doors[d.key] = s[d.key] != null ? clampPct(s[d.key]) : exp.defaults[d.key]
    }
    out[exp.key] = doors
  }
  return out
}

/** @param {Record<string, number>} doorValues */
function sumDoors(doorValues) {
  return Object.values(doorValues).reduce((a, b) => a + (Number(b) || 0), 0)
}

/** Distribute 100 across doors as evenly as possible (remainder to the first). */
function evenSplit(doorKeys) {
  const n = doorKeys.length
  const base = Math.floor(100 / n)
  let remainder = 100 - base * n
  /** @type {Record<string, number>} */
  const out = {}
  for (const k of doorKeys) {
    out[k] = base + (remainder > 0 ? 1 : 0)
    if (remainder > 0) remainder--
  }
  return out
}

function deepClone(v) {
  return JSON.parse(JSON.stringify(v))
}

export default function ExperimentsPage() {
  const [loading, setLoading] = useState(!!firebaseReady)
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState(/** @type {string | null} */ (null))
  const [values, setValues] = useState(defaultAllocations)
  const [saved, setSaved] = useState(defaultAllocations)
  const [devMode, setDevMode] = useState(false)
  const [savedDevMode, setSavedDevMode] = useState(false)

  const dirty = useMemo(
    () =>
      JSON.stringify(values) !== JSON.stringify(saved) ||
      devMode !== savedDevMode,
    [values, saved, devMode, savedDevMode],
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
        const data = snap.data()
        const next = parseExperiments(data)
        const dm = data?.[EXPERIMENTS_FIELD]?.devMode === true
        setValues(next)
        setSaved(deepClone(next))
        setDevMode(dm)
        setSavedDevMode(dm)
      } catch (e) {
        if (!cancelled) setError(e?.message || 'Failed to load experiments')
      } finally {
        if (!cancelled) setLoading(false)
      }
    })()
    return () => {
      cancelled = true
    }
  }, [])

  const setDoor = useCallback((expKey, doorKey, raw) => {
    setValues((v) => ({
      ...v,
      [expKey]: { ...v[expKey], [doorKey]: clampPct(raw) },
    }))
  }, [])

  const applyEvenSplit = useCallback((expKey, doorKeys) => {
    setValues((v) => ({ ...v, [expKey]: evenSplit(doorKeys) }))
  }, [])

  const totals = useMemo(() => {
    /** @type {Record<string, number>} */
    const t = {}
    for (const exp of EXPERIMENTS) t[exp.key] = sumDoors(values[exp.key] || {})
    return t
  }, [values])

  const allValid = useMemo(
    () => EXPERIMENTS.every((exp) => totals[exp.key] === 100),
    [totals],
  )

  const handleSave = useCallback(async () => {
    if (!db || !dirty || !allValid) return
    setSaving(true)
    setError(null)
    try {
      const ref = doc(db, settingsCollectionName, settingsDocumentId)
      await setDoc(
        ref,
        {
          [EXPERIMENTS_FIELD]: { ...values, devMode },
          updatedAt: serverTimestamp(),
        },
        { merge: true },
      )
      setSaved(deepClone(values))
      setSavedDevMode(devMode)
    } catch (e) {
      setError(e?.message || 'Failed to save experiments')
    } finally {
      setSaving(false)
    }
  }, [values, devMode, dirty, allValid])

  return (
    <div className="min-h-[calc(100vh-3rem)] bg-gradient-to-b from-blue-50/40 via-slate-50/90 to-slate-100/80 px-4 py-6 sm:px-6 lg:px-8 lg:py-10">
      <header className="mx-auto mb-8 max-w-3xl">
        <div className="flex items-start justify-between gap-4">
          <div className="flex items-start gap-3 sm:items-center sm:gap-4">
            <div className="flex size-12 shrink-0 items-center justify-center rounded-2xl bg-white shadow-lg shadow-blue-900/[0.06] ring-1 ring-blue-100/90">
              <FlaskConical
                className="size-6 text-blue-600"
                strokeWidth={2}
                aria-hidden
              />
            </div>
            <div>
              <div className="flex flex-wrap items-center gap-2">
                <h1 className="bg-gradient-to-r from-slate-900 to-slate-700 bg-clip-text text-2xl font-semibold tracking-tight text-transparent sm:text-3xl">
                  Experiments
                </h1>
                <span className="rounded-full bg-blue-100 px-2.5 py-0.5 text-[10px] font-bold uppercase tracking-wider text-blue-900 ring-1 ring-blue-200/80">
                  Admin only
                </span>
              </div>
              <p className="mt-1 max-w-xl text-sm text-slate-600">
                Paywall A/B tests. Set the percentage split across the doors for
                each audience — every experiment must total 100%.
              </p>
            </div>
          </div>
          <label
            htmlFor="dev-mode-toggle"
            className="flex shrink-0 cursor-pointer select-none items-center gap-2 rounded-xl border border-slate-200 bg-white px-3 py-1.5 shadow-sm transition hover:border-slate-300"
            title="Developer mode — saved in this browser"
          >
            <Code2
              className={`size-4 shrink-0 ${devMode ? 'text-blue-600' : 'text-slate-400'}`}
              strokeWidth={2}
              aria-hidden
            />
            <span className="text-sm font-semibold text-slate-700">Dev Mode</span>
            <span
              className={`text-xs font-semibold tabular-nums ${
                devMode ? 'text-blue-700' : 'text-slate-400'
              }`}
              aria-hidden
            >
              {devMode ? 'true' : 'false'}
            </span>
            <span className="relative inline-flex h-5 w-9 shrink-0 items-center">
              <input
                id="dev-mode-toggle"
                type="checkbox"
                role="switch"
                aria-label="Toggle developer mode"
                checked={devMode}
                onChange={(e) => setDevMode(e.target.checked)}
                disabled={saving}
                className="peer sr-only"
              />
              <span
                className="absolute inset-0 rounded-full bg-slate-200 transition peer-checked:bg-blue-500 peer-focus-visible:outline peer-focus-visible:outline-2 peer-focus-visible:outline-offset-2 peer-focus-visible:outline-blue-500"
                aria-hidden
              />
              <span
                className="pointer-events-none absolute left-0.5 top-0.5 size-4 rounded-full bg-white shadow transition peer-checked:left-[1.125rem]"
                aria-hidden
              />
            </span>
          </label>
        </div>
      </header>

      {error && (
        <div
          role="alert"
          className="mx-auto mb-6 flex max-w-3xl gap-3 rounded-xl border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-800"
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
              className="size-10 animate-spin text-blue-600"
              strokeWidth={2}
              aria-hidden
            />
            <p className="text-sm font-medium text-slate-600">
              Loading experiments…
            </p>
          </div>
        ) : (
          <>
            {EXPERIMENTS.map((exp) => {
              const doorValues = values[exp.key] || {}
              const total = totals[exp.key]
              const valid = total === 100
              return (
                <section
                  key={exp.key}
                  className="overflow-hidden rounded-2xl border border-slate-200/80 bg-white/90 shadow-[0_8px_30px_-12px_rgba(15,23,42,0.08)] ring-1 ring-slate-900/[0.04]"
                >
                  <div className="border-b border-slate-100/90 bg-gradient-to-r from-blue-50/80 via-white to-indigo-50/40 px-5 py-4">
                    <div className="flex items-start gap-3">
                      <div className="flex size-10 shrink-0 items-center justify-center rounded-xl bg-white shadow-sm ring-1 ring-blue-100/90">
                        <FlaskConical
                          className="size-5 text-blue-600"
                          strokeWidth={2}
                          aria-hidden
                        />
                      </div>
                      <div className="min-w-0">
                        <p className="inline-flex items-center gap-1 rounded-full bg-blue-50 px-2 py-0.5 text-[10px] font-bold uppercase tracking-wider text-blue-900 ring-1 ring-blue-200/70">
                          <Users className="size-3 shrink-0" strokeWidth={2.25} aria-hidden />
                          {exp.audience}
                        </p>
                        <h2 className="mt-1 text-base font-semibold tracking-tight text-slate-900">
                          {exp.title}
                        </h2>
                        <p className="mt-1 text-xs leading-relaxed text-slate-600">
                          {exp.description}
                        </p>
                      </div>
                    </div>
                    <div className="mt-3 flex flex-wrap items-center justify-between gap-2">
                      {valid ? (
                        <span className="inline-flex items-center gap-1.5 rounded-lg bg-emerald-50 px-2.5 py-1 text-xs font-semibold text-emerald-800 ring-1 ring-emerald-200/80">
                          <Check className="size-3.5 shrink-0" strokeWidth={2.5} aria-hidden />
                          Splits to 100%
                        </span>
                      ) : (
                        <span className="inline-flex items-center gap-1.5 rounded-lg bg-amber-50 px-2.5 py-1 text-xs font-semibold text-amber-800 ring-1 ring-amber-200/80">
                          <AlertCircle className="size-3.5 shrink-0" strokeWidth={2.25} aria-hidden />
                          Total {total}% —{' '}
                          {total > 100
                            ? `${total - 100}% over`
                            : `${100 - total}% left`}
                        </span>
                      )}
                      <button
                        type="button"
                        onClick={() =>
                          applyEvenSplit(
                            exp.key,
                            exp.doors.map((d) => d.key),
                          )
                        }
                        disabled={saving}
                        className="inline-flex cursor-pointer items-center gap-1.5 rounded-lg border border-slate-200 bg-white px-2.5 py-1 text-xs font-semibold text-slate-700 shadow-sm transition hover:border-slate-300 hover:bg-slate-50 focus:outline-none focus-visible:ring-2 focus-visible:ring-blue-500 focus-visible:ring-offset-2 disabled:cursor-not-allowed disabled:opacity-50"
                      >
                        <Equal className="size-3.5 shrink-0" strokeWidth={2.25} aria-hidden />
                        Even split
                      </button>
                    </div>
                  </div>
                  <div className="space-y-3 p-5">
                    {exp.doors.map((door, i) => (
                      <PercentageSlider
                        key={door.key}
                        id={`exp-${exp.key}-${door.key}`}
                        title={door.label}
                        description={door.description}
                        value={doorValues[door.key] ?? 0}
                        onChange={(raw) => setDoor(exp.key, door.key, raw)}
                        disabled={saving}
                        icon={
                          <span className="text-sm font-bold tabular-nums text-blue-700">
                            {i + 1}
                          </span>
                        }
                      />
                    ))}
                  </div>
                </section>
              )
            })}

            <div className="sticky bottom-4 z-10 flex flex-col gap-3 rounded-2xl border border-slate-200/90 bg-white/95 px-4 py-4 shadow-[0_8px_40px_-12px_rgba(15,23,42,0.2)] backdrop-blur-md sm:flex-row sm:items-center sm:justify-between sm:px-5">
              <p className="text-sm font-medium text-slate-800">
                {!allValid
                  ? 'Each experiment must total 100% before saving'
                  : dirty
                    ? 'Unsaved changes'
                    : 'All changes saved'}
              </p>
              <button
                type="button"
                onClick={handleSave}
                disabled={!dirty || !allValid || saving}
                className="inline-flex cursor-pointer items-center justify-center gap-2 rounded-xl bg-gradient-to-b from-blue-600 to-blue-700 px-5 py-2.5 text-sm font-semibold text-white shadow-lg shadow-blue-900/20 transition hover:from-blue-700 hover:to-blue-800 focus:outline-none focus-visible:ring-2 focus-visible:ring-blue-500 focus-visible:ring-offset-2 disabled:cursor-not-allowed disabled:opacity-45"
              >
                {saving ? (
                  <>
                    <Loader2 className="size-4 animate-spin" strokeWidth={2} aria-hidden />
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
          </>
        )}
      </div>
    </div>
  )
}
