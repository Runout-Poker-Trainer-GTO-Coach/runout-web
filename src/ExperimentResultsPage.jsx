import {
  BarElement,
  CategoryScale,
  Chart as ChartJS,
  Legend,
  LinearScale,
  Tooltip,
} from 'chart.js'
import {
  AlertCircle,
  AlertTriangle,
  BarChart3,
  ChevronDown,
  CircleCheck,
  CircleX,
  Clock,
  HelpCircle,
  Info,
  Loader2,
  Minus,
  Percent,
  Play,
  RefreshCw,
  TrendingDown,
  TrendingUp,
} from 'lucide-react'
import { useCallback, useEffect, useMemo, useState } from 'react'
import { Bar } from 'react-chartjs-2'

ChartJS.register(BarElement, CategoryScale, LinearScale, Tooltip, Legend)

/**
 * Set to true to preview the charts with illustrative dummy data shaped
 * like a real purchase_summary() response — useful while paywall_offer's
 * own real numbers are still all-zero (see
 * PokerGame/docs/paywall-offer-trials-and-arms.md's rollout note). As of
 * 2026-09-08, real data is live: 50 assigned, 0 purchasers across all 7
 * arms — accurate, just not yet visually interesting to chart.
 */
const USE_DUMMY_CHART_DATA = false

/** Shaped exactly like a real purchase_summary() response — same field
 *  names, same arm list as paywall-offer-trials-and-arms.md's 7 arms — but
 *  with illustrative numbers standing in for real (still near-zero)
 *  purchase volume. */
const DUMMY_PURCHASE_SUMMARY = {
  experiment: 'paywall_offer',
  total_assigned: 4820,
  low_sample: false,
  arms: [
    { name: 'control', note: 'Baseline main paywall, default RevenueCat offering. No trial, no discount.', assigned: 720, assigned_pct: 14.9, viewers: 612, view_rate: 0.85, subscribed: 61, subscribe_rate: 0.0997, subscribed_trials: null, purchasers: 61, purchasers_from_trial: null, trials_ongoing: null, conv_rate: 0.0997, revenue_usd: 2621.0, arpu: 3.6403, arppu_usd: 42.97, delta_vs_control_pct: null, product_split: [{ product_id: 'annual', count: 40, pct: 65.6 }, { product_id: 'monthly', count: 21, pct: 34.4 }] },
    { name: 'app2web_discount', note: 'US-only, not a trial. Same main paywall as control plus a "Save 50%" web checkout button.', assigned: 690, assigned_pct: 14.3, viewers: 588, view_rate: 0.85, subscribed: 71, subscribe_rate: 0.1207, subscribed_trials: null, purchasers: 71, purchasers_from_trial: null, trials_ongoing: null, conv_rate: 0.1207, revenue_usd: 2698.0, arpu: 3.9101, arppu_usd: 38.0, delta_vs_control_pct: 21.1, product_split: [{ product_id: 'annual', count: 71, pct: 100.0 }] },
    { name: 'discount_trial_weekly', note: 'The "hidden" trial arm — same main paywall as control, but shows a weekly-trial discount on cancel.', assigned: 705, assigned_pct: 14.6, viewers: 601, view_rate: 0.85, subscribed: 118, subscribe_rate: 0.1963, subscribed_trials: 34, purchasers: 84, purchasers_from_trial: 12, trials_ongoing: 16, conv_rate: 0.1398, revenue_usd: 3057.6, arpu: 4.3369, arppu_usd: 36.4, delta_vs_control_pct: 40.2, product_split: [{ product_id: 'annual', count: 50, pct: 59.5 }, { product_id: 'weekly_trial', count: 34, pct: 40.5 }], trial_metrics: { trials_started: 34, trials_converted: 12, trials_cancelled: 6, trial_conv_rate: 0.3529, trial_cancel_rate: 0.1765 } },
    { name: 'yearly_high', note: 'Price-elasticity test on the annual plan: $139.99/year instead of control’s standard annual price.', assigned: 680, assigned_pct: 14.1, viewers: 579, view_rate: 0.85, subscribed: 45, subscribe_rate: 0.0777, subscribed_trials: null, purchasers: 45, purchasers_from_trial: null, trials_ongoing: null, conv_rate: 0.0777, revenue_usd: 3006.0, arpu: 4.4206, arppu_usd: 66.8, delta_vs_control_pct: -22.1, product_split: [{ product_id: 'annual_high', count: 45, pct: 100.0 }] },
    { name: 'trial_yearly', note: 'Leads with the free-trial paywall, emphasised plan: yearly.', assigned: 685, assigned_pct: 14.2, viewers: 583, view_rate: 0.85, subscribed: 220, subscribe_rate: 0.3774, subscribed_trials: 180, purchasers: 96, purchasers_from_trial: 96, trials_ongoing: 44, conv_rate: 0.1647, revenue_usd: 1996.8, arpu: 2.9152, arppu_usd: 20.8, delta_vs_control_pct: 65.2, product_split: [{ product_id: 'annual', count: 96, pct: 100.0 }], trial_metrics: { trials_started: 180, trials_converted: 96, trials_cancelled: 40, trial_conv_rate: 0.5333, trial_cancel_rate: 0.2222 } },
    { name: 'trial_monthly', note: 'Leads with the free-trial paywall, emphasised plan: monthly.', assigned: 675, assigned_pct: 14.0, viewers: 574, view_rate: 0.85, subscribed: 205, subscribe_rate: 0.3572, subscribed_trials: 170, purchasers: 89, purchasers_from_trial: 89, trials_ongoing: 46, conv_rate: 0.155, revenue_usd: 1157.0, arpu: 1.714, arppu_usd: 13.0, delta_vs_control_pct: 55.5, product_split: [{ product_id: 'monthly', count: 89, pct: 100.0 }], trial_metrics: { trials_started: 170, trials_converted: 89, trials_cancelled: 35, trial_conv_rate: 0.5235, trial_cancel_rate: 0.2059 } },
    { name: 'trial_weekly', note: 'Leads with the free-trial paywall, emphasised plan: weekly.', assigned: 665, assigned_pct: 13.8, viewers: 566, view_rate: 0.85, subscribed: 190, subscribe_rate: 0.3357, subscribed_trials: 150, purchasers: 78, purchasers_from_trial: 78, trials_ongoing: 42, conv_rate: 0.1378, revenue_usd: 623.9, arpu: 0.9382, arppu_usd: 8.0, delta_vs_control_pct: 38.2, product_split: [{ product_id: 'weekly', count: 78, pct: 100.0 }], trial_metrics: { trials_started: 150, trials_converted: 78, trials_cancelled: 30, trial_conv_rate: 0.52, trial_cancel_rate: 0.2 } },
  ],
  conversion_window_days: 7,
  revenue_basis_note:
    'Dummy data — illustrative only, shaped like a real purchase_summary() response. Not live paywall_offer results.',
}

/** Human-readable labels for each arm slug — the "Dev label" column from
 *  paywall-offer-trials-and-arms.md's arm table, used verbatim rather than
 *  invented here. Falls back to the raw slug for any arm not in this list
 *  (a new arm shipped before this map was updated, or the "(none)" bucket). */
const ARM_LABELS = {
  control: 'Control',
  app2web_discount: 'App2Web trial',
  discount_trial_weekly: 'Weekly popup',
  trial_yearly: 'Trial · Yearly',
  trial_monthly: 'Trial · Monthly',
  trial_weekly: 'Trial · Weekly',
  yearly_high: 'Yearly $139.99',
}

function armLabel(name) {
  return ARM_LABELS[name] ?? name
}

/** The three arms that lead with the free-trial paywall — grouped at the
 *  bottom of every table on this page (see sortArmsControlFirst) since
 *  they share a distinct flow from every other arm and read more clearly
 *  together than interleaved with the main-paywall arms. */
