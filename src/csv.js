import { DocumentReference, GeoPoint, Timestamp } from 'firebase/firestore'

function serializeField(value) {
  if (value === undefined || value === null) return ''
  if (value instanceof Timestamp) return value.toDate().toISOString()
  if (value instanceof GeoPoint)
    return `${value.latitude},${value.longitude}`
  if (value instanceof DocumentReference) return value.path
  if (typeof value === 'object') {
    try {
      return JSON.stringify(value)
    } catch {
      return String(value)
    }
  }
  if (typeof value === 'boolean') return value ? 'YES' : 'NO'
  return String(value)
}

function escapeCsvCell(val) {
  const s = val == null ? '' : String(val)
  if (/[",\n\r]/.test(s)) return `"${s.replace(/"/g, '""')}"`
  return s
}

/**
 * @param {Array<Record<string, unknown>>} rows
 * @param {Array<{ key: string, label: string }>} fields
 */
export function rowsToCsv(rows, fields) {
  if (rows.length === 0 || !fields?.length) return ''

  const keys = fields.map((f) => f.key)
  const headerLabels = fields.map((f) => f.label)

  const lines = [
    headerLabels.map(escapeCsvCell).join(','),
    ...rows.map((row) =>
      keys.map((k) => escapeCsvCell(serializeField(row[k]))).join(','),
    ),
  ]
  return lines.join('\r\n')
}

export function downloadCsv(filename, csvText) {
  const blob = new Blob([csvText], { type: 'text/csv;charset=utf-8;' })
  const url = URL.createObjectURL(blob)
  const a = document.createElement('a')
  a.href = url
  a.download = filename
  a.rel = 'noopener'
  document.body.appendChild(a)
  a.click()
  document.body.removeChild(a)
  URL.revokeObjectURL(url)
}
