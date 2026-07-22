import { CheckCircle2, Loader2, Mail, X, XCircle } from 'lucide-react'
import { useEffect } from 'react'
import {
  AUDIENCE_MULTI_ID_FIELD_CONFIG,
  ONBOARDING_STRING_MULTI_FIELDS,
  detailModalLabelForField,
} from './userFields'
import OnboardingMultiTags from './OnboardingMultiTags.jsx'

/**
 * @param {{ value: boolean, variant?: 'purchase' | 'default' }} props
 */
function BooleanDetail({ value, variant }) {
  const isPurchase = variant === 'purchase'
  if (value) {
    if (isPurchase) {
      return (
        <span className="inline-flex items-center gap-1.5 rounded-lg bg-emerald-100 px-2.5 py-1 font-sans text-xs font-bold uppercase tracking-wide text-emerald-900 ring-1 ring-emerald-300/70">
          <CheckCircle2
            className="size-4 shrink-0 text-emerald-600"
            strokeWidth={2.25}
            aria-hidden
          />
          Yes
        </span>
      )
    }
    return (
      <span className="inline-flex items-center gap-1.5 font-sans text-xs font-medium text-emerald-800">
        <CheckCircle2
          className="size-3.5 shrink-0 text-emerald-600"
          strokeWidth={2}
          aria-hidden
        />
        Yes
      </span>
    )
  }
  return (
    <span
      className={`inline-flex items-center gap-1.5 font-sans text-xs ${
        isPurchase ? 'font-normal text-slate-500' : 'font-medium text-slate-600'
      }`}
    >
      <XCircle
        className={`shrink-0 text-slate-400 ${isPurchase ? 'size-3' : 'size-3.5'}`}
        strokeWidth={2}
        aria-hidden
      />
      No
    </span>
  )
}

/**
 * @param {string} email
 */
function emailInitial(email) {
  const c = String(email ?? '').trim()[0]
  return c ? c.toUpperCase() : '?'
}

/**
 * Full onboarding + admin fields in a modal (Users or Audience).
 *
 * @param {{
 *   row: Record<string, unknown> & { id: string } | null
 *   onClose: () => void
 *   mode: 'users' | 'audience'
 *   tagVariant: 'emerald' | 'teal'
 *   fields: { key: string, label: string }[]
 *   purchasePending?: boolean
 * }} props
 */