const LEAD_WITH_TRIAL_ARMS = new Set(['trial_monthly', 'trial_weekly', 'trial_yearly'])

/** Arms with no real trial mechanism at all (mirrors the backend's own
 *  _NO_TRIAL_ARMS in experiments.py — pure main-paywall arms per
 *  ARM_NOTES, no trial path). Their rc_trial_started_event counts in the
 *  Trial economics table (control: 2, yearly_high: 4, live 2026-09-23) are
 *  edge-case/fallback contamination, not real trial activity for these
 *  arms — filtered out of that table specifically so it isn't misread as
 *  "control has trials too". Frontend-only: the backend's trial_summary()
 *  keeps returning these rows unfiltered in case another consumer needs
 *  the raw counts. */
const NO_TRIAL_ARMS = new Set(['control', 'yearly_high'])

/** Control first, the lead-with-trial arms last, everything else in
 *  between in the order the API returned it — every table on this page
 *  reads control as the natural baseline to scan first, and groups the
 *  free-trial-flow arms together at the end since they're a distinct flow
 *  from the rest. */
function sortArmsControlFirst(arms) {
  return [...arms].sort((a, b) => {
    if (a.name === 'control') return -1
    if (b.name === 'control') return 1
    const aTrial = LEAD_WITH_TRIAL_ARMS.has(a.name)
    const bTrial = LEAD_WITH_TRIAL_ARMS.has(b.name)
    if (aTrial && !bTrial) return 1
    if (!aTrial && bTrial) return -1
    return 0
  })
}

/**
 * Live results for the `paywall_offer` experiment — the single, global
 * paywall/pricing test (see PokerGame/docs/paywall-offer-trials-and-arms.md).
 * Purchase/trial/LTV/churn figures come from RevenueCat's server-verified
 * events, joined to each user's arm via their first arm-stamped
 * paywall_viewed — never the client-fired paywall_purchase event, which can
 * diverge from what RevenueCat actually confirms was paid.
 *
 * Talks to Mixpanel server-side only (the Query API secret never reaches
 * the browser). See runout-chatbot/app/experiments.py + app/main.py's
 * /admin/experiments* routes for the actual query logic.
 */
const EXPERIMENTS_API_BASE = 'https://coach-api-tv3w6ws4bq-uc.a.run.app'

/** Below this many assigned users, a report is flagged low-sample rather
 *  than hidden — matches the backend's own LOW_SAMPLE_THRESHOLD. */
const LOW_SAMPLE_THRESHOLD = 1000

function pct(n) {
  return n == null ? '—' : `${(n * 100).toFixed(1)}%`
}

function usd(n) {
  return n == null ? '—' : `$${n.toFixed(2)}`
}

/** Shared fetch: throws with the backend's own error message when present,
 *  otherwise returns parsed JSON. Every route is all-time/all-geo with no
 *  query params — see app/experiments.py's module docstring for why. */
function fetchJson(path) {
  return fetch(`${EXPERIMENTS_API_BASE}${path}`).then((res) => {
    if (!res.ok) {
      return res.json().then((body) => {
        throw new Error(body?.detail?.message || `Request to ${path} returned ${res.status}`)
      })
    }
    return res.json()
  })
}

export default function ExperimentResultsPage() {
  const [discovery, setDiscovery] = useState(
    /** @type {Record<string, unknown> | null} */ (null),
  )
  const [discoveryLoading, setDiscoveryLoading] = useState(true)
  const [discoveryError, setDiscoveryError] = useState(
    /** @type {string | null} */ (null),
  )
  const [refreshNonce, setRefreshNonce] = useState(0)

  // Pure fetch — callers set loading/error before invoking, so each call
  // site's setState calls stay directly visible in the effect/handler that
  // makes them (see GlossaryPage.jsx for the same pattern + rationale).
  const loadDiscovery = useCallback(() => {
    return fetch(`${EXPERIMENTS_API_BASE}/admin/experiments`)
      .then((res) => {
        if (!res.ok) throw new Error(`Discovery request returned ${res.status}`)
        return res.json()
      })
      .then((data) => {
        setDiscovery(data)
      })
      .catch((e) => {
        setDiscoveryError(e?.message || 'Failed to load experiment')
      })
      .finally(() => {
        setDiscoveryLoading(false)
      })
  }, [])

  const refreshAll = useCallback(() => {
    setDiscoveryLoading(true)
    setDiscoveryError(null)
    loadDiscovery()
    setRefreshNonce((n) => n + 1)
  }, [loadDiscovery])

  // No setLoading(true)/setError(null) here — `loading` already starts
  // true and `error` starts null, so resetting them on mount would be a
  // redundant synchronous setState inside the effect body.
  useEffect(() => {
    loadDiscovery()
  }, [loadDiscovery])

  const lowSample = Boolean(discovery?.low_sample)

  return (
    <div className="px-4 py-6 sm:px-6 lg:px-8 lg:py-8">
      <header className="mb-8 flex flex-col gap-5 lg:flex-row lg:items-end lg:justify-between">
        <div className="flex items-start gap-3 sm:items-center sm:gap-4">
          <div className="flex size-11 shrink-0 items-center justify-center rounded-xl bg-white shadow-md shadow-slate-900/[0.04] ring-1 ring-slate-200/90 sm:size-12">
            <BarChart3
              className="size-5 text-indigo-600 sm:size-6"
              strokeWidth={2}
              aria-hidden
            />
          </div>
          <div>
            <h1 className="text-2xl font-semibold tracking-tight text-slate-900 sm:text-3xl">
              Experiment Results
            </h1>
            <p className="mt-1 flex flex-wrap items-center gap-2 text-sm text-slate-600">
              <span className="rounded-md bg-slate-100 px-1.5 py-0.5 font-mono text-xs font-semibold text-slate-700">
                paywall_offer
              </span>
              {discovery ? (
                <span className="inline-flex items-center gap-1.5">
                  <span className="inline-flex size-1.5 rounded-full bg-indigo-500" />
                  {`${discovery.assignments} assigned (all-time)`}
                  {discovery.arms?.length ? ` · ${discovery.arms.length} arms` : ''}
                </span>
              ) : !discoveryLoading ? (
                <span>Live results, RevenueCat-verified</span>
              ) : null}
              {lowSample ? (
                <span
                  className="inline-flex items-center gap-1 rounded-full bg-amber-50 px-2 py-0.5 text-[11px] font-semibold text-amber-800 ring-1 ring-amber-200/80"
                  title={`Fewer than ${LOW_SAMPLE_THRESHOLD} assignments — read with caution`}
                >
                  <AlertTriangle className="size-3 shrink-0" strokeWidth={2.25} aria-hidden />
                  Low sample
                </span>
              ) : null}
            </p>
          </div>
        </div>
        <div className="flex flex-col gap-3 sm:flex-row sm:flex-wrap sm:items-stretch">
          <button
            type="button"
            onClick={refreshAll}
            disabled={discoveryLoading}
            title="Re-fetch everything"
            className="inline-flex shrink-0 cursor-pointer items-center justify-center gap-1.5 rounded-lg border border-slate-200 bg-white px-3 py-2 text-sm font-semibold text-slate-700 shadow-sm transition hover:border-indigo-300 hover:bg-indigo-50 hover:text-indigo-700 focus:outline-none focus-visible:ring-2 focus-visible:ring-indigo-500 disabled:cursor-not-allowed disabled:opacity-50"
          >
            <RefreshCw
              className={`size-4 shrink-0 ${discoveryLoading ? 'animate-spin' : ''}`}
              strokeWidth={2.25}
              aria-hidden
            />
          </button>
        </div>
      </header>

      {discoveryError ? (
        <div
          role="alert"
          className="mb-6 flex gap-3 rounded-xl border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-800"
        >
          <AlertCircle className="mt-0.5 size-4 shrink-0 text-red-600" strokeWidth={2} />
          <span>{discoveryError}</span>
        </div>
      ) : null}

      <TrialKpiCards refreshNonce={refreshNonce} />

      <div className="flex flex-col gap-6">
        <Section title="Purchase funnel" subtitle="All-time · exposure → paid · revenue, ARPU (RevenueCat-verified)">
          <PurchaseFunnelSection refreshNonce={refreshNonce} />
        </Section>

        <Section title="App2Web trial vs control · US only, by store" subtitle="All-time · US users · web purchases (STRIPE / RC_BILLING) vs in-app (APP_STORE / PLAY_STORE)">
          <UsTrialVsControlSection refreshNonce={refreshNonce} />
        </Section>

        <Section title="Trial economics" subtitle="All-time · rc_trial_started_event → converted → cancelled, by arm">
          <TrialSection refreshNonce={refreshNonce} />
        </Section>

        <Section title="Lifetime value" subtitle="All-time · average cumulative revenue per paying user, including renewals">
          <LtvSection refreshNonce={refreshNonce} />
        </Section>

        <Section title="Churn" subtitle="All-time · cancellation / expiration rates against the paying base">
          <ChurnSection refreshNonce={refreshNonce} />
        </Section>
      </div>
    </div>
  )
}

