import {
  AlertCircle,
  Calendar,
  Check,
  CheckCircle2,
  CircleDot,
  Inbox,
  Loader2,
  Pencil,
  Plus,
  Search,
  SearchX,
  Sparkles,
  ThumbsUp,
  Trash2,
  X,
} from 'lucide-react'
import { useCallback, useEffect, useMemo, useState } from 'react'
import {
  addDoc,
  collection,
  deleteDoc,
  doc,
  getDocs,
  serverTimestamp,
  updateDoc,
} from 'firebase/firestore'
import { db, firebaseReady, userIdeasCollectionName } from './firebase'

/** @param {unknown} v */
function asStr(v) {
  if (v == null) return ''
  if (typeof v === 'string') return v
  return String(v)
}

/** @param {unknown} v */
function asBool(v) {
  if (v === true) return true
  if (v === false) return false
  if (typeof v === 'string') {
    const s = v.trim().toLowerCase()
    return s === 'true' || s === '1' || s === 'yes'
  }
  return false
}

/** @param {unknown} v */
function asInt(v) {
  if (typeof v === 'number' && Number.isFinite(v)) return Math.trunc(v)
  if (typeof v === 'string') {
    const n = parseInt(v, 10)
    return Number.isFinite(n) ? n : 0
  }
  return 0
}

/**
 * Normalizes any Firestore/JS timestamp shape (Timestamp instance, plain
 * JSON-export `{_seconds}`/`{seconds}`, ISO string, epoch number) into a
 * Date, or null if unparseable. Shared by formatDate/formatDateLabel/tsMs so
 * the shape-detection lives in exactly one place.
 * @param {unknown} v
 * @returns {Date | null}
 */
function toDateObject(v) {
  if (v == null) return null
  if (typeof v === 'string') {
    const d = new Date(v)
    return Number.isNaN(d.getTime()) ? null : d
  }
  if (typeof v === 'number') {
    const d = new Date(v)
    return Number.isNaN(d.getTime()) ? null : d
  }
  if (typeof v === 'object') {
    if ('toDate' in v) {
      try {
        return /** @type {{ toDate: () => Date }} */ (v).toDate()
      } catch {
        return null
      }
    }
    if ('_seconds' in v && typeof (/** @type {any} */ (v))._seconds === 'number') {
      return new Date(/** @type {any} */ (v)._seconds * 1000)
    }
    if ('seconds' in v && typeof (/** @type {any} */ (v)).seconds === 'number') {
      return new Date(/** @type {any} */ (v).seconds * 1000)
    }
  }
  return null
}

/** Short date label for prominent display — e.g. "Aug 4, 2026". Null if unparseable. */
function formatDateLabel(v) {
  const d = toDateObject(v)
  return d
    ? d.toLocaleDateString(undefined, {
        month: 'short',
        day: 'numeric',
        year: 'numeric',
      })
    : null
}

/** ms-since-epoch for newest-first sorting. Handles every Firestore shape. */
function tsMs(v) {
  const d = toDateObject(v)
  return d ? d.getTime() : 0
}

