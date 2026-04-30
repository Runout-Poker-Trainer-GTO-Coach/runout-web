/**
 * @typedef {'emerald' | 'teal' | 'slate'} TagVariant
 */

/** @type {Record<TagVariant, { pill: string, empty: string }>} */
const VARIANT = {
  emerald: {
    pill:
      'border-emerald-200/85 bg-gradient-to-b from-emerald-50 via-white to-emerald-50/60 text-emerald-950 ring-1 ring-emerald-900/[0.05] shadow-[0_1px_2px_rgba(16,185,129,0.06),inset_0_1px_0_rgba(255,255,255,0.85)] transition-[box-shadow,border-color] hover:border-emerald-300/90 hover:shadow-[0_2px_6px_rgba(16,185,129,0.1)]',
    empty:
      'border border-dashed border-slate-200/90 bg-slate-50/90 text-slate-400 ring-1 ring-slate-900/[0.03]',
  },
  teal: {
    pill:
      'border-teal-200/85 bg-gradient-to-b from-teal-50 via-white to-cyan-50/50 text-teal-950 ring-1 ring-teal-900/[0.05] shadow-[0_1px_2px_rgba(20,184,166,0.07),inset_0_1px_0_rgba(255,255,255,0.85)] transition-[box-shadow,border-color] hover:border-teal-300/90 hover:shadow-[0_2px_6px_rgba(20,184,166,0.12)]',
    empty:
      'border border-dashed border-slate-200/90 bg-slate-50/90 text-slate-400 ring-1 ring-slate-900/[0.03]',
  },
  slate: {
    pill:
      'border-slate-200/90 bg-gradient-to-b from-slate-50 to-slate-100/50 text-slate-800 ring-1 ring-slate-900/[0.05] shadow-sm',
    empty:
      'border border-dashed border-slate-200/90 bg-slate-50/90 text-slate-400 ring-1 ring-slate-900/[0.03]',
  },
}

/**
 * Onboarding multi-select values as compact, readable chips.
 * Use either `stringValues` (plain strings) or `ids` + `idLabelMap`.
 *
 * @param {{
 *   ids?: unknown
 *   idLabelMap?: Record<string, string>
 *   stringValues?: unknown
 *   variant?: TagVariant
 * }} props
 */
export default function OnboardingMultiTags({
  ids,
  idLabelMap,
  stringValues,
  variant = 'slate',
}) {
  const v = VARIANT[variant] ?? VARIANT.slate
  const stringMode = stringValues !== undefined

  /** @type {{ key: string, label: string }[]} */
  const items = []
  if (stringMode) {
    const raw = Array.isArray(stringValues) ? stringValues : []
    raw.forEach((x, i) => {
      const label = String(x ?? '').trim()
      if (!label) return
      items.push({ key: `str-${i}-${label}`, label })
    })
  } else {
    const list = Array.isArray(ids) ? ids : []
    const map = idLabelMap ?? {}
    for (const id of list) {
      const s = String(id)
      const label = map[s] ?? s
      items.push({ key: `id-${s}`, label })
    }
  }

  if (items.length === 0) {
    return (
      <span
        className={`inline-flex items-center rounded-lg px-2.5 py-1 text-xs font-medium ${v.empty}`}
      >
        Not set
      </span>
    )
  }

  return (
    <div className="min-w-0 max-w-[min(20rem,100%)]">
      <ul
        className="m-0 flex list-none flex-wrap gap-2 p-0"
        aria-label={`${items.length} items`}
      >
        {items.map(({ key, label }) => (
          <li key={key} className="min-w-0 max-w-full">
            <span
              className={`inline-flex max-w-full rounded-xl border px-2.5 py-1.5 text-left text-xs font-medium leading-snug tracking-tight ${v.pill}`}
              title={label}
            >
              <span className="min-w-0 break-words">{label}</span>
            </span>
          </li>
        ))}
      </ul>
    </div>
  )
}
