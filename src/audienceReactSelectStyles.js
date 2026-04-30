/** Shared react-select theme for Audience filters (single + multi). */
export const audienceSelectStyles = {
  control: (base, state) => ({
    ...base,
    minHeight: 44,
    borderRadius: '0.75rem',
    borderColor: state.isFocused ? 'rgb(45 212 191)' : 'rgb(226 232 240)',
    boxShadow: state.isFocused
      ? '0 0 0 3px rgb(45 212 191 / 0.2)'
      : '0 1px 2px 0 rgb(0 0 0 / 0.05)',
  }),
  multiValue: (base) => ({
    ...base,
    backgroundColor: 'rgb(204 251 241)',
    borderRadius: '0.375rem',
  }),
  multiValueLabel: (base) => ({
    ...base,
    color: 'rgb(17 94 89)',
    fontSize: '0.75rem',
  }),
  multiValueRemove: (base) => ({
    ...base,
    color: 'rgb(17 94 89)',
    ':hover': {
      backgroundColor: 'rgb(153 246 228)',
      color: 'rgb(19 78 74)',
    },
  }),
  menu: (base) => ({ ...base, zIndex: 999 }),
  menuPortal: (base) => ({ ...base, zIndex: 999 }),
  menuList: (base) => ({ ...base, maxHeight: 240 }),
  option: (base, state) => ({
    ...base,
    fontSize: '0.875rem',
    cursor: 'pointer',
    backgroundColor: state.isSelected
      ? 'rgb(13 148 136)'
      : state.isFocused
        ? 'rgb(240 253 250)'
        : 'white',
    color: state.isSelected ? 'white' : 'rgb(15 23 42)',
  }),
}