export default function UserIdeasPage() {
  /** @type {[Array<Record<string, unknown>>, (v: any) => void]} */
  const [rows, setRows] = useState([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState(/** @type {string | null} */ (null))
  const [search, setSearch] = useState('')
  const [statusFilter, setStatusFilter] = useState(
    /** @type {'all' | 'pending' | 'completed'} */ ('pending'),
  )
  const [sortMode, setSortMode] = useState(
    /** @type {'newest' | 'votes'} */ ('newest'),
  )
  /** @type {[Record<string, unknown> | 'new' | null, (v: any) => void]} */
  const [editorTarget, setEditorTarget] = useState(null)
  /** @type {[Record<string, unknown> | null, (v: any) => void]} */
  const [deleteTarget, setDeleteTarget] = useState(null)
  const [busyId, setBusyId] = useState(/** @type {string | null} */ (null))
  const [toast, setToast] = useState(
    /** @type {{ tone: 'success' | 'error', message: string } | null} */ (
      null
    ),
  )

  useEffect(() => {
    if (!toast) return
    const t = setTimeout(() => setToast(null), 3000)
    return () => clearTimeout(t)
  }, [toast])

  const load = useCallback(async () => {
    if (!db) {
      setError('Firestore is not available')
      setLoading(false)
      return
    }
    setLoading(true)
    setError(null)
    try {
      const snap = await getDocs(collection(db, userIdeasCollectionName))
      const list = snap.docs.map((d) => ({
        firestoreDocId: d.id,
        ...d.data(),
      }))
      setRows(list)
    } catch (e) {
      setError(e?.message || 'Failed to load user ideas')
      setRows([])
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => {
    if (!firebaseReady) {
      setError('Firebase is not configured')
      setLoading(false)
      return
    }
    load()
  }, [load])

  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase()
    const list = rows.filter((r) => {
      const completed = asBool(r.isCompleted)
      if (statusFilter === 'completed' && !completed) return false
      if (statusFilter === 'pending' && completed) return false
      if (q === '') return true
      return (
        asStr(r.title).toLowerCase().includes(q) ||
        asStr(r.body).toLowerCase().includes(q)
      )
    })
    if (sortMode === 'votes') {
      list.sort((a, b) => {
        const va = asInt(a.voteCount)
        const vb = asInt(b.voteCount)
        if (vb !== va) return vb - va
        return tsMs(b.createdAt) - tsMs(a.createdAt)
      })
    } else {
      list.sort((a, b) => {
        const ta = tsMs(a.createdAt)
        const tb = tsMs(b.createdAt)
        if (tb !== ta) return tb - ta
        return String(b.firestoreDocId).localeCompare(String(a.firestoreDocId))
      })
    }
    return list
  }, [rows, search, statusFilter, sortMode])

  const counts = useMemo(() => {
    let pending = 0,
      completed = 0,
      totalVotes = 0
    for (const r of rows) {
      if (asBool(r.isCompleted)) completed++
      else pending++
      totalVotes += asInt(r.voteCount)
    }
    return { all: rows.length, pending, completed, totalVotes }
  }, [rows])

  const toggleCompleted = useCallback(
    async (row) => {
      if (!db) return
      const id = String(row.firestoreDocId)
      const next = !asBool(row.isCompleted)
      setBusyId(id)
      const prev = rows
      setRows((curr) =>
        curr.map((r) =>
          r.firestoreDocId === id ? { ...r, isCompleted: next } : r,
        ),
      )
      try {
        await updateDoc(doc(db, userIdeasCollectionName, id), {
          isCompleted: next,
          updatedAt: serverTimestamp(),
        })
        setToast({
          tone: 'success',
          message: next ? 'Marked as added' : 'Marked as idea',
        })
      } catch (e) {
        setRows(prev)
        setToast({
          tone: 'error',
          message: e?.message || 'Failed to update',
        })
      } finally {
        setBusyId(null)
      }
    },
    [rows],
  )

  const saveEditor = useCallback(
    async ({ title, body }) => {
      if (!db) return
      const trimmedTitle = asStr(title).trim()
      const trimmedBody = asStr(body).trim()
      if (trimmedTitle === '') {
        setToast({ tone: 'error', message: 'Title is required' })
        return
      }
      try {
        if (editorTarget === 'new') {
          const ref = await addDoc(
            collection(db, userIdeasCollectionName),
            {
              title: trimmedTitle,
              // Body is optional — only write it when the user typed
              // something so blank ideas don't get a stray empty key.
              ...(trimmedBody !== '' ? { body: trimmedBody } : {}),
              isCompleted: false,
              voteCount: 0,
              createdBy: 'admin',
              createdAt: serverTimestamp(),
            },
          )
          setRows((curr) => [
            {
              firestoreDocId: ref.id,
              title: trimmedTitle,
              ...(trimmedBody !== '' ? { body: trimmedBody } : {}),
              isCompleted: false,
              voteCount: 0,
              createdBy: 'admin',
              createdAt: new Date(),
            },
            ...curr,
          ])
          setToast({ tone: 'success', message: 'Idea added' })
        } else if (editorTarget && typeof editorTarget === 'object') {
          const id = String(
            /** @type {Record<string, unknown>} */ (editorTarget)
              .firestoreDocId,
          )
          // For an EDIT: always write the body field (even if blank) so
          // clearing it propagates to Firestore. Empty string is fine
          // here — the card display + writes treat "" the same as absent.
          await updateDoc(doc(db, userIdeasCollectionName, id), {
            title: trimmedTitle,
            body: trimmedBody,
            updatedAt: serverTimestamp(),
          })
          setRows((curr) =>
            curr.map((r) =>
              r.firestoreDocId === id
                ? { ...r, title: trimmedTitle, body: trimmedBody }
                : r,
            ),
          )
          setToast({ tone: 'success', message: 'Idea updated' })
        }
        setEditorTarget(null)
      } catch (e) {
        setToast({ tone: 'error', message: e?.message || 'Save failed' })
      }
    },
    [editorTarget],
  )

  const confirmDelete = useCallback(async () => {
    if (!db || !deleteTarget) return
    const id = String(deleteTarget.firestoreDocId)
    setBusyId(id)
    const prev = rows
    setRows((curr) => curr.filter((r) => r.firestoreDocId !== id))
    try {
      await deleteDoc(doc(db, userIdeasCollectionName, id))
      setToast({ tone: 'success', message: 'Idea deleted' })
      setDeleteTarget(null)
    } catch (e) {
      setRows(prev)
      setToast({ tone: 'error', message: e?.message || 'Delete failed' })
    } finally {
      setBusyId(null)
    }
  }, [deleteTarget, rows])

  return (
    <div className="flex flex-1 flex-col gap-4 px-4 py-6 sm:px-6 lg:px-8 lg:py-8">
      {/* Filter bar */}
      <section className="flex flex-wrap items-center gap-2 rounded-2xl border border-slate-200 bg-white px-4 py-3 shadow-sm">
        <div className="relative min-w-[220px] flex-1 sm:max-w-md">
          <Search
            className="pointer-events-none absolute left-3 top-1/2 size-4 -translate-y-1/2 text-slate-400"
            strokeWidth={2}
            aria-hidden
          />
          <input
            type="search"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="Search title or description"
            className="block w-full rounded-xl border border-slate-200 bg-slate-50 py-2 pl-9 pr-3 text-sm text-slate-800 placeholder:text-slate-400 focus:border-violet-400 focus:bg-white focus:outline-none focus:ring-2 focus:ring-violet-100"
          />
        </div>
        <div className="flex items-center gap-1 rounded-xl border border-slate-200 bg-slate-50 p-1 text-xs">
          {(/** @type {const} */ (['all', 'pending', 'completed'])).map((s) => (
            <button
              key={s}
              type="button"
              onClick={() => setStatusFilter(s)}
              className={`cursor-pointer rounded-lg px-3 py-1.5 font-semibold transition ${
                statusFilter === s
                  ? 'bg-white text-slate-900 shadow-sm ring-1 ring-slate-200'
                  : 'text-slate-500 hover:text-slate-700'
              }`}
            >
              {s === 'all'
                ? `All (${counts.all})`
                : s === 'pending'
                  ? `Ideas (${counts.pending})`
                  : `Added (${counts.completed})`}
            </button>
          ))}
        </div>
        <div className="flex items-center gap-1 rounded-xl border border-slate-200 bg-slate-50 p-1 text-xs">
          {(/** @type {const} */ (['newest', 'votes'])).map((m) => (
            <button
              key={m}
              type="button"
              onClick={() => setSortMode(m)}
              className={`cursor-pointer rounded-lg px-3 py-1.5 font-semibold transition ${
                sortMode === m
                  ? 'bg-white text-slate-900 shadow-sm ring-1 ring-slate-200'
                  : 'text-slate-500 hover:text-slate-700'
              }`}
              title={
                m === 'newest'
                  ? 'Sort by createdAt, newest first'
                  : 'Sort by voteCount, most-voted first'
              }
            >
              {m === 'newest' ? 'Newest' : 'Most voted'}
            </button>
          ))}
        </div>
        <div className="ml-auto flex items-center gap-2">
          <button
            type="button"
            onClick={() => load()}
            disabled={loading}
            className="cursor-pointer rounded-xl border border-slate-200 bg-white px-3 py-2 text-xs font-semibold text-slate-600 transition hover:border-slate-300 hover:bg-slate-50 disabled:cursor-not-allowed disabled:opacity-50"
            title="Refresh from Firestore"
          >
            Refresh
          </button>
          <button
            type="button"
            onClick={() => setEditorTarget('new')}
            className="inline-flex cursor-pointer items-center gap-1.5 rounded-xl bg-gradient-to-b from-violet-600 to-violet-700 px-3 py-2 text-sm font-semibold text-white shadow-md shadow-violet-900/25 transition hover:from-violet-700 hover:to-violet-800 focus:outline-none focus-visible:ring-2 focus-visible:ring-violet-500 focus-visible:ring-offset-2"
          >
            <Plus className="size-4 shrink-0" strokeWidth={2.5} aria-hidden />
            Add idea
          </button>
        </div>
      </section>

      {/* Body */}
      {loading ? (
        <div className="flex flex-1 items-center justify-center rounded-2xl border border-slate-200 bg-white py-20">
          <Loader2
            className="size-9 animate-spin text-violet-600"
            strokeWidth={2}
            aria-hidden
          />
        </div>
      ) : error ? (
        <div
          role="alert"
          className="flex gap-3 rounded-2xl border border-rose-200 bg-rose-50 px-4 py-3 text-sm text-rose-800"
        >
          <AlertCircle
            className="mt-0.5 size-4 shrink-0 text-rose-600"
            strokeWidth={2}
            aria-hidden
          />
          <span>{error}</span>
        </div>
      ) : filtered.length === 0 ? (
        <div className="flex flex-1 flex-col items-center justify-center rounded-2xl border border-slate-200 bg-white py-20 text-center">
          {rows.length === 0 ? (
            <>
              <Inbox
                className="size-12 text-slate-300"
                strokeWidth={1.5}
                aria-hidden
              />
              <p className="mt-3 text-sm font-semibold text-slate-700">
                No user ideas yet
              </p>
              <p className="mt-1 text-xs text-slate-500">
                Click <span className="font-semibold">Add idea</span> to create
                the first one.
              </p>
            </>
          ) : (
            <>
              <SearchX
                className="size-12 text-slate-300"
                strokeWidth={1.5}
                aria-hidden
              />
              <p className="mt-3 text-sm font-semibold text-slate-700">
                No ideas match these filters
              </p>
              <p className="mt-1 text-xs text-slate-500">
                Try clearing the search or switching the status tab.
              </p>
            </>
          )}
        </div>
      ) : (
        <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
          {filtered.map((r) => {
            const completed = asBool(r.isCompleted)
            const voters = asInt(r.voteCount)
            const dateLabel = formatDateLabel(r.createdAt)
            const id = String(r.firestoreDocId)
            return (
              <article
                key={id}
                className={`flex flex-col gap-2 rounded-2xl border bg-white p-4 shadow-sm transition ${
                  completed
                    ? 'border-emerald-200/70'
                    : 'border-slate-200 hover:border-violet-200 hover:shadow-md'
                }`}
              >
                <div className="flex items-start justify-between gap-2">
                  <h3 className="line-clamp-2 text-base font-semibold leading-snug text-slate-900">
                    {asStr(r.title) || (
                      <span className="italic text-slate-400">
                        (untitled)
                      </span>
                    )}
                  </h3>
                  <span
                    className={`inline-flex shrink-0 items-center gap-1 rounded-full px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wider ring-1 ${
                      completed
                        ? 'bg-emerald-50 text-emerald-700 ring-emerald-200'
                        : 'bg-amber-50 text-amber-700 ring-amber-200'
                    }`}
                  >
                    {completed ? (
                      <CheckCircle2
                        className="size-3"
                        strokeWidth={2.5}
                        aria-hidden
                      />
                    ) : (
                      <CircleDot
                        className="size-3"
                        strokeWidth={2.5}
                        aria-hidden
                      />
                    )}
                    {completed ? 'Added' : 'Idea'}
                  </span>
                </div>
                {dateLabel ? (
                  <p className="-mt-1 flex items-center gap-1 text-xs font-medium text-slate-400">
                    <Calendar
                      className="size-3 shrink-0"
                      strokeWidth={2.25}
                      aria-hidden
                    />
                    Submitted {dateLabel}
                  </p>
                ) : null}
                {asStr(r.body).trim() !== '' ? (
                  <p className="line-clamp-5 whitespace-pre-wrap text-sm leading-relaxed text-slate-600">
                    {asStr(r.body)}
                  </p>
                ) : null}
                <div className="mt-auto flex flex-wrap items-center gap-x-3 gap-y-1 pt-2 text-[11px] text-slate-500">
                  <span
                    className="inline-flex items-center gap-1 rounded-full bg-violet-50 px-2 py-0.5 font-semibold text-violet-700 ring-1 ring-violet-200"
                    title={`${voters} vote${voters === 1 ? '' : 's'}`}
                  >
                    <ThumbsUp
                      className="size-3"
                      strokeWidth={2.5}
                      aria-hidden
                    />
                    {voters} {voters === 1 ? 'vote' : 'votes'}
                  </span>
                </div>
                <div className="-mx-1 flex flex-wrap gap-1 border-t border-slate-100 pt-2">
                  <button
                    type="button"
                    onClick={() => toggleCompleted(r)}
                    disabled={busyId === id}
                    className={`inline-flex flex-1 cursor-pointer items-center justify-center gap-1.5 rounded-lg px-2 py-1.5 text-xs font-semibold transition disabled:cursor-not-allowed disabled:opacity-50 ${
                      completed
                        ? 'text-slate-600 hover:bg-slate-100'
                        : 'bg-emerald-50 text-emerald-700 hover:bg-emerald-100'
                    }`}
                    title={
                      completed
                        ? 'Mark back as idea (un-add)'
                        : 'Mark as added / shipped'
                    }
                  >
                    <Check
                      className="size-3.5 shrink-0"
                      strokeWidth={2.5}
                      aria-hidden
                    />
                    {completed ? 'Mark as idea' : 'Mark as added'}
                  </button>
                  <button
                    type="button"
                    onClick={() => setEditorTarget(r)}
                    disabled={busyId === id}
                    className="inline-flex cursor-pointer items-center gap-1.5 rounded-lg px-2 py-1.5 text-xs font-semibold text-slate-600 transition hover:bg-slate-100 disabled:cursor-not-allowed disabled:opacity-50"
                    title="Edit idea"
                  >
                    <Pencil
                      className="size-3.5 shrink-0"
                      strokeWidth={2.5}
                      aria-hidden
                    />
                    Edit
                  </button>
                  <button
                    type="button"
                    onClick={() => setDeleteTarget(r)}
                    disabled={busyId === id}
                    className="inline-flex cursor-pointer items-center gap-1.5 rounded-lg px-2 py-1.5 text-xs font-semibold text-rose-600 transition hover:bg-rose-50 disabled:cursor-not-allowed disabled:opacity-50"
                    title="Delete idea"
                  >
                    <Trash2
                      className="size-3.5 shrink-0"
                      strokeWidth={2.5}
                      aria-hidden
                    />
                    Delete
                  </button>
                </div>
              </article>
            )
          })}
        </div>
      )}

      {/* Add / Edit modal */}
      {editorTarget ? (
        <EditorModal
          target={editorTarget}
          onClose={() => setEditorTarget(null)}
          onSave={saveEditor}
        />
      ) : null}

      {/* Delete confirm */}
      {deleteTarget ? (
        <DeleteConfirm
          row={deleteTarget}
          onCancel={() => setDeleteTarget(null)}
          onConfirm={confirmDelete}
          busy={busyId === String(deleteTarget.firestoreDocId)}
        />
      ) : null}

      {/* Toast */}
      {toast ? (
        <div
          role="status"
          aria-live="polite"
          className={`fixed bottom-6 left-1/2 z-50 -translate-x-1/2 rounded-xl px-4 py-2 text-sm font-semibold text-white shadow-lg ${
            toast.tone === 'success' ? 'bg-emerald-600' : 'bg-rose-600'
          }`}
        >
          {toast.message}
        </div>
      ) : null}
    </div>
  )
}

/**
 * @param {{
 *   target: Record<string, unknown> | 'new'
 *   onClose: () => void
 *   onSave: (v: { title: string, body: string }) => void
 * }} props
 */
function EditorModal({ target, onClose, onSave }) {
  const isNew = target === 'new'
  const initial = isNew ? null : /** @type {Record<string, unknown>} */ (target)
  const [title, setTitle] = useState(asStr(initial?.title))
  const [body, setBody] = useState(asStr(initial?.body))
  const [busy, setBusy] = useState(false)

  useEffect(() => {
    function onKey(e) {
      if (e.key === 'Escape' && !busy) onClose()
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [onClose, busy])

  async function handleSubmit(e) {
    e?.preventDefault?.()
    if (busy) return
    setBusy(true)
    try {
      await onSave({ title, body })
    } finally {
      setBusy(false)
    }
  }

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-slate-900/40 px-4 py-8 backdrop-blur-sm"
      onClick={(e) => {
        if (e.target === e.currentTarget && !busy) onClose()
      }}
    >
      <form
        onSubmit={handleSubmit}
        className="flex w-full max-w-lg flex-col gap-4 rounded-2xl bg-white p-6 shadow-2xl"
      >
        <header className="flex items-center justify-between gap-3">
          <div className="flex items-center gap-3">
            <div className="flex size-10 shrink-0 items-center justify-center rounded-xl bg-gradient-to-br from-violet-500 to-fuchsia-600 text-white shadow-md shadow-violet-900/20">
              <Sparkles className="size-5" strokeWidth={2.25} aria-hidden />
            </div>
            <h2 className="text-lg font-semibold text-slate-900">
              {isNew ? 'New user idea' : 'Edit idea'}
            </h2>
          </div>
          <button
            type="button"
            onClick={onClose}
            disabled={busy}
            className="cursor-pointer rounded-lg p-1.5 text-slate-400 transition hover:bg-slate-100 hover:text-slate-700 disabled:cursor-not-allowed disabled:opacity-50"
          >
            <X className="size-4" strokeWidth={2} aria-hidden />
          </button>
        </header>
        <div className="flex flex-col gap-1.5">
          <label className="text-[11px] font-semibold uppercase tracking-wider text-slate-600">
            Title <span className="text-rose-600">*</span>
          </label>
          <input
            type="text"
            value={title}
            onChange={(e) => setTitle(e.target.value)}
            autoFocus
            required
            maxLength={140}
            placeholder="What's the idea?"
            className="rounded-xl border border-slate-200 bg-slate-50 px-3 py-2 text-sm text-slate-800 placeholder:text-slate-400 focus:border-violet-400 focus:bg-white focus:outline-none focus:ring-2 focus:ring-violet-100"
          />
        </div>
        <div className="flex flex-col gap-1.5">
          <label className="flex items-baseline justify-between text-[11px] font-semibold uppercase tracking-wider text-slate-600">
            Description
            <span className="font-normal normal-case text-slate-400">
              optional
            </span>
          </label>
          <textarea
            value={body}
            onChange={(e) => setBody(e.target.value)}
            rows={5}
            placeholder="Optional detail, context, or rationale"
            className="min-h-[7rem] rounded-xl border border-slate-200 bg-slate-50 px-3 py-2 text-sm leading-relaxed text-slate-800 placeholder:text-slate-400 focus:border-violet-400 focus:bg-white focus:outline-none focus:ring-2 focus:ring-violet-100"
          />
        </div>
        <footer className="flex items-center justify-end gap-2">
          <button
            type="button"
            onClick={onClose}
            disabled={busy}
            className="cursor-pointer rounded-xl border border-slate-200 bg-white px-3 py-2 text-sm font-semibold text-slate-700 transition hover:border-slate-300 hover:bg-slate-50 disabled:cursor-not-allowed disabled:opacity-50"
          >
            Cancel
          </button>
          <button
            type="submit"
            disabled={busy || title.trim() === ''}
            className="inline-flex cursor-pointer items-center gap-1.5 rounded-xl bg-gradient-to-b from-violet-600 to-violet-700 px-4 py-2 text-sm font-semibold text-white shadow-md shadow-violet-900/25 transition hover:from-violet-700 hover:to-violet-800 disabled:cursor-not-allowed disabled:from-slate-300 disabled:to-slate-400 disabled:shadow-none"
          >
            {busy ? (
              <>
                <Loader2
                  className="size-4 animate-spin"
                  strokeWidth={2}
                  aria-hidden
                />
                Saving…
              </>
            ) : isNew ? (
              'Add idea'
            ) : (
              'Save changes'
            )}
          </button>
        </footer>
      </form>
    </div>
  )
}

/**
 * @param {{
 *   row: Record<string, unknown>
 *   onCancel: () => void
 *   onConfirm: () => void
 *   busy: boolean
 * }} props
 */
function DeleteConfirm({ row, onCancel, onConfirm, busy }) {
  useEffect(() => {
    function onKey(e) {
      if (e.key === 'Escape' && !busy) onCancel()
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [onCancel, busy])
  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-slate-900/40 px-4 py-8 backdrop-blur-sm"
      onClick={(e) => {
        if (e.target === e.currentTarget && !busy) onCancel()
      }}
    >
      <div className="flex w-full max-w-sm flex-col gap-4 rounded-2xl bg-white p-6 shadow-2xl">
        <div className="flex gap-3">
          <div className="flex size-10 shrink-0 items-center justify-center rounded-xl bg-rose-50 text-rose-600">
            <Trash2 className="size-5" strokeWidth={2.25} aria-hidden />
          </div>
          <div>
            <h2 className="text-base font-semibold text-slate-900">
              Delete this idea?
            </h2>
            <p className="mt-1 text-xs text-slate-600">
              "{asStr(row.title).slice(0, 80)}
              {asStr(row.title).length > 80 ? '…' : ''}" will be permanently
              removed.
            </p>
          </div>
        </div>
        <div className="flex items-center justify-end gap-2">
          <button
            type="button"
            onClick={onCancel}
            disabled={busy}
            className="cursor-pointer rounded-xl border border-slate-200 bg-white px-3 py-2 text-sm font-semibold text-slate-700 transition hover:border-slate-300 hover:bg-slate-50 disabled:cursor-not-allowed disabled:opacity-50"
          >
            Cancel
          </button>
          <button
            type="button"
            onClick={onConfirm}
            disabled={busy}
            className="inline-flex cursor-pointer items-center gap-1.5 rounded-xl bg-gradient-to-b from-rose-600 to-rose-700 px-3 py-2 text-sm font-semibold text-white shadow-md shadow-rose-900/25 transition hover:from-rose-700 hover:to-rose-800 disabled:cursor-not-allowed disabled:from-slate-300 disabled:to-slate-400"
          >
            {busy ? (
              <>
                <Loader2
                  className="size-4 animate-spin"
                  strokeWidth={2}
                  aria-hidden
                />
                Deleting…
              </>
            ) : (
              'Delete'
            )}
          </button>
        </div>
      </div>
    </div>
  )
}
