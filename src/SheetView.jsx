import {
  AlertCircle,
  AlertTriangle,
  Download,
  Loader2,
  Save,
  Table as TableIcon,
  Upload,
  X,
} from 'lucide-react'
import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { doc, updateDoc } from 'firebase/firestore'
import { read, utils, writeFile } from 'xlsx'
import { db, questionsCollectionName } from './firebase'

/**
 * Canonical field order — kept in sync with the JSON shape of a question doc.
 * Defined here (not imported) so SheetView is self-contained.
 */
const SHEET_FIELDS = /** @type {const} */ ([
  'id',
  'user_seat',
  'user_cards',
  'flop',
  'table_size',
  'default_stack',
  'seats',
  'pot',
  'context',
  'question',
  'question_type',
  'hand_stage',
  'option_1',
  'option_2',
  'option_3',
  'option_4',
  'correct_answer',
  'answer_explanation',
  'cash_or_tournament',
  'live_or_online',
  'relative_position',
  'preflop_pot_type',
  'pot_participant_type',
  'stack_depth',
  'difficulty_rating',
  'tag_1',
  'tag_2',
  'tag_3',
  'notes',
  'source_url',
  'hand_type',
])

const EDITS_KEY = 'edit-questions:sheet-edits'

/**
 * Persist JSON-serializable state to localStorage so cell edits survive a
 * full page refresh (per the product requirement).
 *
 * @template T
 * @param {string} key
 * @param {T} initial
 * @returns {[T, (v: T | ((s: T) => T)) => void]}
 */
function useLocalStorageState(key, initial) {
  const [value, setValue] = useState(() => {
    try {
      const raw = localStorage.getItem(key)
      return raw == null ? initial : JSON.parse(raw)
    } catch {
      return initial
    }
  })
  useEffect(() => {
    try {
      localStorage.setItem(key, JSON.stringify(value))
    } catch {
      /* quota / private mode */
    }
  }, [key, value])
  return [value, setValue]
}

/** @param {unknown} v */
function valueAsString(v) {
  if (v == null) return ''
  if (typeof v === 'string') return v
  return String(v)
}

/**
 * @param {string} field
 * @param {string} raw
 */
function patchValue(field, raw) {
  const trimmed = raw.trim()
  if (field === 'id' || field === 'difficulty_rating') {
    if (trimmed === '') return null
    const n = Number(trimmed)
    return Number.isFinite(n) ? n : trimmed
  }
  return trimmed === '' ? null : trimmed
}

/**
 * Spreadsheet-style full-screen editor. One row per question, one column per
 * field. Cell edits live in localStorage until the user explicitly presses
 * "Save to database" (commits via Firestore) or "Close" (discards).
 *
 * @param {{
 *   rows: Array<{ firestoreDocId: string } & Record<string, unknown>>
 *   onClose: () => void
 *   onCommitted: (patches: Array<{ docId: string, patch: Record<string, unknown> }>) => void
 * }} props
 */