export default function OnboardingUserDetailModal({
  row,
  onClose,
  mode,
  tagVariant,
  fields,
  purchasePending = false,
}) {
  useEffect(() => {
    if (!row) return
    const prev = document.body.style.overflow
    document.body.style.overflow = 'hidden'
    const onKey = (e) => {
      if (e.key === 'Escape') onClose()
    }
    window.addEventListener('keydown', onKey)
    return () => {
      document.body.style.overflow = prev
      window.removeEventListener('keydown', onKey)
    }
  }, [row, onClose])

  if (!row) return null

  const email = String(row.email ?? '')
  const accent =
    mode === 'audience'
      ? {
          ring: 'ring-teal-400/35',
          avatar: 'from-teal-400 to-cyan-500',
          badge: 'bg-teal-50 text-teal-900 ring-teal-200/80',
        }
      : {
          ring: 'ring-emerald-400/35',
          avatar: 'from-emerald-400 to-teal-500',
          badge: 'bg-emerald-50 text-emerald-900 ring-emerald-200/80',
        }

  return (
    <div
      className="fixed inset-0 z-[2000] flex items-end justify-center p-0 sm:items-center sm:p-6"
      role="dialog"
      aria-modal="true"
      aria-labelledby="user-detail-title"
    >
      <button
        type="button"
        className="animate-ui-backdrop-in absolute inset-0 cursor-pointer bg-slate-950/55 backdrop-blur-[3px]"
        onClick={onClose}
        aria-label="Close dialog"
      />
      <div
        className={`animate-ui-modal-panel-in relative flex max-h-[min(92vh,880px)] w-full max-w-lg flex-col overflow-hidden rounded-t-[1.25rem] border border-white/20 shadow-[0_25px_50px_-12px_rgba(15,23,42,0.25)] sm:rounded-2xl ${
          mode === 'audience'
            ? 'bg-gradient-to-br from-white via-teal-50/30 to-white'
            : 'bg-gradient-to-br from-white via-emerald-50/30 to-white'
        }`}
      >
        <div
          className={`relative shrink-0 border-b px-5 pb-4 pt-5 ${
            mode === 'audience'
              ? 'border-teal-100/80 bg-white/70'
              : 'border-emerald-100/80 bg-white/70'
          }`}
        >
          <div className="flex items-start gap-4">
            <div
              className={`flex size-14 shrink-0 items-center justify-center rounded-2xl bg-gradient-to-br ${accent.avatar} text-lg font-bold text-white shadow-lg shadow-slate-900/15 ring-2 ${accent.ring}`}
              aria-hidden
            >
              {emailInitial(email)}
            </div>
            <div className="min-w-0 flex-1 pt-0.5">
              <p
                className={`inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wider ring-1 ${accent.badge}`}
              >
                User
              </p>
              <h2
                id="user-detail-title"
                className="mt-2 text-xl font-semibold tracking-tight text-slate-900"
              >
                {mode === 'audience' ? 'Member profile' : 'Account & onboarding'}
              </h2>
              <p className="mt-1 flex items-center gap-1.5 truncate text-sm text-slate-600">
                <Mail className="size-3.5 shrink-0 opacity-60" strokeWidth={2} />
                <span className="truncate font-mono text-xs text-slate-700">
                  {email || '—'}
                </span>
              </p>
            </div>
            <button
              type="button"
              onClick={onClose}
              className="group shrink-0 cursor-pointer rounded-xl border border-slate-200/90 bg-white/90 p-2.5 text-slate-500 shadow-sm transition hover:border-slate-300 hover:bg-slate-50 hover:text-slate-900 focus:outline-none focus-visible:ring-2 focus-visible:ring-slate-400 focus-visible:ring-offset-2"
            >
              <X
                className="size-5 transition group-hover:rotate-90"
                strokeWidth={2}
                aria-hidden
              />
              <span className="sr-only">Close</span>
            </button>
          </div>
        </div>

        <div className="min-h-0 flex-1 overflow-y-auto overscroll-contain px-5 py-5">
          <p className="mb-3 text-[10px] font-bold uppercase tracking-[0.14em] text-slate-400">
            Fields
          </p>
          <dl className="space-y-2">
            {fields.map(({ key, label }) => {
              const fieldHeading = detailModalLabelForField(key, label)
              const value = row[key]
              const stringListKey = ONBOARDING_STRING_MULTI_FIELDS[key]
              if (stringListKey) {
                const vals = row[stringListKey]
                return (
                  <div
                    key={key}
                    className="rounded-xl border border-slate-100/90 bg-white/80 p-3.5 shadow-sm ring-1 ring-slate-900/[0.02] transition hover:border-slate-200/90 hover:shadow-md"
                  >
                    <dt className="text-sm font-medium leading-snug text-slate-700">
                      {fieldHeading}
                    </dt>
                    <dd className="mt-2">
                      <OnboardingMultiTags
                        stringValues={vals}
                        variant={tagVariant}
                      />
                    </dd>
                  </div>
                )
              }
              const multiCfg = AUDIENCE_MULTI_ID_FIELD_CONFIG[key]
              if (multiCfg) {
                const ids = row[multiCfg.idKey]
                return (
                  <div
                    key={key}
                    className="rounded-xl border border-slate-100/90 bg-white/80 p-3.5 shadow-sm ring-1 ring-slate-900/[0.02] transition hover:border-slate-200/90 hover:shadow-md"
                  >
                    <dt className="text-sm font-medium leading-snug text-slate-700">
                      {fieldHeading}
                    </dt>
                    <dd className="mt-2">
                      <OnboardingMultiTags
                        ids={ids}
                        idLabelMap={multiCfg.idLabelMap}
                        variant={tagVariant}
                      />
                    </dd>
                  </div>
                )
              }
              if (
                key === 'isPurchased' &&
                (mode === 'users' || mode === 'audience')
              ) {
                return (
                  <div
                    key={key}
                    className="rounded-xl border border-slate-100/90 bg-white/80 p-3.5 shadow-sm ring-1 ring-slate-900/[0.02]"
                  >
                    <dt className="text-sm font-medium leading-snug text-slate-700">
                      {fieldHeading}
                    </dt>
                    <dd className="mt-2">
                      {purchasePending ? (
                        <span className="inline-flex items-center gap-2 rounded-lg bg-slate-50 px-3 py-2 text-sm text-slate-600 ring-1 ring-slate-200/80">
                          <Loader2
                            className="size-4 animate-spin text-emerald-600"
                            strokeWidth={2}
                            aria-hidden
                          />
                          Syncing purchase status…
                        </span>
                      ) : typeof value === 'boolean' ? (
                        <BooleanDetail value={value} variant="purchase" />
                      ) : (
                        <span className="font-mono text-sm text-slate-800">
                          {String(value ?? '—')}
                        </span>
                      )}
                    </dd>
                  </div>
                )
              }
              if (typeof value === 'boolean') {
                return (
                  <div
                    key={key}
                    className="rounded-xl border border-slate-100/90 bg-white/80 p-3.5 shadow-sm ring-1 ring-slate-900/[0.02]"
                  >
                    <dt className="text-sm font-medium leading-snug text-slate-700">
                      {fieldHeading}
                    </dt>
                    <dd className="mt-2">
                      <BooleanDetail
                        value={value}
                        variant={key === 'isPurchased' ? 'purchase' : 'default'}
                      />
                    </dd>
                  </div>
                )
              }
              return (
                <div
                  key={key}
                  className="rounded-xl border border-slate-100/90 bg-white/80 p-3.5 shadow-sm ring-1 ring-slate-900/[0.02] transition hover:border-slate-200/90"
                >
                  <dt className="text-sm font-medium leading-snug text-slate-700">
                    {fieldHeading}
                  </dt>
                  <dd className="mt-2 break-words font-mono text-sm leading-relaxed text-slate-800">
                    {value === undefined || value === null || value === ''
                      ? '—'
                      : String(value)}
                  </dd>
                </div>
              )
            })}
          </dl>
        </div>
      </div>
    </div>
  )
}