/**
 * A single top-line KPI card: colored gradient panel with an icon, an
 * uppercase label, a large number, and an optional subtitle line. Same
 * visual pattern as the Questions page's KpiCard, kept local here rather
 * than shared so this page has no cross-page import coupling.
 * @param {{ tone: 'sky' | 'emerald' | 'slate' | 'rose' | 'indigo', icon: import('react').ReactNode, label: string, value: string | number, sub?: string }} props
 */
function KpiCard({ tone, icon, label, value, sub }) {
  const toneCls = {
    sky: 'bg-gradient-to-br from-sky-50 to-white text-sky-900 ring-sky-100',
    emerald: 'bg-gradient-to-br from-emerald-50 to-white text-emerald-900 ring-emerald-100',
    slate: 'bg-gradient-to-br from-slate-100 to-white text-slate-900 ring-slate-200',
    rose: 'bg-gradient-to-br from-rose-50 to-white text-rose-900 ring-rose-100',
    indigo: 'bg-gradient-to-br from-indigo-50 to-white text-indigo-900 ring-indigo-100',
  }[tone]
  const iconCls = {
    sky: 'bg-sky-100 text-sky-700',
    emerald: 'bg-emerald-100 text-emerald-700',
    slate: 'bg-slate-200 text-slate-700',
    rose: 'bg-rose-100 text-rose-700',
    indigo: 'bg-indigo-100 text-indigo-700',
  }[tone]
  return (
    <div className={`rounded-2xl border border-slate-200 p-4 shadow-sm ring-1 ${toneCls}`}>
      <div className="flex items-center gap-3">
        <div className={`flex size-10 shrink-0 items-center justify-center rounded-xl shadow-sm ${iconCls}`}>
          {icon}
        </div>
        <div className="min-w-0">
          <p className="text-[11px] font-semibold uppercase tracking-wider text-slate-500">
            {label}
          </p>
          <p className="mt-0.5 text-2xl font-bold tabular-nums">
            {typeof value === 'number' ? value.toLocaleString() : value}
          </p>
          {sub ? <p className="text-[11px] tabular-nums text-slate-500">{sub}</p> : null}
        </div>
      </div>
    </div>
  )
}

/**
 * App-wide, all-time trial totals as a row of KPI cards at the top of the
 * page: trials started → converted → still waiting → cancelled, plus the
 * overall conversion rate. Uses /admin/experiments/trial-totals, which
 * counts EVERY user's trial events across the whole app — NOT scoped to
 * paywall_offer or any arm (so these totals are much larger than the
 * per-arm sums in the Trial economics table below, which only count
 * arm-attributed users). "Waiting" = started but neither converted nor
 * cancelled yet (computed per user on the backend).
 * @param {{ refreshNonce: number }} props
 */
function TrialKpiCards({ refreshNonce }) {
  const [data, setData] = useState(/** @type {Record<string, unknown> | null} */ (null))
  const [error, setError] = useState(/** @type {string | null} */ (null))

  const fetchTotals = useCallback((cancelledRef) => {
    setError(null)
    return fetchJson('/admin/experiments/trial-totals')
      .then((d) => {
        if (!cancelledRef.current) setData(d)
      })
      .catch((e) => {
        if (!cancelledRef.current) setError(e?.message || 'Failed to load trial totals')
      })
  }, [])

  useEffect(() => {
    const cancelledRef = { current: false }
    queueMicrotask(() => fetchTotals(cancelledRef))
    return () => {
      cancelledRef.current = true
    }
  }, [fetchTotals, refreshNonce])

  const totals = useMemo(() => {
    const started = Number(data?.started) || 0
    const converted = Number(data?.converted) || 0
    const cancelled = Number(data?.cancelled) || 0
    const waiting = Number(data?.waiting) || 0
    const convRate = data?.conv_rate != null ? Number(data.conv_rate) : started > 0 ? converted / started : null
    return { started, converted, cancelled, waiting, convRate }
  }, [data])

  if (error || !data) return null

  return (
    <div className="mb-6 grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-5">
      <KpiCard
        tone="sky"
        icon={<Play className="size-5" strokeWidth={2.25} aria-hidden />}
        label="Trials started"
        value={totals.started}
        sub="all-time, app-wide"
      />
      <KpiCard
        tone="emerald"
        icon={<CircleCheck className="size-5" strokeWidth={2.25} aria-hidden />}
        label="Converted"
        value={totals.converted}
        sub={
          totals.started > 0
            ? `${((totals.converted / totals.started) * 100).toFixed(1)}% of started`
            : undefined
        }
      />
      <KpiCard
        tone="slate"
        icon={<Clock className="size-5" strokeWidth={2.25} aria-hidden />}
        label="Still waiting"
        value={totals.waiting}
        sub={
          totals.started > 0
            ? `${((totals.waiting / totals.started) * 100).toFixed(1)}% of started`
            : undefined
        }
      />
      <KpiCard
        tone="rose"
        icon={<CircleX className="size-5" strokeWidth={2.25} aria-hidden />}
        label="Cancelled"
        value={totals.cancelled}
        sub={
          totals.started > 0
            ? `${((totals.cancelled / totals.started) * 100).toFixed(1)}% of started`
            : undefined
        }
      />
      <KpiCard
        tone="indigo"
        icon={<Percent className="size-5" strokeWidth={2.25} aria-hidden />}
        label="Conversion rate"
        value={totals.convRate != null ? `${(totals.convRate * 100).toFixed(1)}%` : '—'}
        sub="converted ÷ started"
      />
    </div>
  )
}

/**
 * @param {{ title: string, subtitle: string, children: import('react').ReactNode }} props
 */
function Section({ title, subtitle, children }) {
  return (
    <section className="overflow-hidden rounded-2xl border border-slate-200/90 bg-white shadow-sm ring-1 ring-slate-900/[0.02]">
      <div className="border-b border-slate-100 bg-slate-50/60 px-4 py-3.5 sm:px-5">
        <h2 className="text-sm font-semibold text-slate-900">{title}</h2>
        <p className="mt-0.5 text-xs text-slate-500">{subtitle}</p>
      </div>
      <div className="p-4 sm:p-5">{children}</div>
    </section>
  )
}

function LoadingRow({ label }) {
  return (
    <div className="flex items-center justify-center gap-2.5 py-10 text-sm text-slate-500">
      <Loader2 className="size-4 animate-spin" strokeWidth={2} aria-hidden />
      {label}
    </div>
  )
}

/**
 * @param {{ message: string }} props
 */
