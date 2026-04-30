import Select from 'react-select'
import { audienceSelectStyles } from './audienceReactSelectStyles'

/**
 * Single-select audience filter (searchable).
 *
 * @param {{
 *   options: { value: string, label: string }[]
 *   value: string
 *   onChange: (value: string) => void
 *   inputId: string
 *   qn: number
 *   question: string
 * }} props
 */
export default function AudienceScalarSelect({
  options,
  value,
  onChange,
  inputId,
  qn,
  question,
}) {
  const selected =
    options.find((o) => o.value === value) ?? options[0] ?? null

  return (
    <>
      <label className="sr-only" htmlFor={inputId}>
        {question}
      </label>
      <Select
        inputId={inputId}
        instanceId={inputId}
        isSearchable
        menuPortalTarget={
          typeof document !== 'undefined' ? document.body : null
        }
        menuPosition="fixed"
        options={options}
        value={selected}
        onChange={(opt) => onChange(opt?.value ?? 'all')}
        placeholder="Search or choose…"
        classNamePrefix="audience-rs"
        styles={audienceSelectStyles}
        aria-label={`Q${qn}: ${question}`}
      />
    </>
  )
}
