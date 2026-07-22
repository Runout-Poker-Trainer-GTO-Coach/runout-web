import { AlertCircle, Loader2, X } from 'lucide-react'
import { useCallback, useEffect, useState } from 'react'
import { doc, updateDoc } from 'firebase/firestore'
import { db, questionsCollectionName } from './firebase'
import { questionPreviewText } from './questionRow.js'

/**
 * Firestore sometimes deserializes arrays as objects with numeric keys; normalize to a real array.
 * @param {unknown} v
 */
function normalizeReportsField(v) {
  if (Array.isArray(v)) return v
  if (v && typeof v === 'object' && !Array.isArray(v)) {
    const o = /** @type {Record<string, unknown>} */ (v)
    const keys = Object.keys(o).filter((k) => /^\d+$/.test(k))
    if (keys.length > 0) {
      return keys.sort((a, b) => Number(a) - Number(b)).map((k) => o[k])
    }
  }
  return []
}

/** @param {unknown} row */
function getReportsArray(row) {
  if (!row || typeof row !== 'object') return []
  return normalizeReportsField(/** @type {Record<string, unknown>} */ (row).reports)
}

/** @param {unknown} v */
function formatReportDate(v) {
  if (v == null) return '—'
  if (typeof v === 'string') return v
  if (typeof v === 'object' && v !== null && 'toDate' in v) {
    try {
      return /** @type {{ toDate: () => Date }} */ (v).toDate().toISOString()
    } catch {
      return '—'
    }
  }
  return String(v)
}

const LEGACY_REPORT_META = 'From Old Version'

/**
 * @param {unknown} value
 * @returns {{ display: string, legacy: boolean }}
 */
function reportMetaField(value) {
  const s = String(value ?? '').trim()
  if (s !== '') return { display: s, legacy: false }
  return { display: LEGACY_REPORT_META, legacy: true }
}

/**
 * @param {Record<string, unknown>} r
 */
function reportSummaryLines(r) {
  const issue = r.issueType != null ? String(r.issueType) : ''
  const details = r.details != null ? String(r.details) : ''
  const uid = r.userId != null ? String(r.userId) : ''
  const appVersion = r.appVersion != null ? String(r.appVersion) : ''
  const deviceType = r.deviceType != null ? String(r.deviceType) : ''
  const at = formatReportDate(r.submittedAt)
  return { issue, details, uid, appVersion, deviceType, at }
}

/**
 * @param {unknown} rep
 * @param {string} notesTrimmed
 */
function mergeReportAdminNotes(rep, notesTrimmed) {
  const base =
    rep && typeof rep === 'object' && !Array.isArray(rep) ? { ...rep } : {}
  if (notesTrimmed) base.adminNotes = notesTrimmed
  else delete base.adminNotes
  return base
}

/**
 * Reports dialog shared by QuestionsPage.jsx and EditQuestionsPage.jsx — lets
 * an admin resolve a report or edit its internal admin notes, writing
 * straight to the question doc's `reports` array. Self-contained: owns its
 * own busy/draft state, seeded from `row` and reset whenever a different
 * row is opened.
 *
 * @param {{
 *   row: ({ firestoreDocId: string } & Record<string, unknown>) | null
 *   onClose: () => void
 *   onReportsChange?: (firestoreDocId: string, nextReports: unknown[]) => void
 * }} props
 */