function ErrorRow({ message }) {
  return (
    <div className="flex gap-2.5 rounded-xl border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-800">
      <AlertCircle className="mt-0.5 size-4 shrink-0 text-red-600" strokeWidth={2} />
      <span>{message}</span>
    </div>
  )
}

/**
 * @param {{ text: string }} props
 */
function NoteRow({ text }) {
  return (
    <div className="mt-3 flex gap-2 rounded-lg border border-slate-200 bg-slate-50 px-3 py-2 text-[11px] leading-relaxed text-slate-500">
      <Info className="mt-0.5 size-3.5 shrink-0 text-slate-400" strokeWidth={2} />
      <span>{text}</span>
    </div>
  )
}

/**
 * US-only control vs app2web_discount, in two side-by-side columns split by
 * where the money was taken: web purchases (STRIPE / RC_BILLING) vs in-app
 * purchases (APP_STORE / PLAY_STORE). app2web is a US-only, web-checkout-first
 * arm; control is an in-app paywall — so the two arms win on different rails,
 * and this split makes that visible. Reads /admin/experiments/us-by-store.
 * @param {{ refreshNonce: number }} props
 */
function UsTrialVsControlSection({ refreshNonce }) {
  const [data, setData] = useState(/** @type {Record<string, unknown> | null} */ (null))
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState(/** @type {string | null} */ (null))

  const fetchData = useCallback((cancelledRef) => {
    setLoading(true)
    setError(null)
    return fetchJson('/admin/experiments/us-by-store')
      .then((d) => {
        if (!cancelledRef.current) setData(d)
      })
      .catch((e) => {
        if (!cancelledRef.current) setError(e?.message || 'Failed to load US store split')
      })
      .finally(() => {
        if (!cancelledRef.current) setLoading(false)
      })
  }, [])

  useEffect(() => {
    const cancelledRef = { current: false }
    queueMicrotask(() => fetchData(cancelledRef))
    return () => {
      cancelledRef.current = true
    }
  }, [fetchData, refreshNonce])

  if (loading) return <LoadingRow label="Querying US store split…" />
  if (error) return <ErrorRow message={error} />
  if (!data) return null

  const arms = /** @type {Array<any>} */ (data.arms ?? [])
  const control = arms.find((a) => a.name === 'control')
  const app2web = arms.find((a) => a.name === 'app2web_discount')
  if (!control || !app2web) {
    return (
      <p className="rounded-xl border border-dashed border-slate-200 bg-white px-4 py-4 text-center text-xs text-slate-500">
        No US data for these arms yet.
      </p>
    )
  }

  const maxViewers = Math.max(1, control.viewers || 0, app2web.viewers || 0)

  const columns = [
    { key: 'web', label: 'US-only · web purchases', hint: 'STRIPE / RC_BILLING' },
    { key: 'inapp', label: 'US-only · in-app purchases', hint: 'APP_STORE / PLAY_STORE' },
  ]

  return (
    <>
      <div className="grid grid-cols-1 gap-4 lg:grid-cols-2">
        {columns.map((col) => (
          <div key={col.key} className="flex flex-col gap-2.5">
            <div className="flex items-baseline gap-2">
              <span className="text-xs font-semibold uppercase tracking-wide text-slate-700">
                {col.label}
              </span>
              <span className="text-[10px] text-slate-400">{col.hint}</span>
            </div>
            <UsStoreCard arm={control} store={col.key} tone="control" maxViewers={maxViewers} />
            <UsStoreCard arm={app2web} store={col.key} tone="trial" maxViewers={maxViewers} />
          </div>
        ))}
      </div>
      <NoteRow text="US users only (first paywall view logged from the US via mp_country_code), split by store. Web = STRIPE / RC_BILLING (App2Web's pay.rev.cat checkout); in-app = APP_STORE / PLAY_STORE. App2Web is a web-checkout-first arm so it wins the web column; control is an in-app paywall so it wins the in-app column. A user is counted in whichever store their first qualifying payment used." />
    </>
  )
}

/**
 * One arm's card in a store-split column (web or in-app). Shows Viewers, and
 * the store-specific Paid count + headline viewed→paid rate for that store
 * (arm.web_paid / arm.web_conv_rate, or arm.inapp_paid / arm.inapp_conv_rate).
 * Trials row shows only for trial arms in the web column (trials are a web-
 * checkout concept here). Bars scale to the larger arm's viewers.
 * @param {{ arm: Record<string, any>, store: 'web' | 'inapp', tone: 'control' | 'trial', maxViewers: number }} props
 */
function UsStoreCard({ arm, store, tone, maxViewers }) {
  const featured = tone === 'trial'
  const isWeb = store === 'web'
  const paid = isWeb ? arm.web_paid : arm.inapp_paid
  const rate = isWeb ? arm.web_conv_rate : arm.inapp_conv_rate

  const bar = (value, cls) => {
    const w = Math.max(2, Math.round(((Number(value) || 0) / maxViewers) * 100))
    return (
      <span className="relative h-3 w-full max-w-[240px] overflow-hidden rounded-full bg-slate-100">
        <span className={`absolute inset-y-0 left-0 rounded-full ${cls}`} style={{ width: `${w}%` }} />
      </span>
    )
  }
  const row = (label, value, extra, cls) => (
    <div className="flex items-center gap-2.5">
      <span className="w-[92px] shrink-0 text-xs font-medium uppercase tracking-wide text-slate-500">{label}</span>
      {bar(value, cls)}
      <span className="shrink-0 text-base font-semibold tabular-nums text-slate-900">
        {(Number(value) || 0).toLocaleString()}
      </span>
      {extra ? <span className="shrink-0 text-xs font-medium text-slate-500">{extra}</span> : null}
    </div>
  )

  return (
    <div className={`rounded-2xl border bg-white p-4 shadow-sm ${featured ? 'border-indigo-300 ring-1 ring-indigo-100' : 'border-slate-200'}`}>
      <div className="mb-0.5 flex items-center gap-2">
        <span className={`inline-block size-2.5 rounded-full ${featured ? 'bg-indigo-500' : 'bg-slate-400'}`} />
        <span className="text-sm font-semibold text-slate-900">{armLabel(arm.name)}</span>
      </div>
      <p className="mb-3.5 text-[11px] text-slate-400">
        {featured ? 'US-only arm · web checkout + trial' : 'Main paywall · essentially no trial'}
      </p>

      <div className="flex flex-col gap-2.5">
        {row('Viewers', arm.viewers, null, 'bg-cyan-500')}
        {featured && isWeb
          ? row(
              'Trials',
              arm.trials_started,
              arm.trial_start_rate != null ? pct(arm.trial_start_rate) : null,
              'bg-indigo-500',
            )
          : null}
        {row(isWeb ? 'Web paid' : 'In-app paid', paid, null, 'bg-emerald-500')}
      </div>

      <div className="mt-3.5 flex items-baseline justify-between border-t border-slate-100 pt-3">
        <span className="text-xs text-slate-500">Viewed → {isWeb ? 'web' : 'in-app'} paid</span>
        <span className={`text-2xl font-bold tabular-nums ${featured ? 'text-indigo-700' : 'text-emerald-700'}`}>
          {pct(rate)}
        </span>
      </div>
    </div>
  )
}

/**
 * ARPU by arm (comparison — horizontal bar, control shown in gray). ARPU
 * rather than raw conversion rate is the plan's actual decision metric
 * (revenue/assigned, not revenue/purchaser); conversion rate stays in the
 * table below where the vs.-control delta already lives.
 * @param {{ summary: Record<string, unknown> }} props
 */
