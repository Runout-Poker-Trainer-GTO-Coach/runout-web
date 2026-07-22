/**
 * Reusable 0–100 percentage control: a number input plus a solid blue
 * scale-line slider with arrow ends and a hollow ring handle
 * (see `.range-line` in index.css). Shared by Settings (App2Web rollout)
 * and the Experiments page (per-door allocation).
 *
 * @param {{
 *   id: string
 *   title: string
 *   description?: string
 *   value: number
 *   onChange: (next: string) => void
 *   disabled?: boolean
 *   icon?: import('react').ReactNode
 * }} props
 */
export default function PercentageSlider({
  id,
  title,
  description,
  value,
  onChange,
  disabled,
  icon,
}) {
  return (
    <div className="flex flex-col gap-4 rounded-xl border border-slate-100/90 bg-white/80 p-4 shadow-sm ring-1 ring-slate-900/[0.03]">
      <div className="flex items-start justify-between gap-3">
        <div className="flex min-w-0 items-center gap-3">
          {icon ? (
            <div className="flex size-10 shrink-0 items-center justify-center rounded-xl bg-gradient-to-br from-slate-50 to-white shadow-sm ring-1 ring-slate-200/80">
              {icon}
            </div>
          ) : null}
          <div className="min-w-0">
            <p className="text-sm font-semibold text-slate-900">{title}</p>
            {description ? (
              <p className="text-xs leading-snug text-slate-500">{description}</p>
            ) : null}
          </div>
        </div>
        <div className="flex shrink-0 items-center gap-1">
          <input
            id={id}
            type="number"
            min={0}
            max={100}
            step={1}
            inputMode="numeric"
            value={value}
            onChange={(e) => onChange(e.target.value)}
            disabled={disabled}
            aria-label={`${title} (percent)`}
            className="w-16 rounded-lg border border-slate-200 bg-white px-2 py-1.5 text-right text-sm font-semibold tabular-nums text-slate-900 shadow-sm outline-none transition focus:border-emerald-400 focus:ring-4 focus:ring-emerald-500/15 disabled:opacity-50"
          />
          <span className="text-sm font-semibold text-slate-500" aria-hidden>
            %
          </span>
        </div>
      </div>
      <div className="flex items-center gap-3">
        <div className="range-line-wrap">
          <input
            type="range"
            min={0}
            max={100}
            step={1}
            value={value}
            onChange={(e) => onChange(e.target.value)}
            disabled={disabled}
            aria-label={title}
            className="range-line"
          />
        </div>
        <span className="w-11 shrink-0 text-right text-xs font-semibold tabular-nums text-slate-600">
          {value}%
        </span>
      </div>
    </div>
  )
}
