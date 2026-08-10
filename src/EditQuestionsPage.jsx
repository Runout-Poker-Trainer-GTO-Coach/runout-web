import {
  AlertCircle,
  AlertTriangle,
  ArrowDownAZ,
  ArrowDownWideNarrow,
  ArrowUpAZ,
  BarChart3,
  Check,
  ChevronDown,
  Copy,
  Download,
  Eye,
  EyeOff,
  Filter,
  Flag,
  Gauge,
  Inbox,
  Info,
  Keyboard,
  Languages,
  Layers,
  ListChecks,
  Loader2,
  MessageCircleQuestion,
  Pencil,
  Plus,
  Save,
  Search,
  SearchX,
  Settings2,
  Sparkles,
  StickyNote,
  Table2,
  Tags,
  Target,
  Trash2,
  Upload,
  UsersRound,
  X,
} from 'lucide-react'
import {
  Fragment,
  startTransition,
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
} from 'react'
import {
  collection,
  doc,
  documentId,
  getDocs,
  query,
  serverTimestamp,
  setDoc,
  updateDoc,
  where,
  writeBatch,
} from 'firebase/firestore'
import { useVirtualizer } from '@tanstack/react-virtual'
import { read, utils, writeFile } from 'xlsx'
import { db, firebaseReady, questionsCollectionName } from './firebase'
import {
  answerPctToneClass,
  answerStatsForRow,
  displayScalar,
  formatOptionsSummary,
  isDeletedQuestionRow,
  questionDocToRow,
  questionPreviewText,
  questionRowMatchesSearch,
} from './questionRow.js'
import ReportsModal from './ReportsModal.jsx'
// Sheet view temporarily hidden — import kept commented for easy revival.
// import SheetView from './SheetView.jsx'

/* -------------------------------------------------------------------------- */
/* Helpers                                                                    */
/* -------------------------------------------------------------------------- */

/**
 * Firestore sometimes deserializes arrays as objects with numeric keys; mirror
 * the same normalizer the read-only Questions page uses.
 *
 * @param {unknown} v
 */
function normalizeReportsField(v) {
  if (Array.isArray(v)) return v
  if (v && typeof v === 'object' && !Array.isArray(v)) {
    const o = /** @type {Record<string, unknown>} */ (v)
    const keys = Object.keys(o).filter((k) => /^\d+$/.test(k))
    if (keys.length > 0) {
      return keys
        .sort((a, b) => Number(a) - Number(b))
        .map((k) => o[k])
    }
  }
  return []
}

/** @param {unknown} row */
function getReportsArray(row) {
  if (!row || typeof row !== 'object') return []
  return normalizeReportsField(
    /** @type {Record<string, unknown>} */ (row).reports,
  )
}

/**
 * Up to four answer options stored as `option_1`…`option_4`. Returns the
 * non-empty options, preserving order.
 *
 * @param {Record<string, unknown>} row
 */
function getOptionsList(row) {
  /** @type {Array<{ index: number, text: string }>} */
  const out = []
  for (let i = 1; i <= 4; i++) {
    const v = row[`option_${i}`]
    if (typeof v === 'string' && v.trim()) {
      out.push({ index: i, text: v.trim() })
    }
  }
  return out
}

/** @param {Record<string, unknown>} row */
function correctOptionIndex(row) {
  // 1) Text-based `correct_answer` matching one of the options.
  const text =
    typeof row.correct_answer === 'string' ? row.correct_answer.trim() : ''
  if (text) {
    for (let i = 1; i <= 4; i++) {
      const opt = row[`option_${i}`]
      if (typeof opt === 'string' && opt.trim() === text) return i
    }
  }
  // 2) Legacy numeric `correct_option` / `correctOption` / `answer` index.
  for (const k of ['correct_option', 'correctOption', 'answer']) {
    const v = row[k]
    if (v == null || v === '') continue
    const n = Number(v)
    if (Number.isFinite(n) && n >= 1 && n <= 4) return n
  }
  return null
}

/**
 * Ascending compare on `firestoreDocId` that handles all-digit ids numerically.
 *
 * @param {{ firestoreDocId: string }} a
 * @param {{ firestoreDocId: string }} b
 */
function compareDocIdAsc(a, b) {
  const idA = String(a.firestoreDocId ?? '')
  const idB = String(b.firestoreDocId ?? '')
  const digA = /^\d+$/.test(idA)
  const digB = /^\d+$/.test(idB)
  if (digA && digB) {
    const na = Number(idA)
    const nb = Number(idB)
    if (na !== nb) return na - nb
    return idA.localeCompare(idB)
  }
  if (digA !== digB) return digA ? -1 : 1
  return idA.localeCompare(idB, undefined, { numeric: true, sensitivity: 'base' })
}

/**
 * Persist a piece of state to sessionStorage under `key`. Reads on mount;
 * writes after every change. Mirrors the pattern used elsewhere in this admin
 * panel (see `adminAuth.js`).
 *
 * @template T
 * @param {string} key
 * @param {T} initial
 * @param {{ parse?: (raw: string) => T, serialize?: (v: T) => string }} [opts]
 * @returns {[T, (v: T | ((s: T) => T)) => void]}
 */
function usePersistedSessionState(key, initial, opts) {
  const serialize = opts?.serialize ?? JSON.stringify
  const parse = opts?.parse ?? JSON.parse
  const [value, setValue] = useState(() => {
    try {
      const raw = sessionStorage.getItem(key)
      if (raw == null) return initial
      return parse(raw)
    } catch {
      return initial
    }
  })
  useEffect(() => {
    try {
      sessionStorage.setItem(key, serialize(value))
    } catch {
      /* ignore quota or private-mode errors */
    }
  }, [key, value, serialize])
  return [value, setValue]
}

/**
 * Returns a value that lags behind `input` by `delayMs` — useful for
 * filtering large lists without re-running on every keystroke.
 *
 * @template T
 * @param {T} input
 * @param {number} delayMs
 */
function useDebouncedValue(input, delayMs) {
  const [debounced, setDebounced] = useState(input)
  useEffect(() => {
    const id = setTimeout(() => setDebounced(input), delayMs)
    return () => clearTimeout(id)
  }, [input, delayMs])
  return debounced
}

/** Escape special regex chars in a user-typed search query. */
function escapeRegExp(s) {
  return s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
}

/**
 * Split a string into highlight segments around case-insensitive matches of
 * `query`. Returns a flat array suitable for rendering: alternating plain
 * strings and `{ match: string }` segments.
 *
 * @param {string} text
 * @param {string} query
 * @returns {Array<string | { match: string }>}
 */
function highlightSegments(text, query) {
  const q = query.trim()
  if (!q || !text) return [text]
  /** @type {Array<string | { match: string }>} */
  const out = []
  const re = new RegExp(`(${escapeRegExp(q)})`, 'gi')
  let last = 0
  let m
  while ((m = re.exec(text)) !== null) {
    if (m.index > last) out.push(text.slice(last, m.index))
    out.push({ match: m[0] })
    last = m.index + m[0].length
    if (m.index === re.lastIndex) re.lastIndex++ // guard against empty match
  }
  if (last < text.length) out.push(text.slice(last))
  return out
}

/**
 * Render highlighted text segments produced by {@link highlightSegments}.
 *
 * @param {{ text: string, query: string }} props
 */
function HighlightedText({ text, query }) {
  const segments = highlightSegments(text, query)
  return (
    <>
      {segments.map((seg, i) =>
        typeof seg === 'string' ? (
          seg
        ) : (
          <mark
            key={i}
            className="rounded bg-amber-200/70 px-0.5 text-slate-900"
          >
            {seg.match}
          </mark>
        ),
      )}
    </>
  )
}

const FIELD_TOGGLES = /** @type {const} */ ([
  { key: 'context', label: 'Context' },
  { key: 'type', label: 'Type' },
  { key: 'options', label: 'Options' },
  { key: 'reports', label: 'Active reports' },
])

/* -------------------------------------------------------------------------- */
/* Page                                                                       */
/* -------------------------------------------------------------------------- */

/**
 * Rich card-based question editor — the default content for the
 * "Questions" section, rendered inside AdminLayout (sidebar + top bar
 * stay visible). `onShowTableView` switches to the simpler read-only
 * QuestionsPage table.
 *
 * @param {{ onShowTableView: () => void }} props
 */