function PurchaseCharts({ summary }) {
  const arms = useMemo(
    () => sortArmsControlFirst(/** @type {Array<any>} */ (summary.arms ?? [])),
    [summary.arms],
  )

  const arpuSorted = useMemo(
    () => [...arms].sort((a, b) => (b.arpu ?? 0) - (a.arpu ?? 0)),
    [arms],
  )
  const arpuData = useMemo(
    () => ({
      labels: arpuSorted.map((a) => armLabel(a.name)),
      datasets: [
        {
          label: 'ARPU',
          data: arpuSorted.map((a) => a.arpu ?? 0),
          backgroundColor: arpuSorted.map((a) => (a.name === 'control' ? '#888780' : '#1baf7a')),
          borderRadius: 4,
        },
      ],
    }),
    [arpuSorted],
  )

  return (
    <div className="mb-4 rounded-xl border border-slate-200 bg-white p-4">
      <p className="mb-3 text-xs font-semibold uppercase tracking-wide text-slate-500">
        ARPU by arm
      </p>
      <div className="relative" style={{ height: Math.max(arms.length * 32 + 40, 140) }}>
        <Bar
          data={arpuData}
          options={{
            indexAxis: 'y',
            responsive: true,
            maintainAspectRatio: false,
            plugins: {
              legend: { display: false },
              tooltip: {
                callbacks: {
                  label: (ctx) => `$${Number(ctx.parsed.x).toFixed(4)}`,
                },
              },
            },
            scales: {
              x: {
                ticks: { callback: (v) => `$${Number(v).toFixed(2)}` },
                grid: { color: 'rgba(148, 163, 184, 0.15)' },
              },
              y: { grid: { display: false } },
            },
          }}
          aria-label={`Average revenue per assigned user by arm, control shown in gray`}
        />
      </div>
    </div>
  )
}

/**
 * @param {{ refreshNonce: number }} props
 */
function PurchaseFunnelSection({ refreshNonce }) {
  const [summary, setSummary] = useState(/** @type {Record<string, unknown> | null} */ (null))
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState(/** @type {string | null} */ (null))

  const fetchSummary = useCallback((cancelledRef) => {
    if (USE_DUMMY_CHART_DATA) {
      setLoading(false)
      setError(null)
      setSummary(DUMMY_PURCHASE_SUMMARY)
      return Promise.resolve()
    }
    setLoading(true)
    setError(null)
    return fetchJson('/admin/experiments/summary')
      .then((data) => {
        if (!cancelledRef.current) setSummary(data)
      })
      .catch((e) => {
        if (!cancelledRef.current) setError(e?.message || 'Failed to load purchase funnel')
      })
      .finally(() => {
        if (!cancelledRef.current) setLoading(false)
      })
  }, [])

  // queueMicrotask genuinely defers the fetch off this effect's synchronous
  // execution frame, which is what satisfies the React Compiler's
  // "no setState synchronously within an effect" lint rule when the effect
  // has real (non-[]) deps — lexical restructuring alone doesn't. See
  // ExperimentCard's original version of this pattern for the full history.
  useEffect(() => {
    const cancelledRef = { current: false }
    queueMicrotask(() => fetchSummary(cancelledRef))
    return () => {
      cancelledRef.current = true
    }
  }, [fetchSummary, refreshNonce])

  if (loading) return <LoadingRow label="Loading purchase funnel…" />
  if (error) return <ErrorRow message={error} />
  if (!summary) return null

  const arms = sortArmsControlFirst(/** @type {Array<any>} */ (summary.arms ?? []))
  if (arms.length === 0) {
    return (
      <p className="rounded-xl border border-dashed border-slate-200 bg-white px-4 py-4 text-center text-xs text-slate-500">
        No assignment data for paywall_offer yet.
      </p>
    )
  }

  return (
    <>
      <PurchaseCharts summary={summary} />

      <FunnelLegend
        stages={[
          { label: 'Viewers', tone: 'neutral', description: 'saw the paywall' },
          { label: 'Subscribed', tone: 'accent', description: 'started paying or started a trial' },
          { label: 'Paid', tone: 'good', description: 'actually paid' },
        ]}
      />

      <div className="mt-3 overflow-hidden rounded-xl border border-slate-200 bg-white">
        <table className="w-full text-left text-sm">
          <thead>
            {/* Super-header: bands the funnel-stage columns and the
                economics columns into two visually distinct zones so the
                dense header reads as two groups at a glance, not nine
                unrelated labels. Purely presentational — no colSpan
                content of its own beyond the group name, so it adds no
                new tooltip/accessibility surface to maintain. */}
            <tr className="bg-slate-50/40">
              <th className="px-3 pt-2.5" />
              <th className="px-3 pt-2.5 text-left text-[10px] font-bold uppercase tracking-wider text-indigo-500/80">
                Funnel
              </th>
              <th
                colSpan={4}
                className="px-3 pt-2.5 text-right text-[10px] font-bold uppercase tracking-wider text-emerald-600/80"
              >
                Economics
              </th>
            </tr>
            <tr className="border-b border-slate-200 bg-slate-50/90">
              <Th>Arm</Th>
              <ThWithHint
                hint="How many of the users assigned to this arm ever actually saw the paywall (had a paywall_viewed event), through to how many reached a subscribe/trial-start moment, through to how many actually paid — RevenueCat's rc_initial_purchase_event (non-trial arms) or rc_trial_converted_event (trial arms). The track shows each stage as a share of Viewers so drop-off is visible at a glance; each stage's own rate (÷ Viewers) sits right under its count. Note: for the free-trial arms, the underlying Viewers count is currently understated by a client tracking bug (the trial paywall screen fires its view event once per user ever, not once per visit like the main paywall) — these rates are real, but the Viewers denominator behind them is not yet apples-to-apples across arms."
              >
                Viewers → Subscribed → Paid
              </ThWithHint>
              <Th align="right">vs. control</Th>
              <Th align="right">Revenue</Th>
              <ThWithHint
                align="right"
                hint="Average Revenue Per User — total revenue ÷ total assigned users in this arm (not just purchasers). The standard decision metric: it already accounts for both conversion rate and price."
              >
                ARPU
              </ThWithHint>
              <ThWithHint
                align="right"
                hint="Average Revenue Per Paying User — total revenue ÷ purchasers only. Shows how much a paying customer is worth on average, independent of how many people converted."
              >
                ARRPU
              </ThWithHint>
            </tr>
          </thead>
          <tbody className="divide-y divide-slate-100">
            {arms.map((arm) => (
              <ArmRow key={arm.name} arm={arm} />
            ))}
          </tbody>
        </table>
      </div>

      {summary.revenue_basis_note ? <NoteRow text={String(summary.revenue_basis_note)} /> : null}
    </>
  )
}

/** Shared color system for a funnel stage's tone — one place so the strip,
 *  its legend, and its labels always agree on which color means what. */
const FUNNEL_TONE = {
  neutral: { bar: 'bg-cyan-500', dot: 'bg-cyan-500', text: 'text-cyan-700' },
  accent: { bar: 'bg-indigo-500', dot: 'bg-indigo-500', text: 'text-indigo-700' },
  good: { bar: 'bg-emerald-500', dot: 'bg-emerald-500', text: 'text-emerald-700' },
}

/**
 * A small, persistent color key — one dot + plain-English phrase per
 * funnel stage — sitting once above the whole table rather than expecting
 * a viewer to infer "this color means Subscribed" from a text label that
 * sits below a bar instead of on it. Purely a legend: takes the same
 * `{ label, tone }` shape as FunnelStrip's stages plus a short
 * `description`, nothing arm- or experiment-specific.
 * @param {{ stages: Array<{ label: string, tone: 'neutral' | 'accent' | 'good', description: string }> }} props
 */
function FunnelLegend({ stages }) {
  return (
    <div className="mt-4 flex flex-wrap items-center gap-x-5 gap-y-1.5 rounded-lg border border-slate-200 bg-slate-50/60 px-3 py-2 text-xs text-slate-600">
      {stages.map((stage) => (
        <span key={stage.label} className="inline-flex items-center gap-1.5">
          <span className={`inline-block size-2.5 shrink-0 rounded-full ${FUNNEL_TONE[stage.tone].dot}`} />
          <span className="font-semibold text-slate-800">{stage.label}</span>
          <span className="text-slate-500">— {stage.description}</span>
        </span>
      ))}
    </div>
  )
}

