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
  Info,
  Loader2,
  Minus,
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
    { name: 'control', assigned: 720, assigned_pct: 14.9, viewers: 612, purchasers: 61, conv_rate: 0.0997, revenue_usd: 2621.0, arpu: 3.6403, avg_order_value_usd: 42.97, delta_vs_control_pct: null },
    { name: 'app2web_discount', assigned: 690, assigned_pct: 14.3, viewers: 588, purchasers: 71, conv_rate: 0.1207, revenue_usd: 2698.0, arpu: 3.9101, avg_order_value_usd: 38.0, delta_vs_control_pct: 21.1 },
    { name: 'discount_trial_weekly', assigned: 705, assigned_pct: 14.6, viewers: 601, purchasers: 84, conv_rate: 0.1398, revenue_usd: 3057.6, arpu: 4.3369, avg_order_value_usd: 36.4, delta_vs_control_pct: 40.2 },
    { name: 'yearly_high', assigned: 680, assigned_pct: 14.1, viewers: 579, purchasers: 45, conv_rate: 0.0777, revenue_usd: 3006.0, arpu: 4.4206, avg_order_value_usd: 66.8, delta_vs_control_pct: -22.1 },
    { name: 'trial_yearly', assigned: 685, assigned_pct: 14.2, viewers: 583, purchasers: 96, conv_rate: 0.1647, revenue_usd: 1996.8, arpu: 2.9152, avg_order_value_usd: 20.8, delta_vs_control_pct: 65.2 },
    { name: 'trial_monthly', assigned: 675, assigned_pct: 14.0, viewers: 574, purchasers: 89, conv_rate: 0.155, revenue_usd: 1157.0, arpu: 1.714, avg_order_value_usd: 13.0, delta_vs_control_pct: 55.5 },
    { name: 'trial_weekly', assigned: 665, assigned_pct: 13.8, viewers: 566, purchasers: 78, conv_rate: 0.1378, revenue_usd: 623.9, arpu: 0.9382, avg_order_value_usd: 8.0, delta_vs_control_pct: 38.2 },
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

/** Control first, then everything else in the order the API returned it —
 *  every table on this page reads control as the natural baseline to
 *  scan first. */
function sortArmsControlFirst(arms) {
  return [...arms].sort((a, b) => {
    if (a.name === 'control') return -1
    if (b.name === 'control') return 1
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

      <div className="flex flex-col gap-6">
        <Section title="Purchase funnel" subtitle="All-time · assignment split · exposure → paid · revenue, ARPU (RevenueCat-verified)">
          <PurchaseFunnelSection refreshNonce={refreshNonce} />
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

      <div className="mt-4 overflow-x-auto rounded-xl border border-slate-200 bg-white">
        <table className="w-full min-w-[720px] text-left text-sm">
          <thead>
            <tr className="border-b border-slate-200 bg-slate-50/90">
              <Th>Arm</Th>
              <Th align="right">Assigned</Th>
              <Th align="right">Viewers</Th>
              <Th align="right">Paid</Th>
              <Th align="right">Conv. rate</Th>
              <Th align="right">vs. control</Th>
              <Th align="right">Revenue</Th>
              <Th align="right">ARPU</Th>
              <Th align="right">AOV</Th>
            </tr>
          </thead>
          <tbody className="divide-y divide-slate-100">
            {arms.map((arm) => (
              <tr key={arm.name} className={arm.name === 'control' ? 'bg-slate-50/50' : ''}>
                <Td className="font-semibold text-slate-900">{armLabel(arm.name)}</Td>
                <Td align="right">
                  {arm.assigned}
                  <span className="ml-1 text-[10px] text-slate-400">({arm.assigned_pct}%)</span>
                </Td>
                <Td align="right">{arm.viewers}</Td>
                <Td align="right">{arm.purchasers}</Td>
                <Td align="right" className="font-semibold text-slate-900">
                  {pct(arm.conv_rate)}
                </Td>
                <Td align="right">
                  <DeltaBadge deltaPct={arm.delta_vs_control_pct} isControl={arm.name === 'control'} />
                </Td>
                <Td align="right">{usd(arm.revenue_usd)}</Td>
                <Td align="right" className="font-semibold text-emerald-700">
                  {arm.arpu != null ? `$${Number(arm.arpu).toFixed(4)}` : '—'}
                </Td>
                <Td align="right">{usd(arm.avg_order_value_usd)}</Td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      {summary.revenue_basis_note ? <NoteRow text={String(summary.revenue_basis_note)} /> : null}
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

  const arms = sortArmsControlFirst(/** @type {Array<any>} */ (trial.arms ?? []))
  if (arms.length === 0) {
    return (
      <p className="rounded-xl border border-dashed border-slate-200 bg-white px-4 py-4 text-center text-xs text-slate-500">
        No rc_trial_started_event data for paywall_offer's trial arms yet.
      </p>
    )
  }

  return (
    <div className="overflow-x-auto rounded-xl border border-slate-200 bg-white">
      <table className="w-full min-w-[540px] text-left text-sm">
        <thead>
          <tr className="border-b border-slate-200 bg-slate-50/90">
            <Th>Arm</Th>
            <Th align="right">Started</Th>
            <Th align="right">Converted</Th>
            <Th align="right">Cancelled</Th>
            <Th align="right">Conv. rate</Th>
            <Th align="right">Cancel rate</Th>
          </tr>
        </thead>
        <tbody className="divide-y divide-slate-100">
          {arms.map((arm) => (
            <tr key={arm.name}>
              <Td className="font-semibold text-slate-900">{armLabel(arm.name)}</Td>
              <Td align="right">{arm.trials_started}</Td>
              <Td align="right">{arm.trials_converted}</Td>
              <Td align="right">{arm.trials_cancelled}</Td>
              <Td align="right" className="font-semibold text-slate-900">
                {pct(arm.conv_rate)}
              </Td>
              <Td align="right" className="font-semibold text-rose-700">
                {pct(arm.cancel_rate)}
              </Td>
            </tr>
          ))}
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
      <div className="overflow-x-auto rounded-xl border border-slate-200 bg-white">
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
      <div className="overflow-x-auto rounded-xl border border-slate-200 bg-white">
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
    return <span className="text-[11px] text-slate-400">baseline</span>
  }
  if (deltaPct == null) {
    return <Minus className="ml-auto size-3.5 text-slate-300" strokeWidth={2} aria-hidden />
  }
  const positive = deltaPct > 0
  const Icon = positive ? TrendingUp : deltaPct < 0 ? TrendingDown : Minus
  return (
    <span
      className={`inline-flex items-center gap-1 text-xs font-semibold ${
        positive ? 'text-emerald-700' : deltaPct < 0 ? 'text-rose-700' : 'text-slate-500'
      }`}
    >
      <Icon className="size-3.5 shrink-0" strokeWidth={2.25} aria-hidden />
      {positive ? '+' : ''}
      {deltaPct}%
    </span>
  )
}