export default function SheetView({ rows, onClose, onCommitted }) {
  /** @type {[Record<string, Record<string, string>>, (v: any) => void]} */
  const [edits, setEdits] = useLocalStorageState(EDITS_KEY, {})
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState(/** @type {string | null} */ (null))
  const [confirmingClose, setConfirmingClose] = useState(false)
  const fileInputRef = useRef(/** @type {HTMLInputElement | null} */ (null))

  // Index rows by firestoreDocId for O(1) lookups in cellValue.
  const rowsById = useMemo(() => {
    /** @type {Record<string, Record<string, unknown>>} */
    const m = {}
    for (const r of rows) m[r.firestoreDocId] = r
    return m
  }, [rows])

  const editedDocCount = Object.keys(edits).length
  const editedCellCount = useMemo(
    () =>
      Object.values(edits).reduce(
        (acc, fields) => acc + Object.keys(fields).length,
        0,
      ),
    [edits],
  )

  const cellValue = useCallback(
    (docId, field) => {
      const rowEdits = edits[docId]
      if (rowEdits && field in rowEdits) return rowEdits[field]
      return valueAsString(rowsById[docId]?.[field])
    },
    [edits, rowsById],
  )

  const isModified = useCallback(
    (docId, field) => Boolean(edits[docId] && field in edits[docId]),
    [edits],
  )

  const setCell = useCallback(
    (docId, field, value) => {
      const original = valueAsString(rowsById[docId]?.[field])
      setEdits((prev) => {
        const rowEdits = { ...(prev[docId] || {}) }
        if (value === original) {
          delete rowEdits[field]
        } else {
          rowEdits[field] = value
        }
        const next = { ...prev }
        if (Object.keys(rowEdits).length === 0) {
          delete next[docId]
        } else {
          next[docId] = rowEdits
        }
        return next
      })
    },
    [rowsById, setEdits],
  )

  const clearAllEdits = useCallback(() => {
    setEdits({})
  }, [setEdits])

  const handleClose = useCallback(() => {
    if (editedCellCount > 0) {
      setConfirmingClose(true)
      return
    }
    onClose()
  }, [editedCellCount, onClose])

  const handleDiscardAndClose = useCallback(() => {
    clearAllEdits()
    setConfirmingClose(false)
    onClose()
  }, [clearAllEdits, onClose])

  const handleSaveToDb = useCallback(async () => {
    if (!db || editedDocCount === 0 || saving) return
    setSaving(true)
    setError(null)
    /** @type {Array<{ docId: string, patch: Record<string, unknown> }>} */
    const applied = []
    try {
      for (const [docId, fields] of Object.entries(edits)) {
        /** @type {Record<string, unknown>} */
        const patch = {}
        for (const [f, v] of Object.entries(fields)) {
          patch[f] = patchValue(f, v)
        }
        await updateDoc(doc(db, questionsCollectionName, docId), patch)
        applied.push({ docId, patch })
      }
      setEdits({})
      onCommitted(applied)
    } catch (e) {
      const msg = e?.message || 'Failed to save changes'
      setError(`${msg} (${applied.length} of ${editedDocCount} saved)`)
      // Drop the patches that already landed so the user doesn't re-apply
      // them on retry.
      if (applied.length > 0) {
        const savedIds = new Set(applied.map((a) => a.docId))
        setEdits((prev) => {
          const next = {}
          for (const [k, v] of Object.entries(prev)) {
            if (!savedIds.has(k)) next[k] = v
          }
          return next
        })
        onCommitted(applied)
      }
    } finally {
      setSaving(false)
    }
  }, [edits, editedDocCount, saving, setEdits, onCommitted])

  const handleExport = useCallback(() => {
    const data = rows.map((r) => {
      /** @type {Record<string, string>} */
      const out = { firestoreDocId: r.firestoreDocId }
      for (const f of SHEET_FIELDS) {
        out[f] = cellValue(r.firestoreDocId, f)
      }
      return out
    })
    const ws = utils.json_to_sheet(data)
    const wb = utils.book_new()
    utils.book_append_sheet(wb, ws, 'Questions')
    writeFile(wb, 'questions.xlsx')
  }, [rows, cellValue])

  const handleImportFile = useCallback(
    (file) => {
      const reader = new FileReader()
      reader.onload = (e) => {
        try {
          const buf = e.target?.result
          if (!(buf instanceof ArrayBuffer)) return
          const wb = read(new Uint8Array(buf), { type: 'array' })
          const ws = wb.Sheets[wb.SheetNames[0]]
          if (!ws) {
            setError('Workbook has no sheets')
            return
          }
          const json = /** @type {Array<Record<string, unknown>>} */ (
            utils.sheet_to_json(ws, { defval: '' })
          )

          /** @type {Record<string, Record<string, string>>} */
          const newEdits = { ...edits }
          let touched = 0
          for (const raw of json) {
            const docId = String(raw.firestoreDocId ?? '')
            if (!docId || !rowsById[docId]) continue
            for (const f of SHEET_FIELDS) {
              const original = valueAsString(rowsById[docId][f])
              const imported = valueAsString(raw[f])
              if (imported !== original) {
                if (!newEdits[docId]) newEdits[docId] = {}
                newEdits[docId][f] = imported
                touched++
              }
            }
          }
          setEdits(newEdits)
          setError(
            touched === 0
              ? 'Imported file matches current data — no changes staged'
              : null,
          )
        } catch (err) {
          setError(err?.message || 'Failed to parse spreadsheet')
        }
      }
      reader.readAsArrayBuffer(file)
    },
    [edits, rowsById, setEdits],
  )

  // Esc closes (via the standard confirmation if dirty).
  useEffect(() => {
    function onKey(e) {
      if (e.key === 'Escape') {
        if (confirmingClose) setConfirmingClose(false)
        else handleClose()
      }
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [handleClose, confirmingClose])

  return (
    <div className="fixed inset-0 z-[60] flex flex-col bg-white">
      {/* Top bar */}
      <header className="flex shrink-0 flex-wrap items-center gap-2 border-b border-slate-200 bg-white px-3 py-2 shadow-sm sm:gap-3 sm:px-4">
        <div className="flex min-w-0 items-center gap-2">
          <div className="flex size-8 shrink-0 items-center justify-center rounded-lg bg-gradient-to-br from-emerald-500 to-teal-600 text-white shadow-md shadow-emerald-900/20">
            <TableIcon className="size-4" strokeWidth={2.25} aria-hidden />
          </div>
          <div className="min-w-0">
            <h1 className="text-sm font-semibold tracking-tight text-slate-900">
              Sheet view
            </h1>
            <p className="text-[10.5px] text-slate-500">
              {rows.length} rows · {SHEET_FIELDS.length} columns
              {editedCellCount > 0 ? (
                <>
                  {' · '}
                  <span className="font-semibold text-amber-700">
                    {editedCellCount} pending edit
                    {editedCellCount === 1 ? '' : 's'} across {editedDocCount}{' '}
                    row{editedDocCount === 1 ? '' : 's'}
                  </span>
                </>
              ) : null}
            </p>
          </div>
        </div>
        <div className="ml-auto flex flex-wrap items-center gap-1.5">
          <input
            ref={fileInputRef}
            type="file"
            accept=".xlsx,.xls,.csv"
            className="hidden"
            onChange={(e) => {
              const file = e.target.files?.[0]
              if (file) handleImportFile(file)
              e.target.value = ''
            }}
          />
          <ToolbarButton
            icon={<Upload className="size-3.5" strokeWidth={2.25} aria-hidden />}
            label="Import xlsx"
            onClick={() => fileInputRef.current?.click()}
            disabled={saving}
          />
          <ToolbarButton
            icon={<Download className="size-3.5" strokeWidth={2.25} aria-hidden />}
            label="Export xlsx"
            onClick={handleExport}
            disabled={saving}
          />
          {editedCellCount > 0 ? (
            <ToolbarButton
              icon={<X className="size-3.5" strokeWidth={2.25} aria-hidden />}
              label="Clear edits"
              onClick={clearAllEdits}
              disabled={saving}
              tone="amber"
            />
          ) : null}
          <button
            type="button"
            onClick={handleSaveToDb}
            disabled={editedDocCount === 0 || saving}
            className="inline-flex cursor-pointer items-center justify-center gap-1.5 rounded-lg bg-gradient-to-b from-emerald-600 to-emerald-700 px-3 py-1.5 text-xs font-semibold text-white shadow-md shadow-emerald-900/25 transition hover:from-emerald-700 hover:to-emerald-800 focus:outline-none focus-visible:ring-2 focus-visible:ring-emerald-500 focus-visible:ring-offset-1 disabled:cursor-not-allowed disabled:opacity-50"
          >
            {saving ? (
              <>
                <Loader2 className="size-3.5 animate-spin" strokeWidth={2} aria-hidden />
                Saving…
              </>
            ) : (
              <>
                <Save className="size-3.5" strokeWidth={2.25} aria-hidden />
                Save to database
                {editedDocCount > 0 ? (
                  <span className="rounded-full bg-emerald-800/40 px-1.5 py-0.5 text-[10px] tabular-nums">
                    {editedDocCount}
                  </span>
                ) : null}
              </>
            )}
          </button>
          <button
            type="button"
            onClick={handleClose}
            disabled={saving}
            className="inline-flex cursor-pointer items-center justify-center gap-1.5 rounded-lg border border-slate-200 bg-white px-3 py-1.5 text-xs font-semibold text-slate-700 transition hover:border-slate-300 hover:bg-slate-50 focus:outline-none focus-visible:ring-2 focus-visible:ring-slate-400 disabled:cursor-not-allowed disabled:opacity-50"
          >
            <X className="size-3.5" strokeWidth={2.25} aria-hidden />
            Close
          </button>
        </div>
      </header>

      {error ? (
        <div
          role="alert"
          className="flex shrink-0 gap-2 border-b border-red-100 bg-red-50 px-4 py-2 text-xs text-red-800"
        >
          <AlertCircle
            className="mt-0.5 size-3.5 shrink-0 text-red-600"
            strokeWidth={2}
          />
          <span className="min-w-0 flex-1">{error}</span>
          <button
            type="button"
            onClick={() => setError(null)}
            className="cursor-pointer rounded p-0.5 text-red-700 hover:bg-red-100"
            aria-label="Dismiss error"
          >
            <X className="size-3.5" strokeWidth={2.5} />
          </button>
        </div>
      ) : null}

      {/* Spreadsheet */}
      <main className="min-h-0 flex-1 overflow-auto bg-slate-50">
        <table className="w-full border-collapse text-xs">
          <thead className="sticky top-0 z-20">
            <tr>
              <th className="sticky left-0 z-30 w-12 border-b border-r border-slate-300 bg-slate-200/95 px-2 py-1.5 text-left font-mono text-[10px] font-bold uppercase tracking-wider text-slate-600 backdrop-blur-sm">
                #
              </th>
              <th className="sticky left-12 z-30 min-w-[180px] border-b border-r border-slate-300 bg-slate-200/95 px-2 py-1.5 text-left font-mono text-[10px] font-bold uppercase tracking-wider text-slate-600 backdrop-blur-sm">
                firestoreDocId
              </th>
              {SHEET_FIELDS.map((f) => (
                <th
                  key={f}
                  className="min-w-[160px] border-b border-r border-slate-300 bg-slate-100/95 px-2 py-1.5 text-left font-mono text-[10px] font-bold uppercase tracking-wider text-slate-700 backdrop-blur-sm"
                  title={f}
                >
                  {f}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {rows.map((r, i) => (
              <tr
                key={r.firestoreDocId}
                className={
                  edits[r.firestoreDocId]
                    ? 'bg-amber-50/30'
                    : i % 2 === 0
                      ? 'bg-white'
                      : 'bg-slate-50/40'
                }
              >
                <td className="sticky left-0 z-10 w-12 border-r border-slate-200 bg-slate-100/95 px-2 py-1 text-center font-mono text-[10px] tabular-nums text-slate-500 backdrop-blur-sm">
                  {i + 1}
                </td>
                <td className="sticky left-12 z-10 min-w-[180px] border-r border-slate-200 bg-slate-100/95 px-2 py-1 font-mono text-[10px] text-slate-600 backdrop-blur-sm">
                  {r.firestoreDocId}
                </td>
                {SHEET_FIELDS.map((f) => {
                  const modified = isModified(r.firestoreDocId, f)
                  const value = cellValue(r.firestoreDocId, f)
                  return (
                    <td
                      key={f}
                      className={`border-b border-r border-slate-200 p-0 align-top ${
                        modified ? 'bg-amber-100/70' : ''
                      }`}
                    >
                      <input
                        type="text"
                        value={value}
                        onChange={(e) =>
                          setCell(r.firestoreDocId, f, e.target.value)
                        }
                        disabled={saving}
                        className="block w-full bg-transparent px-2 py-1 text-xs text-slate-800 outline-none focus:bg-white focus:ring-2 focus:ring-emerald-400/60 disabled:cursor-not-allowed disabled:opacity-60"
                      />
                    </td>
                  )
                })}
              </tr>
            ))}
          </tbody>
        </table>
      </main>

      {/* Footer status bar */}
      <footer className="flex shrink-0 items-center justify-between gap-2 border-t border-slate-200 bg-white px-3 py-1.5 text-[11px] text-slate-500 sm:px-4">
        <span>
          Edits are stored on this device until you save them or close the
          sheet — closing or refreshing the page does not lose them.
        </span>
        <span>
          {editedCellCount > 0
            ? `${editedCellCount} pending cell${editedCellCount === 1 ? '' : 's'}`
            : 'No pending changes'}
        </span>
      </footer>

      {/* Close-while-dirty confirmation */}
      {confirmingClose ? (
        <div
          className="fixed inset-0 z-[65] flex items-center justify-center bg-slate-900/50 backdrop-blur-sm"
          role="presentation"
          onClick={() => setConfirmingClose(false)}
        >
          <div
            role="dialog"
            aria-modal="true"
            aria-labelledby="sheet-close-title"
            className="w-[min(92%,28rem)] rounded-2xl border border-amber-200 bg-white p-5 shadow-2xl"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="flex items-start gap-3">
              <div className="flex size-10 shrink-0 items-center justify-center rounded-xl bg-amber-100 text-amber-700">
                <AlertTriangle
                  className="size-5"
                  strokeWidth={2.25}
                  aria-hidden
                />
              </div>
              <div className="min-w-0 flex-1">
                <h3
                  id="sheet-close-title"
                  className="text-sm font-semibold text-slate-900"
                >
                  Close sheet with {editedCellCount} pending edits?
                </h3>
                <p className="mt-1 text-xs text-slate-600">
                  Closing discards your local changes. To keep them, press{' '}
                  <span className="font-semibold">Save to database</span>{' '}
                  instead.
                </p>
              </div>
            </div>
            <div className="mt-4 flex justify-end gap-2">
              <button
                type="button"
                onClick={() => setConfirmingClose(false)}
                autoFocus
                className="cursor-pointer rounded-lg border border-slate-200 bg-white px-3 py-1.5 text-xs font-semibold text-slate-700 transition hover:border-slate-300 hover:bg-slate-50 focus:outline-none focus-visible:ring-2 focus-visible:ring-slate-400"
              >
                Keep editing
              </button>
              <button
                type="button"
                onClick={handleDiscardAndClose}
                className="cursor-pointer rounded-lg bg-amber-600 px-3 py-1.5 text-xs font-semibold text-white shadow-sm transition hover:bg-amber-700 focus:outline-none focus-visible:ring-2 focus-visible:ring-amber-500 focus-visible:ring-offset-2"
              >
                Discard & close
              </button>
            </div>
          </div>
        </div>
      ) : null}
    </div>
  )
}

/**
 * @param {{
 *   icon: import('react').ReactNode
 *   label: string
 *   onClick: () => void
 *   disabled?: boolean
 *   tone?: 'default' | 'amber'
 * }} props
 */
function ToolbarButton({ icon, label, onClick, disabled, tone = 'default' }) {
  const cls =
    tone === 'amber'
      ? 'border-amber-200 bg-white text-amber-800 hover:border-amber-300 hover:bg-amber-50 focus-visible:ring-amber-500'
      : 'border-slate-200 bg-white text-slate-700 hover:border-slate-300 hover:bg-slate-50 focus-visible:ring-slate-400'
  return (
    <button
      type="button"
      onClick={onClick}
      disabled={disabled}
      title={label}
      className={`inline-flex cursor-pointer items-center justify-center gap-1.5 rounded-lg border px-2.5 py-1.5 text-xs font-semibold transition focus:outline-none focus-visible:ring-2 focus-visible:ring-offset-1 disabled:cursor-not-allowed disabled:opacity-50 ${cls}`}
    >
      {icon}
      <span className="hidden sm:inline">{label}</span>
    </button>
  )
}