/**
 * Generic stacked-bars funnel: one full-width horizontal bar PER stage
 * (Viewers on its own line, Subscribed on the next, Paid on the last),
 * each sized relative to the first/widest stage — so Viewers is always
 * the full-width reference bar and each later stage's bar shows its true
 * share of it, with nothing overlapping or nested on top of anything
 * else. Chosen over a single nested/layered bar (an earlier version of
 * this component tried that) specifically because nesting every stage's
 * bar from the same edge made the narrowest, most important segment
 * (Paid) visually compete with the widest one (Viewers) for the same
 * corner of the track — confusing at a glance, and ambiguous about which
 * color "came first". Three separate lines removes that ambiguity
 * entirely at the cost of using 3 lines of row height instead of 1.
 * Deliberately arm-/experiment-agnostic — plain `{ label, value, rate,
 * tone, note }` stages, nothing about paywall_offer — so the same
 * component works for any funnel-shaped experiment result. See
 * FunnelLegend for the color-to-label key shown once above the table.
 * @param {{ stages: Array<{ label: string, value: number, rate?: number | null, tone: 'neutral' | 'accent' | 'good', note?: import('react').ReactNode }> }} props
 */
function FunnelStrip({ stages }) {
  const max = Math.max(1, ...stages.map((s) => s.value || 0))

  return (
    <div className="flex flex-col gap-1.5">
      {stages.map((stage) => {
        const widthPct = stage.value ? Math.max(2, Math.round((stage.value / max) * 100)) : 0
        return (
          <div key={stage.label} className="flex items-center gap-2.5">
            <span className="flex w-[92px] shrink-0 items-center gap-1.5 text-xs font-medium uppercase tracking-wide text-slate-500">
              <span
                className={`inline-block size-2 shrink-0 rounded-full ${FUNNEL_TONE[stage.tone].dot}`}
                aria-hidden
              />
              {stage.label}
            </span>
            <span className="relative h-3 w-[288px] shrink-0 overflow-hidden rounded-full bg-slate-100">
              <span
                className={`absolute inset-y-0 left-0 rounded-full ${FUNNEL_TONE[stage.tone].bar}`}
                style={{ width: `${widthPct}%` }}
              />
            </span>
            <span className="flex shrink-0 items-baseline gap-1.5">
              <span className="w-9 text-right text-base font-semibold tabular-nums text-slate-900">
                {stage.value}
              </span>
              {stage.rate != null ? (
                <span className={`w-11 text-right text-xs font-semibold tabular-nums ${FUNNEL_TONE[stage.tone].text}`}>
                  {pct(stage.rate)}
                </span>
              ) : null}
              {stage.note ? (
                <span className="whitespace-nowrap text-xs font-medium text-slate-500">{stage.note}</span>
              ) : null}
            </span>
          </div>
        )
      })}
    </div>
  )
}

/**
 * One purchase-funnel table row. Expandable (chevron) to reveal what this
 * arm actually IS (arm.note, from ARM_NOTES on the backend), its product
 * split, and — for trial arms — the trial started/converted/cancelled
 * funnel inline, instead of only living in a separate, easy-to-miss
 * section below (see purchase_summary()'s docstring on the backend).
 *
 * The Viewer → Subscribed → Paid stages render as one FunnelStrip (see
 * above) — a single-line track plus a left-to-right label row carrying
 * each stage's count AND its own rate together, rather than the count and
 * its rate living in two separate columns a reader has to cross-reference.
 * One row of height per arm keeps 7 arms scannable as a column, which is
 * the primary use case here (comparing arms), not reading any one in
 * isolation. Nothing about this row hardcodes an arm name or a
 * paywall-specific meaning beyond calling the existing armLabel() /
 * LEAD_WITH_TRIAL_ARMS-driven badge — the visual layer itself is generic
 * funnel-analytics UI (see FunnelStrip) that would read the same for any
 * future experiment shaped like viewers → mid-funnel → paid.
 * @param {{ arm: Record<string, unknown> }} props
 */
function ArmRow({ arm }) {
  const [expanded, setExpanded] = useState(false)
  const hasDetail = Boolean(arm.note) || (arm.product_split ?? []).length > 0 || Boolean(arm.trial_metrics)

  const funnelStages = [
    { label: 'Viewers', value: Number(arm.viewers) || 0, tone: /** @type {const} */ ('neutral') },
    {
      label: 'Subscribed',
      value: Number(arm.subscribed) || 0,
      rate: arm.subscribe_rate,
      tone: /** @type {const} */ ('accent'),
      note: arm.subscribed_trials
        ? `${arm.subscribed_trials} trial${arm.subscribed_trials === 1 ? '' : 's'}`
        : null,
    },
    {
      label: 'Paid',
      value: Number(arm.purchasers) || 0,
      rate: arm.conv_rate,
      tone: /** @type {const} */ ('good'),
      // Both pieces matter and neither implies the other: "from trial" is
      // how this arm's purchasers broke down (trial-converted vs. direct),
      // "ongoing" is a DIFFERENT, still-unresolved population that hasn't
      // reached Paid at all yet — a trial arm can have both at once, and
      // showing only one (the original bug here) hid whichever came second
      // in the ternary, silently dropping "how many are still waiting" for
      // any arm where purchasers_from_trial also happened to be set.
      note: [
        arm.purchasers_from_trial != null ? `${arm.purchasers_from_trial} from trial` : null,
        arm.trials_ongoing ? `${arm.trials_ongoing} waiting` : null,
      ]
        .filter(Boolean)
        .join(' · ') || null,
    },
  ]

  return (
    <>
      <tr className={arm.name === 'control' ? 'bg-slate-50/50' : ''}>
        <Td className="align-top font-semibold text-slate-900">
          <button
            type="button"
            onClick={() => setExpanded((v) => !v)}
            disabled={!hasDetail}
            aria-expanded={expanded}
            className="inline-flex cursor-pointer items-center gap-1 text-left disabled:cursor-default"
          >
            {hasDetail ? (
              <ChevronDown
                className={`size-3.5 shrink-0 text-slate-400 transition-transform ${expanded ? 'rotate-180' : ''}`}
                strokeWidth={2.25}
                aria-hidden
              />
            ) : (
              <span className="inline-block size-3.5 shrink-0" aria-hidden />
            )}
            {armLabel(String(arm.name))}
            {arm.trial_metrics ? (
              <span
                className="rounded-full bg-indigo-50 px-1.5 py-0.5 text-[9px] font-semibold text-indigo-700"
                title="This arm has a trial funnel — expand to see it"
              >
                trial
              </span>
            ) : null}
          </button>
        </Td>
        <Td className="!whitespace-normal min-w-[360px] py-2.5">
          <FunnelStrip stages={funnelStages} />
        </Td>
        <Td align="right" className="align-top text-base">
          <DeltaBadge deltaPct={arm.delta_vs_control_pct} isControl={arm.name === 'control'} />
        </Td>
        <Td align="right" className="align-top text-base font-medium text-slate-800">
          {usd(arm.revenue_usd)}
        </Td>
        <Td align="right" className="align-top text-base font-semibold text-emerald-700">
          {arm.arpu != null ? `$${Number(arm.arpu).toFixed(4)}` : '—'}
        </Td>
        <Td align="right" className="align-top text-base font-medium text-slate-800">
          {usd(arm.arppu_usd)}
        </Td>
      </tr>
      {expanded ? (
        <tr className="bg-slate-50/70">
          <td colSpan={6} className="px-4 py-3">
            <div className="flex flex-col gap-3">
              {arm.note ? (
                <p className="text-xs leading-relaxed text-slate-600">{String(arm.note)}</p>
              ) : null}

              {(arm.product_split ?? []).length > 0 ? (
                <div>
                  <p className="mb-1.5 text-[10px] font-semibold uppercase tracking-wide text-slate-400">
                    Product split (of {arm.purchasers} purchaser{arm.purchasers === 1 ? '' : 's'})
                  </p>
                  <div className="flex flex-wrap gap-1.5">
                    {(/** @type {Array<any>} */ (arm.product_split)).map((p) => (
                      <span
                        key={p.product_id}
                        className="inline-flex items-center gap-1 rounded-md bg-white px-2 py-1 text-[11px] text-slate-700 ring-1 ring-slate-200"
                      >
                        <span className="font-mono font-semibold text-slate-900">{p.product_id}</span>
                        <span className="text-slate-400">
                          {p.count} · {p.pct}%
                        </span>
                      </span>
                    ))}
                  </div>
                </div>
              ) : null}

              {arm.trial_metrics ? (
                <div>
                  <p className="mb-1.5 text-[10px] font-semibold uppercase tracking-wide text-slate-400">
                    Trial funnel (rc_trial_started_event → converted → cancelled)
                  </p>
                  <div className="overflow-x-auto overflow-y-visible rounded-lg border border-slate-200 bg-white">
                    <table className="w-full min-w-[420px] text-left text-xs">
                      <thead>
                        <tr className="border-b border-slate-100 bg-slate-50/70">
                          <Th align="right">Started</Th>
                          <Th align="right">Converted</Th>
                          <Th align="right">Cancelled</Th>
                          <Th align="right">Conv. rate</Th>
                          <Th align="right">Cancel rate</Th>
                        </tr>
                      </thead>
                      <tbody>
                        <tr>
                          <Td align="right">
                            {/** @type {any} */ (arm.trial_metrics).trials_started}
                          </Td>
                          <Td align="right">
                            {/** @type {any} */ (arm.trial_metrics).trials_converted}
                          </Td>
                          <Td align="right">
                            {/** @type {any} */ (arm.trial_metrics).trials_cancelled}
                          </Td>
                          <Td align="right" className="font-semibold text-slate-900">
                            {pct(/** @type {any} */ (arm.trial_metrics).trial_conv_rate)}
                          </Td>
                          <Td align="right" className="font-semibold text-rose-700">
                            {pct(/** @type {any} */ (arm.trial_metrics).trial_cancel_rate)}
                          </Td>
                        </tr>
                      </tbody>
                    </table>
                  </div>
                </div>
              ) : null}
            </div>
          </td>
        </tr>
      ) : null}
    </>
  )
}