export default function EditQuestionsPage({ onShowTableView }) {
  const [rows, setRows] = useState(
    /** @type {Array<{ firestoreDocId: string } & Record<string, unknown>>} */ (
      []
    ),
  )
  const [loading, setLoading] = useState(!!firebaseReady)
  const [error, setError] = useState(/** @type {string | null} */ (null))
  const [toast, setToast] = useState(
    /** @type {{ tone: 'success' | 'error', message: string } | null} */ (null),
  )

  // Search is not persisted — it's a transient query. The rest of the view
  // state survives across page navigations within the session.
  const [search, setSearch] = useState('')
  const debouncedSearch = useDebouncedValue(search, 150)

  const [typeFilter, setTypeFilter] = usePersistedSessionState(
    'edit-questions:typeFilter',
    'all',
  )
  const [handStageFilter, setHandStageFilter] = usePersistedSessionState(
    'edit-questions:handStageFilter',
    'all',
  )
  const [cashTourneyFilter, setCashTourneyFilter] = usePersistedSessionState(
    'edit-questions:cashTourneyFilter',
    'all',
  )
  const [liveOnlineFilter, setLiveOnlineFilter] = usePersistedSessionState(
    'edit-questions:liveOnlineFilter',
    'all',
  )
  // Not persisted like the other filters below — this page's primary job is
  // triaging reported questions, so every fresh visit (reload or navigating
  // back from another section) must land on "With active reports" rather
  // than remembering a one-off "All reports" browse from earlier.
  const [reportsFilter, setReportsFilter] = useState(
    /** @type {'all' | 'with' | 'without'} */ ('with'),
  )
  const [onlyBroken, setOnlyBroken] = usePersistedSessionState(
    'edit-questions:onlyBroken',
    false,
  )
  const [sortMode, setSortMode] = usePersistedSessionState(
    'edit-questions:sortMode',
    /** @type {'id_asc' | 'id_desc' | 'reports_desc'} */ ('id_asc'),
  )
  // Which language the user is viewing / editing. New questions are still
  // always authored in English; switching this only changes how existing
  // questions are displayed and how the Edit modal stores their content.
  const [activeLanguage, setActiveLanguage] = usePersistedSessionState(
    'edit-questions:lang',
    'en',
  )

  // Insights overlay
  const [insightsOpen, setInsightsOpen] = useState(false)
  // CSV upload overlay
  const [uploadOpen, setUploadOpen] = useState(false)

  const [showShortcutsHint, setShowShortcutsHint] = useState(false)

  const searchInputRef = useRef(/** @type {HTMLInputElement | null} */ (null))

  const [fieldsOpen, setFieldsOpen] = useState(false)
  const [visibleFields, setVisibleFields] = usePersistedSessionState(
    'edit-questions:visibleFields',
    {
      context: true,
      type: true,
      options: true,
      reports: true,
    },
  )
  const [lastAddedId, setLastAddedId] = useState(
    /** @type {string | null} */ (null),
  )

  // Defensively clear any leftover Sheet view state (the feature is hidden
  // for now). Without this, a user who had it open before this change would
  // still see the overlay after a refresh.
  useEffect(() => {
    try {
      localStorage.removeItem('edit-questions:sheet-open')
      localStorage.removeItem('edit-questions:sheet-edits')
    } catch {
      /* ignore */
    }
  }, [])

  /** @type {{ mode: 'add' } | { mode: 'edit', row: any } | { mode: 'duplicate', row: any } | null} */
  const [editorState, setEditorState] = useState(null)
  /** @type {(({ firestoreDocId: string } & Record<string, unknown>) | null)} */
  const [viewingReportsRow, setViewingReportsRow] = useState(null)
  /** @type {(({ firestoreDocId: string } & Record<string, unknown>) | null)} */
  const [previewingRow, setPreviewingRow] = useState(null)
  const [deletingRow, setDeletingRow] = useState(
    /** @type {({ firestoreDocId: string } & Record<string, unknown>) | null} */ (
      null
    ),
  )
  const [savingEditor, setSavingEditor] = useState(false)
  const [deletingBusy, setDeletingBusy] = useState(false)

  // Mass delete: a "Select" mode toggle that shows a checkbox per card
  // instead of opening the editor on click, plus a bulk soft-delete flow.
  const [selectMode, setSelectMode] = useState(false)
  const [selectedIds, setSelectedIds] = useState(
    /** @type {Set<string>} */ (new Set()),
  )
  const [bulkDeleteConfirmOpen, setBulkDeleteConfirmOpen] = useState(false)
  const [bulkDeleteBusy, setBulkDeleteBusy] = useState(false)

  const fieldsButtonRef = useRef(/** @type {HTMLButtonElement | null} */ (null))
  const fieldsPopoverRef = useRef(/** @type {HTMLDivElement | null} */ (null))

  /* ------------------------------- Load data ----------------------------- */

  useEffect(() => {
    if (!firebaseReady || !db) {
      setLoading(false)
      return
    }
    let cancelled = false
    setLoading(true)
    setError(null)

    ;(async () => {
      try {
        const snap = await getDocs(collection(db, questionsCollectionName))
        if (cancelled) return
        const list = snap.docs
          .map((d) => questionDocToRow(d.id, d.data()))
          .filter((r) => !isDeletedQuestionRow(r))
        setRows(list)
      } catch (e) {
        if (!cancelled) {
          setError(e?.message || 'Failed to load questions')
          setRows([])
        }
      } finally {
        if (!cancelled) setLoading(false)
      }
    })()

    return () => {
      cancelled = true
    }
  }, [])

  /* ------------------------------ Mass delete ----------------------------- */

  const toggleSelectMode = useCallback(() => {
    setSelectMode((v) => !v)
    setSelectedIds(new Set())
  }, [])

  const toggleSelected = useCallback((docId) => {
    setSelectedIds((prev) => {
      const next = new Set(prev)
      if (next.has(docId)) next.delete(docId)
      else next.add(docId)
      return next
    })
  }, [])

  const clearSelection = useCallback(() => {
    setSelectedIds(new Set())
  }, [])

  const handleConfirmBulkDelete = useCallback(async () => {
    if (!db || selectedIds.size === 0) return
    setBulkDeleteBusy(true)
    setError(null)

    const ids = Array.from(selectedIds)
    const snapshot = rows
    // Optimistic remove
    setRows((prev) => prev.filter((r) => !selectedIds.has(r.firestoreDocId)))

    try {
      // Same soft-delete contract as the single-question path: ONLY the
      // deletion markers, via a merge-style batch update. Never blank/
      // overwrite the rest of each doc — see handleConfirmDelete above.
      const MAX_BATCH = 500
      for (let i = 0; i < ids.length; i += MAX_BATCH) {
        const chunk = ids.slice(i, i + MAX_BATCH)
        const batch = writeBatch(db)
        for (const id of chunk) {
          batch.update(doc(db, questionsCollectionName, id), {
            isDeleted: true,
            updatedAt: serverTimestamp(),
          })
        }
        await batch.commit()
      }
      setToast({
        tone: 'success',
        message: `${ids.length} question${ids.length === 1 ? '' : 's'} deleted`,
      })
      setBulkDeleteConfirmOpen(false)
      setSelectedIds(new Set())
      setSelectMode(false)
    } catch (e) {
      // Roll back
      setRows(snapshot)
      const msg = e?.message || 'Failed to delete questions'
      setError(msg)
      setToast({ tone: 'error', message: msg })
    } finally {
      setBulkDeleteBusy(false)
    }
  }, [selectedIds, rows])

  /* ------------------------------ Escape key ----------------------------- */

  useEffect(() => {
    function onKey(e) {
      if (e.key !== 'Escape') return
      if (bulkDeleteConfirmOpen) {
        if (!bulkDeleteBusy) setBulkDeleteConfirmOpen(false)
        return
      }
      if (deletingRow) {
        if (!deletingBusy) setDeletingRow(null)
        return
      }
      if (editorState) {
        if (!savingEditor) setEditorState(null)
        return
      }
      // ReportsModal / Insights / Upload manage their own Escape — defer
      // to them so the parent doesn't also pop out of the Edit Questions view.
      if (viewingReportsRow || insightsOpen || uploadOpen || previewingRow) return
      if (fieldsOpen) {
        setFieldsOpen(false)
        return
      }
      if (selectMode) {
        toggleSelectMode()
        return
      }
      onShowTableView()
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [
    onShowTableView,
    bulkDeleteConfirmOpen,
    bulkDeleteBusy,
    deletingRow,
    deletingBusy,
    editorState,
    savingEditor,
    viewingReportsRow,
    previewingRow,
    insightsOpen,
    uploadOpen,
    fieldsOpen,
    selectMode,
    toggleSelectMode,
  ])

  /* --------------------------- Fields popover ---------------------------- */

  useEffect(() => {
    if (!fieldsOpen) return
    function onDocClick(e) {
      if (
        fieldsPopoverRef.current &&
        !fieldsPopoverRef.current.contains(e.target) &&
        fieldsButtonRef.current &&
        !fieldsButtonRef.current.contains(e.target)
      ) {
        setFieldsOpen(false)
      }
    }
    document.addEventListener('mousedown', onDocClick)
    return () => document.removeEventListener('mousedown', onDocClick)
  }, [fieldsOpen])

  /* ------------------------------- Toast --------------------------------- */

  useEffect(() => {
    if (!toast) return
    const t = setTimeout(() => setToast(null), 3500)
    return () => clearTimeout(t)
  }, [toast])

  // Clear the new-row pulse highlight after the animation has had time to play.
  useEffect(() => {
    if (!lastAddedId) return
    const t = setTimeout(() => setLastAddedId(null), 2500)
    return () => clearTimeout(t)
  }, [lastAddedId])

  /* ------------------------------ Filtering ------------------------------ */

  const typeOptions = useMemo(() => {
    /** @type {Set<string>} */
    const set = new Set()
    for (const r of rows) {
      const t = r.question_type
      if (t != null && t !== '') set.add(String(t))
    }
    return Array.from(set).sort((a, b) =>
      a.localeCompare(b, undefined, { sensitivity: 'base' }),
    )
  }, [rows])

  // Distinct values for the secondary filter dropdowns, derived from data.
  const distinctValuesFor = useCallback(
    (key) => {
      /** @type {Map<string, string>} */
      const map = new Map() // lowercase → original label
      for (const r of rows) {
        const v = r[key]
        if (v == null || v === '') continue
        const s = String(v).trim()
        if (!s) continue
        const lc = s.toLowerCase()
        if (!map.has(lc)) map.set(lc, s)
      }
      return Array.from(map.entries())
        .map(([value, label]) => ({ value, label }))
        .sort((a, b) =>
          a.label.localeCompare(b.label, undefined, { sensitivity: 'base' }),
        )
    },
    [rows],
  )
  const handStageOptions = useMemo(
    () => distinctValuesFor('hand_stage'),
    [distinctValuesFor],
  )
  const cashTourneyOptions = useMemo(
    () => distinctValuesFor('cash_or_tournament'),
    [distinctValuesFor],
  )
  const liveOnlineOptions = useMemo(
    () => distinctValuesFor('live_or_online'),
    [distinctValuesFor],
  )

  const filteredRows = useMemo(() => {
    let list = rows
    const q = debouncedSearch.trim().toLowerCase()
    if (q)
      list = list.filter((r) =>
        questionRowMatchesSearch(r, q, { includeAnswerExplanation: true }),
      )
    if (typeFilter !== 'all') {
      list = list.filter((r) => String(r.question_type ?? '') === typeFilter)
    }
    if (handStageFilter !== 'all') {
      list = list.filter(
        (r) => String(r.hand_stage ?? '').toLowerCase() === handStageFilter,
      )
    }
    if (cashTourneyFilter !== 'all') {
      list = list.filter(
        (r) =>
          String(r.cash_or_tournament ?? '').toLowerCase() === cashTourneyFilter,
      )
    }
    if (liveOnlineFilter !== 'all') {
      list = list.filter(
        (r) =>
          String(r.live_or_online ?? '').toLowerCase() === liveOnlineFilter,
      )
    }
    if (reportsFilter === 'with') {
      list = list.filter((r) => getReportsArray(r).length > 0)
    } else if (reportsFilter === 'without') {
      list = list.filter((r) => getReportsArray(r).length === 0)
    }
    if (onlyBroken) {
      list = list.filter((r) => {
        const opts = getOptionsList(r)
        return opts.length === 0 || correctOptionIndex(r) == null
      })
    }
    return list
  }, [
    rows,
    debouncedSearch,
    typeFilter,
    handStageFilter,
    cashTourneyFilter,
    liveOnlineFilter,
    reportsFilter,
    onlyBroken,
  ])

  const sortedRows = useMemo(() => {
    const copy = [...filteredRows]
    if (sortMode === 'id_desc') {
      copy.sort((a, b) => -compareDocIdAsc(a, b))
    } else if (sortMode === 'reports_desc') {
      copy.sort((a, b) => {
        const diff = getReportsArray(b).length - getReportsArray(a).length
        if (diff !== 0) return diff
        return compareDocIdAsc(a, b)
      })
    } else {
      copy.sort(compareDocIdAsc)
    }
    return copy
  }, [filteredRows, sortMode])

  // Virtualized scroll — only render cards near the viewport, scales to
  // tens of thousands of rows without freezing.
  const scrollParentRef = useRef(
    /** @type {HTMLDivElement | null} */ (null),
  )
  const virtualizer = useVirtualizer({
    count: sortedRows.length,
    getScrollElement: () => scrollParentRef.current,
    estimateSize: () => 180,
    overscan: 6,
    getItemKey: (i) => sortedRows[i]?.firestoreDocId ?? i,
  })

  // Reset scroll to top whenever the visible list changes meaningfully —
  // otherwise scrolling stays anchored to a row that may no longer exist.
  useEffect(() => {
    scrollParentRef.current?.scrollTo({ top: 0 })
  }, [
    debouncedSearch,
    typeFilter,
    handStageFilter,
    cashTourneyFilter,
    liveOnlineFilter,
    reportsFilter,
    onlyBroken,
    sortMode,
  ])

  // Global keyboard shortcuts (no-op while a modal or input is focused).
  useEffect(() => {
    function onKey(e) {
      const t = /** @type {HTMLElement | null} */ (e.target)
      if (
        t &&
        (t.tagName === 'INPUT' ||
          t.tagName === 'TEXTAREA' ||
          t.tagName === 'SELECT' ||
          t.isContentEditable)
      ) {
        return
      }
      if (
        editorState ||
        deletingRow ||
        viewingReportsRow ||
        previewingRow ||
        fieldsOpen ||
        insightsOpen ||
        uploadOpen
      )
        return
      if (e.metaKey || e.ctrlKey || e.altKey) return

      if (e.key === '/') {
        e.preventDefault()
        searchInputRef.current?.focus()
        searchInputRef.current?.select()
      } else if (e.key === 'u' || e.key === 'U') {
        e.preventDefault()
        if (!loading) setUploadOpen(true)
      } else if (e.key === '?') {
        e.preventDefault()
        setShowShortcutsHint((v) => !v)
      } else if (e.key === 'Home') {
        e.preventDefault()
        scrollParentRef.current?.scrollTo({ top: 0, behavior: 'smooth' })
      } else if (e.key === 'End') {
        e.preventDefault()
        const el = scrollParentRef.current
        if (el) el.scrollTo({ top: el.scrollHeight, behavior: 'smooth' })
      }
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [
    editorState,
    deletingRow,
    viewingReportsRow,
    previewingRow,
    fieldsOpen,
    insightsOpen,
    uploadOpen,
    loading,
  ])

  const reportedCount = useMemo(
    () => rows.filter((r) => getReportsArray(r).length > 0).length,
    [rows],
  )

  // Map of numeric id → firestoreDocId for duplicate-id detection in the form.
  const existingNumericIds = useMemo(() => {
    /** @type {Map<string, string>} */
    const map = new Map()
    for (const r of rows) {
      if (r.id != null && r.id !== '') {
        map.set(String(r.id), r.firestoreDocId)
      }
    }
    return map
  }, [rows])

  // Map of numeric id → the FULL existing row. Powers two checks in the
  // CSV upload modal:
  //  1. Translatable-fields diff → decides whether to flip
  //     `isTranslated_es: false` on an UPDATE.
  //  2. Full-row diff → matched rows that already equal the incoming CSV
  //     are classified UNCHANGED and skipped entirely (no Firestore write).
  // Replaces the older `existingByNumericId` — same source, richer
  // payload — so we don't recompute two maps from the same `rows`.
  const existingByNumericId = useMemo(() => {
    /** @type {Map<string, Record<string, unknown>>} */
    const map = new Map()
    for (const r of rows) {
      if (r.id == null || r.id === '') continue
      map.set(String(r.id), r)
    }
    return map
  }, [rows])

  // Next available numeric id = max(existing) + 1, walking past any conflicts.
  const nextNumericId = useMemo(() => {
    let max = 0
    for (const r of rows) {
      const n = Number(r.id)
      if (Number.isFinite(n) && n > max) max = n
    }
    let candidate = max + 1
    while (existingNumericIds.has(String(candidate))) candidate++
    return candidate
  }, [rows, existingNumericIds])

  /* ------------------------------ Mutations ------------------------------ */

  /**
   * Apply form values to a row, preserving any unknown fields that already
   * exist on the document. Returns the patch to send to Firestore. String
   * fields are trimmed; empty strings become `null` so we don't pollute the
   * document with empty values.
   *
   * @param {ReturnType<typeof emptyFormValues>} form
   */
  function formToPatch(form) {
    /** @type {Record<string, unknown>} */
    const patch = {}
    for (const f of FORM_FIELDS) {
      const raw = (form[f.key] ?? '').trim()
      // Coerce numeric fields when the value parses cleanly; otherwise store
      // the raw string (some docs use string ids like "42a").
      if (f.key === 'id' || f.key === 'difficulty_rating') {
        if (raw === '') patch[f.key] = null
        else {
          const n = Number(raw)
          patch[f.key] = Number.isFinite(n) ? n : raw
        }
      } else {
        patch[f.key] = raw === '' ? null : raw
      }
    }
    return patch
  }

  const onTranslateError = useCallback((err) => {
    setError(
      `Saved successfully, but the translation request failed: ${err.message}`,
    )
  }, [])

  const handleSaveEditor = useCallback(
    async (form, opts) => {
      if (!db || !editorState) return false
      const keepOpen = opts?.keepOpen === true
      // Add/Duplicate are always English; Edit follows the language the
      // modal was opened in. Defaults to 'en' if the caller doesn't pass one.
      const saveLang = opts?.language || 'en'
      setSavingEditor(true)
      setError(null)
      const patch = formToPatch(form)

      try {
        if (editorState.mode === 'add' || editorState.mode === 'duplicate') {
          const base =
            editorState.mode === 'duplicate' ? { ...editorState.row } : {}
          // Strip identity / report / translation-state fields from a
          // duplicate template — the new doc needs its own translation pass.
          delete base.firestoreDocId
          delete base.reports
          delete base.reportCounts
          delete base.isTranslated_es
          // Strip every nested language translation too — leaving the
          // source's `es` (or future `fr`, etc.) attached would let stale
          // translations flash on the duplicate until the cloud function
          // overwrites them.
          for (const l of SUPPORTED_LANGUAGES) {
            if (l.code !== 'en') delete base[l.code]
          }
          // New content always needs translation.
          patch.isTranslated_es = false
          // Stamp the document with server-side UTC timestamps. `createdAt`
          // is set once on insert; `updatedAt` mirrors it now and is bumped
          // on every later edit.
          const payload = {
            ...base,
            ...patch,
            createdAt: serverTimestamp(),
            updatedAt: serverTimestamp(),
          }
          // Use the numeric id as the Firestore document path so the doc
          // ID matches our `id` field — keeps the console readable and
          // makes direct-path lookups possible everywhere. Falls back to
          // a random id only if `payload.id` is somehow blank.
          const explicitId =
            payload.id != null && String(payload.id).trim() !== ''
              ? String(payload.id).trim()
              : null
          const ref = explicitId
            ? doc(collection(db, questionsCollectionName), explicitId)
            : doc(collection(db, questionsCollectionName))
          await setDoc(ref, payload)
          const newRow = {
            firestoreDocId: ref.id,
            ...base,
            ...patch,
          }
          setRows((prev) => [newRow, ...prev])
          setLastAddedId(ref.id)
          triggerQuestionTranslation(onTranslateError)
          setToast({
            tone: 'success',
            message:
              editorState.mode === 'duplicate'
                ? 'Question duplicated · translation queued'
                : keepOpen
                  ? 'Question created · translation queued · add another'
                  : 'Question created · translation queued',
          })
        } else {
          const target = editorState.row
          if (!target?.firestoreDocId) return
          const prevRow = rows.find(
            (r) => r.firestoreDocId === target.firestoreDocId,
          )

          /** @type {Record<string, unknown>} */
          let writePatch
          /** @type {Record<string, unknown>} */
          let optimisticPatch
          let needsTranslation = false
          let statusFlag = `isTranslated_${saveLang}`

          if (saveLang === 'en') {
            // Standard English edit: write top-level keys. Invalidate the
            // existing translation only when translatable content changed.
            needsTranslation = hasTranslatableContentChange(patch, target)
            writePatch = { ...patch }
            optimisticPatch = { ...patch }
            if (needsTranslation) {
              writePatch.isTranslated_es = false
              optimisticPatch.isTranslated_es = false
            }
          } else {
            // Non-English edit:
            //  - Translatable fields go into nested `${lang}.field` via
            //    Firestore dot notation so we don't clobber siblings.
            //  - Non-translatable fields still update at the top level
            //    (they are language-agnostic).
            //  - Mark `isTranslated_${lang}: true` since this is a manual
            //    edit and don't fire the auto-translate cloud function.
            writePatch = {}
            const nextNested = {
              ...((target[saveLang] && typeof target[saveLang] === 'object')
                ? target[saveLang]
                : {}),
            }
            for (const [k, v] of Object.entries(patch)) {
              if (
                /** @type {readonly string[]} */ (TRANSLATABLE_FIELDS).includes(
                  k,
                )
              ) {
                writePatch[`${saveLang}.${k}`] = v
                nextNested[k] = v
              } else {
                writePatch[k] = v
              }
            }
            writePatch[statusFlag] = true
            optimisticPatch = { ...patch, [saveLang]: nextNested, [statusFlag]: true }
            // Strip translatable top-level fields from the optimistic patch
            // so the local row doesn't drift away from the English version.
            for (const f of TRANSLATABLE_FIELDS) delete optimisticPatch[f]
          }

          // Optimistic update
          setRows((prev) =>
            prev.map((r) =>
              r.firestoreDocId !== target.firestoreDocId
                ? r
                : { ...r, ...optimisticPatch },
            ),
          )
          try {
            await updateDoc(
              doc(db, questionsCollectionName, target.firestoreDocId),
              { ...writePatch, updatedAt: serverTimestamp() },
            )
            if (needsTranslation) triggerQuestionTranslation(onTranslateError)
            setToast({
              tone: 'success',
              message:
                saveLang !== 'en'
                  ? `Saved ${saveLang.toUpperCase()} translation`
                  : needsTranslation
                    ? 'Question updated · translation queued'
                    : 'Question updated',
            })
          } catch (e) {
            if (prevRow) {
              setRows((prev) =>
                prev.map((r) =>
                  r.firestoreDocId === target.firestoreDocId ? prevRow : r,
                ),
              )
            }
            throw e
          }
        }
        if (!keepOpen) setEditorState(null)
        return true
      } catch (e) {
        const msg = e?.message || 'Failed to save question'
        setError(msg)
        setToast({ tone: 'error', message: msg })
        return false
      } finally {
        setSavingEditor(false)
      }
    },
    [editorState, rows, onTranslateError],
  )

  /**
   * Persist a CSV's worth of CREATE + UPDATE operations across one or more
   * Firestore batches. Earlier chunks that succeed are NEVER lost on a
   * later failure — the function returns a structured result so the caller
   * can update local state with what landed and surface a precise error.
   *
   * @param {Array<
   *   | { kind: 'create', payload: Record<string, unknown> }
   *   | { kind: 'update', firestoreDocId: string, patch: Record<string, unknown> }
   * >} ops  Tagged-union operation list. Each create assigns a new doc id
   *   via `doc(col)`; each update targets an existing doc id directly.
   * @param {(p: { done: number, total: number }) => void} [onProgress]
   *   Called once after each successful batch commit so the UI can advance
   *   a progress bar in real time.
   * @returns {Promise<{
   *   created: Array<{ firestoreDocId: string } & Record<string, unknown>>
   *   updated: Array<{ firestoreDocId: string } & Record<string, unknown>>
   *   failedChunkIndex: number | null
   *   failedRowCount: number
   *   error: Error | null
   * }>}
   */
  const writeUploadedQuestions = useCallback(async (ops, onProgress) => {
    if (!db) throw new Error('Firestore is not available')
    /** @type {Array<{ firestoreDocId: string } & Record<string, unknown>>} */
    const created = []
    /** @type {Array<{ firestoreDocId: string } & Record<string, unknown>>} */
    const updated = []
    // Firestore batches max out at 500 ops. Chunk to stay safely under.
    const CHUNK = 400
    const col = collection(db, questionsCollectionName)
    const total = ops.length
    let chunkIndex = 0
    for (let i = 0; i < ops.length; i += CHUNK, chunkIndex++) {
      const slice = ops.slice(i, i + CHUNK)
      // Pre-resolve doc refs for both branches:
      //  - create → `doc(col, payload.id)` so the Firestore document path
      //    equals our numeric id ("1111", "1112", …). Without this Firestore
      //    auto-generates a 20-char random key, which makes the console
      //    unreadable and forces every lookup through a `where('id','==')`
      //    query instead of a direct path read.
      //  - update → target the existing doc id (could be numeric or, for
      //    legacy random-id records, the original random key).
      const refs = slice.map((op) =>
        op.kind === 'create'
          ? doc(col, String(op.payload.id))
          : doc(col, op.firestoreDocId),
      )
      const batch = writeBatch(db)
      slice.forEach((op, idx) => {
        if (op.kind === 'create') batch.set(refs[idx], op.payload)
        else batch.update(refs[idx], op.patch)
      })
      try {
        await batch.commit()
      } catch (err) {
        return {
          created,
          updated,
          failedChunkIndex: chunkIndex,
          failedRowCount: total - created.length - updated.length,
          error: err instanceof Error ? err : new Error(String(err)),
        }
      }
      slice.forEach((op, idx) => {
        if (op.kind === 'create') {
          created.push({ firestoreDocId: refs[idx].id, ...op.payload })
        } else {
          updated.push({ firestoreDocId: op.firestoreDocId, ...op.patch })
        }
      })
      onProgress?.({
        done: created.length + updated.length,
        total,
      })
    }
    return {
      created,
      updated,
      failedChunkIndex: null,
      failedRowCount: 0,
      error: null,
    }
  }, [])

  /**
   * Re-fetch the just-uploaded documents by their Firestore ids so that
   * `serverTimestamp()` sentinels in the optimistic local rows are replaced
   * with the real server-stamped values — and any concurrent edits from the
   * translation cloud function are pulled in too.
   *
   * Firestore allows at most 30 values per `in` clause, so we chunk and
   * fan out the reads in parallel.
   *
   * @param {string[]} docIds  Firestore document ids to hydrate.
   * @returns {Promise<Array<ReturnType<typeof questionDocToRow>>>}
   */
  const refetchByDocIds = useCallback(async (docIds) => {
    if (!db || docIds.length === 0) return []
    const col = collection(db, questionsCollectionName)
    const CHUNK = 30
    /** @type {Array<Promise<ReturnType<typeof getDocs>>>} */
    const reads = []
    for (let i = 0; i < docIds.length; i += CHUNK) {
      const slice = docIds.slice(i, i + CHUNK)
      reads.push(getDocs(query(col, where(documentId(), 'in', slice))))
    }
    const snaps = await Promise.all(reads)
    return snaps.flatMap((snap) =>
      snap.docs.map((d) => questionDocToRow(d.id, d.data())),
    )
  }, [])

  const handleConfirmDelete = useCallback(async () => {
    if (!db || !deletingRow) return
    setDeletingBusy(true)
    setError(null)

    const id = deletingRow.firestoreDocId
    const snapshot = rows
    // Optimistic remove
    setRows((prev) => prev.filter((r) => r.firestoreDocId !== id))

    try {
      // Soft delete: ONLY set the deletion markers via a merge update.
      // Accepted values for `isDeleted` are always an explicit boolean —
      // `true` here — never left absent/implicit once a doc has been touched
      // by this feature. There is no un-delete UI; this is a one-way action
      // from the admin's perspective.
      //
      // ⚠️ Do NOT "delete" by blanking/overwriting the other fields (e.g.
      // setDoc without merge). That destroys the question's content the
      // instant it's written, for no reason — isDeleted is a flag layered on
      // top of an intact document, not a replacement for it.
      await updateDoc(doc(db, questionsCollectionName, id), {
        isDeleted: true,
        updatedAt: serverTimestamp(),
      })
      setToast({ tone: 'success', message: 'Question deleted' })
      setDeletingRow(null)
    } catch (e) {
      // Roll back
      setRows(snapshot)
      const msg = e?.message || 'Failed to delete question'
      setError(msg)
      setToast({ tone: 'error', message: msg })
    } finally {
      setDeletingBusy(false)
    }
  }, [deletingRow, rows])

  /* ------------------------------- Filters ------------------------------- */

  const hasFilters =
    search.trim() !== '' ||
    typeFilter !== 'all' ||
    handStageFilter !== 'all' ||
    cashTourneyFilter !== 'all' ||
    liveOnlineFilter !== 'all' ||
    reportsFilter !== 'all' ||
    onlyBroken ||
    sortMode !== 'id_asc'

  const clearFilters = useCallback(() => {
    setSearch('')
    setTypeFilter('all')
    setHandStageFilter('all')
    setCashTourneyFilter('all')
    setLiveOnlineFilter('all')
    setReportsFilter('all')
    setOnlyBroken(false)
    setSortMode('id_asc')
  }, [
    setTypeFilter,
    setHandStageFilter,
    setCashTourneyFilter,
    setLiveOnlineFilter,
    setReportsFilter,
    setOnlyBroken,
    setSortMode,
  ])

  const toggleField = useCallback(
    (key) => {
      setVisibleFields((prev) => ({ ...prev, [key]: !prev[key] }))
    },
    [setVisibleFields],
  )

  /* --------------------------- Render ------------------------------------ */

  return (
    <div className="relative flex h-[calc(100vh-3.25rem)] flex-col overflow-hidden bg-slate-50 text-slate-900">
      {/* Top bar */}
      <header className="sticky top-0 z-30 flex flex-col gap-3 border-b border-slate-200/90 bg-white/95 px-4 py-3 shadow-sm backdrop-blur-md sm:px-6 lg:flex-row lg:items-center lg:justify-between lg:gap-6">
        <div className="flex min-w-0 items-center gap-3">
          <button
            type="button"
            onClick={onShowTableView}
            className="inline-flex cursor-pointer items-center gap-1.5 rounded-xl border border-slate-200 bg-white px-3 py-2 text-sm font-semibold text-slate-700 shadow-sm transition hover:border-slate-300 hover:bg-slate-50 focus:outline-none focus-visible:ring-2 focus-visible:ring-violet-500"
            aria-label="Switch to table view"
          >
            <Table2 className="size-4" strokeWidth={2.25} aria-hidden />
            Table view
          </button>
          <div className="hidden h-6 w-px bg-slate-200 sm:block" aria-hidden />
          <div className="flex items-center gap-2.5">
            <div className="flex size-9 shrink-0 items-center justify-center rounded-xl bg-gradient-to-br from-violet-500 to-fuchsia-600 text-white shadow-md shadow-violet-900/20">
              <Pencil className="size-4" strokeWidth={2.25} aria-hidden />
            </div>
            <div className="min-w-0">
              <h1 className="text-base font-semibold tracking-tight text-slate-900 sm:text-lg">
                Edit Questions
              </h1>
              <p className="text-[11px] text-slate-500">
                {rows.length > 0
                  ? `${sortedRows.length}${hasFilters ? ` of ${rows.length}` : ''} questions`
                  : 'Loading…'}
              </p>
            </div>
          </div>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <button
            type="button"
            onClick={toggleSelectMode}
            title={
              selectMode
                ? 'Exit select mode'
                : 'Select multiple questions to mass delete'
            }
            className={`inline-flex shrink-0 cursor-pointer items-center justify-center gap-1.5 rounded-xl px-4 py-2 text-sm font-semibold shadow-sm transition focus:outline-none focus-visible:ring-2 focus-visible:ring-violet-500 focus-visible:ring-offset-2 ${
              selectMode
                ? 'bg-gradient-to-b from-violet-600 to-violet-700 text-white hover:from-violet-700 hover:to-violet-800'
                : 'border border-slate-200 bg-white text-slate-700 hover:border-violet-300 hover:bg-violet-50 hover:text-violet-700'
            }`}
          >
            {selectMode ? null : (
              <ListChecks
                className="size-4 shrink-0"
                strokeWidth={2.25}
                aria-hidden
              />
            )}
            {selectMode ? 'Done' : 'Select'}
          </button>
          {selectMode ? null : (
            <>
              <button
                type="button"
                onClick={() => setInsightsOpen(true)}
                title="View statistics across all questions"
                className="inline-flex shrink-0 cursor-pointer items-center justify-center gap-1.5 rounded-xl border border-slate-200 bg-white px-3 py-2 text-sm font-semibold text-slate-700 shadow-sm transition hover:border-violet-300 hover:bg-violet-50 hover:text-violet-700 focus:outline-none focus-visible:ring-2 focus-visible:ring-violet-500 focus-visible:ring-offset-2"
              >
                <BarChart3
                  className="size-4 shrink-0"
                  strokeWidth={2.25}
                  aria-hidden
                />
                Insights
              </button>
              <button
                type="button"
                onClick={() => setUploadOpen(true)}
                disabled={loading}
                title={
                  loading
                    ? 'Wait for existing questions to load before uploading new ones'
                    : 'Upload a CSV of new questions — ids are auto-assigned'
                }
                className="inline-flex shrink-0 cursor-pointer items-center justify-center gap-1.5 rounded-xl bg-gradient-to-b from-violet-600 to-violet-700 px-4 py-2 text-sm font-semibold text-white shadow-md shadow-violet-900/25 transition hover:from-violet-700 hover:to-violet-800 focus:outline-none focus-visible:ring-2 focus-visible:ring-violet-500 focus-visible:ring-offset-2 disabled:cursor-not-allowed disabled:from-slate-300 disabled:to-slate-400 disabled:shadow-none"
              >
                <Upload className="size-4 shrink-0" strokeWidth={2.5} aria-hidden />
                Upload new questions
              </button>
            </>
          )}
        </div>
      </header>

      {/* Sticky filter bar */}
      <section className="sticky top-[3.75rem] z-20 border-b border-slate-200/80 bg-white/85 px-4 py-3 backdrop-blur-md sm:px-6 lg:top-[3.5rem]">
        <div className="mx-auto flex w-full flex-col gap-2.5 sm:flex-row sm:flex-wrap sm:items-center">
          <div className="relative w-full min-w-[220px] sm:max-w-md sm:flex-1">
            <Search
              className="pointer-events-none absolute left-3 top-1/2 size-4 -translate-y-1/2 text-slate-400"
              strokeWidth={2}
              aria-hidden
            />
            <input
              ref={searchInputRef}
              type="search"
              placeholder="Search doc id, question, context, type, answer… ( / )"
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              className="w-full rounded-xl border border-slate-200 bg-white py-2 pl-10 pr-12 text-sm text-slate-900 shadow-sm outline-none placeholder:text-slate-400 focus:border-violet-400 focus:ring-4 focus:ring-violet-500/15"
            />
            <kbd className="pointer-events-none absolute right-2.5 top-1/2 -translate-y-1/2 rounded border border-slate-200 bg-slate-50 px-1.5 py-0.5 font-mono text-[10px] font-semibold text-slate-500">
              /
            </kbd>
          </div>
          <FilterSelect
            icon={<Filter className="size-4 shrink-0 text-slate-400" strokeWidth={2} aria-hidden />}
            value={typeFilter}
            onChange={setTypeFilter}
            options={[
              { value: 'all', label: 'All types' },
              ...typeOptions.map((t) => ({ value: t, label: t })),
            ]}
            ariaLabel="Filter by type"
          />
          {handStageOptions.length > 0 ? (
            <FilterSelect
              icon={
                <Layers
                  className="size-4 shrink-0 text-slate-400"
                  strokeWidth={2}
                  aria-hidden
                />
              }
              value={handStageFilter}
              onChange={setHandStageFilter}
              options={[
                { value: 'all', label: 'All stages' },
                ...handStageOptions,
              ]}
              ariaLabel="Filter by hand stage"
            />
          ) : null}
          {cashTourneyOptions.length > 0 ? (
            <FilterSelect
              icon={
                <Target
                  className="size-4 shrink-0 text-slate-400"
                  strokeWidth={2}
                  aria-hidden
                />
              }
              value={cashTourneyFilter}
              onChange={setCashTourneyFilter}
              options={[
                { value: 'all', label: 'Cash + tournament' },
                ...cashTourneyOptions,
              ]}
              ariaLabel="Filter by cash or tournament"
            />
          ) : null}
          {liveOnlineOptions.length > 0 ? (
            <FilterSelect
              icon={
                <Gauge
                  className="size-4 shrink-0 text-slate-400"
                  strokeWidth={2}
                  aria-hidden
                />
              }
              value={liveOnlineFilter}
              onChange={setLiveOnlineFilter}
              options={[
                { value: 'all', label: 'Live + online' },
                ...liveOnlineOptions,
              ]}
              ariaLabel="Filter by live or online"
            />
          ) : null}
          <FilterSelect
            icon={<Flag className="size-4 shrink-0 text-slate-400" strokeWidth={2} aria-hidden />}
            value={reportsFilter}
            onChange={setReportsFilter}
            options={[
              { value: 'all', label: 'All reports' },
              { value: 'with', label: 'With active reports' },
              { value: 'without', label: 'No reports' },
            ]}
            ariaLabel="Filter by active reports"
          />
          <FilterSelect
            icon={
              sortMode === 'id_asc' ? (
                <ArrowUpAZ className="size-4 shrink-0 text-slate-400" strokeWidth={2} aria-hidden />
              ) : sortMode === 'id_desc' ? (
                <ArrowDownAZ className="size-4 shrink-0 text-slate-400" strokeWidth={2} aria-hidden />
              ) : (
                <ArrowDownWideNarrow
                  className="size-4 shrink-0 text-slate-400"
                  strokeWidth={2}
                  aria-hidden
                />
              )
            }
            value={sortMode}
            onChange={(v) => setSortMode(v)}
            options={[
              { value: 'id_asc', label: 'Doc id ↑' },
              { value: 'id_desc', label: 'Doc id ↓' },
              { value: 'reports_desc', label: 'Reports (most first)' },
            ]}
            ariaLabel="Sort"
          />

          <FilterSelect
            icon={
              <Languages
                className="size-4 shrink-0 text-slate-400"
                strokeWidth={2}
                aria-hidden
              />
            }
            value={activeLanguage}
            onChange={(v) => setActiveLanguage(v)}
            options={SUPPORTED_LANGUAGES.map((l) => ({
              value: l.code,
              label: l.label,
            }))}
            ariaLabel="View language"
          />

          {/* Fields visibility popover */}
          <div className="relative">
            <button
              ref={fieldsButtonRef}
              type="button"
              onClick={() => setFieldsOpen((v) => !v)}
              aria-expanded={fieldsOpen}
              aria-haspopup="true"
              className="inline-flex cursor-pointer items-center gap-1.5 rounded-xl border border-slate-200 bg-white py-2 pl-3 pr-3 text-sm font-semibold text-slate-700 shadow-sm transition hover:border-slate-300 hover:bg-slate-50 focus:outline-none focus-visible:ring-2 focus-visible:ring-violet-500"
            >
              <Settings2 className="size-4 shrink-0" strokeWidth={2} aria-hidden />
              Fields
              <span className="rounded-full bg-slate-100 px-1.5 py-0.5 text-[10px] tabular-nums text-slate-600">
                {Object.values(visibleFields).filter(Boolean).length}/
                {FIELD_TOGGLES.length}
              </span>
              <ChevronDown
                className={`size-3.5 shrink-0 text-slate-400 transition ${
                  fieldsOpen ? 'rotate-180' : ''
                }`}
                strokeWidth={2.25}
                aria-hidden
              />
            </button>
            {fieldsOpen ? (
              <div
                ref={fieldsPopoverRef}
                className="absolute right-0 top-full z-30 mt-2 w-60 rounded-xl border border-slate-200 bg-white p-2 shadow-xl ring-1 ring-slate-900/[0.04]"
                role="menu"
              >
                <p className="px-2 pb-1.5 pt-1 text-[10px] font-semibold uppercase tracking-wider text-slate-400">
                  Show on each card
                </p>
                {FIELD_TOGGLES.map((f) => {
                  const on = visibleFields[f.key]
                  return (
                    <button
                      key={f.key}
                      type="button"
                      onClick={() => toggleField(f.key)}
                      className={`flex w-full cursor-pointer items-center justify-between rounded-lg px-2 py-1.5 text-sm transition hover:bg-violet-50/70 focus:outline-none focus-visible:bg-violet-50 ${
                        on ? 'text-slate-800' : 'text-slate-400'
                      }`}
                      role="menuitemcheckbox"
                      aria-checked={on}
                    >
                      <span className="inline-flex items-center gap-2">
                        {on ? (
                          <Eye
                            className="size-3.5 shrink-0 text-violet-600"
                            strokeWidth={2.25}
                            aria-hidden
                          />
                        ) : (
                          <EyeOff
                            className="size-3.5 shrink-0 text-slate-300"
                            strokeWidth={2}
                            aria-hidden
                          />
                        )}
                        {f.label}
                      </span>
                      {on ? (
                        <Check
                          className="size-3.5 shrink-0 text-violet-600"
                          strokeWidth={2.5}
                          aria-hidden
                        />
                      ) : null}
                    </button>
                  )
                })}
              </div>
            ) : null}
          </div>

          <button
            type="button"
            onClick={() => setOnlyBroken((v) => !v)}
            aria-pressed={onlyBroken}
            className={`inline-flex cursor-pointer items-center gap-1.5 rounded-xl border py-2 px-3 text-xs font-semibold shadow-sm transition focus:outline-none focus-visible:ring-2 focus-visible:ring-amber-500 ${
              onlyBroken
                ? 'border-amber-300 bg-amber-50 text-amber-900'
                : 'border-slate-200 bg-white text-slate-700 hover:border-slate-300 hover:bg-slate-50'
            }`}
            title="Show questions missing options or a correct answer"
          >
            <AlertTriangle
              className={`size-3.5 shrink-0 ${onlyBroken ? 'text-amber-700' : 'text-slate-400'}`}
              strokeWidth={2.25}
              aria-hidden
            />
            Issues only
          </button>

          {hasFilters ? (
            <button
              type="button"
              onClick={clearFilters}
              className="inline-flex cursor-pointer items-center gap-1 rounded-lg px-2 py-1.5 text-xs font-semibold text-violet-700 transition hover:bg-violet-50"
            >
              <X className="size-3.5 shrink-0" strokeWidth={2.25} aria-hidden />
              Clear filters
            </button>
          ) : null}

          <button
            type="button"
            onClick={() => setShowShortcutsHint(true)}
            title="Keyboard shortcuts"
            aria-label="Keyboard shortcuts"
            className="ml-auto inline-flex cursor-pointer items-center gap-1 rounded-lg border border-slate-200 bg-white py-1.5 px-2 text-[11px] font-semibold text-slate-600 shadow-sm transition hover:border-slate-300 hover:bg-slate-50 focus:outline-none focus-visible:ring-2 focus-visible:ring-violet-500"
          >
            <Keyboard className="size-3.5 shrink-0" strokeWidth={2.25} aria-hidden />
            <kbd className="rounded bg-slate-100 px-1 font-mono text-[10px]">?</kbd>
          </button>
        </div>

        <div className="mx-auto mt-2 flex w-full flex-wrap items-center gap-1.5 text-[11px] text-slate-500">
          <span className="inline-flex items-center gap-1 rounded-full bg-slate-100 px-2 py-0.5 font-semibold tabular-nums">
            <MessageCircleQuestion
              className="size-3 shrink-0"
              strokeWidth={2.25}
              aria-hidden
            />
            {rows.length} total
          </span>
          {reportedCount > 0 ? (
            <span className="inline-flex items-center gap-1 rounded-full bg-rose-50 px-2 py-0.5 font-semibold text-rose-800 ring-1 ring-rose-100">
              <Flag className="size-3 shrink-0" strokeWidth={2.25} aria-hidden />
              {reportedCount} reported
            </span>
          ) : null}
          {hasFilters ? (
            <span className="inline-flex items-center gap-1 rounded-full bg-violet-50 px-2 py-0.5 font-semibold text-violet-800 ring-1 ring-violet-100">
              Filtered · {sortedRows.length}
            </span>
          ) : null}
        </div>
      </section>

      {selectMode ? (
        <div className="pointer-events-none absolute inset-x-0 bottom-4 z-20 flex justify-center px-4 sm:px-6">
          <div className="pointer-events-auto flex w-full max-w-2xl flex-wrap items-center justify-between gap-3 rounded-2xl border border-slate-200 bg-white px-4 py-2.5 shadow-xl shadow-slate-900/10 ring-1 ring-black/5">
            <div className="flex flex-wrap items-center gap-1">
              <span className="mr-1 text-sm font-semibold text-slate-900">
                {selectedIds.size} selected
              </span>
              <button
                type="button"
                onClick={() =>
                  setSelectedIds(new Set(sortedRows.map((r) => r.firestoreDocId)))
                }
                className="cursor-pointer rounded-lg px-2 py-1 text-xs font-semibold text-violet-700 transition hover:bg-violet-50"
              >
                Select all {sortedRows.length} filtered
              </button>
              {selectedIds.size > 0 ? (
                <button
                  type="button"
                  onClick={clearSelection}
                  className="cursor-pointer rounded-lg px-2 py-1 text-xs font-semibold text-slate-600 transition hover:bg-slate-100"
                >
                  Clear
                </button>
              ) : null}
            </div>
            <button
              type="button"
              onClick={() => setBulkDeleteConfirmOpen(true)}
              disabled={selectedIds.size === 0}
              className="inline-flex cursor-pointer items-center gap-1.5 rounded-lg bg-rose-600 px-3 py-1.5 text-xs font-semibold text-white shadow-sm transition hover:bg-rose-700 focus:outline-none focus-visible:ring-2 focus-visible:ring-rose-500 focus-visible:ring-offset-2 disabled:cursor-not-allowed disabled:opacity-40"
            >
              <Trash2 className="size-3.5 shrink-0" strokeWidth={2.25} aria-hidden />
              Delete{selectedIds.size > 0 ? ` ${selectedIds.size}` : ''} selected
            </button>
          </div>
        </div>
      ) : null}

      {error ? (
        <div
          role="alert"
          className="mx-4 mt-4 flex gap-3 rounded-xl border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-800 sm:mx-6"
        >
          <AlertCircle className="mt-0.5 size-4 shrink-0 text-red-600" strokeWidth={2} />
          <span>{error}</span>
        </div>
      ) : null}

      {/* List (virtualized) */}
      {loading ? (
        <main className="flex flex-1 flex-col items-center justify-center gap-4 px-2 py-12 text-slate-600">
          <Loader2 className="size-9 animate-spin text-violet-600" strokeWidth={2} aria-hidden />
          <p className="text-sm font-medium">Loading questions…</p>
        </main>
      ) : rows.length === 0 ? (
        <main className="flex flex-1 items-start justify-center px-4 py-12">
          <EmptyState
            icon={<Inbox className="size-7" strokeWidth={1.75} aria-hidden />}
            title="No questions yet"
            body={
              <>
                The{' '}
                <code className="rounded bg-slate-100 px-1.5 py-0.5 font-mono text-xs text-slate-800">
                  {questionsCollectionName}
                </code>{' '}
                collection is empty. Use{' '}
                <span className="font-semibold text-violet-700">Add new question</span> to create one.
              </>
            }
          />
        </main>
      ) : sortedRows.length === 0 ? (
        <main className="flex flex-1 items-start justify-center px-4 py-12">
          <EmptyState
            icon={<SearchX className="size-7" strokeWidth={1.75} aria-hidden />}
            title="No questions match your filters"
            body="Try clearing one of the filters or simplifying your search."
          />
        </main>
      ) : (
        <main
          ref={scrollParentRef}
          className={`flex-1 overflow-auto px-2 py-3 sm:px-4 sm:py-4 ${
            selectMode ? 'pb-20' : ''
          }`}
        >
          <ol
            className="relative mx-auto w-full list-none"
            style={{ height: `${virtualizer.getTotalSize()}px` }}
          >
            {virtualizer.getVirtualItems().map((vItem) => {
              const row = sortedRows[vItem.index]
              if (!row) return null
              return (
                <li
                  key={vItem.key}
                  ref={virtualizer.measureElement}
                  data-index={vItem.index}
                  className="absolute left-0 top-0 w-full pb-2"
                  style={{ transform: `translateY(${vItem.start}px)` }}
                >
                  <QuestionCard
                    row={localizeRow(row, activeLanguage)}
                    rawRow={row}
                    language={activeLanguage}
                    index={vItem.index + 1}
                    visible={visibleFields}
                    searchQuery={search}
                    isNewlyAdded={row.firestoreDocId === lastAddedId}
                    selectMode={selectMode}
                    selected={selectedIds.has(row.firestoreDocId)}
                    onToggleSelected={toggleSelected}
                    onFilterByType={setTypeFilter}
                    onEdit={() => setEditorState({ mode: 'edit', row })}
                    onDelete={() => setDeletingRow(row)}
                    onShowReports={() => setViewingReportsRow(row)}
                    onPreview={() => setPreviewingRow(row)}
                  />
                </li>
              )
            })}
          </ol>
        </main>
      )}

      {editorState ? (
        <EditQuestionModal
          key={`${editorState.mode}-${editorState.mode === 'add' ? 'new' : editorState.row?.firestoreDocId ?? 'new'}-${editorState.mode === 'edit' ? activeLanguage : 'en'}`}
          state={editorState}
          // Add/Duplicate are always authored in English; only Edit follows
          // the currently-selected language.
          language={editorState.mode === 'edit' ? activeLanguage : 'en'}
          existingNumericIds={existingNumericIds}
          nextNumericId={nextNumericId}
          onClose={() => {
            if (!savingEditor) setEditorState(null)
          }}
          onSave={handleSaveEditor}
          saving={savingEditor}
        />
      ) : null}

      {deletingRow ? (
        <DeleteConfirmationModal
          key={`delete-${deletingRow.firestoreDocId}`}
          row={deletingRow}
          busy={deletingBusy}
          onCancel={() => {
            if (!deletingBusy) setDeletingRow(null)
          }}
          onConfirm={handleConfirmDelete}
        />
      ) : null}

      {bulkDeleteConfirmOpen ? (
        <BulkDeleteConfirmationModal
          rows={rows.filter((r) => selectedIds.has(r.firestoreDocId))}
          busy={bulkDeleteBusy}
          onCancel={() => {
            if (!bulkDeleteBusy) setBulkDeleteConfirmOpen(false)
          }}
          onConfirm={handleConfirmBulkDelete}
        />
      ) : null}

      {showShortcutsHint ? (
        <ShortcutsHint onClose={() => setShowShortcutsHint(false)} />
      ) : null}

      <ReportsModal
        row={viewingReportsRow}
        onClose={() => setViewingReportsRow(null)}
        onReportsChange={(firestoreDocId, nextReports) => {
          setRows((prev) =>
            prev.map((r) =>
              r.firestoreDocId === firestoreDocId
                ? { ...r, reports: nextReports }
                : r,
            ),
          )
        }}
      />

      {previewingRow ? (
        <AnswerPreviewModal
          row={previewingRow}
          onClose={() => setPreviewingRow(null)}
        />
      ) : null}

      {uploadOpen ? (
        <UploadQuestionsModal
          existingNumericIds={existingNumericIds}
          existingByNumericId={existingByNumericId}
          nextNumericId={nextNumericId}
          onClose={() => setUploadOpen(false)}
          onUpload={async (ops, onProgress) => {
            const result = await writeUploadedQuestions(ops, onProgress)
            const {
              created,
              updated,
              failedChunkIndex,
              failedRowCount,
              error,
            } = result
            // Always apply what landed — even if a later chunk failed, the
            // earlier successful rows are already in Firestore. Wrapping in
            // startTransition lets the modal close smoothly before React
            // does the expensive virtualized re-render.
            if (created.length > 0 || updated.length > 0) {
              startTransition(() => {
                setRows((prev) => {
                  // 1. Patch updated rows in place (preserve order).
                  const updatedMap = new Map(
                    updated.map((u) => [u.firestoreDocId, u]),
                  )
                  const patched = prev.map((r) =>
                    updatedMap.has(r.firestoreDocId)
                      ? { ...r, ...updatedMap.get(r.firestoreDocId) }
                      : r,
                  )
                  // 2. Prepend created rows on top.
                  return created.length > 0 ? [...created, ...patched] : patched
                })
              })
              // Only flash the "newly added" pulse on rows that were
              // actually created. For a pure-UPDATE upload we leave
              // `lastAddedId` alone so we don't green-highlight a row
              // that already existed in the list.
              if (created.length > 0) {
                setLastAddedId(created[0].firestoreDocId)
              }
              triggerQuestionTranslation(onTranslateError)

              // Re-fetch every touched doc so `serverTimestamp()` sentinels
              // become real Timestamps and any concurrent translation writes
              // get pulled in. Fire-and-forget — failure leaves the
              // optimistic rows visible.
              const touchedIds = [
                ...created.map((c) => c.firestoreDocId),
                ...updated.map((u) => u.firestoreDocId),
              ]
              refetchByDocIds(touchedIds)
                .then((fresh) => {
                  if (fresh.length === 0) return
                  const byId = new Map(
                    fresh.map((r) => [r.firestoreDocId, r]),
                  )
                  startTransition(() => {
                    setRows((prev) =>
                      prev.map((r) =>
                        byId.has(r.firestoreDocId)
                          ? byId.get(r.firestoreDocId)
                          : r,
                      ),
                    )
                  })
                })
                .catch(() => {
                  /* non-fatal — optimistic rows stay visible */
                })
            }
            const writtenLen = created.length + updated.length
            // Count updates that flipped `isTranslated_es: false` — these are
            // the ones whose translatable content changed and which will be
            // picked up by the translation cloud function. The rest had
            // non-translatable edits only and keep their existing translation.
            const updatesNeedingTranslation = updated.filter(
              (u) => u.isTranslated_es === false,
            ).length
            // Total docs the translation function will pick up = every new
            // doc (CREATE always sets false) + updates with changed text.
            const willTranslate = created.length + updatesNeedingTranslation
            const breakdown =
              created.length > 0 && updated.length > 0
                ? `${created.length} new · ${updated.length} updated`
                : created.length > 0
                  ? `${created.length} new`
                  : `${updated.length} updated`
            const translateNote =
              willTranslate === writtenLen
                ? '· translation queued'
                : willTranslate > 0
                  ? `· ${willTranslate} re-translating`
                  : '· translations preserved (no text change)'
            if (error) {
              setToast({
                tone: 'error',
                message:
                  writtenLen > 0
                    ? `Saved ${breakdown} · ${failedRowCount} failed (chunk ${(failedChunkIndex ?? 0) + 1}): ${error.message}`
                    : `Upload failed: ${error.message}`,
              })
            } else {
              setToast({
                tone: 'success',
                message: `Saved ${breakdown} ${translateNote}`,
              })
            }
            return result
          }}
        />
      ) : null}

      {insightsOpen ? (
        <InsightsOverlay
          rows={rows}
          onClose={() => setInsightsOpen(false)}
          onApplyFilter={(patch) => {
            // Apply a filter chosen from an insights bar (e.g. clicking a
            // row in the "Question type" panel filters to that type).
            if ('type' in patch) setTypeFilter(patch.type)
            if ('handStage' in patch) setHandStageFilter(patch.handStage)
            if ('cashTourney' in patch) setCashTourneyFilter(patch.cashTourney)
            if ('liveOnline' in patch) setLiveOnlineFilter(patch.liveOnline)
            setInsightsOpen(false)
          }}
        />
      ) : null}

      {/* Sheet view temporarily hidden — preserved in src/SheetView.jsx
          for when it's brought back. */}

      {toast ? (
        <div
          className={`pointer-events-none fixed bottom-4 left-1/2 z-[60] -translate-x-1/2 rounded-xl px-4 py-2.5 text-sm font-semibold shadow-xl ring-1 ${
            toast.tone === 'success'
              ? 'bg-emerald-600 text-white ring-emerald-700/40'
              : 'bg-rose-600 text-white ring-rose-700/40'
          }`}
          role="status"
        >
          <span className="inline-flex items-center gap-2">
            {toast.tone === 'success' ? (
              <Check className="size-4 shrink-0" strokeWidth={2.5} aria-hidden />
            ) : (
              <AlertCircle className="size-4 shrink-0" strokeWidth={2.25} aria-hidden />
            )}
            {toast.message}
          </span>
        </div>
      ) : null}
    </div>
  )
}

/* -------------------------------------------------------------------------- */
/* Reusable bits                                                              */
/* -------------------------------------------------------------------------- */

/**
 * @param {{
 *   icon: import('react').ReactNode
 *   value: string
 *   onChange: (v: string) => void
 *   options: Array<{ value: string, label: string }>
 *   ariaLabel: string
 * }} props
 */
function FilterSelect({ icon, value, onChange, options, ariaLabel }) {
  return (
    <div className="relative w-full min-w-[10rem] sm:w-auto">
      <span className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2">
        {icon}
      </span>
      <select
        value={value}
        onChange={(e) => onChange(e.target.value)}
        className="w-full cursor-pointer appearance-none rounded-xl border border-slate-200 bg-white py-2 pl-10 pr-8 text-sm text-slate-900 shadow-sm outline-none transition hover:border-slate-300 focus:border-violet-400 focus:ring-4 focus:ring-violet-500/15"
        aria-label={ariaLabel}
      >
        {options.map((o) => (
          <option key={o.value} value={o.value}>
            {o.label}
          </option>
        ))}
      </select>
      <ChevronDown
        className="pointer-events-none absolute right-3 top-1/2 size-3.5 -translate-y-1/2 text-slate-400"
        strokeWidth={2.25}
        aria-hidden
      />
    </div>
  )
}

/**
 * @param {{
 *   icon: import('react').ReactNode
 *   title: string
 *   body: import('react').ReactNode
 * }} props
 */
function EmptyState({ icon, title, body }) {
  return (
    <div className="mx-auto flex max-w-md flex-col items-center rounded-2xl border border-dashed border-slate-200 bg-white/60 px-6 py-16 text-center">
      <div className="mb-4 flex size-14 items-center justify-center rounded-2xl bg-slate-100 text-slate-400 ring-1 ring-slate-200/80">
        {icon}
      </div>
      <p className="text-sm font-semibold text-slate-700">{title}</p>
      <p className="mt-1.5 text-xs text-slate-500">{body}</p>
    </div>
  )
}

/**
 * Non-empty adminNotes per report, numbered when there's more than one —
 * same source data as the Reports modal, just surfaced as a quick glance
 * on the card without opening it.
 *
 * @param {unknown[]} reports
 */
function reportsAdminNotesForCard(reports) {
  /** @type {{ key: number, prefix: string, text: string }[]} */
  const lines = []
  const multi = reports.length > 1
  for (let i = 0; i < reports.length; i++) {
    const r = reports[i]
    if (!r || typeof r !== 'object' || Array.isArray(r)) continue
    const raw = /** @type {Record<string, unknown>} */ (r).adminNotes
    const text = typeof raw === 'string' ? raw.trim() : ''
    if (!text) continue
    lines.push({ key: i, prefix: multi ? `${i + 1}.` : '', text })
  }
  return lines
}

/* -------------------------------------------------------------------------- */
/* Card                                                                       */
/* -------------------------------------------------------------------------- */

/**
 * @param {{
 *   row: { firestoreDocId: string } & Record<string, unknown>
 *   rawRow?: { firestoreDocId: string } & Record<string, unknown>
 *   language?: string
 *   index: number
 *   visible: Record<string, boolean>
 *   searchQuery: string
 *   isNewlyAdded: boolean
 *   selectMode?: boolean
 *   selected?: boolean
 *   onToggleSelected?: (docId: string) => void
 *   onFilterByType: (t: string) => void
 *   onEdit: () => void
 *   onDelete: () => void
 *   onShowReports: () => void
 *   onPreview: () => void
 * }} props
 */
function QuestionCard({
  row,
  rawRow,
  language = 'en',
  index,
  visible,
  searchQuery,
  isNewlyAdded,
  selectMode = false,
  selected = false,
  onToggleSelected,
  onFilterByType,
  onEdit,
  onDelete,
  onShowReports,
  onPreview,
}) {
  // When the active language is non-English, surface whether *this* doc has
  // a translation for it (vs. silently falling back to English content).
  const hasTranslationForLang =
    language !== 'en' &&
    !!rawRow &&
    !!rawRow[language] &&
    typeof rawRow[language] === 'object'
  const [contextExpanded, setContextExpanded] = useState(false)
  const [notesExpanded, setNotesExpanded] = useState(true)
  const questionText = questionPreviewText(row) || '(No question text)'
  const reports = getReportsArray(row)
  const noteLines = reportsAdminNotesForCard(reports)
  const { correct: ansCorrect, wrong: ansWrong, pct: ansPct } = answerStatsForRow(row)
  const ansTotal = ansCorrect + ansWrong
  const options = getOptionsList(row)
  const correctIdx = correctOptionIndex(row)
  const type = displayScalar(row.question_type)
  const numericId = row.id != null && row.id !== '' ? String(row.id) : null
  const context =
    typeof row.context === 'string' && row.context.trim()
      ? row.context.trim()
      : ''

  // Card is itself a click target — opens Edit, or toggles its checkbox
  // while in select mode. Inner action buttons (Duplicate, Delete, Reports,
  // type-chip filter, the checkbox itself) call stopPropagation so they
  // don't also fire this handler.
  const handleCardActivate = () => {
    if (selectMode) onToggleSelected?.(row.firestoreDocId)
    else onEdit()
  }

  return (
    <div className="group">
      <article
        role="button"
        tabIndex={0}
        onClick={handleCardActivate}
        onKeyDown={(e) => {
          if (e.key === 'Enter' || e.key === ' ') {
            e.preventDefault()
            handleCardActivate()
          }
        }}
        className={`block cursor-pointer overflow-hidden rounded-xl border bg-white shadow-sm transition focus:outline-none focus-visible:ring-2 focus-visible:ring-violet-500 focus-visible:ring-offset-1 ${
          isNewlyAdded
            ? 'border-emerald-300 ring-2 ring-emerald-200 animate-[pulse_1s_ease-in-out_2]'
            : selected
              ? 'border-violet-400 ring-2 ring-violet-300/70'
              : 'border-slate-200 hover:border-violet-300 hover:shadow-md hover:ring-1 hover:ring-violet-200/60'
        }`}
      >
        <div className="flex gap-2.5 px-3 py-2.5 sm:px-4">
          {selectMode ? (
            <span className="relative mt-0.5 flex size-5 shrink-0 items-center justify-center">
              <input
                type="checkbox"
                checked={selected}
                onChange={() => onToggleSelected?.(row.firestoreDocId)}
                onClick={(e) => e.stopPropagation()}
                aria-label={`Select question #${numericId ?? index}`}
                className={`peer size-5 shrink-0 cursor-pointer appearance-none rounded-full border-2 transition ${
                  selected
                    ? 'border-violet-600 bg-violet-600'
                    : 'border-slate-300 bg-white hover:border-violet-400'
                }`}
              />
              <Check
                className="pointer-events-none absolute size-3 text-white opacity-0 peer-checked:opacity-100"
                strokeWidth={3}
                aria-hidden
              />
            </span>
          ) : null}
          <div className="flex min-w-0 flex-1 flex-col gap-2 sm:flex-row sm:items-start sm:justify-between">
            <div className="min-w-0 flex-1">
              <div className="flex flex-wrap items-center gap-1.5">
                <span
                  className="rounded-full bg-violet-100 px-2 py-0.5 text-xs font-bold uppercase tracking-wider text-violet-800"
                  title={`Firestore doc: ${row.firestoreDocId}`}
                >
                  #{numericId ?? index}
                </span>
                {language !== 'en' ? (
                  hasTranslationForLang ? (
                    <span
                      className="inline-flex items-center gap-1 rounded-full bg-emerald-50 px-2 py-0.5 text-[11px] font-semibold text-emerald-800 ring-1 ring-emerald-200/80"
                      title={`Showing the ${language.toUpperCase()} translation`}
                    >
                      <Languages
                        className="size-3 shrink-0"
                        strokeWidth={2.25}
                        aria-hidden
                      />
                      {language.toUpperCase()}
                    </span>
                  ) : (
                    <span
                      className="inline-flex items-center gap-1 rounded-full bg-amber-50 px-2 py-0.5 text-[11px] font-semibold text-amber-800 ring-1 ring-amber-200/80"
                      title={`No ${language.toUpperCase()} translation yet — showing English`}
                    >
                      <Languages
                        className="size-3 shrink-0"
                        strokeWidth={2.25}
                        aria-hidden
                      />
                      No {language.toUpperCase()}
                    </span>
                  )
                ) : null}
                {visible.type && type !== '—' ? (
                  <button
                    type="button"
                    onClick={(e) => {
                      e.stopPropagation()
                      onFilterByType(String(row.question_type))
                    }}
                    aria-label={`Filter by type "${type}"`}
                    className="cursor-pointer rounded-md bg-slate-50 px-1.5 py-0.5 text-[10.5px] font-medium text-slate-600 ring-1 ring-slate-200/80 transition hover:bg-violet-50 hover:text-violet-900 hover:ring-violet-200"
                  >
                    {type}
                  </button>
                ) : null}
                {visible.reports && reports.length > 0 ? (
                  <button
                    type="button"
                    onClick={(e) => {
                      e.stopPropagation()
                      onShowReports()
                    }}
                    title="View report details"
                    className="inline-flex cursor-pointer items-center gap-1.5 rounded-full bg-rose-100 px-2.5 py-1 text-xs font-bold text-rose-900 shadow-sm ring-1 ring-rose-300 transition hover:bg-rose-200 hover:ring-rose-400 focus:outline-none focus-visible:ring-2 focus-visible:ring-rose-500 focus-visible:ring-offset-1"
                  >
                    <Flag className="size-3.5 shrink-0" strokeWidth={2.5} aria-hidden />
                    {reports.length} active report
                    {reports.length === 1 ? '' : 's'}
                  </button>
                ) : null}
                {ansTotal > 0 ? (
                  <span
                    className={`inline-flex items-center gap-1.5 rounded-full px-2 py-0.5 text-[11px] font-semibold tabular-nums ring-1 ${answerPctToneClass(ansPct)}`}
                    aria-label={`Graded attempts: ${ansCorrect.toLocaleString()} correct, ${ansWrong.toLocaleString()} wrong, ${ansPct}% correct`}
                  >
                    <Check className="size-3 shrink-0" strokeWidth={2.5} aria-hidden />
                    {ansCorrect.toLocaleString()}
                    <X className="size-3 shrink-0 opacity-70" strokeWidth={2.5} aria-hidden />
                    {ansWrong.toLocaleString()}
                    <span className="opacity-60">·</span>
                    <span>{ansPct}%</span>
                  </span>
                ) : null}
                {correctIdx == null && options.length > 0 ? (
                  <span
                    className="inline-flex items-center gap-1 rounded-full bg-amber-50 px-2 py-0.5 text-[11px] font-semibold text-amber-800 ring-1 ring-amber-200/80"
                    title="No correct option set"
                  >
                    No correct option
                  </span>
                ) : null}
              </div>
              <p className="mt-2 whitespace-pre-wrap break-words text-base font-semibold leading-snug text-slate-900">
                <HighlightedText text={questionText} query={searchQuery} />
              </p>
              {visible.context && context ? (
                <div className="mt-2">
                  <p
                    className={`whitespace-pre-wrap break-words text-sm leading-relaxed text-slate-600 ${
                      contextExpanded ? '' : 'line-clamp-3'
                    }`}
                  >
                    <span className="font-semibold text-slate-500">Context: </span>
                    <HighlightedText text={context} query={searchQuery} />
                  </p>
                  {/* Only offer the toggle when content would actually be
                      clipped — rough heuristic on length / newline count. */}
                  {context.length > 220 || context.split('\n').length > 3 ? (
                    <button
                      type="button"
                      onClick={(e) => {
                        e.stopPropagation()
                        setContextExpanded((v) => !v)
                      }}
                      className="mt-0.5 cursor-pointer text-[11px] font-semibold text-violet-700 hover:text-violet-900 focus:outline-none focus-visible:underline"
                    >
                      {contextExpanded ? 'Show less' : 'Show more'}
                    </button>
                  ) : null}
                </div>
              ) : null}
            </div>

          {selectMode ? null : (
            <div className="flex shrink-0 items-center gap-1.5 self-start">
              <CardActionButton
                icon={<Eye className="size-5 shrink-0" strokeWidth={2.25} aria-hidden />}
                label="Preview answer"
                onClick={onPreview}
              />
              <CardActionButton
                icon={<Flag className="size-5 shrink-0" strokeWidth={2.25} aria-hidden />}
                label={
                  reports.length > 0
                    ? `View ${reports.length} report${reports.length === 1 ? '' : 's'}`
                    : 'No reports'
                }
                tone="reports"
                disabled={reports.length === 0}
                onClick={onShowReports}
              />
              <CardActionButton
                icon={<Trash2 className="size-5 shrink-0" strokeWidth={2.25} aria-hidden />}
                label="Delete"
                tone="danger"
                onClick={onDelete}
              />
            </div>
          )}
          </div>
        </div>

        {visible.options && options.length > 0 ? (
          <div className="border-t border-slate-100 bg-slate-50/70 px-3 py-2.5 sm:px-4">
            <ul className="flex flex-wrap gap-1.5 text-sm">
              {options.map((o) => {
                const isCorrect = correctIdx === o.index
                return (
                  <li
                    key={o.index}
                    className={`flex items-start gap-2 rounded-md border px-2.5 py-1.5 ${
                      isCorrect
                        ? 'border-emerald-200 bg-emerald-50/70'
                        : 'border-slate-200 bg-white'
                    }`}
                  >
                    <span
                      className={`flex size-5 shrink-0 items-center justify-center rounded text-[11px] font-bold tabular-nums ${
                        isCorrect
                          ? 'bg-emerald-600 text-white'
                          : 'bg-slate-100 text-slate-600'
                      }`}
                    >
                      {o.index}
                    </span>
                    <span className="leading-snug text-slate-800">
                      {o.text}
                    </span>
                    {isCorrect ? (
                      <Check
                        className="ml-auto mt-0.5 size-3 shrink-0 text-emerald-600"
                        strokeWidth={2.5}
                        aria-hidden
                      />
                    ) : null}
                  </li>
                )
              })}
            </ul>
          </div>
        ) : visible.options && options.length === 0 ? (
          <div className="border-t border-slate-100 bg-slate-50/70 px-4 py-2 text-[11px] italic text-slate-400 sm:px-5">
            No options on this question · {formatOptionsSummary(row)}
          </div>
        ) : null}

        {noteLines.length > 0 ? (
          <div className="border-t border-slate-100 px-3 py-2 sm:px-4">
            <button
              type="button"
              onClick={(e) => {
                e.stopPropagation()
                setNotesExpanded((v) => !v)
              }}
              aria-expanded={notesExpanded}
              className="inline-flex cursor-pointer items-center gap-1.5 rounded-lg px-1.5 py-1 text-xs font-semibold text-violet-800 transition hover:bg-violet-50 focus:outline-none focus-visible:ring-2 focus-visible:ring-violet-500 focus-visible:ring-offset-1"
            >
              <StickyNote className="size-3.5 shrink-0" strokeWidth={2.25} aria-hidden />
              Admin notes
              <span className="rounded-full bg-violet-100 px-1.5 py-0.5 text-[10px] tabular-nums text-violet-700">
                {noteLines.length}
              </span>
              <ChevronDown
                className={`size-3.5 shrink-0 text-violet-500 transition-transform ${
                  notesExpanded ? 'rotate-180' : ''
                }`}
                strokeWidth={2.25}
                aria-hidden
              />
            </button>
            {notesExpanded ? (
              <div className="mt-1.5 space-y-2 rounded-lg border border-violet-100 bg-violet-50/50 p-2.5">
                {noteLines.map((line) => (
                  <p key={line.key} className="text-xs leading-snug text-slate-700">
                    {line.prefix ? (
                      <span className="font-medium text-slate-500">
                        {line.prefix}{' '}
                      </span>
                    ) : null}
                    {line.text}
                  </p>
                ))}
              </div>
            ) : null}
          </div>
        ) : null}
      </article>
    </div>
  )
}

/**
 * @param {{
 *   icon: import('react').ReactNode
 *   label: string
 *   tone?: 'default' | 'danger' | 'reports'
 *   disabled?: boolean
 *   onClick: () => void
 * }} props
 */
function CardActionButton({ icon, label, tone = 'default', disabled, onClick }) {
  const toneClass =
    tone === 'danger'
      ? 'border-rose-200 bg-white text-rose-600 hover:border-rose-300 hover:bg-rose-50 focus-visible:ring-rose-500'
      : tone === 'reports'
        ? 'border-rose-200 bg-rose-50 text-rose-700 hover:border-rose-300 hover:bg-rose-100 focus-visible:ring-rose-500'
        : 'border-slate-200 bg-white text-slate-600 hover:border-violet-300 hover:bg-violet-50 hover:text-violet-700 focus-visible:ring-violet-500'
  return (
    <button
      type="button"
      disabled={disabled}
      onClick={(e) => {
        e.stopPropagation()
        onClick()
      }}
      title={label}
      aria-label={label}
      className={`inline-flex size-9 cursor-pointer items-center justify-center rounded-lg border shadow-sm transition focus:outline-none focus-visible:ring-2 focus-visible:ring-offset-1 disabled:cursor-not-allowed disabled:opacity-40 ${toneClass}`}
    >
      {icon}
    </button>
  )
}

/* -------------------------------------------------------------------------- */
/* Edit / Add / Duplicate modal                                               */
/* -------------------------------------------------------------------------- */

/**
 * Translation cloud function — fires after every successful Firestore add or
 * update so the backend can produce localized copies of the new content.
 *
 * URL and bearer token can be overridden via env vars; defaults match the
 * spec the team handed off.
 */
const TRANSLATE_URL =
  import.meta.env.VITE_TRANSLATE_QUESTIONS_URL?.trim() ||
  'https://translatequestions-tv3w6ws4bq-uc.a.run.app'
const TRANSLATE_TOKEN =
  import.meta.env.VITE_TRANSLATE_QUESTIONS_TOKEN?.trim() ||
  'mR7xKw2NpJ9vBtYd4LqZs5CfAe8UhG3X'
const TRANSLATE_LANGUAGE_CODE =
  import.meta.env.VITE_TRANSLATE_LANGUAGE_CODE?.trim() || 'es'

/**
 * Languages the editor knows how to display + edit. Each non-English
 * language is stored as a nested object on the doc, e.g.:
 *   { question: "...", es: { question: "..." } }
 */
const SUPPORTED_LANGUAGES = /** @type {const} */ ([
  { code: 'en', label: 'English' },
  { code: 'es', label: 'Spanish' },
])

/**
 * Fields whose contents need translating. Used for two purposes:
 *  1. In Edit mode for the default English language, changing any of these
 *     marks `isTranslated_es: false` and triggers the translation cloud
 *     function. Pure-metadata edits (tags, calibration, etc.) do not.
 *  2. When the user is viewing/editing a non-English language, the values
 *     for these keys come from (and write to) the nested `row[lang]` object.
 */
const TRANSLATABLE_FIELDS = /** @type {const} */ ([
  'question',
  'context',
  'option_1',
  'option_2',
  'option_3',
  'option_4',
  'correct_answer',
  'answer_explanation',
])

/**
 * Swap translatable fields with the values stored in `row[lang]`, falling
 * back to the English (top-level) value when a translation is missing.
 *
 * @param {Record<string, unknown>} row
 * @param {string} lang
 */
function localizeRow(row, lang) {
  if (!row) return row
  if (lang === 'en') return row
  const nested = row[lang]
  if (!nested || typeof nested !== 'object') return row
  const out = { ...row }
  for (const f of TRANSLATABLE_FIELDS) {
    const v = /** @type {Record<string, unknown>} */ (nested)[f]
    if (v != null && v !== '') out[f] = v
  }
  return out
}

/**
 * Normalize a stored field value so a `null` and an `''` compare equal
 * (Firestore frequently round-trips one as the other).
 *
 * @param {unknown} v
 */
function normalizeForCompare(v) {
  if (v == null) return ''
  if (typeof v === 'string') return v
  return String(v)
}

/**
 * Did any translation-affecting field change between `patch` (the new values
 * about to be written) and `original` (the doc currently in Firestore)?
 *
 * @param {Record<string, unknown>} patch
 * @param {Record<string, unknown> | undefined} original
 */
function hasTranslatableContentChange(patch, original) {
  for (const f of TRANSLATABLE_FIELDS) {
    if (!(f in patch)) continue
    const next = normalizeForCompare(patch[f])
    const prev = normalizeForCompare(original?.[f])
    if (next !== prev) return true
  }
  return false
}

/**
 * Fire-and-forget POST to the translation function. Errors are logged and,
 * if `onError` is provided, surfaced to the caller so the UI can show them.
 * Never rethrows — translation is a background concern that should not break
 * the save flow.
 *
 * @param {(err: Error) => void} [onError]
 */
function triggerQuestionTranslation(onError) {
  const report = (err) => {
    // eslint-disable-next-line no-console
    console.warn('[translate]', err)
    try {
      onError?.(err instanceof Error ? err : new Error(String(err)))
    } catch {
      /* ignore — never crash the save flow */
    }
  }
  try {
    fetch(TRANSLATE_URL, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${TRANSLATE_TOKEN}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({ languageCode: TRANSLATE_LANGUAGE_CODE }),
    })
      .then((res) => {
        if (!res.ok) {
          report(new Error(`Translation request failed (HTTP ${res.status})`))
        }
      })
      .catch(report)
  } catch (err) {
    report(err)
  }
}

/**
 * Friendly label + free-form help text for each field. Sourced from the team
 * spreadsheet. Newlines are preserved verbatim in the help block.
 *
 * @type {Record<string, { title: string, help?: string }>}
 */
const FIELD_META = {
  id: { title: 'No.' },
  user_seat: {
    title: 'User Seat',
    help: `The main player — hand scenario questions only.

No action: POS-STACK
With action: POS-STACK-ACTION
* action here means they made an action with a value, such as betting, raising, or calling
** you can use either $ or BB next to any amount, depending on what the question uses

Examples
- LJ-100BB
- BTN-100BB-45BB-3-bet
- BB-$100-$6-call

Positions:
BTN  SB  BB  UTG  UTG+1  UTG+2  LJ  HJ  CO
* For the position, if the question just says "middle position", you can write MP instead of having to decide whether it's the low jack or high jack.
* Of course, for tables less than 9 players, positions will be different unless specified. Assume tables are 9 players unless otherwise specified.
** Hand-state columns are only applicable for "hand scenario" questions — otherwise leave blank.`,
  },
  user_cards: {
    title: 'User Cards',
    help: `Hand scenario questions only.
Format: RANK-SUIT

Examples
- 9-diamonds
- K-spades
- Q-hearts
- J-spades
- 5-hearts

KK = "K-diamonds, K-clubs" (choose any random suits if not specified, as long as it matches whether it's offsuit or suited).

Suits: spades | hearts | diamonds | clubs`,
  },
  flop: {
    title: 'Cards on table',
    help: `Hand scenario questions only.
Format: RANK-SUIT, RANK-SUIT, RANK-SUIT

Examples
- 9-diamonds, 9-hearts, K-spades
- Q-hearts, J-spades, 5-hearts

Suits: spades | hearts | diamonds | clubs`,
  },
  table_size: {
    title: 'Table size',
    help: '9 or 6 based on the question. Hand scenario questions only.',
  },
  default_stack: {
    title: 'Default stack',
    help: 'Default stack of the table. Hand scenario questions only.',
  },
  seats: {
    title: 'Seats',
    help: `All active or folded seats that have taken actions in the hand.

Format:
- No action:                POS-STACK
- With action:              POS-STACK-AMOUNT-ACTION
- No-action folded:         POS-STACK-AMOUNT-FOLD
- Action folded:            POS-STACK-AMOUNT-ACTION-FOLD

For the no-action player, if there is a check you can add "$0-check" at the end, e.g. "LJ-$100-$0-check".
*no action is for the players who haven't acted yet.

Examples
- LJ-100BB-15BB
- BTN-$500-$75-3-bet

With folded seats
- LJ-100BB-15BB-FOLD
- BTN-$100-$45-3-bet-FOLD
- CO-$120-$15-FOLD

Positions: BTN  SB  BB  UTG  UTG+1  UTG+2  LJ  HJ  CO
Folded seats and the hero user should not be included in this list.`,
  },
  pot: {
    title: 'Pot',
    help: 'The pot value, e.g. $50 or 20 BB.',
  },
  context: {
    title: 'Context',
    help: 'Details about the situation — can appear in different places in each question. Some questions will not have any context.',
  },
  question: { title: 'Question' },
  question_type: { title: 'Question type' },
  hand_stage: { title: 'Hand stage' },
  option_1: {
    title: 'Option 1',
    help: `Format only applies to Hand Selection questions.
Accepted formats:
- 9-diamonds, 9-hearts
- K-spades, Q-hearts
- 76-suited
- AJ-offsuit

Suits: spades | hearts | diamonds | clubs`,
  },
  option_2: {
    title: 'Option 2',
    help: `Format only applies to Hand Selection questions.
Accepted formats:
- 9-diamonds, 9-hearts
- K-spades, Q-hearts
- 76-suited
- AJ-offsuit

Suits: spades | hearts | diamonds | clubs`,
  },
  option_3: {
    title: 'Option 3',
    help: `Format only applies to Hand Selection questions.
Accepted formats:
- 9-diamonds, 9-hearts
- K-spades, Q-hearts
- 76-suited
- AJ-offsuit

Suits: spades | hearts | diamonds | clubs`,
  },
  option_4: {
    title: 'Option 4',
    help: `Format only applies to Hand Selection questions.
Accepted formats:
- 9-diamonds, 9-hearts
- K-spades, Q-hearts
- 76-suited
- AJ-offsuit

Suits: spades | hearts | diamonds | clubs`,
  },
  correct_answer: {
    title: 'Correct answer',
    help: 'Make sure to use the correct format for hand-selection questions.',
  },
  neutral_credit: {
    title: 'Neutral credit',
    help: 'Optional alternate answer that should also be credited as correct (e.g. "Mostly Fold" alongside an "Always Fold" correct answer). Leave blank when there is no neutral / partial-credit option.',
  },
  answer_explanation: { title: 'Answer explanation' },
  cash_or_tournament: { title: 'Cash / Tourney' },
  live_or_online: { title: 'Live or online?' },
  relative_position: {
    title: 'Relative position',
    help: `Only for hand-scenario and hand-selection types.
- In position
- Out of position`,
  },
  preflop_pot_type: {
    title: 'Preflop pot type',
    help: `- Single raise pot
- Three bet pot
- Four bet pot
- Limped pot`,
  },
  pot_participant_type: {
    title: 'Pot participant type',
    help: `- Multi-way
- Heads-up`,
  },
  stack_depth: {
    title: 'Stack depth',
    help: `- Short stack  (0–50 bb)
- Standard stack  (50–130 bb)
- Deep stack  (130 bb+)`,
  },
  difficulty_rating: { title: 'Difficulty rating' },
  skills: {
    title: 'Skills',
    help: 'Comma-separated skills tested by the question (e.g. Blind Defense, Pot Odds, Out of Position Play).',
  },
  action_frequencies: {
    title: 'Action frequencies',
    help: 'Mixed-strategy frequencies for each action, e.g. "Fold: 84%, Call: 16%, 3-bet: 0%".',
  },
  action_ev_bb: {
    title: 'Action EV (bb)',
    help: 'EV in big blinds for each action option, e.g. "Fold: -4.00, Call: -4.02, All-in: -5.99, 4-bet: -4.26".',
  },
  stat_notes: {
    title: 'Stat notes',
    help: 'JSON array of contextual stats surfaced alongside the answer (pot odds, equity, blockers, villain range, etc.). Each entry: { key, label, value, note }.',
  },
  claim_check: {
    title: 'Claim check',
    help: 'JSON array flagging dubious or imprecise claims in the answer explanation. Each entry: { claim, problem }. Empty array [] is fine.',
  },
  exploit_notes: {
    title: 'Exploit notes',
    help: 'JSON array of opponent-type exploits (nit, station, maniac). Each entry: { opponent, label, headline, detail }.',
  },
  chat_context: {
    title: 'Chat context',
    help: 'JSON blob of the chat/LLM pipeline context for this question (situation, hero hand, recommended action, full strategy breakdown). Stored verbatim.',
  },
  animation_script: {
    title: 'Animation script',
    help: 'Script/data driving the hand-replay animation for this question. Optional — stored verbatim, leave blank if none.',
  },
  hand_id: {
    title: 'Hand ID',
    help: 'Identifier for the underlying hand this question belongs to — shared across every question/step in the same hand sequence. Stored as-is (not coerced to a number).',
  },
  sequence_index: {
    title: 'Sequence index',
    help: 'Position of this question within its hand sequence (0, 1, 2, …) — determines ordering for multi-step hands sharing the same Hand ID.',
  },
  hand_difficulty: {
    title: 'Hand difficulty',
    help: 'Difficulty score for the underlying hand (independent of this specific question’s difficulty_rating).',
  },
  ev_gap_bb: {
    title: 'EV gap (bb)',
    help: 'EV difference (in big blinds) between the best play and the next-best play.',
  },
  notes: { title: 'Notes' },
  source_url: {
    title: 'Source URL',
    help: 'Link to where this hand / scenario was originally documented (e.g. a forum post, hand history, training-site lesson).',
  },
  hand_origin: {
    title: 'Hand origin',
    help: 'Was this a real hand played at the table or a constructed teaching example? Typical values: "Real", "Made-up".',
  },
  concept_tags: {
    title: 'Concept tags',
    help: 'Comma-separated concept tags (snake_case). Example: small_blind, facing_single_raise, mixed_strategy.',
  },
  position_matchup: {
    title: 'Position matchup',
    help: 'Hero vs villain seats, e.g. "SB_vs_UTG".',
  },
  ranges: {
    title: 'Ranges',
    help: 'JSON string mapping each seat to its hand-frequency map. Edited verbatim.',
  },
  archetype: {
    title: 'Archetype',
    help: 'High-level archetype for the spot, e.g. "fold_dominated".',
  },
  board_texture: {
    title: 'Board texture',
    help: 'Postflop board texture descriptor (preflop questions leave this blank).',
  },
  solver_reference: {
    title: 'Solver reference',
    help: 'Path or label of the solver tree this question references.',
  },
  validation_status: {
    title: 'Validation status',
    help: 'Workflow state for QA, e.g. "auto_approved", "pending_review".',
  },
  easy_freq: {
    title: 'Easy: frequency',
    help: 'Calibration score (0–1) for how decisive the frequency answer is.',
  },
  easy_ev: {
    title: 'Easy: EV',
    help: 'Calibration score (0–1) for how decisive the EV gap is.',
  },
  easy_concept: {
    title: 'Easy: concept',
    help: 'Calibration score (0–1) for how clear the underlying concept is.',
  },
  easy_hand: {
    title: 'Easy: hand',
    help: 'Calibration score (0–1) for how representative the specific hand is.',
  },
  difficulty_bumps: {
    title: 'Difficulty bumps',
    help: 'Manual difficulty adjustments applied on top of the base rating.',
  },
  hand_class: {
    title: 'Hand class',
    help: 'Shorthand hand class, e.g. "98s", "AKo", "TT".',
  },
}

/**
 * Every editable field on a question document. `span` is the column span
 * inside the 4-column responsive grid used in the full-screen Edit/Add view.
 * Optional `section` separates fields visually with a small heading.
 */
const FORM_FIELDS = /** @type {const} */ ([
  // Headline content
  { key: 'question', kind: 'textarea', required: true, span: 4, section: 'Question' },
  { key: 'context', kind: 'textarea', span: 4 },

  // Identity & classification
  { key: 'id', span: 1, section: 'Identity' },
  { key: 'question_type', span: 1 },
  { key: 'hand_stage', span: 1 },
  { key: 'difficulty_rating', span: 1 },

  // Hand state
  { key: 'user_seat', span: 1, section: 'Hand state' },
  { key: 'user_cards', span: 1 },
  { key: 'flop', span: 1 },
  { key: 'pot', span: 1 },
  { key: 'table_size', span: 1 },
  { key: 'default_stack', span: 1 },
  { key: 'seats', span: 2 },
  { key: 'board_texture', span: 1 },
  { key: 'position_matchup', span: 1 },
  { key: 'relative_position', span: 1 },
  { key: 'preflop_pot_type', span: 1 },
  { key: 'pot_participant_type', span: 1 },
  { key: 'stack_depth', span: 1 },

  // Format
  { key: 'cash_or_tournament', span: 2, section: 'Format' },
  { key: 'live_or_online', span: 2 },

  // Answer choices
  { key: 'option_1', span: 2, section: 'Answer' },
  { key: 'option_2', span: 2 },
  { key: 'option_3', span: 2 },
  { key: 'option_4', span: 2 },
  { key: 'correct_answer', span: 2 },
  { key: 'neutral_credit', span: 2 },
  { key: 'answer_explanation', kind: 'textarea', span: 4 },

  // Skills & tagging
  { key: 'skills', span: 2, section: 'Skills & tags' },
  { key: 'concept_tags', span: 2 },
  { key: 'archetype', span: 1 },
  { key: 'hand_class', span: 1 },
  { key: 'action_frequencies', span: 2 },
  { key: 'action_ev_bb', span: 2 },

  // Difficulty calibration
  { key: 'ev_gap_bb', span: 1, section: 'Difficulty calibration' },
  { key: 'easy_freq', span: 1 },
  { key: 'easy_ev', span: 1 },
  { key: 'easy_concept', span: 1 },
  { key: 'easy_hand', span: 1 },
  { key: 'hand_difficulty', span: 1 },
  { key: 'difficulty_bumps', span: 3 },

  // Solver
  { key: 'solver_reference', span: 3, section: 'Solver' },
  { key: 'validation_status', span: 1 },
  { key: 'ranges', kind: 'textarea', span: 4 },
  { key: 'stat_notes', kind: 'textarea', span: 4 },
  { key: 'claim_check', kind: 'textarea', span: 4 },
  { key: 'exploit_notes', kind: 'textarea', span: 4 },
  { key: 'chat_context', kind: 'textarea', span: 4 },
  { key: 'animation_script', kind: 'textarea', span: 4 },
  { key: 'hand_id', span: 2 },
  { key: 'sequence_index', span: 2 },

  // Notes & provenance
  { key: 'notes', kind: 'textarea', span: 4, section: 'Notes' },
  { key: 'source_url', span: 3 },
  { key: 'hand_origin', span: 1 },
])

function emptyFormValues() {
  /** @type {Record<string, string>} */
  const v = {}
  for (const f of FORM_FIELDS) v[f.key] = ''
  return v
}

function rowToFormValues(row, lang = 'en') {
  // For non-English languages, swap translatable fields with the values
  // stored in the nested `row[lang]` object before reading.
  const localized = localizeRow(row, lang)
  const v = emptyFormValues()
  for (const f of FORM_FIELDS) {
    const raw = localized[f.key]
    if (raw == null || raw === '') v[f.key] = ''
    else v[f.key] = typeof raw === 'string' ? raw : String(raw)
  }
  // If `correct_answer` is empty but a legacy numeric `correct_option` exists,
  // backfill the answer text from the matching option so the user sees what
  // was previously stored.
  if (!v.correct_answer.trim()) {
    const idx = correctOptionIndex(row)
    if (idx != null) v.correct_answer = v[`option_${idx}`] ?? ''
  }
  return v
}

/**
 * @param {{
 *   state: { mode: 'add' } | { mode: 'edit' | 'duplicate', row: any }
 *   onClose: () => void
 *   onSave: (form: ReturnType<typeof emptyFormValues>) => void
 *   saving: boolean
 * }} props
 */
function EditQuestionModal({
  state,
  language = 'en',
  existingNumericIds,
  nextNumericId,
  onClose,
  onSave,
  saving,
}) {
  const questionTextareaRef = useRef(
    /** @type {HTMLTextAreaElement | null} */ (null),
  )
  useEffect(() => {
    questionTextareaRef.current?.focus()
  }, [])
  // `initial` is captured once per mount; the parent renders this modal with
  // a `key` derived from the target row + language so a fresh mount → fresh
  // `initial`. For Add/Duplicate, the numeric `id` is auto-filled with max+1.
  const initial = useMemo(() => {
    if (state.mode === 'add') {
      const v = emptyFormValues()
      if (nextNumericId != null) v.id = String(nextNumericId)
      return v
    }
    // Edit pulls from the active language's nested object; Duplicate stays
    // in English (we always author new content in English).
    const sourceLang = state.mode === 'duplicate' ? 'en' : language
    const v = rowToFormValues(state.row, sourceLang)
    if (state.mode === 'duplicate' && nextNumericId != null) {
      v.id = String(nextNumericId)
    }
    return v
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])
  const [form, setForm] = useState(initial)
  const [touched, setTouched] = useState(false)
  const [confirmDiscard, setConfirmDiscard] = useState(false)

  // Reset form back to empty when user chooses "Save & add another" — the
  // parent's `key` doesn't change so we have to do it locally. The next id
  // is recomputed by the parent and passed in via the `nextNumericId` prop.
  const resetForNext = useCallback(() => {
    const v = emptyFormValues()
    if (nextNumericId != null) v.id = String(nextNumericId)
    setForm(v)
    setTouched(false)
  }, [nextNumericId])

  // In Add mode, `id` is always derived from the parent's next-available id.
  // Sync the form whenever the prop updates so consecutive "Save & add
  // another" clicks never reuse the just-saved id — between save 1 and save
  // 2 the parent re-renders with a new `nextNumericId`, this effect mirrors
  // it onto the form even though `resetForNext` ran with a stale closure.
  useEffect(() => {
    if (state.mode !== 'add') return
    if (nextNumericId == null) return
    const next = String(nextNumericId)
    setForm((prev) => (prev.id === next ? prev : { ...prev, id: next }))
  }, [state.mode, nextNumericId])

  const isAdd = state.mode === 'add'
  const isDup = state.mode === 'duplicate'
  const title = isAdd
    ? 'Add new question'
    : isDup
      ? 'Duplicate question'
      : 'Edit question'
  const editingId =
    state.mode === 'edit' || state.mode === 'duplicate'
      ? state.row?.id
      : null
  const isNonEnglishEdit = state.mode === 'edit' && language !== 'en'
  const langLabel =
    SUPPORTED_LANGUAGES.find((l) => l.code === language)?.label || language
  const subtitle = isAdd
    ? `Create a brand new question · id #${nextNumericId ?? '?'}`
    : isDup
      ? `Duplicate of #${editingId ?? state.row?.firestoreDocId} → new id #${nextNumericId ?? '?'}`
      : isNonEnglishEdit
        ? `Editing #${editingId ?? state.row?.firestoreDocId} · ${langLabel} translation`
        : `Editing question #${editingId ?? state.row?.firestoreDocId}`

  const valid = form.question.trim() !== ''
  // In Add mode, `id` is auto-managed (mirrors parent's `nextNumericId`)
  // and the user can't edit it. Excluding it from the dirty check stops
  // the "Save & add another" reset from looking dirty just because the id
  // bumped from 100 → 101 between rows.
  const dirtyVsInitial =
    isAdd
      ? JSON.stringify({ ...form, id: initial.id }) !==
        JSON.stringify(initial)
      : JSON.stringify(form) !== JSON.stringify(initial)
  // Add/Duplicate: any text typed counts as dirty. Edit: must differ from saved.
  const dirty = isAdd || isDup ? dirtyVsInitial : dirtyVsInitial

  // Detect a numeric id collision against any *other* question.
  const trimmedId = form.id.trim()
  const ownFirestoreId = state.mode === 'edit' ? state.row?.firestoreDocId : null
  const idClashWith =
    trimmedId !== ''
      ? existingNumericIds?.get(trimmedId) ?? null
      : null
  const duplicateIdConflict =
    idClashWith != null && idClashWith !== ownFirestoreId

  function patch(p) {
    setForm((prev) => ({ ...prev, ...p }))
    setTouched(true)
  }

  function attemptClose() {
    if (saving) return
    if (dirty) setConfirmDiscard(true)
    else onClose()
  }

  function handleSubmit(e) {
    if (e) e.preventDefault()
    if (!valid || !dirty || saving) return
    onSave(form, { language })
  }

  // Cmd/Ctrl+Enter to submit when modal is focused.
  useEffect(() => {
    function onKey(e) {
      if (e.key === 'Enter' && (e.metaKey || e.ctrlKey)) {
        e.preventDefault()
        if (valid && dirty && !saving) onSave(form, { language })
      }
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [valid, dirty, saving, form, onSave])

  return (
    <div
      role="dialog"
      aria-modal="true"
      aria-labelledby="edit-question-modal-title"
      className="fixed inset-0 z-50 flex flex-col bg-slate-50"
    >
      {/* Sticky top bar */}
      <header className="sticky top-0 z-10 flex flex-wrap items-center justify-between gap-3 border-b border-slate-200 bg-white px-4 py-3 shadow-sm sm:px-6">
        <div className="flex min-w-0 items-center gap-3">
          <div className="flex size-10 shrink-0 items-center justify-center rounded-xl bg-gradient-to-br from-violet-500 to-fuchsia-600 text-white shadow-md shadow-violet-900/25">
            {isAdd ? (
              <Sparkles className="size-5" strokeWidth={2.25} aria-hidden />
            ) : isDup ? (
              <Copy className="size-5" strokeWidth={2.25} aria-hidden />
            ) : (
              <Pencil className="size-5" strokeWidth={2.25} aria-hidden />
            )}
          </div>
          <div className="min-w-0">
            <h2
              id="edit-question-modal-title"
              className="text-base font-semibold text-slate-900 sm:text-lg"
            >
              {title}
            </h2>
            <p className="truncate font-mono text-[11px] text-slate-500">
              {subtitle}
            </p>
          </div>
          {dirty ? (
            <span className="ml-2 hidden rounded-full bg-amber-50 px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wider text-amber-800 ring-1 ring-amber-200/80 sm:inline">
              Unsaved
            </span>
          ) : null}
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <span className="hidden text-[11px] text-slate-400 sm:inline">
            <kbd className="rounded border border-slate-200 bg-slate-50 px-1 py-0.5 font-mono text-[10px] text-slate-500">
              ⌘
            </kbd>
            +
            <kbd className="rounded border border-slate-200 bg-slate-50 px-1 py-0.5 font-mono text-[10px] text-slate-500">
              Enter
            </kbd>
            {' '}to save
          </span>
          <button
            type="button"
            onClick={attemptClose}
            disabled={saving}
            className="cursor-pointer rounded-lg border border-slate-200 bg-white px-3 py-1.5 text-xs font-semibold text-slate-700 transition hover:border-slate-300 hover:bg-slate-50 focus:outline-none focus-visible:ring-2 focus-visible:ring-slate-400 disabled:cursor-not-allowed disabled:opacity-50"
          >
            Cancel
          </button>
          {isAdd ? (
            <button
              type="button"
              onClick={async () => {
                if (!valid || !dirty || saving) return
                // "Save & add another" is only available in Add mode, which
                // is always English. Only reset the form when the save
                // actually succeeded — otherwise the user's data would be
                // lost on a Firestore error.
                const ok = await onSave(form, {
                  keepOpen: true,
                  language: 'en',
                })
                if (ok) resetForNext()
              }}
              disabled={!valid || !dirty || saving}
              title="Save and clear the form to add another"
              className="inline-flex cursor-pointer items-center justify-center gap-1.5 rounded-lg border border-violet-200 bg-white px-3 py-1.5 text-xs font-semibold text-violet-800 transition hover:border-violet-300 hover:bg-violet-50 focus:outline-none focus-visible:ring-2 focus-visible:ring-violet-500 disabled:cursor-not-allowed disabled:opacity-50"
            >
              <Plus className="size-3.5 shrink-0" strokeWidth={2.5} aria-hidden />
              Save & add another
            </button>
          ) : null}
          <button
            type="button"
            onClick={handleSubmit}
            disabled={!valid || !dirty || saving}
            className="inline-flex cursor-pointer items-center justify-center gap-1.5 rounded-lg bg-gradient-to-b from-violet-600 to-violet-700 px-4 py-1.5 text-xs font-semibold text-white shadow-md shadow-violet-900/25 transition hover:from-violet-700 hover:to-violet-800 focus:outline-none focus-visible:ring-2 focus-visible:ring-violet-500 focus-visible:ring-offset-1 disabled:cursor-not-allowed disabled:opacity-50"
          >
            {saving ? (
              <>
                <Loader2 className="size-3.5 animate-spin" strokeWidth={2} aria-hidden />
                Saving…
              </>
            ) : isAdd ? (
              <>
                <Plus className="size-3.5 shrink-0" strokeWidth={2.5} aria-hidden />
                Create
              </>
            ) : isDup ? (
              <>
                <Copy className="size-3.5 shrink-0" strokeWidth={2.25} aria-hidden />
                Save copy
              </>
            ) : (
              <>
                <Save className="size-3.5 shrink-0" strokeWidth={2.25} aria-hidden />
                Save changes
              </>
            )}
          </button>
          <button
            type="button"
            onClick={attemptClose}
            disabled={saving}
            className="cursor-pointer rounded-lg p-1.5 text-slate-500 transition hover:bg-slate-100 hover:text-slate-800 focus:outline-none focus-visible:ring-2 focus-visible:ring-slate-400 disabled:cursor-not-allowed disabled:opacity-50"
            aria-label="Close"
          >
            <X className="size-5" strokeWidth={2} />
          </button>
        </div>
      </header>

      <form
        className="flex-1 overflow-y-auto"
        onSubmit={handleSubmit}
      >
        <div className="mx-auto max-w-7xl px-4 py-6 sm:px-6 lg:px-8 lg:py-8">
          <div className="grid grid-cols-1 gap-x-5 gap-y-4 sm:grid-cols-2 lg:grid-cols-4">
            {FORM_FIELDS.map((f, i) => {
              const isQuestion = f.key === 'question'
              const isId = f.key === 'id'
              const prevSection = FORM_FIELDS[i - 1]?.section
              const showSection = f.section && f.section !== prevSection
              return (
                <Fragment key={f.key}>
                  {showSection ? (
                    <h3 className="col-span-1 mt-4 flex items-center gap-2 border-b border-slate-200 pb-2 text-xs font-bold uppercase tracking-[0.14em] text-slate-600 sm:col-span-2 lg:col-span-4">
                      <span className="size-2 rounded-full bg-violet-400" />
                      {f.section}
                    </h3>
                  ) : null}
                  <DraftField
                    label={FIELD_META[f.key]?.title || f.key}
                    keyName={f.key}
                    help={FIELD_META[f.key]?.help}
                    required={f.required}
                    multiline={f.kind === 'textarea'}
                    span={f.span}
                    inputRef={isQuestion ? questionTextareaRef : undefined}
                    value={form[f.key]}
                    onChange={(v) => patch({ [f.key]: v })}
                    disabled={saving || isId}
                    error={
                      isQuestion && touched && !form.question.trim()
                        ? 'Required'
                        : isId && duplicateIdConflict
                          ? 'Already used'
                          : ''
                    }
                    hint={
                      isId && state.mode === 'edit'
                        ? 'IDs are read-only — assigned at creation.'
                        : isId && duplicateIdConflict
                          ? `id ${trimmedId} is already used by another question`
                          : isId
                            ? 'Auto-generated from the next available id (read-only).'
                            : ''
                    }
                  />
                </Fragment>
              )
            })}
          </div>
        </div>
      </form>

      {confirmDiscard ? (
        <DiscardChangesOverlay
          onCancel={() => setConfirmDiscard(false)}
          onDiscard={() => {
            setConfirmDiscard(false)
            onClose()
          }}
        />
      ) : null}
    </div>
  )
}

/**
 * Inline overlay shown inside an Edit/Add modal when the user tries to
 * close while there are unsaved changes.
 *
 * @param {{ onCancel: () => void, onDiscard: () => void }} props
 */
function DiscardChangesOverlay({ onCancel, onDiscard }) {
  return (
    <div
      className="fixed inset-0 z-[55] flex items-center justify-center bg-slate-900/50 backdrop-blur-sm"
      role="dialog"
      aria-modal="true"
      aria-labelledby="discard-changes-title"
    >
      <div className="w-[min(90%,22rem)] rounded-2xl border border-amber-200 bg-white p-5 shadow-2xl">
        <div className="flex items-start gap-3">
          <div className="flex size-10 shrink-0 items-center justify-center rounded-xl bg-amber-100 text-amber-700">
            <AlertTriangle className="size-5" strokeWidth={2.25} aria-hidden />
          </div>
          <div className="min-w-0 flex-1">
            <h3
              id="discard-changes-title"
              className="text-sm font-semibold text-slate-900"
            >
              Discard unsaved changes?
            </h3>
            <p className="mt-1 text-xs text-slate-600">
              You have unsaved edits. Closing will throw them away.
            </p>
          </div>
        </div>
        <div className="mt-4 flex justify-end gap-2">
          <button
            type="button"
            onClick={onCancel}
            className="cursor-pointer rounded-lg border border-slate-200 bg-white px-3 py-1.5 text-xs font-semibold text-slate-700 transition hover:border-slate-300 hover:bg-slate-50 focus:outline-none focus-visible:ring-2 focus-visible:ring-violet-500"
            autoFocus
          >
            Keep editing
          </button>
          <button
            type="button"
            onClick={onDiscard}
            className="cursor-pointer rounded-lg bg-amber-600 px-3 py-1.5 text-xs font-semibold text-white shadow-sm transition hover:bg-amber-700 focus:outline-none focus-visible:ring-2 focus-visible:ring-amber-500 focus-visible:ring-offset-2"
          >
            Discard
          </button>
        </div>
      </div>
    </div>
  )
}

/**
 * @param {{
 *   label: string
 *   value: string
 *   onChange: (v: string) => void
 *   placeholder?: string
 *   multiline?: boolean
 *   required?: boolean
 *   disabled?: boolean
 *   error?: string
 *   hint?: string
 *   span?: number
 *   rows?: number
 *   inputRef?: import('react').Ref<any>
 * }} props
 */
/**
 * Convert a `span` value to the right Tailwind col-span classes for our
 * 4-column responsive grid. Listed statically so JIT picks them up.
 */
const SPAN_CLASS = {
  1: 'sm:col-span-1 lg:col-span-1',
  2: 'sm:col-span-2 lg:col-span-2',
  3: 'sm:col-span-2 lg:col-span-3',
  4: 'sm:col-span-2 lg:col-span-4',
}

function DraftField({
  label,
  keyName,
  help,
  value,
  onChange,
  placeholder,
  multiline = false,
  required = false,
  disabled = false,
  error = '',
  hint = '',
  span = 1,
  rows = 3,
  inputRef,
}) {
  const spanCls = SPAN_CLASS[span] ?? SPAN_CLASS[1]
  const isLongTextarea = multiline && span === 4
  const [helpOpen, setHelpOpen] = useState(false)
  return (
    <label className={`flex flex-col ${spanCls}`}>
      <span className="flex items-center gap-2">
        <span className="text-[15px] font-semibold text-slate-800">
          {label}
          {required ? <span className="ml-0.5 text-rose-500">*</span> : null}
        </span>
        {keyName ? (
          <span
            className="rounded bg-slate-100 px-1.5 py-0.5 font-mono text-[11px] text-slate-500"
            title={`Stored as ${keyName}`}
          >
            {keyName}
          </span>
        ) : null}
        {help ? (
          <button
            type="button"
            onClick={(e) => {
              e.preventDefault()
              setHelpOpen((v) => !v)
            }}
            aria-expanded={helpOpen}
            title={helpOpen ? 'Hide help' : 'Show help'}
            className={`inline-flex size-5 cursor-pointer items-center justify-center rounded-full transition focus:outline-none focus-visible:ring-2 focus-visible:ring-violet-500 ${
              helpOpen
                ? 'bg-violet-100 text-violet-800'
                : 'bg-slate-100 text-slate-500 hover:bg-violet-50 hover:text-violet-700'
            }`}
          >
            <Info className="size-3" strokeWidth={2.25} aria-hidden />
          </button>
        ) : null}
        {error ? (
          <span className="ml-auto inline-flex items-center gap-1 rounded-full bg-rose-50 px-2 py-0.5 text-[10px] font-semibold text-rose-700 ring-1 ring-rose-100">
            {error}
          </span>
        ) : null}
      </span>
      {help && helpOpen ? (
        <div className="mt-2 whitespace-pre-line rounded-lg border border-violet-100 bg-violet-50/60 px-3 py-2.5 text-xs leading-relaxed text-slate-700">
          {help}
        </div>
      ) : null}
      {multiline ? (
        <textarea
          ref={inputRef}
          rows={isLongTextarea ? Math.max(rows, 4) : rows}
          value={value}
          onChange={(e) => onChange(e.target.value)}
          placeholder={placeholder}
          disabled={disabled}
          className={`mt-1.5 w-full resize-y rounded-lg border bg-white px-3 py-2.5 text-[15px] leading-relaxed text-slate-800 shadow-sm outline-none placeholder:text-slate-400 focus:ring-2 disabled:cursor-not-allowed disabled:bg-slate-50 disabled:opacity-70 ${
            error
              ? 'border-rose-300 focus:border-rose-400 focus:ring-rose-500/20'
              : 'border-slate-200 focus:border-violet-400 focus:ring-violet-500/20'
          }`}
        />
      ) : (
        <input
          ref={inputRef}
          type="text"
          value={value}
          onChange={(e) => onChange(e.target.value)}
          placeholder={placeholder}
          disabled={disabled}
          className={`mt-1.5 w-full rounded-lg border bg-white px-3 py-2.5 text-[15px] text-slate-800 shadow-sm outline-none placeholder:text-slate-400 focus:ring-2 disabled:cursor-not-allowed disabled:bg-slate-50 disabled:opacity-70 ${
            error
              ? 'border-rose-300 focus:border-rose-400 focus:ring-rose-500/20'
              : 'border-slate-200 focus:border-violet-400 focus:ring-violet-500/20'
          }`}
        />
      )}
      {hint ? (
        <p
          className={`mt-1 text-xs ${
            error ? 'text-rose-700' : 'text-slate-500'
          }`}
        >
          {hint}
        </p>
      ) : null}
    </label>
  )
}

/* -------------------------------------------------------------------------- */
/* Delete confirmation                                                        */
/* -------------------------------------------------------------------------- */

/**
 * Type-to-confirm destructive modal. The user must type the question's
 * numeric id (when present) or the literal word `DELETE` before the
 * destructive button enables — the same UX pattern GitHub/Vercel use.
 *
 * @param {{
 *   row: { firestoreDocId: string } & Record<string, unknown>
 *   busy: boolean
 *   onCancel: () => void
 *   onConfirm: () => void
 * }} props
 */
function DeleteConfirmationModal({ row, busy, onCancel, onConfirm }) {
  const numericId = row.id != null && row.id !== '' ? String(row.id) : null
  const confirmToken = numericId ? `delete-${numericId}` : 'DELETE'
  const [typed, setTyped] = useState('')
  const matches = typed.trim() === confirmToken
  const inputRef = useRef(/** @type {HTMLInputElement | null} */ (null))

  useEffect(() => {
    inputRef.current?.focus()
  }, [])

  // Parent keys this modal by row.firestoreDocId, so it remounts when the
  // target changes — no need to reset `typed` in an effect.

  const questionText = questionPreviewText(row) || '(no question text)'
  const reports = getReportsArray(row)

  return (
    <div
      className="fixed inset-0 z-[55] flex items-end justify-center bg-slate-900/50 p-0 backdrop-blur-sm sm:items-center sm:p-4"
      role="presentation"
      onClick={() => {
        if (!busy) onCancel()
      }}
    >
      <div
        role="dialog"
        aria-modal="true"
        aria-labelledby="delete-confirm-title"
        className="flex max-h-[min(92vh,640px)] w-full max-w-md flex-col rounded-t-2xl border border-rose-200 bg-white shadow-2xl sm:rounded-2xl"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-start gap-3 border-b border-rose-100 bg-rose-50/70 px-5 py-4">
          <div className="flex size-10 shrink-0 items-center justify-center rounded-xl bg-rose-600 text-white shadow-md shadow-rose-900/25">
            <AlertTriangle className="size-5" strokeWidth={2.25} aria-hidden />
          </div>
          <div className="min-w-0 flex-1">
            <h2
              id="delete-confirm-title"
              className="text-base font-semibold text-rose-900"
            >
              Delete this question?
            </h2>
            <p className="text-xs text-rose-800/80">
              This hides the question everywhere — it won't appear in any
              list.
            </p>
          </div>
          <button
            type="button"
            onClick={onCancel}
            disabled={busy}
            className="shrink-0 cursor-pointer rounded-lg p-1.5 text-rose-700 transition hover:bg-rose-100 focus:outline-none focus-visible:ring-2 focus-visible:ring-rose-500 disabled:cursor-not-allowed disabled:opacity-50"
            aria-label="Cancel"
          >
            <X className="size-5" strokeWidth={2} />
          </button>
        </div>
        <div className="flex-1 space-y-3 overflow-y-auto px-5 py-4 text-sm">
          <div className="rounded-xl border border-slate-200 bg-slate-50/80 p-3">
            <p className="flex flex-wrap items-center gap-1.5 text-xs">
              {numericId ? (
                <span className="rounded-full bg-violet-100 px-2 py-0.5 text-[10px] font-bold uppercase tracking-wider text-violet-800">
                  #{numericId}
                </span>
              ) : null}
              <span
                className="rounded-md bg-slate-100 px-1.5 py-0.5 font-mono text-[10.5px] text-slate-600"
                title={row.firestoreDocId}
              >
                {row.firestoreDocId}
              </span>
              {reports.length > 0 ? (
                <span className="inline-flex items-center gap-1 rounded-full bg-rose-50 px-2 py-0.5 text-[11px] font-semibold text-rose-800 ring-1 ring-rose-100">
                  <Flag
                    className="size-3 shrink-0"
                    strokeWidth={2.25}
                    aria-hidden
                  />
                  {reports.length} active report
                  {reports.length === 1 ? '' : 's'}
                </span>
              ) : null}
            </p>
            <p className="mt-2 line-clamp-3 whitespace-pre-wrap break-words text-sm font-medium text-slate-800">
              {questionText}
            </p>
          </div>

          <div>
            <label
              htmlFor="delete-confirm-input"
              className="block text-xs font-semibold text-slate-700"
            >
              To confirm, type{' '}
              <code className="rounded bg-slate-100 px-1.5 py-0.5 font-mono text-[11px] font-bold text-rose-700">
                {confirmToken}
              </code>{' '}
              below:
            </label>
            <input
              ref={inputRef}
              id="delete-confirm-input"
              type="text"
              autoComplete="off"
              value={typed}
              onChange={(e) => setTyped(e.target.value)}
              disabled={busy}
              placeholder={confirmToken}
              className={`mt-1.5 w-full rounded-lg border bg-white px-3 py-2 font-mono text-sm shadow-sm outline-none transition placeholder:text-slate-400 focus:ring-2 disabled:cursor-not-allowed disabled:opacity-60 ${
                typed.length === 0
                  ? 'border-slate-200 focus:border-rose-400 focus:ring-rose-500/15'
                  : matches
                    ? 'border-emerald-300 bg-emerald-50/50 focus:border-emerald-400 focus:ring-emerald-500/20'
                    : 'border-rose-300 focus:border-rose-400 focus:ring-rose-500/20'
              }`}
              onKeyDown={(e) => {
                if (e.key === 'Enter' && matches && !busy) onConfirm()
              }}
            />
            <p className="mt-1 text-[11px] text-slate-500">
              This action <span className="font-semibold">cannot be undone</span>.
            </p>
          </div>
        </div>
        <div className="flex flex-col-reverse gap-2 border-t border-slate-100 px-5 py-3 sm:flex-row sm:items-center sm:justify-between">
          <button
            type="button"
            onClick={onCancel}
            disabled={busy}
            className="cursor-pointer rounded-lg border border-slate-200 bg-white px-3 py-2 text-xs font-semibold text-slate-700 transition hover:border-slate-300 hover:bg-slate-50 focus:outline-none focus-visible:ring-2 focus-visible:ring-slate-400 disabled:cursor-not-allowed disabled:opacity-50"
          >
            Cancel
          </button>
          <button
            type="button"
            onClick={onConfirm}
            disabled={!matches || busy}
            className="inline-flex cursor-pointer items-center justify-center gap-1.5 rounded-lg bg-gradient-to-b from-rose-600 to-rose-700 px-4 py-2 text-xs font-semibold text-white shadow-md shadow-rose-900/25 transition hover:from-rose-700 hover:to-rose-800 focus:outline-none focus-visible:ring-2 focus-visible:ring-rose-500 focus-visible:ring-offset-2 disabled:cursor-not-allowed disabled:opacity-50"
          >
            {busy ? (
              <>
                <Loader2
                  className="size-3.5 animate-spin"
                  strokeWidth={2}
                  aria-hidden
                />
                Deleting…
              </>
            ) : (
              <>
                <Trash2
                  className="size-3.5 shrink-0"
                  strokeWidth={2.25}
                  aria-hidden
                />
                Delete
              </>
            )}
          </button>
        </div>
      </div>
    </div>
  )
}

/**
 * Type-to-confirm destructive modal for mass soft-delete. There's no single
 * id to type for a mixed selection, so this asks for the exact count
 * instead — same friction pattern as DeleteConfirmationModal, scaled up.
 *
 * @param {{
 *   rows: Array<{ firestoreDocId: string } & Record<string, unknown>>
 *   busy: boolean
 *   onCancel: () => void
 *   onConfirm: () => void
 * }} props
 */
function BulkDeleteConfirmationModal({ rows, busy, onCancel, onConfirm }) {
  const confirmToken = String(rows.length)
  const [typed, setTyped] = useState('')
  const matches = typed.trim() === confirmToken
  const inputRef = useRef(/** @type {HTMLInputElement | null} */ (null))

  useEffect(() => {
    inputRef.current?.focus()
  }, [])

  const PREVIEW_LIMIT = 50
  const preview = rows.slice(0, PREVIEW_LIMIT)

  return (
    <div
      className="fixed inset-0 z-[55] flex items-end justify-center bg-slate-900/50 p-0 backdrop-blur-sm sm:items-center sm:p-4"
      role="presentation"
      onClick={() => {
        if (!busy) onCancel()
      }}
    >
      <div
        role="dialog"
        aria-modal="true"
        aria-labelledby="bulk-delete-confirm-title"
        className="flex max-h-[min(92vh,640px)] w-full max-w-md flex-col rounded-t-2xl border border-rose-200 bg-white shadow-2xl sm:rounded-2xl"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-start gap-3 border-b border-rose-100 bg-rose-50/70 px-5 py-4">
          <div className="flex size-10 shrink-0 items-center justify-center rounded-xl bg-rose-600 text-white shadow-md shadow-rose-900/25">
            <AlertTriangle className="size-5" strokeWidth={2.25} aria-hidden />
          </div>
          <div className="min-w-0 flex-1">
            <h2
              id="bulk-delete-confirm-title"
              className="text-base font-semibold text-rose-900"
            >
              Delete {rows.length} question{rows.length === 1 ? '' : 's'}?
            </h2>
            <p className="text-xs text-rose-800/80">
              This hides them everywhere — they won't appear in any list.
            </p>
          </div>
          <button
            type="button"
            onClick={onCancel}
            disabled={busy}
            className="shrink-0 cursor-pointer rounded-lg p-1.5 text-rose-700 transition hover:bg-rose-100 focus:outline-none focus-visible:ring-2 focus-visible:ring-rose-500 disabled:cursor-not-allowed disabled:opacity-50"
            aria-label="Cancel"
          >
            <X className="size-5" strokeWidth={2} />
          </button>
        </div>
        <div className="flex-1 space-y-3 overflow-y-auto px-5 py-4 text-sm">
          <ul className="max-h-40 space-y-1.5 overflow-y-auto rounded-xl border border-slate-200 bg-slate-50/80 p-3">
            {preview.map((r) => {
              const rNumericId = r.id != null && r.id !== '' ? String(r.id) : null
              const text = questionPreviewText(r) || '(no question text)'
              return (
                <li
                  key={r.firestoreDocId}
                  className="flex items-start gap-2 text-xs text-slate-700"
                >
                  <span className="mt-0.5 shrink-0 rounded-full bg-violet-100 px-1.5 py-0.5 font-bold text-violet-800">
                    #{rNumericId ?? '—'}
                  </span>
                  <span className="line-clamp-1 break-words">{text}</span>
                </li>
              )
            })}
            {rows.length > PREVIEW_LIMIT ? (
              <li className="pt-1 text-xs italic text-slate-500">
                …and {rows.length - PREVIEW_LIMIT} more
              </li>
            ) : null}
          </ul>

          <div>
            <label
              htmlFor="bulk-delete-confirm-input"
              className="block text-xs font-semibold text-slate-700"
            >
              To confirm, type the number{' '}
              <code className="rounded bg-slate-100 px-1.5 py-0.5 font-mono text-[11px] font-bold text-rose-700">
                {confirmToken}
              </code>{' '}
              below:
            </label>
            <input
              ref={inputRef}
              id="bulk-delete-confirm-input"
              type="text"
              autoComplete="off"
              inputMode="numeric"
              value={typed}
              onChange={(e) => setTyped(e.target.value)}
              disabled={busy}
              placeholder={confirmToken}
              className={`mt-1.5 w-full rounded-lg border bg-white px-3 py-2 font-mono text-sm shadow-sm outline-none transition placeholder:text-slate-400 focus:ring-2 disabled:cursor-not-allowed disabled:opacity-60 ${
                typed.length === 0
                  ? 'border-slate-200 focus:border-rose-400 focus:ring-rose-500/15'
                  : matches
                    ? 'border-emerald-300 bg-emerald-50/50 focus:border-emerald-400 focus:ring-emerald-500/20'
                    : 'border-rose-300 focus:border-rose-400 focus:ring-rose-500/20'
              }`}
              onKeyDown={(e) => {
                if (e.key === 'Enter' && matches && !busy) onConfirm()
              }}
            />
            <p className="mt-1 text-[11px] text-slate-500">
              This action <span className="font-semibold">cannot be undone</span>.
            </p>
          </div>
        </div>
        <div className="flex flex-col-reverse gap-2 border-t border-slate-100 px-5 py-3 sm:flex-row sm:items-center sm:justify-between">
          <button
            type="button"
            onClick={onCancel}
            disabled={busy}
            className="cursor-pointer rounded-lg border border-slate-200 bg-white px-3 py-2 text-xs font-semibold text-slate-700 transition hover:border-slate-300 hover:bg-slate-50 focus:outline-none focus-visible:ring-2 focus-visible:ring-slate-400 disabled:cursor-not-allowed disabled:opacity-50"
          >
            Cancel
          </button>
          <button
            type="button"
            onClick={onConfirm}
            disabled={!matches || busy}
            className="inline-flex cursor-pointer items-center justify-center gap-1.5 rounded-lg bg-gradient-to-b from-rose-600 to-rose-700 px-4 py-2 text-xs font-semibold text-white shadow-md shadow-rose-900/25 transition hover:from-rose-700 hover:to-rose-800 focus:outline-none focus-visible:ring-2 focus-visible:ring-rose-500 focus-visible:ring-offset-2 disabled:cursor-not-allowed disabled:opacity-50"
          >
            {busy ? (
              <>
                <Loader2
                  className="size-3.5 animate-spin"
                  strokeWidth={2}
                  aria-hidden
                />
                Deleting…
              </>
            ) : (
              <>
                <Trash2
                  className="size-3.5 shrink-0"
                  strokeWidth={2.25}
                  aria-hidden
                />
                Delete {rows.length}
              </>
            )}
          </button>
        </div>
      </div>
    </div>
  )
}

/* -------------------------------------------------------------------------- */
/* Shortcuts hint                                                             */
/* -------------------------------------------------------------------------- */

/**
 * Lightweight popup listing the keyboard shortcuts available on this page.
 *
 * @param {{ onClose: () => void }} props
 */
function ShortcutsHint({ onClose }) {
  return (
    <div
      className="fixed inset-0 z-[55] flex items-end justify-center bg-slate-900/40 p-0 backdrop-blur-sm sm:items-center sm:p-4"
      role="presentation"
      onClick={onClose}
    >
      <div
        role="dialog"
        aria-modal="true"
        aria-labelledby="shortcuts-title"
        className="w-full max-w-sm rounded-t-2xl border border-slate-200 bg-white shadow-2xl sm:rounded-2xl"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-center justify-between gap-3 border-b border-slate-100 px-5 py-3">
          <div className="flex items-center gap-2.5">
            <div className="flex size-8 shrink-0 items-center justify-center rounded-lg bg-slate-100 text-slate-700">
              <Keyboard className="size-4" strokeWidth={2.25} aria-hidden />
            </div>
            <h3 id="shortcuts-title" className="text-sm font-semibold">
              Keyboard shortcuts
            </h3>
          </div>
          <button
            type="button"
            onClick={onClose}
            className="cursor-pointer rounded-lg p-1.5 text-slate-500 transition hover:bg-slate-100 hover:text-slate-800 focus:outline-none focus-visible:ring-2 focus-visible:ring-violet-500"
            aria-label="Close"
          >
            <X className="size-4" strokeWidth={2} />
          </button>
        </div>
        <ul className="space-y-1.5 px-5 py-4 text-sm">
          <ShortcutRow keys={['/']} description="Focus search" />
          <ShortcutRow keys={['u']} description="Upload new questions" />
          <ShortcutRow keys={['Home']} description="Scroll to top" />
          <ShortcutRow keys={['End']} description="Scroll to bottom" />
          <ShortcutRow
            keys={['⌘', 'Enter']}
            description="Save (inside an open modal)"
          />
          <ShortcutRow keys={['Esc']} description="Close modal / go back" />
          <ShortcutRow keys={['?']} description="Show this hint" />
        </ul>
      </div>
    </div>
  )
}

/**
 * @param {{ keys: string[], description: string }} props
 */
function ShortcutRow({ keys, description }) {
  return (
    <li className="flex items-center justify-between gap-3">
      <span className="text-slate-700">{description}</span>
      <span className="flex items-center gap-1">
        {keys.map((k, i) => (
          <span key={i} className="flex items-center gap-1">
            {i > 0 ? (
              <span className="text-[10px] text-slate-400">+</span>
            ) : null}
            <kbd className="rounded border border-slate-200 bg-slate-50 px-1.5 py-0.5 font-mono text-[11px] font-semibold text-slate-700 shadow-sm">
              {k}
            </kbd>
          </span>
        ))}
      </span>
    </li>
  )
}

/* -------------------------------------------------------------------------- */
/* Reports dialog (read-only)                                                 */
/* -------------------------------------------------------------------------- */

/** @param {unknown} v */

/**
 * Read-only listing of every user-submitted report on a question. Resolving
 * lives on the dedicated Questions admin page — this is just a quick peek
 * from inside the editor.
/**
 *
 * @param {{ row: Record<string, unknown>, onClose: () => void }} props
 */
function AnswerPreviewModal({ row, onClose }) {
  // Parse the three JSON-string fields safely; missing / malformed → empty.
  /** @param {unknown} raw */
  const parseArr = (raw) => {
    if (raw == null || raw === '') return []
    if (Array.isArray(raw)) return raw
    try {
      const v = JSON.parse(String(raw))
      return Array.isArray(v) ? v : []
    } catch {
      return []
    }
  }
  const statNotes = parseArr(row.stat_notes)
  const exploitNotes = parseArr(row.exploit_notes)
  // "Fold: -4.00, Call: -4.02, All-in: -5.99, 4-bet: -4.26" → [{action,ev}]
  const actionEvBb = useMemo(() => {
    const s = String(row.action_ev_bb ?? '').trim()
    if (s === '') return []
    return s
      .split(',')
      .map((part) => {
        const [a, v] = part.split(':')
        const action = (a || '').trim()
        const ev = Number((v || '').trim())
        return { action, ev: Number.isFinite(ev) ? ev : null }
      })
      .filter((p) => p.action !== '' && p.ev != null)
  }, [row.action_ev_bb])
  const bestEv = actionEvBb.length
    ? Math.max(...actionEvBb.map((p) => p.ev))
    : 0

  const [openRanges, setOpenRanges] = useState(false)
  const [openMath, setOpenMath] = useState(true)
  const [openExploit, setOpenExploit] = useState(false)

  useEffect(() => {
    function onKey(e) {
      if (e.key === 'Escape') onClose()
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [onClose])

  const answerText = String(row.answer_explanation ?? '').trim() || '—'

  return (
    <div
      className="fixed inset-0 z-[70] flex items-center justify-center bg-slate-900/70 px-4 py-6 backdrop-blur-sm"
      onClick={(e) => {
        if (e.target === e.currentTarget) onClose()
      }}
    >
      <div className="relative flex max-h-full w-full max-w-md flex-col overflow-hidden rounded-3xl bg-black text-white shadow-2xl ring-1 ring-white/10">
        <header className="flex shrink-0 items-center justify-between gap-2 px-5 pb-2 pt-5">
          <div className="flex items-center gap-2.5">
            <span className="flex size-7 shrink-0 items-center justify-center rounded-lg bg-emerald-500 text-white">
              <Check className="size-4" strokeWidth={3} aria-hidden />
            </span>
            <h2 className="text-base font-semibold">That's right!</h2>
          </div>
          <button
            type="button"
            onClick={onClose}
            className="cursor-pointer rounded-lg p-1.5 text-white/40 transition hover:bg-white/5 hover:text-white"
            aria-label="Close preview"
          >
            <X className="size-4" strokeWidth={2} aria-hidden />
          </button>
        </header>

        <div className="flex-1 overflow-y-auto px-5 pb-2">
          <p className="whitespace-pre-wrap break-words text-sm leading-relaxed text-white/85">
            {answerText}
          </p>

          <div className="mt-5 space-y-2.5">
            {/* Show player ranges — STATIC for now (just a collapsed
                placeholder; the mobile app will render the ranges JSON
                here eventually). */}
            <PreviewSection
              title="Show player ranges"
              icon={<BarChart3 className="size-4" strokeWidth={2.25} aria-hidden />}
              iconBg="bg-rose-500/15 text-rose-300"
              open={openRanges}
              onToggle={() => setOpenRanges((v) => !v)}
            >
              <p className="text-xs italic text-white/40">
                (Player-range visualization coming soon — the raw{' '}
                <code className="font-mono">ranges</code> JSON is stored on
                this question.)
              </p>
            </PreviewSection>

            {/* Show the math — parses stat_notes + action_ev_bb. */}
            <PreviewSection
              title="Show the math"
              icon={
                <Settings2 className="size-4" strokeWidth={2.25} aria-hidden />
              }
              iconBg="bg-sky-500/15 text-sky-300"
              open={openMath}
              onToggle={() => setOpenMath((v) => !v)}
            >
              {statNotes.length === 0 && actionEvBb.length === 0 ? (
                <p className="text-xs italic text-white/40">
                  No stat_notes or action_ev_bb on this question.
                </p>
              ) : (
                <div className="space-y-3.5">
                  {statNotes.map((s, i) => (
                    <div key={s.key || i} className="space-y-1">
                      <p className="flex flex-wrap items-baseline gap-1.5 text-sm">
                        <span className="font-semibold">{s.label || s.key}</span>
                        {s.value != null && s.value !== '' ? (
                          <span className="text-sky-300">{String(s.value)}</span>
                        ) : null}
                      </p>
                      {s.note ? (
                        <p className="text-xs leading-relaxed text-white/65">
                          {s.note}
                        </p>
                      ) : null}
                    </div>
                  ))}
                  {actionEvBb.length > 0 ? (
                    <div className="space-y-2 border-t border-white/10 pt-3">
                      <p className="text-sm font-semibold">
                        How much each play costs
                      </p>
                      <p className="text-[11px] text-white/55">
                        Compared to the best play. Shorter is better.
                      </p>
                      <div className="space-y-2 pt-1">
                        {actionEvBb.map((p) => {
                          // The "best" action is the one with the highest EV.
                          // Everything else's cost = bestEv − thisEv (≥ 0).
                          const cost = bestEv - p.ev
                          const worstCost = bestEv -
                            Math.min(...actionEvBb.map((x) => x.ev))
                          const widthPct = worstCost > 0
                            ? (cost / worstCost) * 100
                            : 0
                          const isBest = cost === 0
                          return (
                            <div key={p.action} className="space-y-0.5">
                              <p className="text-xs text-white/80">{p.action}</p>
                              <div className="h-1.5 overflow-hidden rounded-full bg-white/10">
                                <div
                                  className={`h-full rounded-full ${
                                    isBest
                                      ? 'bg-white/15'
                                      : widthPct < 30
                                        ? 'bg-sky-500'
                                        : widthPct < 70
                                          ? 'bg-amber-500'
                                          : 'bg-rose-500'
                                  }`}
                                  style={{ width: `${Math.max(2, widthPct)}%` }}
                                />
                              </div>
                            </div>
                          )
                        })}
                      </div>
                    </div>
                  ) : null}
                </div>
              )}
            </PreviewSection>

            {/* Adjusting to your opponent — parses exploit_notes. */}
            <PreviewSection
              title="Adjusting to your opponent"
              icon={
                <UsersRound className="size-4" strokeWidth={2.25} aria-hidden />
              }
              iconBg="bg-amber-500/15 text-amber-300"
              open={openExploit}
              onToggle={() => setOpenExploit((v) => !v)}
            >
              {exploitNotes.length === 0 ? (
                <p className="text-xs italic text-white/40">
                  No exploit_notes on this question.
                </p>
              ) : (
                <>
                  <p className="text-xs leading-relaxed text-white/65">
                    How to change your play based on how your opponent tends
                    to play. These are directional, not exact.
                  </p>
                  <div className="mt-3 space-y-3">
                    {exploitNotes.map((e, i) => (
                      <div key={e.opponent || i} className="space-y-1">
                        <p className="text-sm">
                          <span className="font-semibold">
                            {e.label || e.opponent}
                          </span>
                          {e.headline ? (
                            <>
                              {' '}
                              ·{' '}
                              <span className="text-amber-300">
                                {e.headline}
                              </span>
                            </>
                          ) : null}
                        </p>
                        {e.detail ? (
                          <p className="text-xs leading-relaxed text-white/65">
                            {e.detail}
                          </p>
                        ) : null}
                      </div>
                    ))}
                  </div>
                </>
              )}
            </PreviewSection>
          </div>
        </div>

        {/* Continue — static placeholder, matches the mobile app's footer. */}
        <div className="shrink-0 px-5 pb-5 pt-3">
          <button
            type="button"
            onClick={onClose}
            className="block w-full cursor-pointer rounded-2xl bg-white py-3.5 text-center text-sm font-semibold text-black transition hover:bg-white/95"
          >
            Continue
          </button>
        </div>
      </div>
    </div>
  )
}

/**
 * @param {{
 *   title: string
 *   icon: import('react').ReactNode
 *   iconBg: string
 *   open: boolean
 *   onToggle: () => void
 *   children: import('react').ReactNode
 * }} props
 */
function PreviewSection({ title, icon, iconBg, open, onToggle, children }) {
  return (
    <div className="overflow-hidden rounded-2xl bg-white/[0.04] ring-1 ring-white/10">
      <button
        type="button"
        onClick={onToggle}
        className="flex w-full cursor-pointer items-center justify-between gap-3 px-4 py-3 text-left transition hover:bg-white/5"
        aria-expanded={open}
      >
        <span className="flex items-center gap-2.5">
          <span
            className={`flex size-7 shrink-0 items-center justify-center rounded-lg ${iconBg}`}
          >
            {icon}
          </span>
          <span className="text-sm font-semibold">{title}</span>
        </span>
        <ChevronDown
          className={`size-4 shrink-0 text-white/40 transition ${
            open ? 'rotate-180' : ''
          }`}
          strokeWidth={2}
          aria-hidden
        />
      </button>
      {open ? (
        <div className="border-t border-white/5 px-4 py-3.5">{children}</div>
      ) : null}
    </div>
  )
}


/* -------------------------------------------------------------------------- */
/* Insights overlay                                                           */
/* -------------------------------------------------------------------------- */

/**
 * Count values for a scalar field across all rows.
 *
 * @param {Array<Record<string, unknown>>} rows
 * @param {string} key
 */
function countByScalar(rows, key) {
  /** @type {Map<string, { label: string, count: number }>} */
  const map = new Map()
  let missing = 0
  for (const r of rows) {
    const raw = r[key]
    if (raw == null || raw === '') {
      missing++
      continue
    }
    const label = String(raw).trim()
    if (!label) {
      missing++
      continue
    }
    const lc = label.toLowerCase()
    const existing = map.get(lc)
    if (existing) existing.count++
    else map.set(lc, { label, count: 1 })
  }
  const entries = Array.from(map.entries()).map(([value, { label, count }]) => ({
    value,
    label,
    count,
  }))
  entries.sort((a, b) => b.count - a.count)
  return { entries, missing }
}

/**
 * Count tokens in a comma-separated text field (e.g. `skills`,
 * `concept_tags`). Empty values count as "missing".
 *
 * @param {Array<Record<string, unknown>>} rows
 * @param {string} key
 */
function countByCsvField(rows, key) {
  /** @type {Map<string, { label: string, count: number }>} */
  const map = new Map()
  let missing = 0
  for (const r of rows) {
    const raw = r[key]
    if (raw == null || raw === '') {
      missing++
      continue
    }
    const tokens = String(raw)
      .split(',')
      .map((t) => t.trim())
      .filter(Boolean)
    if (tokens.length === 0) {
      missing++
      continue
    }
    for (const t of tokens) {
      const lc = t.toLowerCase()
      const existing = map.get(lc)
      if (existing) existing.count++
      else map.set(lc, { label: t, count: 1 })
    }
  }
  const entries = Array.from(map.entries()).map(([value, { label, count }]) => ({
    value,
    label,
    count,
  }))
  entries.sort((a, b) => b.count - a.count)
  return { entries, missing }
}

/** Bucket questions into difficulty bands. */
/**
 * Human-readable labels for the filter chips at the top of the Insights
 * overlay. Keys match the `activeFilters` Map's field keys.
 */
const FILTER_FIELD_LABELS = /** @type {const} */ ({
  question_type: 'Type',
  hand_stage: 'Stage',
  hero_position: 'Hero pos',
  preflop_pot_type: 'Pot type',
  stack_depth: 'Stack',
  cash_or_tournament: 'Format',
  live_or_online: 'Live/online',
  table_size: 'Table size',
  archetype: 'Archetype',
  validation_status: 'Validation',
  skills: 'Skill',
  concept_tags: 'Tag',
  difficulty_band: 'Difficulty',
})

const DIFFICULTY_BANDS = /** @type {const} */ ([
  { label: '0–999 (very easy)', min: 0, max: 999 },
  { label: '1000–1299 (easy)', min: 1000, max: 1299 },
  { label: '1300–1499 (medium-low)', min: 1300, max: 1499 },
  { label: '1500–1699 (medium)', min: 1500, max: 1699 },
  { label: '1700–1899 (medium-high)', min: 1700, max: 1899 },
  { label: '1900–2199 (hard)', min: 1900, max: 2199 },
  { label: '2200+ (expert)', min: 2200, max: Infinity },
])
function countByDifficultyBand(rows) {
  const bands = DIFFICULTY_BANDS.map((b) => ({ ...b, count: 0 }))
  let missing = 0
  for (const r of rows) {
    const raw = r.difficulty_rating
    if (raw == null || raw === '') {
      missing++
      continue
    }
    const n = Number(raw)
    if (!Number.isFinite(n)) {
      missing++
      continue
    }
    const band = bands.find((b) => n >= b.min && n <= b.max)
    if (band) band.count++
    else missing++
  }
  return { entries: bands.filter((b) => b.count > 0), missing }
}

/**
 * Full-screen statistics overlay. Aggregates counts across the full row set
 * (NOT the filtered one — Insights is meant to show the whole library) and
 * displays them as horizontal bars in topic panels.
 *
 * @param {{
 *   rows: Array<{ firestoreDocId: string } & Record<string, unknown>>
 *   onClose: () => void
 *   onApplyFilter: (patch: { type?: string, handStage?: string, cashTourney?: string, liveOnline?: string }) => void
 * }} props
 */
function InsightsOverlay({ rows, onClose, onApplyFilter }) {
  // Drill-in: when set, every panel BELOW the "By question type" panel
  // Multi-filter drill-down. Each entry is `field → value`; rows must
  // satisfy ALL active filters (logical AND). Clicking a row in a panel
  // toggles that field/value into this map; clicking the same row again
  // removes it. Compositional: hand_stage=preflop + hero_position=BB +
  // cash_or_tournament=Cash, etc.
  const [activeFilters, setActiveFilters] = useState(
    /** @type {Map<string, string>} */ (new Map()),
  )
  const applyFilter = useCallback((field, value) => {
    setActiveFilters((prev) => {
      const next = new Map(prev)
      const v = String(value ?? '').trim()
      if (v === '') return next
      const lc = v.toLowerCase()
      if (next.get(field)?.toLowerCase() === lc) {
        next.delete(field)
      } else {
        next.set(field, v)
      }
      return next
    })
  }, [])
  const clearAllFilters = useCallback(() => setActiveFilters(new Map()), [])
  const hasFilters = activeFilters.size > 0

  // The typeStats panel (rendered as cards above) keeps showing the full
  // catalog distribution so the user can switch types without leaving the
  // overlay. Every other panel reads from `displayRows`.
  const typeStats = useMemo(() => countByScalar(rows, 'question_type'), [rows])

  // Row-level match helpers. Hero position is derived from the first
  // segment of `user_seat` ("BB-99BB-1BB-FOLD" → "BB"). Skills /
  // concept_tags / question_type / hand_stage use the same `countByScalar` /
  // `countByCsvField` value semantics (trimmed + lowercased).
  function heroPosition(r) {
    const s = String(r.user_seat ?? '').trim()
    if (s === '') return ''
    return s.split('-')[0].trim().toUpperCase()
  }
  function rowMatchesField(r, field, lc) {
    if (field === 'hero_position') {
      return heroPosition(r).toLowerCase() === lc
    }
    if (field === 'skills' || field === 'concept_tags') {
      // CSV-list fields: match if any token in the row equals the filter.
      const raw = String(r[field] ?? '').trim()
      if (raw === '') return false
      return raw
        .split(',')
        .some((tok) => tok.trim().toLowerCase() === lc)
    }
    if (field === 'difficulty_band') {
      const n = Number(r.difficulty_rating)
      if (!Number.isFinite(n)) return false
      const band = DIFFICULTY_BANDS.find(
        (b) => n >= b.min && n <= b.max,
      )
      return !!band && band.label.toLowerCase() === lc
    }
    // Plain scalar — same comparison the upload validator uses.
    return String(r[field] ?? '').trim().toLowerCase() === lc
  }
  const displayRows = useMemo(() => {
    if (activeFilters.size === 0) return rows
    const checks = Array.from(activeFilters.entries()).map(([f, v]) => [
      f,
      String(v).toLowerCase(),
    ])
    return rows.filter((r) => checks.every(([f, lc]) => rowMatchesField(r, f, lc)))
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [rows, activeFilters])
  const total = displayRows.length
  const grandTotal = rows.length

  const reported = useMemo(
    () => displayRows.filter((r) => getReportsArray(r).length > 0).length,
    [displayRows],
  )
  const missingCorrect = useMemo(
    () =>
      displayRows.filter((r) => {
        const opts = getOptionsList(r)
        return opts.length === 0 || correctOptionIndex(r) == null
      }).length,
    [displayRows],
  )
  const translatedEs = useMemo(
    () => displayRows.filter((r) => r.isTranslated_es === true).length,
    [displayRows],
  )

  const stageStats = useMemo(() => countByScalar(displayRows, 'hand_stage'), [displayRows])
  const cashStats = useMemo(
    () => countByScalar(displayRows, 'cash_or_tournament'),
    [displayRows],
  )
  const liveStats = useMemo(
    () => countByScalar(displayRows, 'live_or_online'),
    [displayRows],
  )
  const stackStats = useMemo(() => countByScalar(displayRows, 'stack_depth'), [displayRows])
  const potTypeStats = useMemo(
    () => countByScalar(displayRows, 'preflop_pot_type'),
    [displayRows],
  )
  const tableSizeStats = useMemo(
    () => countByScalar(displayRows, 'table_size'),
    [displayRows],
  )
  const archetypeStats = useMemo(
    () => countByScalar(displayRows, 'archetype'),
    [displayRows],
  )
  const validationStats = useMemo(
    () => countByScalar(displayRows, 'validation_status'),
    [displayRows],
  )
  const skillStats = useMemo(() => countByCsvField(displayRows, 'skills'), [displayRows])
  const tagStats = useMemo(
    () => countByCsvField(displayRows, 'concept_tags'),
    [displayRows],
  )
  const difficultyStats = useMemo(() => countByDifficultyBand(displayRows), [displayRows])
  // Custom: count distinct hero positions via the same shape as countByScalar.
  const heroPositionStats = useMemo(() => {
    /** @type {Map<string, { label: string, count: number }>} */
    const map = new Map()
    let missing = 0
    for (const r of displayRows) {
      const p = heroPosition(r)
      if (!p) { missing++; continue }
      const lc = p.toLowerCase()
      const existing = map.get(lc)
      if (existing) existing.count++
      else map.set(lc, { label: p, count: 1 })
    }
    const entries = Array.from(map.entries()).map(([value, { label, count }]) => ({
      value, label, count,
    }))
    entries.sort((a, b) => b.count - a.count)
    return { entries, missing }
  }, [displayRows])

  useEffect(() => {
    function onKey(e) {
      if (e.key === 'Escape') onClose()
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [onClose])

  return (
    <div className="fixed inset-0 z-[60] flex flex-col bg-slate-50">
      <header className="sticky top-0 z-10 flex flex-wrap items-center justify-between gap-3 border-b border-slate-200 bg-white px-4 py-3 shadow-sm sm:px-6">
        <div className="flex min-w-0 items-center gap-3">
          <div className="flex size-10 shrink-0 items-center justify-center rounded-xl bg-gradient-to-br from-violet-500 to-indigo-600 text-white shadow-md shadow-violet-900/25">
            <BarChart3 className="size-5" strokeWidth={2.25} aria-hidden />
          </div>
          <div>
            <h2 className="text-lg font-semibold text-slate-900">
              Question library insights
            </h2>
            <p className="text-[11px] text-slate-500">
              {hasFilters
                ? `Showing ${total.toLocaleString()} of ${grandTotal.toLocaleString()} questions`
                : `Aggregated across all ${grandTotal.toLocaleString()} questions`}
            </p>
          </div>
        </div>
        <button
          type="button"
          onClick={onClose}
          className="inline-flex cursor-pointer items-center gap-1.5 rounded-xl border border-slate-200 bg-white px-3 py-2 text-sm font-semibold text-slate-700 shadow-sm transition hover:border-slate-300 hover:bg-slate-50 focus:outline-none focus-visible:ring-2 focus-visible:ring-slate-400"
        >
          <X className="size-4" strokeWidth={2} aria-hidden />
          Close
        </button>
      </header>

      <main className="flex-1 overflow-y-auto">
        <div className="mx-auto max-w-7xl px-4 py-6 sm:px-6 lg:px-8 lg:py-8">
          {/* Top-line KPI cards */}
          <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
            <KpiCard
              tone="violet"
              icon={<MessageCircleQuestion className="size-5" strokeWidth={2.25} aria-hidden />}
              label="Total questions"
              value={total}
            />
            <KpiCard
              tone="rose"
              icon={<Flag className="size-5" strokeWidth={2.25} aria-hidden />}
              label="With active reports"
              value={reported}
              pct={total > 0 ? reported / total : 0}
            />
            <KpiCard
              tone="amber"
              icon={<AlertTriangle className="size-5" strokeWidth={2.25} aria-hidden />}
              label="Missing correct answer"
              value={missingCorrect}
              pct={total > 0 ? missingCorrect / total : 0}
            />
            <KpiCard
              tone="emerald"
              icon={<Languages className="size-5" strokeWidth={2.25} aria-hidden />}
              label="Translated to ES"
              value={translatedEs}
              pct={total > 0 ? translatedEs / total : 0}
            />
          </div>

          {/* Active-filter chip bar — every applied filter (from any panel
              or type card) renders as a removable chip here. Empty when no
              filters are active. */}
          {hasFilters ? (
            <div className="mt-4 flex flex-wrap items-center gap-2 rounded-2xl border border-violet-200 bg-violet-50/60 px-3 py-2">
              <span className="text-[11px] font-semibold uppercase tracking-wider text-violet-700">
                Filters
              </span>
              {Array.from(activeFilters.entries()).map(([field, val]) => (
                <button
                  key={field}
                  type="button"
                  onClick={() => applyFilter(field, val)}
                  className="inline-flex cursor-pointer items-center gap-1 rounded-full bg-white px-2.5 py-1 text-xs font-semibold text-violet-800 ring-1 ring-violet-200 transition hover:bg-violet-100 hover:ring-violet-300"
                  title="Click to remove this filter"
                >
                  <span className="font-normal text-violet-500">
                    {FILTER_FIELD_LABELS[field] || field}:
                  </span>
                  <span>{val}</span>
                  <X className="size-3 shrink-0" strokeWidth={2.5} aria-hidden />
                </button>
              ))}
              <button
                type="button"
                onClick={clearAllFilters}
                className="ml-auto inline-flex cursor-pointer items-center gap-1 rounded-lg px-2 py-1 text-xs font-semibold text-slate-500 transition hover:bg-white hover:text-slate-700"
                title="Clear every active filter"
              >
                Clear all
              </button>
            </div>
          ) : null}

          {/* Question-type stat cards — click a card to filter every panel
              below to that type. Click again to clear. The active card has
              a violet ring + soft glow. */}
          <p className="mt-4 px-1 text-[11px] font-semibold uppercase tracking-wider text-slate-500">
            Filter by question type
          </p>
          <div className="mt-1 grid grid-cols-2 gap-3 sm:grid-cols-4">
            {typeStats.entries.map((e) => {
              const value = e.value || e.label
              const active =
                String(activeFilters.get('question_type') ?? '')
                  .toLowerCase() === value.toLowerCase()
              const pct = grandTotal > 0 ? (e.count / grandTotal) * 100 : 0
              return (
                <button
                  key={e.label}
                  type="button"
                  onClick={() => applyFilter('question_type', value)}
                  aria-pressed={active}
                  className={`group cursor-pointer rounded-2xl border p-4 text-left shadow-sm transition focus:outline-none focus-visible:ring-2 focus-visible:ring-violet-400 ${
                    active
                      ? 'border-violet-400 bg-gradient-to-br from-violet-50 to-white ring-2 ring-violet-200 shadow-violet-900/10'
                      : 'border-slate-200 bg-white hover:border-violet-200 hover:bg-violet-50/50'
                  }`}
                >
                  <div className="flex items-center gap-3">
                    <div
                      className={`flex size-10 shrink-0 items-center justify-center rounded-xl transition ${
                        active
                          ? 'bg-violet-600 text-white shadow-md shadow-violet-900/25'
                          : 'bg-slate-100 text-slate-500 group-hover:bg-violet-100 group-hover:text-violet-700'
                      }`}
                    >
                      <MessageCircleQuestion
                        className="size-5"
                        strokeWidth={2.25}
                        aria-hidden
                      />
                    </div>
                    <div className="min-w-0">
                      <p
                        className="truncate text-[11px] font-semibold uppercase tracking-wider text-slate-500"
                        title={e.label}
                      >
                        {e.label}
                      </p>
                      <p className="mt-0.5 truncate text-2xl font-bold tabular-nums text-slate-900">
                        {e.count.toLocaleString()}
                      </p>
                    </div>
                  </div>
                  <div className="mt-2 h-1.5 overflow-hidden rounded-full bg-slate-100">
                    <div
                      className={`h-full rounded-full transition ${
                        active
                          ? 'bg-violet-500'
                          : 'bg-slate-300 group-hover:bg-violet-300'
                      }`}
                      style={{ width: `${pct}%` }}
                    />
                  </div>
                  <p className="mt-1.5 flex items-center justify-between text-[10.5px] text-slate-500">
                    <span>{pct.toFixed(1)}% of all questions</span>
                    {active ? (
                      <span className="font-semibold text-violet-700">
                        Selected
                      </span>
                    ) : null}
                  </p>
                </button>
              )
            })}
          </div>

          <div className="mt-6 grid grid-cols-1 gap-4 lg:grid-cols-2">
            <InsightsPanel
              icon={<Layers className="size-4" strokeWidth={2.25} aria-hidden />}
              title="By hand stage"
              missing={stageStats.missing}
              entries={stageStats.entries}
              total={total}
              activeValue={activeFilters.get('hand_stage')}
              onPick={(label, value) => applyFilter('hand_stage', value || label)}
            />
            <InsightsPanel
              icon={<UsersRound className="size-4" strokeWidth={2.25} aria-hidden />}
              title="By hero position (first segment of user_seat)"
              missing={heroPositionStats.missing}
              entries={heroPositionStats.entries}
              total={total}
              activeValue={activeFilters.get('hero_position')}
              onPick={(label, value) => applyFilter('hero_position', value || label)}
            />
            <InsightsPanel
              icon={<Target className="size-4" strokeWidth={2.25} aria-hidden />}
              title="Preflop pot type / action node"
              missing={potTypeStats.missing}
              entries={potTypeStats.entries}
              total={total}
              activeValue={activeFilters.get('preflop_pot_type')}
              onPick={(label, value) => applyFilter('preflop_pot_type', value || label)}
            />
            <InsightsPanel
              icon={<Layers className="size-4" strokeWidth={2.25} aria-hidden />}
              title="Stack depth"
              missing={stackStats.missing}
              entries={stackStats.entries}
              total={total}
              activeValue={activeFilters.get('stack_depth')}
              onPick={(label, value) => applyFilter('stack_depth', value || label)}
            />
            <InsightsPanel
              icon={<Target className="size-4" strokeWidth={2.25} aria-hidden />}
              title="Cash vs tournament"
              missing={cashStats.missing}
              entries={cashStats.entries}
              total={total}
              activeValue={activeFilters.get('cash_or_tournament')}
              onPick={(label, value) => applyFilter('cash_or_tournament', value || label)}
            />
            <InsightsPanel
              icon={<Layers className="size-4" strokeWidth={2.25} aria-hidden />}
              title="Table size"
              missing={tableSizeStats.missing}
              entries={tableSizeStats.entries}
              total={total}
              activeValue={activeFilters.get('table_size')}
              onPick={(label, value) => applyFilter('table_size', value || label)}
            />
            <InsightsPanel
              icon={<Gauge className="size-4" strokeWidth={2.25} aria-hidden />}
              title="Live vs online"
              missing={liveStats.missing}
              entries={liveStats.entries}
              total={total}
              activeValue={activeFilters.get('live_or_online')}
              onPick={(label, value) => applyFilter('live_or_online', value || label)}
            />
            <InsightsPanel
              icon={<BarChart3 className="size-4" strokeWidth={2.25} aria-hidden />}
              title="Difficulty bands"
              missing={difficultyStats.missing}
              entries={difficultyStats.entries.map((b) => ({
                label: b.label,
                value: b.label,
                count: b.count,
              }))}
              total={total}
              activeValue={activeFilters.get('difficulty_band')}
              onPick={(label, value) => applyFilter('difficulty_band', value || label)}
            />
            <InsightsPanel
              icon={<Sparkles className="size-4" strokeWidth={2.25} aria-hidden />}
              title="Archetype"
              missing={archetypeStats.missing}
              entries={archetypeStats.entries}
              total={total}
              activeValue={activeFilters.get('archetype')}
              onPick={(label, value) => applyFilter('archetype', value || label)}
            />
            <InsightsPanel
              icon={<Check className="size-4" strokeWidth={2.25} aria-hidden />}
              title="Validation status"
              missing={validationStats.missing}
              entries={validationStats.entries}
              total={total}
              activeValue={activeFilters.get('validation_status')}
              onPick={(label, value) => applyFilter('validation_status', value || label)}
            />
            <InsightsPanel
              icon={<Target className="size-4" strokeWidth={2.25} aria-hidden />}
              title="All skills (from `skills` field)"
              missing={skillStats.missing}
              entries={skillStats.entries}
              total={total}
              activeValue={activeFilters.get('skills')}
              onPick={(label, value) => applyFilter('skills', value || label)}
            />
            <InsightsPanel
              icon={<Tags className="size-4" strokeWidth={2.25} aria-hidden />}
              title="All concept tags"
              missing={tagStats.missing}
              entries={tagStats.entries}
              total={total}
              activeValue={activeFilters.get('concept_tags')}
              onPick={(label, value) => applyFilter('concept_tags', value || label)}
            />
          </div>
        </div>
      </main>
    </div>
  )
}

/**
 * Top-of-overlay headline statistic card.
 *
 * @param {{
 *   tone: 'violet' | 'rose' | 'amber' | 'emerald'
 *   icon: import('react').ReactNode
 *   label: string
 *   value: number
 *   pct?: number
 * }} props
 */
function KpiCard({ tone, icon, label, value, pct }) {
  const toneCls = {
    violet:
      'bg-gradient-to-br from-violet-50 to-white text-violet-900 ring-violet-100',
    rose:
      'bg-gradient-to-br from-rose-50 to-white text-rose-900 ring-rose-100',
    amber:
      'bg-gradient-to-br from-amber-50 to-white text-amber-900 ring-amber-100',
    emerald:
      'bg-gradient-to-br from-emerald-50 to-white text-emerald-900 ring-emerald-100',
  }[tone]
  const iconCls = {
    violet: 'bg-violet-100 text-violet-700',
    rose: 'bg-rose-100 text-rose-700',
    amber: 'bg-amber-100 text-amber-700',
    emerald: 'bg-emerald-100 text-emerald-700',
  }[tone]
  return (
    <div
      className={`rounded-2xl border border-slate-200 p-4 shadow-sm ring-1 ${toneCls}`}
    >
      <div className="flex items-center gap-3">
        <div
          className={`flex size-10 shrink-0 items-center justify-center rounded-xl shadow-sm ${iconCls}`}
        >
          {icon}
        </div>
        <div className="min-w-0">
          <p className="text-[11px] font-semibold uppercase tracking-wider text-slate-500">
            {label}
          </p>
          <p className="mt-0.5 text-2xl font-bold tabular-nums">
            {value.toLocaleString()}
          </p>
          {pct != null ? (
            <p className="text-[11px] tabular-nums text-slate-500">
              {(pct * 100).toFixed(1)}% of library
            </p>
          ) : null}
        </div>
      </div>
    </div>
  )
}

/**
 * A panel of horizontal bars showing breakdown counts. When `onPick` is
 * provided, clicking a bar applies that value as a filter and closes the
 * overlay.
 *
 * @param {{
 *   icon: import('react').ReactNode
 *   title: string
 *   missing: number
 *   total: number
 *   entries: Array<{ value?: string, label: string, count: number }>
 *   onPick?: (label: string, value: string | undefined) => void
 * }} props
 */
function InsightsPanel({
  icon,
  title,
  missing,
  total,
  entries,
  onPick,
  activeValue,
}) {
  const max = entries.reduce((m, e) => Math.max(m, e.count), 0) || 1
  const activeLc = activeValue != null
    ? String(activeValue).trim().toLowerCase()
    : null
  return (
    <section className="overflow-hidden rounded-2xl border border-slate-200 bg-white shadow-sm">
      <header className="flex items-center justify-between gap-3 border-b border-slate-100 bg-slate-50/60 px-4 py-2.5">
        <h3 className="flex items-center gap-2 text-sm font-semibold text-slate-800">
          <span className="text-slate-500">{icon}</span>
          {title}
        </h3>
        <span className="text-[11px] text-slate-500">
          {entries.length} value{entries.length === 1 ? '' : 's'}
          {missing > 0 ? ` · ${missing.toLocaleString()} blank` : ''}
        </span>
      </header>
      {entries.length === 0 ? (
        <p className="px-4 py-8 text-center text-xs italic text-slate-400">
          No data
        </p>
      ) : (
        // Cap at ~half the viewport so an unbounded list (e.g. every skill
        // in the catalog) scrolls inside the panel instead of pushing the
        // page layout around. Short lists ignore the cap naturally.
        <ul className="max-h-[50vh] space-y-1.5 overflow-y-auto px-4 py-3">
          {entries.map((e) => {
            const widthPct = (e.count / max) * 100
            const sharePct = total > 0 ? (e.count / total) * 100 : 0
            const Tag = onPick ? 'button' : 'div'
            // Highlight the row whose value matches the currently-applied
            // filter on this field. We compare by both `e.value` (lowercase
            // from countByScalar) and `e.label` (original case) so it works
            // for difficulty bands which only have a label.
            const isActive =
              activeLc != null &&
              (String(e.value ?? '').toLowerCase() === activeLc ||
                String(e.label ?? '').toLowerCase() === activeLc)
            return (
              <li key={e.label}>
                <Tag
                  type={onPick ? 'button' : undefined}
                  onClick={
                    onPick ? () => onPick(e.label, e.value) : undefined
                  }
                  className={`group block w-full text-left ${
                    onPick
                      ? `cursor-pointer rounded-lg p-1 -mx-1 transition focus:outline-none focus-visible:ring-2 focus-visible:ring-violet-400 ${
                          isActive
                            ? 'bg-violet-100 ring-1 ring-violet-300 hover:bg-violet-200'
                            : 'hover:bg-violet-50 focus-visible:bg-violet-50'
                        }`
                      : ''
                  }`}
                  title={
                    onPick
                      ? isActive
                        ? `Click to remove the "${e.label}" filter`
                        : `Filter to "${e.label}"`
                      : undefined
                  }
                >
                  <div className="flex items-baseline justify-between gap-2 text-xs">
                    <span
                      className={`truncate ${
                        isActive
                          ? 'font-semibold text-violet-900'
                          : 'text-slate-700'
                      }`}
                    >
                      {e.label}
                      {isActive ? (
                        <span className="ml-1.5 text-[10px] font-normal text-violet-600">
                          active filter — click to remove
                        </span>
                      ) : null}
                    </span>
                    <span className="shrink-0 tabular-nums text-slate-500">
                      {e.count.toLocaleString()}
                      <span className="ml-1 text-[10px] text-slate-400">
                        ({sharePct.toFixed(1)}%)
                      </span>
                    </span>
                  </div>
                  <div className="mt-0.5 h-1.5 overflow-hidden rounded-full bg-slate-100">
                    <div
                      className={`h-full rounded-full transition ${
                        isActive
                          ? 'bg-violet-600'
                          : `bg-violet-400 ${
                              onPick ? 'group-hover:bg-violet-500' : ''
                            }`
                      }`}
                      style={{ width: `${widthPct}%` }}
                    />
                  </div>
                </Tag>
              </li>
            )
          })}
        </ul>
      )}
    </section>
  )
}

/* -------------------------------------------------------------------------- */
/* Upload-questions modal                                                     */
/* -------------------------------------------------------------------------- */

/**
 * Every uploadable column, in the order they appear in the example CSV.
 * Mirrors `FORM_FIELDS` minus the auto-assigned `id` and any read-only
 * status / timestamp fields.
 */
const CSV_HEADERS = FORM_FIELDS
  .filter((f) => f.key !== 'id')
  .map((f) => f.key)

/** A required field on every uploaded row. */
const CSV_REQUIRED_FIELDS = ['question']

/** Quick lookup of canonical schema keys for header normalization. */
const CSV_KNOWN_KEY_SET = new Set(CSV_HEADERS)

/**
 * Sentinel "field" used internally on each parsed row to carry the value
 * from id-like source columns (No, #, id, qid, etc). NOT part of the
 * Firestore schema — handleSubmit reads it off the row to decide whether
 * a row is an UPDATE of an existing question or a NEW create. Prefixed
 * with `_` so it can never collide with a real schema field.
 */
const CSV_SOURCE_ID_KEY = '_sourceId'

/**
 * Map of *case-insensitive* CSV headers to canonical schema keys. Used for
 * columns whose name can't be derived by lowercase + space→underscore alone
 * (semantic remaps, or upstream-only columns we want to silently drop).
 *
 * Keys must be lowercase + trimmed. Set the value to `null` to *ignore* a
 * column completely (e.g. a row-number from an external source — our ids
 * are auto-assigned).
 */
const CSV_HEADER_ALIASES = /** @type {Record<string, string | null>} */ ({
  // Id-like columns are routed to the internal `_sourceId` sentinel so the
  // upload flow can look up matching existing questions and UPSERT them
  // (update if id already exists; otherwise create new with an auto-assigned
  // id). Note: a brand-new row's auto-id will NOT be set to the source No —
  // we still auto-generate to avoid collisions across re-uploads.
  no: CSV_SOURCE_ID_KEY,
  '#': CSV_SOURCE_ID_KEY,
  id: CSV_SOURCE_ID_KEY,
  qid: CSV_SOURCE_ID_KEY,
  question_id: CSV_SOURCE_ID_KEY,
  'question id': CSV_SOURCE_ID_KEY,

  // Row / index columns are purely positional — drop them.
  row: null,
  index: null,

  // Semantic remaps (the two sides describe the same thing under different
  // names).
  'cards on table': 'flop',
  board: 'flop',
  'board cards': 'flop',
  'cash/tourney': 'cash_or_tournament',
  'cash or tourney': 'cash_or_tournament',
  'cash/tournament': 'cash_or_tournament',
  'pot participant': 'pot_participant_type',

  // Provenance fields — `Source URL` auto-derives to `source_url` via the
  // slug step, but `Made-up hand or real hand ?` (with trailing space + ?)
  // doesn't, so route the common variants here.
  'made-up hand or real hand ?': 'hand_origin',
  'made-up hand or real hand?': 'hand_origin',
  'made-up hand or real hand': 'hand_origin',
  'real or made-up hand': 'hand_origin',
  'real or made up': 'hand_origin',
  'made-up hand': 'hand_origin',
  'made up hand': 'hand_origin',
  'hand origin': 'hand_origin',
})

/** Slug → canonical resolution, computed once at module load. Lets the
 *  normalizer match aliases by *slug* instead of exact lowercased text —
 *  so `"Made-up hand or real hand ?"` matches the alias key
 *  `"made-up hand or real hand ?"` even if whitespace/punctuation differs.
 */
const CSV_ALIAS_SLUG_MAP = Object.fromEntries(
  Object.entries(CSV_HEADER_ALIASES)
    .map(([k, v]) => {
      const slug = k
        .toLowerCase()
        .replace(/[^a-z0-9]+/g, '_')
        .replace(/^_+|_+$/g, '')
      return [slug, v]
    })
    .filter(([slug]) => slug !== ''), // drop pure-symbol aliases like `#`
)

/**
 * Resolve an incoming CSV header to one of our canonical FORM_FIELDS keys.
 *
 * - Returns a schema-key string → use it as the row's key.
 * - Returns `CSV_SOURCE_ID_KEY` (`_sourceId`) → id-like column; the value
 *   becomes the upsert lookup key (UPDATE existing if found, else NEW).
 * - Returns `null` → column is on the ignore-list; drop silently.
 * - Returns `undefined` → unknown column; surface it in the validation panel.
 *
 * @param {string} raw
 * @returns {string | null | undefined}
 */
function normalizeCsvHeader(raw) {
  if (raw == null) return undefined
  const lower = String(raw).trim().toLowerCase()
  if (lower === '') return undefined
  // SheetJS auto-names unlabeled columns `__EMPTY`, `__EMPTY_1`, etc. when
  // the source spreadsheet has data in columns with no header text. These
  // are never real fields — drop them silently so the user isn't pestered
  // with a flood of meaningless "unknown column" warnings.
  if (lower.startsWith('__empty')) return null
  // 1. Direct lowercased alias hit — handles pure-symbol keys (`#`) and
  //    exact matches that survive whitespace differences in the source.
  if (Object.prototype.hasOwnProperty.call(CSV_HEADER_ALIASES, lower)) {
    return CSV_HEADER_ALIASES[lower]
  }
  // 2. Slug-based alias hit — robust against whitespace/punctuation
  //    variants (NBSP, fullwidth `?`, trailing spaces, extra hyphens).
  //    "Made-up hand or real hand ?" → "made_up_hand_or_real_hand"
  //    → matches alias-slug map → "hand_origin".
  const slug = lower.replace(/[^a-z0-9]+/g, '_').replace(/^_+|_+$/g, '')
  if (slug !== '' && Object.prototype.hasOwnProperty.call(CSV_ALIAS_SLUG_MAP, slug)) {
    return CSV_ALIAS_SLUG_MAP[slug]
  }
  // 3. Direct schema-field hit by slug.
  //    "User Seat" → "user_seat", "POT" → "pot", "option 1" → "option_1".
  if (CSV_KNOWN_KEY_SET.has(slug)) return slug
  return undefined
}

/**
 * Re-key a raw row (whose keys are the literal CSV headers) so its keys
 * match our snake_case schema. Unknown columns are dropped from the row
 * but reported via the second return slot so the modal can show them.
 *
 * @param {Record<string, unknown>} raw
 * @returns {{ row: Record<string, unknown>, unknown: string[] }}
 */
function normalizeCsvRow(raw) {
  /** @type {Record<string, unknown>} */
  const row = {}
  /** @type {string[]} */
  const unknown = []
  for (const [k, v] of Object.entries(raw)) {
    const canon = normalizeCsvHeader(k)
    if (canon === null) continue // explicit ignore
    if (canon === undefined) {
      if (String(k).trim() !== '') unknown.push(k)
      continue
    }
    // If two source columns happen to map to the same canonical key, prefer
    // the first non-empty one — protects against legacy CSVs that include
    // both old and new names side-by-side.
    if (row[canon] != null && String(row[canon]).trim() !== '') continue
    row[canon] = v
  }
  return { row, unknown }
}

/**
 * Two sample rows that exercise both a hand-scenario and a hand-selection
 * question shape — gives the user a concrete template to fill in.
 */
const CSV_EXAMPLE_ROWS = [
  {
    user_seat: 'SB-99.5BB-0.5BB',
    user_cards: '9-spades, 8-spades',
    flop: '',
    table_size: '6',
    default_stack: '100BB',
    seats: 'BB-99BB-1BB, UTG-97.5BB-2.5BB-raise',
    pot: '4BB',
    context:
      'Online · 6-Handed, $0.25/$0.50, Stacks 100bb · Rake 4% / 0.3bb cap',
    question:
      "You're in the Small Blind with 9♠️8♠️.\n UTG opens to 2.5bb.",
    question_type: 'Hand Scenario Question',
    hand_stage: 'Preflop',
    option_1: 'Always Fold',
    option_2: 'Mostly Fold',
    option_3: 'Mostly Call',
    option_4: 'Always Call',
    correct_answer: 'Mostly Fold',
    neutral_credit: 'Always Fold',
    answer_explanation:
      "The best play is to fold most of the time with 9♠️8♠️. UTG's range crushes a middling suited connector.",
    cash_or_tournament: 'Cash',
    live_or_online: 'Online',
    relative_position: 'Out of Position',
    preflop_pot_type: 'Single raise pot',
    pot_participant_type: 'Heads-Up',
    stack_depth: 'Standard Stack',
    difficulty_rating: '1710',
    skills: 'Blind Defense, Pot Odds, Out of Position Play',
    action_frequencies: 'Fold: 84%, Call: 16%, 3-bet: 0%',
    ev_gap_bb: '0.27',
    notes: 'Auto-generated by poker-pipeline (preflop path).',
    concept_tags:
      'small_blind, facing_single_raise, mixed_strategy, suited_connector, standard_stack',
    position_matchup: 'SB_vs_UTG',
    ranges: '',
    archetype: 'fold_dominated',
    board_texture: '',
    solver_reference:
      'ryan_preflop_tree_6max_100bb/SB/UTG_60%_HJ_Fold_CO_Fold_BTN_Fold_SB_decision',
    validation_status: 'auto_approved',
    easy_freq: '0.647',
    easy_ev: '0.091',
    easy_concept: '0.95',
    easy_hand: '0.4',
    hand_difficulty: '1650',
    difficulty_bumps: '',
    hand_class: '98s',
    source_url: 'https://example.com/hand-history/abc123',
    hand_origin: 'Real',
    action_ev_bb: 'Fold: -0.50, Call: 0.27, 3-bet: -1.10',
    stat_notes:
      '[{"key":"pot_odds","label":"Pot odds","value":"36%","note":"Your pot odds here are 36%."}]',
    claim_check: '[]',
    exploit_notes:
      '[{"opponent":"station","label":"Station (loose-passive)","headline":"A call becomes reasonable.","detail":"Against a station who calls too wide, this hand gains value."}]',
    chat_context:
      '{"pipeline":"preflop","situation":"You are in the Small Blind with 98s. UTG opens to 2.5bb.","hero_hand":"9-spades, 8-spades","hand_summary":"98s","recommended_action":"Mostly Fold","also_acceptable":[],"full_strategy":[{"action":"Fold","frequency_pct":84,"ev_bb":-0.5},{"action":"Call","frequency_pct":16,"ev_bb":-0.02}]}',
    animation_script: '',
    hand_id: 'hand_00123',
    sequence_index: '0',
  },
  {
    user_seat: '',
    user_cards: '',
    flop: '',
    table_size: '',
    default_stack: '',
    seats: '',
    pot: '',
    context:
      'General concept question — independent of any specific hand state.',
    question: 'How should you modify your opening strategy when there are limpers ahead of you?',
    question_type: 'Strategy concept question',
    hand_stage: 'Preflop',
    option_1: 'Open a tighter range for a larger sizing',
    option_2: 'Open your standard range for a larger sizing',
    option_3: 'Open your standard range for a standard sizing',
    option_4: 'Open a looser range for a larger sizing',
    correct_answer: 'Open a tighter range for a larger sizing',
    neutral_credit: '',
    answer_explanation:
      'For each player that limps into the pot, you should add roughly 1bb to your raise size and tighten your raising range accordingly.',
    cash_or_tournament: 'Not specified',
    live_or_online: 'Not specified',
    relative_position: '',
    preflop_pot_type: '',
    pot_participant_type: '',
    stack_depth: '',
    difficulty_rating: '1500',
    skills: 'Preflop Hand Selection, Bet Sizing',
    action_frequencies: '',
    ev_gap_bb: '',
    notes: '',
    concept_tags: '',
    position_matchup: '',
    ranges: '',
    archetype: '',
    board_texture: '',
    solver_reference: '',
    validation_status: '',
    easy_freq: '',
    easy_ev: '',
    easy_concept: '',
    easy_hand: '',
    hand_difficulty: '',
    difficulty_bumps: '',
    hand_class: '',
    source_url: '',
    hand_origin: 'Made-up',
    action_ev_bb: '',
    stat_notes: '',
    claim_check: '',
    exploit_notes: '',
    chat_context: '',
    animation_script: '',
    hand_id: '',
    sequence_index: '',
  },
]

/**
 * Every CSV column that should be coerced to a Number before write. The set
 * deliberately includes the calibration scores (0–1 floats) — leaving them
 * as strings silently broke downstream comparisons and aggregations.
 */
const NUMERIC_CSV_FIELDS = new Set([
  'difficulty_rating',
  'ev_gap_bb',
  'easy_freq',
  'easy_ev',
  'easy_concept',
  'easy_hand',
  'hand_difficulty',
  'sequence_index',
])

/** Convert a raw CSV row value into the Firestore-friendly shape. */
function csvCellToFirestore(field, raw) {
  if (raw == null) return null
  const s = typeof raw === 'string' ? raw : String(raw)
  const trimmed = s.trim()
  if (trimmed === '') return null
  if (NUMERIC_CSV_FIELDS.has(field)) {
    const n = Number(trimmed)
    return Number.isFinite(n) ? n : trimmed
  }
  return trimmed
}

/**
 * True when the new CSV cell value equals the existing Firestore value for
 * the same field, after normalizing both sides through `csvCellToFirestore`
 * so types match (numeric fields compared as numbers, text trimmed).
 *
 * @param {string} field
 * @param {unknown} csvRaw  Value from the parsed CSV row before coercion.
 * @param {unknown} existing  Value already stored in Firestore.
 */
function csvValueEqualsExisting(field, csvRaw, existing) {
  const a = csvCellToFirestore(field, csvRaw)
  const bEmpty = existing == null || existing === ''
  const aEmpty = a == null
  if (aEmpty && bEmpty) return true
  if (aEmpty || bEmpty) return false
  if (typeof a === 'number') {
    const eNum = typeof existing === 'number' ? existing : Number(existing)
    return Number.isFinite(eNum) && eNum === a
  }
  return String(a).trim() === String(existing).trim()
}

/**
 * Validation issues per row. Returns objects shaped for the modal's error
 * details block. Used by both the validation memo (for counting) and the
 * row-by-row preview render.
 *
 * @param {Record<string, unknown>} row
 */
function csvRowIssues(row) {
  /** @type {string[]} */
  const errors = []

  // Source id (No / id / qid column) is REQUIRED — every row's id comes
  // from the CSV verbatim; we no longer auto-assign. Blank `No` → skip.
  const sid = String(row[CSV_SOURCE_ID_KEY] ?? '').trim()
  if (sid === '') {
    errors.push(
      'missing required `No` (every row must have an id — no auto-assignment)',
    )
  }

  // Required content fields
  for (const f of CSV_REQUIRED_FIELDS) {
    const v = row[f]
    if (v == null || String(v).trim() === '') {
      errors.push(`missing required \`${f}\``)
    }
  }

  // correct_answer (if provided) must match one of the option_1..4 values.
  const answer = String(row.correct_answer ?? '').trim()
  if (answer !== '') {
    const opts = [1, 2, 3, 4]
      .map((n) => String(row[`option_${n}`] ?? '').trim())
      .filter(Boolean)
    if (
      opts.length > 0 &&
      !opts.some((o) => o.toLowerCase() === answer.toLowerCase())
    ) {
      errors.push(
        `correct_answer "${answer}" does not match any of option_1..4`,
      )
    }
  }

  // Options must be contiguous starting at option_1 (no gaps).
  const filled = [1, 2, 3, 4].map(
    (n) => String(row[`option_${n}`] ?? '').trim() !== '',
  )
  for (let i = 1; i < 4; i++) {
    if (filled[i] && !filled[i - 1]) {
      errors.push(
        `option_${i + 1} is filled but option_${i} is empty — options must be contiguous`,
      )
      break
    }
  }

  return errors
}

/** Generate + download an example CSV the user can fill in. */
function downloadExampleCsv() {
  // json_to_sheet uses the keys of the first object as the column order,
  // so include the header sentinel via `header` option.
  const ws = utils.json_to_sheet(CSV_EXAMPLE_ROWS, { header: CSV_HEADERS })
  const wb = utils.book_new()
  utils.book_append_sheet(wb, ws, 'Questions')
  writeFile(wb, 'questions-upload-example.csv', { bookType: 'csv' })
}

/**
 * @param {{
 *   existingNumericIds: Map<string, string>
 *   nextNumericId: number
 *   onClose: () => void
 *   onUpload: (preparedRows: Array<Record<string, unknown>>) => Promise<Array<{ firestoreDocId: string } & Record<string, unknown>>>
 * }} props
 */
function UploadQuestionsModal({
  existingNumericIds,
  existingByNumericId,
  nextNumericId,
  onClose,
  onUpload,
}) {
  /** @type {[File | null, (v: any) => void]} */
  const [file, setFile] = useState(null)
  /** @type {[Array<Record<string, unknown>>, (v: any) => void]} */
  const [rawRows, setRawRows] = useState([])
  // Columns from the source file that don't map to any schema field — kept
  // separate from `rawRows` because rows are already re-keyed by the time
  // they hit state. Surfaced as an "unknown columns will be ignored" warning.
  /** @type {[string[], (v: any) => void]} */
  const [unknownColumns, setUnknownColumns] = useState([])
  // Notices for *recognized* remaps & ignores ("Cards on Table → flop",
  // "No → ignored as upstream id") so the user can see what the normalizer
  // did rather than wondering why a column disappeared.
  /** @type {[Array<{ from: string, to: string | null }>, (v: any) => void]} */
  const [headerNotices, setHeaderNotices] = useState([])
  const [parseError, setParseError] = useState(/** @type {string | null} */ (null))
  const [uploading, setUploading] = useState(false)
  const [progress, setProgress] = useState({ done: 0, total: 0 })
  const [uploadError, setUploadError] = useState(/** @type {string | null} */ (null))
  const [partialSuccess, setPartialSuccess] = useState(
    /** @type {{ created: number, failed: number } | null} */ (null),
  )
  const fileInputRef = useRef(/** @type {HTMLInputElement | null} */ (null))
  // Bumped on every new file pick — discards stale FileReader results that
  // resolve after the user has already moved on (or swapped files mid-read).
  const fileGenerationRef = useRef(0)

  // Validate every uploaded row up-front so the same authoritative pass drives
  // the preview, the count, the disabled state, AND the submit loop. The Set
  // of invalid indices is the single source of truth — no recomputing rules
  // in handleSubmit, no risk of preview disagreeing with what actually
  // uploads. Unknown-column detection lives in handleFile (during parse)
  // because rows arrive here already normalized to canonical keys.
  const validation = useMemo(() => {
    if (rawRows.length === 0) {
      return { rowErrors: [], invalidIndices: new Set() }
    }
    /** @type {Array<{ row: number, message: string }>} */
    const rowErrors = []
    /** @type {Set<number>} */
    const invalidIndices = new Set()
    // Pass 1: per-row validity (required fields, answer/options sanity).
    rawRows.forEach((r, i) => {
      const issues = csvRowIssues(r)
      if (issues.length > 0) {
        invalidIndices.add(i)
        for (const message of issues) {
          rowErrors.push({ row: i + 1, message })
        }
      }
    })
    // Pass 2: intra-CSV duplicate id detection. With auto-assignment gone,
    // two rows sharing the same `No` would map to the same Firestore doc
    // and the second would silently overwrite the first. Flag the second
    // (and any later) occurrences so the user catches the dupe before
    // committing.
    /** @type {Map<string, number>} */
    const seenSid = new Map()
    rawRows.forEach((r, i) => {
      if (invalidIndices.has(i)) return
      const sid = String(r[CSV_SOURCE_ID_KEY] ?? '').trim()
      if (sid === '') return // already invalid via csvRowIssues
      const firstAt = seenSid.get(sid)
      if (firstAt != null) {
        invalidIndices.add(i)
        rowErrors.push({
          row: i + 1,
          message: `duplicate id \`${sid}\` (first appeared on row ${firstAt + 1})`,
        })
      } else {
        seenSid.set(sid, i)
      }
    })
    return { rowErrors, invalidIndices }
  }, [rawRows])

  // Per-row action — indexed 1:1 with `rawRows`. The CSV's `No` column
  // is the SOLE source of truth for the id: existing match → UPDATE in
  // place; otherwise → CREATE at that exact id. No auto-assignment, no
  // random Firestore keys. Rows lacking a `No` or duplicating another
  // row's `No` were already pushed into `invalidIndices` by the
  // validation memo, so this loop is purely a dispatch.
  const rowActions = useMemo(() => {
    /** @type {Array<
     *   | { kind: 'invalid' }
     *   | { kind: 'create', newId: string }
     *   | { kind: 'update', firestoreDocId: string, matchedSourceId: string }
     *   | { kind: 'unchanged', firestoreDocId: string, matchedSourceId: string }
     * >} */
    const out = []
    rawRows.forEach((r, i) => {
      if (validation.invalidIndices.has(i)) {
        out.push({ kind: 'invalid' })
        return
      }
      const sid = String(r[CSV_SOURCE_ID_KEY] ?? '').trim()
      if (existingNumericIds.has(sid)) {
        // Matched an existing doc — diff every column actually present in
        // this CSV row against the existing Firestore values. If nothing
        // differs, classify as UNCHANGED so handleSubmit skips it entirely
        // (no wasted Firestore write, no spurious `updatedAt` bump, no
        // re-translation trigger).
        const existing = existingByNumericId?.get(sid)
        let anyChanged = false
        if (existing == null) {
          // No snapshot available (e.g. doc loaded after rowActions ran) —
          // be conservative and treat as a real UPDATE.
          anyChanged = true
        } else {
          for (const f of CSV_HEADERS) {
            if (!Object.prototype.hasOwnProperty.call(r, f)) continue
            if (!csvValueEqualsExisting(f, r[f], existing[f])) {
              anyChanged = true
              break
            }
          }
        }
        out.push({
          kind: anyChanged ? 'update' : 'unchanged',
          firestoreDocId: existingNumericIds.get(sid),
          matchedSourceId: sid,
        })
        return
      }
      out.push({ kind: 'create', newId: sid })
    })
    return out
  }, [rawRows, validation.invalidIndices, existingNumericIds, existingByNumericId])

  const createCount = useMemo(
    () => rowActions.filter((a) => a.kind === 'create').length,
    [rowActions],
  )
  const updateCount = useMemo(
    () => rowActions.filter((a) => a.kind === 'update').length,
    [rowActions],
  )
  const unchangedCount = useMemo(
    () => rowActions.filter((a) => a.kind === 'unchanged').length,
    [rowActions],
  )
  // `validRowCount` = ops we'll actually emit to Firestore. Unchanged rows
  // are intentionally excluded so the progress bar and submit-button copy
  // reflect the real workload.
  const validRowCount = createCount + updateCount

  // Preview row ordering: NEW first → UPDATE (only the actually-changed
  // ones) → SKIP (invalid) → UNCHANGED last (the boring bulk that won't
  // be written). Without this, the few NEW rows would be buried in
  // hundreds of unchanged ones.
  const previewIndices = useMemo(() => {
    /** @type {number[]} */
    const creates = []
    /** @type {number[]} */
    const updates = []
    /** @type {number[]} */
    const skips = []
    /** @type {number[]} */
    const unchanged = []
    for (let i = 0; i < rawRows.length; i++) {
      const kind = rowActions[i]?.kind
      if (kind === 'create') creates.push(i)
      else if (kind === 'update') updates.push(i)
      else if (kind === 'unchanged') unchanged.push(i)
      else skips.push(i)
    }
    return [...creates, ...updates, ...skips, ...unchanged].slice(0, 20)
  }, [rawRows, rowActions])

  const handleFile = useCallback((picked) => {
    setParseError(null)
    setUploadError(null)
    setPartialSuccess(null)
    setRawRows([])
    setUnknownColumns([])
    setHeaderNotices([])
    setFile(picked)
    // Capture the generation for this pick. If the user picks another file
    // before this read finishes, the stale onload returns without touching
    // state. Prevents the classic "row count flickers between files" race.
    fileGenerationRef.current += 1
    const myGen = fileGenerationRef.current
    const reader = new FileReader()
    reader.onload = (e) => {
      if (myGen !== fileGenerationRef.current) return
      try {
        const result = e.target?.result
        if (result == null) {
          setParseError('Empty file')
          return
        }
        // Workbook reader handles CSV, XLSX, and TSV alike.
        const wb =
          typeof result === 'string'
            ? read(result, { type: 'string' })
            : read(new Uint8Array(result), { type: 'array' })
        const ws = wb.Sheets[wb.SheetNames[0]]
        if (!ws) {
          setParseError('No sheet found in the file')
          return
        }
        const json = /** @type {Array<Record<string, unknown>>} */ (
          utils.sheet_to_json(ws, { defval: '' })
        )
        // Drop trailing fully-empty rows that SheetJS sometimes emits for
        // trailing newlines — they would otherwise show up as "missing
        // required" noise in the preview.
        let end = json.length
        while (end > 0) {
          const row = json[end - 1]
          const hasAnyValue = Object.values(row).some(
            (v) => v != null && String(v).trim() !== '',
          )
          if (hasAnyValue) break
          end--
        }
        const trimmed = end === json.length ? json : json.slice(0, end)

        // Normalize each row's keys to our canonical snake_case schema.
        // Track the *union* of unknown columns across all rows (rather than
        // just row 0) so typos that appear partway through the file aren't
        // missed. Track header *remaps* + ignores once, on row 0, since the
        // mapping is column-uniform.
        /** @type {Array<Record<string, unknown>>} */
        const normalized = new Array(trimmed.length)
        const unknownSet = new Set()
        /** @type {Array<{ from: string, to: string | null }>} */
        const notices = []
        if (trimmed.length > 0) {
          for (const k of Object.keys(trimmed[0])) {
            if (String(k).trim() === '') continue
            const canon = normalizeCsvHeader(k)
            // Skip *unknown* headers — they go to the separate
            // `unknownColumns` panel, not the remap notices.
            if (canon === undefined) continue
            const slug = String(k)
              .trim()
              .toLowerCase()
              .replace(/[^a-z0-9]+/g, '_')
              .replace(/^_+|_+$/g, '')
            // Only note remaps/ignores when the source header didn't already
            // equal the canonical key — avoids spamming "skills → skills".
            if (canon !== slug || canon === null) {
              notices.push({ from: k, to: canon })
            }
          }
        }
        for (let i = 0; i < trimmed.length; i++) {
          const { row, unknown } = normalizeCsvRow(trimmed[i])
          normalized[i] = row
          for (const u of unknown) unknownSet.add(u)
        }

        // setRows-equivalent: large files (>500 rows) noticeably stall the
        // virtualized preview re-render. Defer so the picker UI stays
        // responsive while React reconciles.
        startTransition(() => {
          setRawRows(normalized)
          setUnknownColumns(Array.from(unknownSet))
          setHeaderNotices(notices)
        })
      } catch (err) {
        setParseError(err?.message || 'Failed to parse file')
      }
    }
    reader.onerror = () => {
      if (myGen !== fileGenerationRef.current) return
      setParseError('Failed to read file')
    }
    // CSV → text, anything else → binary.
    if (
      picked.name.toLowerCase().endsWith('.csv') ||
      picked.type === 'text/csv'
    ) {
      reader.readAsText(picked)
    } else {
      reader.readAsArrayBuffer(picked)
    }
  }, [])

  const handleSubmit = useCallback(async () => {
    if (validRowCount === 0 || uploading) return
    setUploading(true)
    setUploadError(null)
    setPartialSuccess(null)
    setProgress({ done: 0, total: validRowCount })
    try {
      /**
       * Tagged-union operation list. Each item is either a CREATE (new doc
       * with auto-assigned id) or an UPDATE (existing doc id known up-front).
       * @type {Array<
       *   | { kind: 'create', payload: Record<string, unknown> }
       *   | { kind: 'update', firestoreDocId: string, patch: Record<string, unknown> }
       * >}
       */
      const ops = []
      const now = serverTimestamp()
      for (let i = 0; i < rawRows.length; i++) {
        const action = rowActions[i]
        // Skip invalid rows AND rows whose content already matches the
        // existing Firestore doc — nothing to write for either kind.
        if (action.kind === 'invalid' || action.kind === 'unchanged') continue
        const raw = rawRows[i]
        // For CREATE we want a complete document, so iterate every schema
        // field (blanks become null). For UPDATE we only patch columns that
        // are actually PRESENT in this CSV — otherwise re-uploading a file
        // with fewer columns would silently null out existing data (e.g.
        // dropping `easy_freq` from the template would wipe it on every
        // matched row).
        const createContent = {}
        for (const f of CSV_HEADERS) {
          createContent[f] = csvCellToFirestore(f, raw[f])
        }
        const updateContent = {}
        for (const f of CSV_HEADERS) {
          if (Object.prototype.hasOwnProperty.call(raw, f)) {
            updateContent[f] = csvCellToFirestore(f, raw[f])
          }
        }
        if (action.kind === 'update') {
          // UPDATE: preserve existing `id` + `createdAt`. Bump `updatedAt`.
          // Only flip `isTranslated_es: false` (trigger retranslation) if
          // at least one TRANSLATABLE_FIELDS value actually changed — saves
          // thousands of needless cloud-function runs when re-uploading a
          // CSV where the diff is in non-translatable columns (skills,
          // difficulty, action_frequencies, etc.).
          const existing = existingByNumericId?.get(
            action.matchedSourceId,
          )
          const needsRetranslate = TRANSLATABLE_FIELDS.some((f) => {
            const a =
              existing?.[f] == null ? '' : String(existing[f]).trim()
            // For fields absent from this CSV, the "new" value equals the
            // old (no change → no retranslation).
            const inCsv = Object.prototype.hasOwnProperty.call(updateContent, f)
            const b = inCsv
              ? updateContent[f] == null
                ? ''
                : String(updateContent[f]).trim()
              : a
            return a !== b
          })
          /** @type {Record<string, unknown>} */
          const patch = { ...updateContent, updatedAt: now }
          if (needsRetranslate) patch.isTranslated_es = false
          ops.push({
            kind: 'update',
            firestoreDocId: action.firestoreDocId,
            patch,
          })
        } else {
          // CREATE: either reuse the source id from the CSV (so a re-upload
          // can find this row next time) or use the auto-assigned one.
          // Coerce to Number when numeric so the stored `id` field type
          // MATCHES the manual-add path (`formToPatch` uses Number for ids
          // that parse cleanly). Without this, queries like
          // `where('id','==', 1000)` miss CSV-uploaded rows where id="1000"
          // is stringly typed.
          const idNum = Number(action.newId)
          const idValue = Number.isFinite(idNum) ? idNum : action.newId
          ops.push({
            kind: 'create',
            payload: {
              id: idValue,
              isTranslated_es: false,
              createdAt: now,
              updatedAt: now,
              ...createContent,
            },
          })
        }
      }
      const result = await onUpload(ops, (p) => setProgress(p))
      const writtenLen = Array.isArray(result)
        ? result.length
        : ((result?.created?.length ?? 0) + (result?.updated?.length ?? 0))
      const failedLen = Array.isArray(result)
        ? 0
        : (result?.failedRowCount ?? 0)
      const err = Array.isArray(result) ? null : (result?.error ?? null)
      setProgress({ done: writtenLen, total: validRowCount })
      if (err) {
        setPartialSuccess(
          writtenLen > 0 ? { created: writtenLen, failed: failedLen } : null,
        )
        setUploadError(err.message || 'Upload failed')
      } else {
        // Brief delay so the user sees "uploaded N" before the modal closes.
        setTimeout(onClose, 300)
      }
    } catch (err) {
      setUploadError(err?.message || 'Upload failed')
    } finally {
      setUploading(false)
    }
  }, [
    rawRows,
    rowActions,
    validRowCount,
    uploading,
    onUpload,
    onClose,
    existingByNumericId,
  ])

  // Esc closes the modal (unless mid-upload).
  useEffect(() => {
    function onKey(e) {
      if (e.key === 'Escape' && !uploading) onClose()
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [onClose, uploading])

  return (
    <div className="fixed inset-0 z-[60] flex flex-col bg-slate-50">
      <header className="sticky top-0 z-10 flex flex-wrap items-center justify-between gap-3 border-b border-slate-200 bg-white px-4 py-3 shadow-sm sm:px-6">
        <div className="flex min-w-0 items-center gap-3">
          <div className="flex size-10 shrink-0 items-center justify-center rounded-xl bg-gradient-to-br from-violet-500 to-fuchsia-600 text-white shadow-md shadow-violet-900/25">
            <Upload className="size-5" strokeWidth={2.25} aria-hidden />
          </div>
          <div>
            <h2 className="text-lg font-semibold text-slate-900">
              Upload questions
            </h2>
            <p className="text-[11px] text-slate-500">
              CSV upsert · `No` column = document id → existing rows are
              updated in place, new rows are created at that id · rows with a
              blank or duplicate `No` are skipped · translation queued
            </p>
          </div>
        </div>
        <div className="flex items-center gap-2">
          <button
            type="button"
            onClick={downloadExampleCsv}
            className="inline-flex cursor-pointer items-center gap-1.5 rounded-xl border border-slate-200 bg-white px-3 py-2 text-sm font-semibold text-slate-700 shadow-sm transition hover:border-violet-300 hover:bg-violet-50 hover:text-violet-700 focus:outline-none focus-visible:ring-2 focus-visible:ring-violet-500"
          >
            <Download className="size-4 shrink-0" strokeWidth={2.25} aria-hidden />
            Download example CSV
          </button>
          <button
            type="button"
            onClick={onClose}
            disabled={uploading}
            className="inline-flex cursor-pointer items-center gap-1.5 rounded-xl border border-slate-200 bg-white px-3 py-2 text-sm font-semibold text-slate-700 shadow-sm transition hover:border-slate-300 hover:bg-slate-50 focus:outline-none focus-visible:ring-2 focus-visible:ring-slate-400 disabled:cursor-not-allowed disabled:opacity-50"
          >
            <X className="size-4" strokeWidth={2} aria-hidden />
            Close
          </button>
        </div>
      </header>

      <main className="flex-1 overflow-y-auto">
        <div className="w-full px-4 py-6 sm:px-6 lg:py-8">
          {/* File picker */}
          <input
            ref={fileInputRef}
            type="file"
            accept=".csv,.xlsx,.xls,.tsv,text/csv"
            className="hidden"
            onChange={(e) => {
              const f = e.target.files?.[0]
              if (f) handleFile(f)
              e.target.value = ''
            }}
          />

          {!file ? (
            <button
              type="button"
              onClick={() => fileInputRef.current?.click()}
              className="flex w-full cursor-pointer flex-col items-center justify-center gap-3 rounded-2xl border-2 border-dashed border-slate-300 bg-white px-6 py-16 text-center transition hover:border-violet-400 hover:bg-violet-50/50 focus:outline-none focus-visible:ring-2 focus-visible:ring-violet-500"
            >
              <div className="flex size-14 items-center justify-center rounded-2xl bg-violet-100 text-violet-700">
                <Upload className="size-7" strokeWidth={2} aria-hidden />
              </div>
              <div>
                <p className="text-sm font-semibold text-slate-800">
                  Click to choose a CSV (or .xlsx / .tsv)
                </p>
                <p className="mt-1 text-xs text-slate-500">
                  Don&apos;t include an <code className="font-mono">id</code> column —
                  ids are generated starting at{' '}
                  <span className="font-semibold">#{nextNumericId}</span>.
                </p>
                <p className="mt-1 text-xs text-slate-500">
                  Required column:{' '}
                  <code className="font-mono text-rose-700">question</code>. All
                  other columns optional.
                </p>
              </div>
            </button>
          ) : (
            <div className="space-y-4">
              <div className="flex flex-wrap items-center justify-between gap-3 rounded-xl border border-slate-200 bg-white p-3">
                <div className="min-w-0">
                  <p className="truncate text-sm font-semibold text-slate-800">
                    {file.name}
                  </p>
                  <p className="text-[11px] text-slate-500">
                    {(file.size / 1024).toFixed(1)} KB ·{' '}
                    {rawRows.length.toLocaleString()} row
                    {rawRows.length === 1 ? '' : 's'} parsed
                  </p>
                </div>
                <button
                  type="button"
                  onClick={() => {
                    setFile(null)
                    setRawRows([])
                    setUnknownColumns([])
                    setHeaderNotices([])
                    setParseError(null)
                    setUploadError(null)
                    setPartialSuccess(null)
                  }}
                  disabled={uploading}
                  className="cursor-pointer rounded-lg border border-slate-200 bg-white px-2.5 py-1.5 text-xs font-semibold text-slate-700 transition hover:border-slate-300 hover:bg-slate-50 disabled:cursor-not-allowed disabled:opacity-50"
                >
                  Choose different file
                </button>
              </div>

              {parseError ? (
                <div
                  role="alert"
                  className="flex gap-3 rounded-xl border border-rose-200 bg-rose-50 px-4 py-3 text-sm text-rose-800"
                >
                  <AlertCircle
                    className="mt-0.5 size-4 shrink-0 text-rose-600"
                    strokeWidth={2}
                    aria-hidden
                  />
                  <span>{parseError}</span>
                </div>
              ) : null}

              {rawRows.length > 0 ? (
                <>
                  <div className="grid grid-cols-2 gap-3 sm:grid-cols-5">
                    <StatChip
                      tone="violet"
                      label="Parsed"
                      value={rawRows.length}
                    />
                    <StatChip
                      tone="emerald"
                      label="Will create"
                      value={createCount}
                    />
                    <StatChip
                      tone="sky"
                      label="Will update"
                      value={updateCount}
                    />
                    <StatChip
                      tone="slate"
                      label="Unchanged (skipped)"
                      value={unchangedCount}
                    />
                    <StatChip
                      tone="amber"
                      label="Invalid (skipped)"
                      value={
                        rawRows.length -
                        createCount -
                        updateCount -
                        unchangedCount
                      }
                    />
                  </div>

                  {headerNotices.length > 0 ? (
                    <details className="rounded-xl border border-sky-200 bg-sky-50/70 px-4 py-3 text-xs text-sky-800">
                      <summary className="cursor-pointer font-semibold">
                        {headerNotices.length} column header
                        {headerNotices.length === 1 ? '' : 's'} were normalized
                        — show mapping
                      </summary>
                      <ul className="mt-2 space-y-0.5 font-mono text-[11px]">
                        {headerNotices.map((n, i) => {
                          const isSourceId = n.to === CSV_SOURCE_ID_KEY
                          const label = isSourceId
                            ? 'match key (upsert)'
                            : (n.to ?? 'ignored')
                          const cls = isSourceId
                            ? 'rounded bg-sky-100/80 px-1.5 py-0.5 text-sky-900'
                            : n.to == null
                              ? 'italic text-slate-500'
                              : 'rounded bg-emerald-100/70 px-1.5 py-0.5'
                          return (
                            <li key={i}>
                              <span className="rounded bg-white/70 px-1.5 py-0.5">
                                {n.from}
                              </span>
                              <span className="px-1.5 text-sky-600">→</span>
                              <span className={cls}>{label}</span>
                            </li>
                          )
                        })}
                      </ul>
                    </details>
                  ) : null}

                  {unknownColumns.length > 0 ? (
                    <div
                      role="alert"
                      className="flex gap-3 rounded-xl border border-amber-200 bg-amber-50 px-4 py-3 text-xs text-amber-800"
                    >
                      <AlertTriangle
                        className="mt-0.5 size-4 shrink-0 text-amber-600"
                        strokeWidth={2}
                        aria-hidden
                      />
                      <span>
                        Unknown column
                        {unknownColumns.length === 1 ? '' : 's'} (will be
                        ignored):{' '}
                        <span className="font-mono">
                          {unknownColumns.join(', ')}
                        </span>
                      </span>
                    </div>
                  ) : null}

                  {validation.rowErrors.length > 0 ? (
                    <details className="rounded-xl border border-amber-200 bg-amber-50/70 px-4 py-3 text-xs text-amber-800">
                      <summary className="cursor-pointer font-semibold">
                        {validation.rowErrors.length} row
                        {validation.rowErrors.length === 1 ? '' : 's'} will be
                        skipped — show details
                      </summary>
                      <ul className="mt-2 space-y-0.5 font-mono text-[11px]">
                        {validation.rowErrors.slice(0, 50).map((e, i) => (
                          <li key={i}>
                            row {e.row}: {e.message}
                          </li>
                        ))}
                        {validation.rowErrors.length > 50 ? (
                          <li>
                            … {validation.rowErrors.length - 50} more
                          </li>
                        ) : null}
                      </ul>
                    </details>
                  ) : null}

                  {/* Preview table — all fields, scrollable horizontally */}
                  <div className="overflow-hidden rounded-xl border border-slate-200 bg-white shadow-sm">
                    <div className="flex items-center justify-between gap-3 border-b border-slate-100 bg-slate-50/70 px-3 py-2">
                      <p className="text-[11px] font-semibold uppercase tracking-wider text-slate-600">
                        Preview · {previewIndices.length} of{' '}
                        {rawRows.length.toLocaleString()} row
                        {rawRows.length === 1 ? '' : 's'}
                        {createCount > 0 || updateCount > 0 ? (
                          <span className="ml-1 font-normal normal-case tracking-normal text-slate-500">
                            (new → updates → skipped → unchanged)
                          </span>
                        ) : null}
                      </p>
                      <div className="flex items-center gap-3">
                        {updateCount > 0 ? (
                          <span className="inline-flex items-center gap-1.5 text-[10.5px] text-slate-500">
                            <span
                              className="size-2.5 shrink-0 rounded-sm border border-amber-300 bg-amber-100/80"
                              aria-hidden
                            />
                            = field will change
                          </span>
                        ) : null}
                        <p className="text-[10.5px] text-slate-500">
                          {CSV_HEADERS.length} columns · scroll →
                        </p>
                      </div>
                    </div>
                    <div
                      className="overflow-auto"
                      style={{ maxHeight: 'min(60vh, 640px)' }}
                    >
                      <table className="border-collapse text-xs">
                        <thead className="sticky top-0 z-20">
                          <tr>
                            <th
                              className="sticky left-0 z-30 border-b border-r border-slate-300 bg-slate-200/95 px-2 py-1.5 text-left font-mono text-[10px] font-bold uppercase tracking-wider text-slate-700 backdrop-blur-sm"
                              style={{ minWidth: 130 }}
                            >
                              status / id
                            </th>
                            {CSV_HEADERS.map((h) => {
                              const required =
                                /** @type {readonly string[]} */ (
                                  CSV_REQUIRED_FIELDS
                                ).includes(h)
                              return (
                                <th
                                  key={h}
                                  className={`border-b border-r border-slate-300 px-2 py-1.5 text-left font-mono text-[10px] font-bold uppercase tracking-wider backdrop-blur-sm ${
                                    required
                                      ? 'bg-rose-100/90 text-rose-900'
                                      : 'bg-slate-100/95 text-slate-700'
                                  }`}
                                  style={{ minWidth: 160 }}
                                  title={
                                    required
                                      ? `${h} (required)`
                                      : `${h} (optional)`
                                  }
                                >
                                  {h}
                                  {required ? (
                                    <span className="ml-1 text-rose-600">
                                      *
                                    </span>
                                  ) : null}
                                </th>
                              )
                            })}
                          </tr>
                        </thead>
                        <tbody>
                          {previewIndices.map((origIdx, displayIdx) => {
                            const r = rawRows[origIdx]
                            const action = rowActions[origIdx]
                            const invalid = action.kind === 'invalid'
                            const isUpdate = action.kind === 'update'
                            const isUnchanged = action.kind === 'unchanged'
                            // Existing doc for this row, so per-cell render
                            // below can diff each field individually — the
                            // same comparison rowActions already used to
                            // decide UPDATE vs UNCHANGED, just surfaced per
                            // column instead of collapsed into one boolean.
                            const existingRow = isUpdate
                              ? existingByNumericId?.get(action.matchedSourceId)
                              : null
                            const rowBg = invalid
                              ? 'bg-rose-50/60'
                              : isUpdate
                                ? 'bg-sky-50/40'
                                : isUnchanged
                                  ? 'bg-slate-50/60 opacity-70'
                                  : displayIdx % 2 === 0
                                    ? 'bg-white'
                                    : 'bg-slate-50/40'
                            const stickyBg = invalid
                              ? 'rgb(255 241 242 / 0.95)'
                              : isUpdate
                                ? 'rgb(240 249 255 / 0.95)'
                                : isUnchanged
                                  ? 'rgb(241 245 249 / 0.95)'
                                  : displayIdx % 2 === 0
                                    ? 'rgb(255 255 255 / 0.95)'
                                    : 'rgb(248 250 252 / 0.95)'
                            return (
                              <tr key={origIdx} className={rowBg}>
                                <td
                                  className="sticky left-0 z-10 border-b border-r border-slate-200 px-2 py-1 align-top text-[11px]"
                                  style={{ backgroundColor: stickyBg }}
                                >
                                  {invalid ? (
                                    <span className="inline-flex items-center rounded-md bg-rose-100 px-1.5 py-0.5 font-mono text-[10px] font-semibold uppercase tracking-wider text-rose-800 ring-1 ring-rose-200">
                                      skip
                                    </span>
                                  ) : isUpdate ? (
                                    <span className="flex flex-col gap-0.5">
                                      <span className="inline-flex w-fit items-center rounded-md bg-sky-100 px-1.5 py-0.5 font-mono text-[10px] font-semibold uppercase tracking-wider text-sky-800 ring-1 ring-sky-200">
                                        update
                                      </span>
                                      <span className="font-mono tabular-nums text-sky-900">
                                        #{action.matchedSourceId}
                                      </span>
                                    </span>
                                  ) : isUnchanged ? (
                                    <span className="flex flex-col gap-0.5">
                                      <span
                                        className="inline-flex w-fit items-center rounded-md bg-slate-200 px-1.5 py-0.5 font-mono text-[10px] font-semibold uppercase tracking-wider text-slate-700 ring-1 ring-slate-300"
                                        title="No fields differ from the existing record — skipped."
                                      >
                                        unchanged
                                      </span>
                                      <span className="font-mono tabular-nums text-slate-500">
                                        #{action.matchedSourceId}
                                      </span>
                                    </span>
                                  ) : (
                                    <span className="flex flex-col gap-0.5">
                                      <span className="inline-flex w-fit items-center rounded-md bg-emerald-100 px-1.5 py-0.5 font-mono text-[10px] font-semibold uppercase tracking-wider text-emerald-800 ring-1 ring-emerald-200">
                                        new
                                      </span>
                                      <span className="font-mono tabular-nums text-emerald-900">
                                        #{action.newId}
                                      </span>
                                    </span>
                                  )}
                                </td>
                                {CSV_HEADERS.map((h) => {
                                  const raw = r[h]
                                  const text =
                                    raw == null || raw === ''
                                      ? ''
                                      : String(raw)
                                  const isMissingRequired =
                                    /** @type {readonly string[]} */ (
                                      CSV_REQUIRED_FIELDS
                                    ).includes(h) && text.trim() === ''
                                  // Only cells that actually differ from the
                                  // existing doc — same comparison and same
                                  // "field present in this CSV" gate as the
                                  // UPDATE/UNCHANGED classification above,
                                  // just evaluated per column.
                                  const isChangedField =
                                    isUpdate &&
                                    existingRow != null &&
                                    Object.prototype.hasOwnProperty.call(r, h) &&
                                    !csvValueEqualsExisting(
                                      h,
                                      raw,
                                      existingRow[h],
                                    )
                                  const existingText = isChangedField
                                    ? existingRow[h] == null ||
                                      existingRow[h] === ''
                                      ? '(empty)'
                                      : String(existingRow[h])
                                    : null
                                  return (
                                    <td
                                      key={h}
                                      className={`border-b px-2 py-1 align-top ${
                                        isChangedField
                                          ? 'border-r border-amber-300 bg-amber-100/80 text-amber-950'
                                          : 'border-r border-slate-100 text-slate-700'
                                      }`}
                                      style={{
                                        minWidth: 160,
                                        maxWidth: 320,
                                      }}
                                      title={
                                        isChangedField
                                          ? `Changing: "${existingText}" → "${text}"`
                                          : text
                                      }
                                    >
                                      {text ? (
                                        <span
                                          className={`line-clamp-2 break-words leading-snug ${
                                            isChangedField
                                              ? 'font-semibold'
                                              : ''
                                          }`}
                                        >
                                          {text}
                                        </span>
                                      ) : isMissingRequired ? (
                                        <span className="italic text-rose-700">
                                          missing
                                        </span>
                                      ) : isChangedField ? (
                                        <span className="italic text-amber-800">
                                          (clearing)
                                        </span>
                                      ) : (
                                        <span className="text-slate-300">
                                          —
                                        </span>
                                      )}
                                    </td>
                                  )
                                })}
                              </tr>
                            )
                          })}
                        </tbody>
                      </table>
                    </div>
                    {rawRows.length > 20 ? (
                      <p className="border-t border-slate-100 bg-slate-50/40 px-3 py-2 text-center text-[10.5px] italic text-slate-500">
                        … {(rawRows.length - 20).toLocaleString()} more row
                        {rawRows.length - 20 === 1 ? '' : 's'} not previewed
                      </p>
                    ) : null}
                  </div>
                </>
              ) : null}

              {uploadError ? (
                <div
                  role="alert"
                  className="flex flex-col gap-2 rounded-xl border border-rose-200 bg-rose-50 px-4 py-3 text-sm text-rose-800"
                >
                  <div className="flex gap-3">
                    <AlertCircle
                      className="mt-0.5 size-4 shrink-0 text-rose-600"
                      strokeWidth={2}
                      aria-hidden
                    />
                    <div className="min-w-0 flex-1">
                      {partialSuccess ? (
                        <p>
                          Uploaded{' '}
                          <strong>{partialSuccess.created.toLocaleString()}</strong>{' '}
                          row{partialSuccess.created === 1 ? '' : 's'},{' '}
                          <strong>{partialSuccess.failed.toLocaleString()}</strong>{' '}
                          failed. The earlier rows are already saved — re-upload
                          only the failed remainder.
                        </p>
                      ) : null}
                      <p className={partialSuccess ? 'mt-1 text-xs' : undefined}>
                        {uploadError}
                      </p>
                    </div>
                  </div>
                </div>
              ) : null}
            </div>
          )}
        </div>
      </main>

      {/* Footer with the upload button */}
      {rawRows.length > 0 ? (
        <footer className="flex flex-col gap-2 border-t border-slate-200 bg-white px-4 py-3 sm:px-6">
          {uploading || (progress.done > 0 && uploadError) ? (
            <div className="h-1.5 w-full overflow-hidden rounded-full bg-slate-100">
              <div
                className={`h-full transition-all duration-200 ${
                  uploadError
                    ? 'bg-rose-500'
                    : 'bg-gradient-to-r from-violet-500 to-fuchsia-500'
                }`}
                style={{
                  width: `${
                    progress.total > 0
                      ? Math.min(
                          100,
                          Math.round((progress.done / progress.total) * 100),
                        )
                      : 0
                  }%`,
                }}
                aria-hidden
              />
            </div>
          ) : null}
          <div className="flex flex-wrap items-center justify-between gap-3">
            <div className="text-[11px] text-slate-500">
              {uploading ? (
                <span>
                  Uploading {progress.done.toLocaleString()} /{' '}
                  {progress.total.toLocaleString()}
                  {progress.total > 0
                    ? ` (${Math.round((progress.done / progress.total) * 100)}%)`
                    : ''}
                  …
                </span>
              ) : uploadError ? (
                <span className="text-rose-700">
                  Upload stopped at {progress.done.toLocaleString()} /{' '}
                  {progress.total.toLocaleString()}.
                </span>
              ) : validRowCount === 0 ? (
                <span>
                  Nothing to upload — every matched row is identical to the
                  existing record
                  {unchangedCount > 0
                    ? ` (${unchangedCount.toLocaleString()} unchanged)`
                    : ''}
                  .
                </span>
              ) : (
                <span>
                  Ready to{' '}
                  {createCount > 0 && updateCount > 0 ? (
                    <>
                      create <strong>{createCount.toLocaleString()}</strong> new
                      · update{' '}
                      <strong>{updateCount.toLocaleString()}</strong> existing
                    </>
                  ) : updateCount > 0 ? (
                    <>
                      update{' '}
                      <strong>{updateCount.toLocaleString()}</strong> existing
                      question{updateCount === 1 ? '' : 's'}
                    </>
                  ) : (
                    <>
                      create <strong>{createCount.toLocaleString()}</strong> new
                      question{createCount === 1 ? '' : 's'}
                    </>
                  )}
                  {unchangedCount > 0
                    ? ` · ${unchangedCount.toLocaleString()} unchanged (skipped)`
                    : ''}
                  .
                </span>
              )}
            </div>
            <button
              type="button"
              onClick={handleSubmit}
              disabled={validRowCount === 0 || uploading}
              className="inline-flex cursor-pointer items-center justify-center gap-1.5 rounded-xl bg-gradient-to-b from-violet-600 to-violet-700 px-5 py-2 text-sm font-semibold text-white shadow-md shadow-violet-900/25 transition hover:from-violet-700 hover:to-violet-800 focus:outline-none focus-visible:ring-2 focus-visible:ring-violet-500 focus-visible:ring-offset-2 disabled:cursor-not-allowed disabled:from-slate-300 disabled:to-slate-400 disabled:shadow-none"
            >
              {uploading ? (
                <>
                  <Loader2
                    className="size-4 animate-spin"
                    strokeWidth={2}
                    aria-hidden
                  />
                  Uploading…
                </>
              ) : uploadError ? (
                <>
                  <Upload
                    className="size-4 shrink-0"
                    strokeWidth={2.5}
                    aria-hidden
                  />
                  Retry upload
                </>
              ) : (
                <>
                  <Upload
                    className="size-4 shrink-0"
                    strokeWidth={2.5}
                    aria-hidden
                  />
                  {createCount > 0 && updateCount > 0
                    ? `Upload (${createCount} new, ${updateCount} updated)`
                    : updateCount > 0
                      ? `Update ${updateCount.toLocaleString()} question${updateCount === 1 ? '' : 's'}`
                      : `Upload ${createCount.toLocaleString()} question${createCount === 1 ? '' : 's'}`}
                </>
              )}
            </button>
          </div>
        </footer>
      ) : null}
    </div>
  )
}

/**
 * @param {{ tone: 'violet' | 'emerald' | 'sky' | 'amber' | 'slate', label: string, value: string | number }} props
 */
function StatChip({ tone, label, value }) {
  const toneCls = {
    violet: 'bg-violet-50 text-violet-900 ring-violet-100',
    emerald: 'bg-emerald-50 text-emerald-900 ring-emerald-100',
    sky: 'bg-sky-50 text-sky-900 ring-sky-100',
    amber: 'bg-amber-50 text-amber-900 ring-amber-100',
    slate: 'bg-slate-100 text-slate-800 ring-slate-200',
  }[tone]
  return (
    <div className={`rounded-xl px-3 py-2 ring-1 ${toneCls}`}>
      <p className="text-[10px] font-semibold uppercase tracking-wider opacity-70">
        {label}
      </p>
      <p className="mt-0.5 text-lg font-bold tabular-nums">
        {typeof value === 'number' ? value.toLocaleString() : value}
      </p>
    </div>
  )
}