export default function ReportsModal({ row, onClose, onReportsChange }) {
  const firestoreDocId = row?.firestoreDocId ?? null
  const [reports, setReports] = useState(/** @type {unknown[]} */ ([]))
  const [resolvingKey, setResolvingKey] = useState(
    /** @type {string | null} */ (null),
  )
  const [notesSavingKey, setNotesSavingKey] = useState(
    /** @type {string | null} */ (null),
  )
  const [noteDrafts, setNoteDrafts] = useState(
    /** @type {Record<string, string>} */ ({}),
  )
  const [modalError, setModalError] = useState(/** @type {string | null} */ (null))

  useEffect(() => {
    if (!row) {
      setReports([])
      setNoteDrafts({})
      return
    }
    const list = getReportsArray(row)
    setReports(list)
    const drafts = /** @type {Record<string, string>} */ ({})
    list.forEach((rep, i) => {
      const r = /** @type {Record<string, unknown>} */ (rep)
      drafts[`${row.firestoreDocId}:${i}`] =
        typeof r?.adminNotes === 'string' ? r.adminNotes : ''
    })
    setNoteDrafts(drafts)
    setModalError(null)
    // Reset only when switching to a different row, not on every re-render.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [row?.firestoreDocId])

  useEffect(() => {
    if (!row) return
    function onKey(e) {
      if (e.key === 'Escape') onClose()
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [row, onClose])

  const saveNotes = useCallback(
    async (index, notesText) => {
      if (!db || !firestoreDocId) return
      if (index < 0 || index >= reports.length) return
      const trimmed = notesText.trim()
      const key = `${firestoreDocId}:${index}`
      const prev = reports
      const next = reports.map((r, i) =>
        i !== index ? r : mergeReportAdminNotes(r, trimmed),
      )
      setNotesSavingKey(key)
      setModalError(null)
      setReports(next)
      try {
        await updateDoc(doc(db, questionsCollectionName, firestoreDocId), {
          reports: next,
        })
        onReportsChange?.(firestoreDocId, next)
      } catch (e) {
        setReports(prev)
        setModalError(e?.message || 'Failed to save admin notes')
      } finally {
        setNotesSavingKey(null)
      }
    },
    [reports, firestoreDocId, onReportsChange],
  )

  const resolveReport = useCallback(
    async (index) => {
      if (!db || !firestoreDocId) return
      if (index < 0 || index >= reports.length) return
      const key = `${firestoreDocId}:${index}`
      const prev = reports
      const next = reports.filter((_, i) => i !== index)
      setResolvingKey(key)
      setModalError(null)
      setReports(next)
      try {
        await updateDoc(doc(db, questionsCollectionName, firestoreDocId), {
          reports: next,
        })
        onReportsChange?.(firestoreDocId, next)
        if (next.length === 0) onClose()
      } catch (e) {
        setReports(prev)
        setModalError(e?.message || 'Failed to resolve report')
      } finally {
        setResolvingKey(null)
      }
    },
    [reports, firestoreDocId, onReportsChange, onClose],
  )

  if (!row) return null

  const questionText = questionPreviewText(row) || '(No question text)'

  return (
    <div
      className="fixed inset-0 z-50 flex items-end justify-center bg-slate-900/40 p-0 backdrop-blur-sm sm:items-center sm:p-4"
      role="presentation"
      onClick={onClose}
    >
      <div
        role="dialog"
        aria-modal="true"
        aria-labelledby="reports-modal-title"
        className="flex max-h-[min(90vh,720px)] w-full max-w-lg flex-col rounded-t-2xl border border-slate-200 bg-white shadow-2xl sm:rounded-2xl"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-start justify-between gap-3 border-b border-slate-100 px-5 py-4">
          <div className="min-w-0">
            <h2
              id="reports-modal-title"
              className="text-lg font-semibold text-slate-900"
            >
              Reports
            </h2>
            <p className="mt-1 font-mono text-xs text-slate-500">
              {firestoreDocId}
            </p>
            <p className="mt-2 line-clamp-3 text-sm text-slate-600">
              {questionText}
            </p>
          </div>
          <button
            type="button"
            onClick={onClose}
            className="shrink-0 cursor-pointer rounded-lg p-2 text-slate-500 transition hover:bg-slate-100 hover:text-slate-800 focus:outline-none focus-visible:ring-2 focus-visible:ring-violet-500"
            aria-label="Close"
          >
            <X className="size-5" strokeWidth={2} />
          </button>
        </div>

        {modalError && (
          <div
            role="alert"
            className="mx-3 mt-3 flex gap-2 rounded-xl border border-red-200 bg-red-50 px-3 py-2 text-xs text-red-800 sm:mx-4"
          >
            <AlertCircle className="mt-0.5 size-3.5 shrink-0 text-red-600" strokeWidth={2} />
            <span>{modalError}</span>
          </div>
        )}

        <ul className="flex-1 overflow-y-auto px-3 py-3 sm:px-4 sm:py-4">
          {reports.length === 0 ? (
            <li className="rounded-xl border border-dashed border-slate-200 bg-slate-50/60 px-4 py-8 text-center text-sm text-slate-500">
              No active reports on this question.
            </li>
          ) : null}
          {reports.map((rep, index) => {
            const { issue, details, uid, appVersion, deviceType, at } =
              reportSummaryLines(/** @type {Record<string, unknown>} */ (rep) ?? {})
            const appMeta = reportMetaField(appVersion)
            const deviceMeta = reportMetaField(deviceType)
            const rk = `${firestoreDocId}:${index}`
            const busy = resolvingKey === rk
            return (
              <li
                key={rk}
                className="mb-3 list-none rounded-xl border border-slate-200 bg-slate-50/80 p-4 last:mb-0"
              >
                <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
                  <div className="min-w-0 flex-1 space-y-1.5 text-sm">
                    {issue ? (
                      <p>
                        <span className="font-semibold text-slate-700">
                          Type:{' '}
                        </span>
                        <span className="rounded-md bg-white px-1.5 py-0.5 font-mono text-xs text-violet-800 ring-1 ring-violet-100">
                          {issue}
                        </span>
                      </p>
                    ) : null}
                    {details ? (
                      <p className="break-words text-slate-700">
                        <span className="font-semibold text-slate-800">
                          Details:{' '}
                        </span>
                        {details}
                      </p>
                    ) : null}
                    {uid ? (
                      <p className="font-mono text-xs text-slate-500">
                        User: {uid}
                      </p>
                    ) : null}
                    <p className="font-mono text-xs text-slate-500">
                      App version:{' '}
                      <span
                        className={
                          appMeta.legacy ? 'italic text-slate-400' : undefined
                        }
                      >
                        {appMeta.display}
                      </span>
                    </p>
                    <p className="font-mono text-xs text-slate-500">
                      Device type:{' '}
                      <span
                        className={
                          deviceMeta.legacy ? 'italic text-slate-400' : undefined
                        }
                      >
                        {deviceMeta.display}
                      </span>
                    </p>
                    <p className="text-xs text-slate-500">Submitted: {at}</p>
                  </div>
                  <button
                    type="button"
                    disabled={resolvingKey !== null || notesSavingKey !== null}
                    onClick={() => resolveReport(index)}
                    className="shrink-0 cursor-pointer rounded-lg border border-emerald-200 bg-emerald-50 px-3 py-2 text-xs font-semibold text-emerald-900 transition hover:bg-emerald-100 focus:outline-none focus-visible:ring-2 focus-visible:ring-emerald-500 disabled:cursor-not-allowed disabled:opacity-50"
                  >
                    {busy ? (
                      <span className="inline-flex items-center gap-2">
                        <Loader2 className="size-3.5 animate-spin" strokeWidth={2} />
                        Resolving…
                      </span>
                    ) : (
                      'Resolve'
                    )}
                  </button>
                </div>
                <div className="mt-3 border-t border-slate-200/90 pt-3">
                  <label
                    htmlFor={`report-admin-notes-${rk}`}
                    className="flex items-center gap-1.5 text-xs font-semibold text-slate-700"
                  >
                    Admin notes
                  </label>
                  <textarea
                    id={`report-admin-notes-${rk}`}
                    rows={3}
                    value={noteDrafts[rk] ?? ''}
                    onChange={(e) =>
                      setNoteDrafts((prev) => ({ ...prev, [rk]: e.target.value }))
                    }
                    disabled={resolvingKey !== null || notesSavingKey !== null}
                    placeholder="Internal notes (saved on this report only)…"
                    className="mt-1.5 w-full resize-y rounded-lg border border-slate-200 bg-white px-3 py-2 text-sm text-slate-800 shadow-sm outline-none placeholder:text-slate-400 focus:border-violet-400 focus:ring-2 focus:ring-violet-500/20 disabled:cursor-not-allowed disabled:opacity-60"
                  />
                  <div className="mt-2 flex justify-end">
                    <button
                      type="button"
                      onClick={() => saveNotes(index, noteDrafts[rk] ?? '')}
                      disabled={resolvingKey !== null || notesSavingKey !== null}
                      className="inline-flex cursor-pointer items-center gap-1.5 rounded-lg border border-violet-200 bg-violet-50 px-3 py-2 text-xs font-semibold text-violet-900 transition hover:bg-violet-100 focus:outline-none focus-visible:ring-2 focus-visible:ring-violet-500 disabled:cursor-not-allowed disabled:opacity-50"
                    >
                      {notesSavingKey === rk ? (
                        <span className="inline-flex items-center gap-2">
                          <Loader2 className="size-3.5 animate-spin" strokeWidth={2} aria-hidden />
                          Saving…
                        </span>
                      ) : (
                        'Save notes'
                      )}
                    </button>
                  </div>
                </div>
              </li>
            )
          })}
        </ul>
      </div>
    </div>
  )
}