/**
 * @param {{ refreshNonce: number }} props
 */
function TrialSection({ refreshNonce }) {
  const [trial, setTrial] = useState(/** @type {Record<string, unknown> | null} */ (null))
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState(/** @type {string | null} */ (null))

  const fetchTrial = useCallback((cancelledRef) => {
    setLoading(true)
    setError(null)
    return fetchJson('/admin/experiments/trial')
      .then((data) => {
        if (!cancelledRef.current) setTrial(data)
      })
      .catch((e) => {
        if (!cancelledRef.current) setError(e?.message || 'Failed to load trial economics')
      })
      .finally(() => {
        if (!cancelledRef.current) setLoading(false)
      })
  }, [])

  useEffect(() => {
    const cancelledRef = { current: false }
    queueMicrotask(() => fetchTrial(cancelledRef))
    return () => {
      cancelledRef.current = true
    }
  }, [fetchTrial, refreshNonce])

  if (loading) return <LoadingRow label="Querying trial funnel…" />
  if (error) return <ErrorRow message={error} />
  if (!trial) return null

  const arms = sortArmsControlFirst(
    (/** @type {Array<any>} */ (trial.arms ?? [])).filter((a) => !NO_TRIAL_ARMS.has(a.name)),
  )
  if (arms.length === 0) {
    return (
      <div className="flex items-start gap-2.5 rounded-xl border border-dashed border-slate-200 bg-white px-4 py-4 text-xs text-slate-500">
        <Info className="mt-0.5 size-3.5 shrink-0 text-slate-400" strokeWidth={2} />
        <span>
          No paywall_offer users have a real rc_trial_started_event yet — none of the 4
          trial-offering arms (trial_yearly, trial_monthly, trial_weekly,
          discount_trial_weekly) have accumulated trial volume so far. This is expected
          data, not an error — check back once the experiment has more traffic.
        </span>
      </div>
    )
  }

  return (
    <div className="overflow-x-auto overflow-y-visible rounded-xl border border-slate-200 bg-white">
      <table className="w-full min-w-[540px] text-left text-sm">
        <thead>
          <tr className="border-b border-slate-200 bg-slate-50/90">
            <Th>Arm</Th>
            <Th align="right">Started</Th>
            <Th align="right">Converted</Th>
            <Th align="right">Cancelled</Th>
            <ThWithHint
              align="right"
              hint="Trials that haven't resolved either way yet — started, but neither converted (rc_trial_converted_event) nor cancelled (rc_trial_cancelled_event) so far. Started − Converted − Cancelled, floored at 0."
            >
              Waiting
            </ThWithHint>
            <Th align="right">Conv. rate</Th>
            <Th align="right">Cancel rate</Th>
          </tr>
        </thead>
        <tbody className="divide-y divide-slate-100">
          {arms.map((arm) => {
            const waiting = Math.max(
              0,
              (Number(arm.trials_started) || 0) -
                (Number(arm.trials_converted) || 0) -
                (Number(arm.trials_cancelled) || 0),
            )
            return (
              <tr key={arm.name}>
                <Td className="font-semibold text-slate-900">{armLabel(arm.name)}</Td>
                <Td align="right">{arm.trials_started}</Td>
                <Td align="right">{arm.trials_converted}</Td>
                <Td align="right">{arm.trials_cancelled}</Td>
                <Td align="right" className="font-semibold text-amber-700">
                  {waiting}
                </Td>
                <Td align="right" className="font-semibold text-slate-900">
                  {pct(arm.conv_rate)}
                </Td>
                <Td align="right" className="font-semibold text-rose-700">
                  {pct(arm.cancel_rate)}
                </Td>
              </tr>
            )
          })}
        </tbody>
      </table>
    </div>
  )
}

/**
 * @param {{ refreshNonce: number }} props
 */
