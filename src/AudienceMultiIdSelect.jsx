import { useMemo } from 'react'
import Select from 'react-select'
import { AUDIENCE_FILTER_UNSET } from './audienceConstants'
import { audienceSelectStyles } from './audienceReactSelectStyles'

/**
 * Multi-select for onboarding id arrays using react-select (`isMulti`).
 *
 * @param {{
 *   rows: Array<Record<string, unknown>>
 *   idKey: string
 *   idLabelMap: Record<string, string>
 *   valueIds: string[]
 *   onIdsChange: (ids: string[]) => void
 *   onClear: () => void
 *   inputId: string
 *   qn: number
 *   question: string
 * }} props
 */
export default function AudienceMultiIdSelect({
  rows,
  idKey,
  idLabelMap,
  valueIds,
  onIdsChange,
  onClear,
  inputId,
  qn,
  question,
}) {
  const showUnset = useMemo(() => {
    for (const r of rows) {
      const ids = r[idKey]
      if (!Array.isArray(ids) || ids.length === 0) return true
    }
    return false
  }, [rows, idKey])

  const options = useMemo(() => {
    const sorted = Object.entries(idLabelMap).sort((a, b) =>
      a[1].localeCompare(b[1], undefined, { sensitivity: 'base' }),
    )
    const opts = sorted.map(([value, label]) => ({ value, label }))
    if (showUnset) {
      return [
        { value: AUDIENCE_FILTER_UNSET, label: 'Not set (empty)' },
        ...opts,
      ]
    }
    return opts
  }, [idLabelMap, showUnset])

  const value = useMemo(
    () => options.filter((o) => valueIds.includes(o.value)),
    [options, valueIds],
  )

  return (
    <div className="space-y-2">
      <label className="sr-only" htmlFor={inputId}>
        {question} — multi-select
      </label>
      <Select
        inputId={inputId}
        instanceId={inputId}
        isMulti
        isSearchable
        isClearable
        menuPortalTarget={
          typeof document !== 'undefined' ? document.body : null
        }
        menuPosition="fixed"
        options={options}
        value={value}
        onChange={(newVal) => {
          onIdsChange(
            newVal && newVal.length > 0 ? newVal.map((o) => o.value) : [],
          )
        }}
        placeholder="Search or choose options…"
        closeMenuOnSelect={false}
        blurInputOnSelect={false}
        hideSelectedOptions={false}
        classNamePrefix="audience-rs"
        styles={audienceSelectStyles}
        aria-label={`Q${qn}: ${question}`}
      />
      <p className="text-[11px] leading-snug text-slate-500">
        Type to search; pick multiple options (OR match).
      </p>
      {valueIds.length > 0 ? (
        <button
          type="button"
          onClick={onClear}
          className="text-xs font-medium text-teal-700 underline-offset-2 hover:underline"
        >
          Clear selection
        </button>
      ) : null}
    </div>
  )
}