function LtvSection({ refreshNonce }) {
  const [ltv, setLtv] = useState(/** @type {Record<string, unknown> | null} */ (null))
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState(/** @type {string | null} */ (null))

  const fetchLtv = useCallback((cancelledRef) => {
    setLoading(true)
    setError(null)
    return fetchJson('/admin/experiments/ltv')
      .then((data) => {
        if (!cancelledRef.current) setLtv(data)
      })
      .catch((e) => {
        if (!cancelledRef.current) setError(e?.message || 'Failed to load LTV')
      })
      .finally(() => {
        if (!cancelledRef.current) setLoading(false)
      })
  }, [])

  useEffect(() => {
    const cancelledRef = { current: false }
    queueMicrotask(() => fetchLtv(cancelledRef))
    return () => {
      cancelledRef.current = true
    }
  }, [fetchLtv, refreshNonce])

  if (loading) return <LoadingRow label="Querying renewals…" />
  if (error) return <ErrorRow message={error} />
  if (!ltv) return null

  const arms = sortArmsControlFirst(/** @type {Array<any>} */ (ltv.arms ?? []))
  if (arms.length === 0) {
    return (
      <p className="rounded-xl border border-dashed border-slate-200 bg-white px-4 py-4 text-center text-xs text-slate-500">
        No paying users for paywall_offer's arms yet.
      </p>
    )
  }

  return (
    <>
      <div className="overflow-x-auto overflow-y-visible rounded-xl border border-slate-200 bg-white">
        <table className="w-full min-w-[420px] text-left text-sm">
          <thead>
            <tr className="border-b border-slate-200 bg-slate-50/90">
              <Th>Arm</Th>
              <Th align="right">Payers</Th>
              <Th align="right">Total LTV</Th>
              <Th align="right">Avg LTV</Th>
            </tr>
          </thead>
          <tbody className="divide-y divide-slate-100">
            {arms.map((arm) => (
              <tr key={arm.name}>
                <Td className="font-semibold text-slate-900">{armLabel(arm.name)}</Td>
                <Td align="right">{arm.payers}</Td>
                <Td align="right">{usd(arm.total_ltv_usd)}</Td>
                <Td align="right" className="font-semibold text-emerald-700">
                  {usd(arm.avg_ltv_usd)}
                </Td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      {ltv.revenue_basis_note ? <NoteRow text={String(ltv.revenue_basis_note)} /> : null}
    </>
  )
}

/**
 * @param {{ refreshNonce: number }} props
 */
function ChurnSection({ refreshNonce }) {
  const [churn, setChurn] = useState(/** @type {Record<string, unknown> | null} */ (null))
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState(/** @type {string | null} */ (null))

  const fetchChurn = useCallback((cancelledRef) => {
    setLoading(true)
    setError(null)
    return fetchJson('/admin/experiments/churn')
      .then((data) => {
        if (!cancelledRef.current) setChurn(data)
      })
      .catch((e) => {
        if (!cancelledRef.current) setError(e?.message || 'Failed to load churn')
      })
      .finally(() => {
        if (!cancelledRef.current) setLoading(false)
      })
  }, [])

  useEffect(() => {
    const cancelledRef = { current: false }
    queueMicrotask(() => fetchChurn(cancelledRef))
    return () => {
      cancelledRef.current = true
    }
  }, [fetchChurn, refreshNonce])

  if (loading) return <LoadingRow label="Querying cancellations…" />
  if (error) return <ErrorRow message={error} />
  if (!churn) return null

  const arms = sortArmsControlFirst(/** @type {Array<any>} */ (churn.arms ?? []))
  if (arms.length === 0) {
    return (
      <p className="rounded-xl border border-dashed border-slate-200 bg-white px-4 py-4 text-center text-xs text-slate-500">
        No paying users for paywall_offer's arms yet.
      </p>
    )
  }

  return (
    <>
      <div className="overflow-x-auto overflow-y-visible rounded-xl border border-slate-200 bg-white">
        <table className="w-full min-w-[540px] text-left text-sm">
          <thead>
            <tr className="border-b border-slate-200 bg-slate-50/90">
              <Th>Arm</Th>
              <Th align="right">Paying base</Th>
              <Th align="right">Cancelled</Th>
              <Th align="right">Expired</Th>
              <Th align="right">Cancel rate</Th>
              <Th align="right">Expiration rate</Th>
            </tr>
          </thead>
          <tbody className="divide-y divide-slate-100">
            {arms.map((arm) => (
              <tr key={arm.name}>
                <Td className="font-semibold text-slate-900">{armLabel(arm.name)}</Td>
                <Td align="right">{arm.paying_base}</Td>
                <Td align="right">{arm.cancelled}</Td>
                <Td align="right">{arm.expired}</Td>
                <Td align="right" className="font-semibold text-rose-700">
                  {pct(arm.cancel_rate)}
                </Td>
                <Td align="right" className="font-semibold text-rose-700">
                  {pct(arm.expiration_rate)}
                </Td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </>
  )
}

/**
 * @param {{ children: import('react').ReactNode, align?: 'left' | 'right' }} props
 */
function Th({ children, align = 'left' }) {
  return (
    <th
      className={`whitespace-nowrap px-3 py-2.5 text-xs font-semibold uppercase tracking-wide text-slate-600 ${align === 'right' ? 'text-right' : 'text-left'}`}
    >
      {children}
    </th>
  )
}

/**
 * @param {{ children: import('react').ReactNode, align?: 'left' | 'right', className?: string }} props
 */
function Td({ children, align = 'left', className = '' }) {
  return (
    <td
      className={`whitespace-nowrap px-3 py-2.5 tabular-nums text-slate-700 ${align === 'right' ? 'text-right' : 'text-left'} ${className}`}
    >
      {children}
    </td>
  )
}

/**
 * @param {{ deltaPct: number | null | undefined, isControl: boolean }} props
 */
function DeltaBadge({ deltaPct, isControl }) {
  if (isControl) {
    return <span className="text-sm text-slate-400">baseline</span>
  }
  if (deltaPct == null) {
    return <Minus className="ml-auto size-4 text-slate-300" strokeWidth={2} aria-hidden />
  }
  const positive = deltaPct > 0
  const Icon = positive ? TrendingUp : deltaPct < 0 ? TrendingDown : Minus
  return (
    <span
      className={`inline-flex items-center gap-1 text-sm font-semibold ${
        positive ? 'text-emerald-700' : deltaPct < 0 ? 'text-rose-700' : 'text-slate-500'
      }`}
    >
      <Icon className="size-4 shrink-0" strokeWidth={2.25} aria-hidden />
      {positive ? '+' : ''}
      {deltaPct}%
    </span>
  )
}

/**
 * A small "?" icon that reveals an explanation on hover/focus. Uses the
 * native `title` attribute as an accessible fallback (screen readers,
 * long-press on touch) alongside a styled tooltip for sighted mouse/
 * keyboard users — group-hover/group-focus-within, no JS state needed.
 *
 * `anchor` controls horizontal placement relative to the icon: 'center'
 * (default) works for columns with room on both sides, but for a column
 * near the right edge of the table's own overflow-x-auto scroller, a
 * centered tooltip's right half extends past the clipped/scrolled-away
 * area and is invisible (confirmed live on the rightmost column, e.g.
 * ARRPU). 'left'/'right' anchor the tooltip to that edge of the icon
 * instead of centering it, keeping the whole box inside the visible table.
 * @param {{ text: string, anchor?: 'center' | 'left' | 'right' }} props
 */
function InfoTooltip({ text, anchor = 'center' }) {
  const positionClass =
    anchor === 'right'
      ? 'right-0'
      : anchor === 'left'
        ? 'left-0'
        : 'left-1/2 -translate-x-1/2'
  return (
    <span className="group relative inline-flex" title={text}>
      <HelpCircle
        className="size-3 shrink-0 cursor-help text-slate-400 hover:text-slate-600"
        strokeWidth={2}
        aria-hidden
      />
      <span className="sr-only">{text}</span>
      <span
        role="tooltip"
        className={`pointer-events-none absolute bottom-full z-10 mb-1.5 w-56 rounded-lg bg-slate-900 px-2.5 py-1.5 text-[11px] font-normal normal-case leading-relaxed text-white opacity-0 shadow-lg transition-opacity group-hover:opacity-100 group-focus-within:opacity-100 ${positionClass}`}
      >
        {text}
      </span>
    </span>
  )
}

/**
 * A column header label with an info icon that reveals `hint` on hover.
 * Right-aligned columns anchor their tooltip to the icon's right edge
 * (not centered) so it doesn't overflow the table's scroll container when
 * the column sits near the table's right edge — see InfoTooltip's `anchor`.
 * @param {{ children: import('react').ReactNode, hint: string, align?: 'left' | 'right', className?: string }} props
 */
function ThWithHint({ children, hint, align = 'left', className = '' }) {
  return (
    <th
      className={`whitespace-nowrap px-3 py-2.5 text-xs font-semibold uppercase tracking-wide text-slate-600 ${align === 'right' ? 'text-right' : 'text-left'} ${className}`}
    >
      <span className={`inline-flex items-center gap-1 ${align === 'right' ? 'flex-row-reverse' : ''}`}>
        {children}
        <InfoTooltip text={hint} anchor={align === 'right' ? 'right' : 'center'} />
      </span>
    </th>
  )
}
