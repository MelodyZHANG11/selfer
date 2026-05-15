import { useEffect, useRef, useState } from 'react'
import { RefreshCw, Sparkles } from 'lucide-react'
import type {
  DigestDoc,
  DigestInfo,
  DigestQueueStatus,
  DigestSection
} from '@shared/types'
import { DigestView } from '../components/DigestView'
import { LanguagePicker } from '../components/LanguagePicker'
import { RefineDrawer, type RefineTarget } from '../components/RefineDrawer'

const LANG_STORAGE_KEY = 'selfer.digestLang'
const EMPTY_QUEUE: DigestQueueStatus = { current: null, pending: [] }

export function DigestsPage(): JSX.Element {
  const [digests, setDigests] = useState<DigestInfo[]>([])
  const [today, setToday] = useState('')
  const [date, setDate] = useState('')
  const [queue, setQueue] = useState<DigestQueueStatus>(EMPTY_QUEUE)
  const [error, setError] = useState<string | null>(null)
  const [selected, setSelected] = useState<DigestInfo | null>(null)
  const [doc, setDoc] = useState<DigestDoc | null>(null)
  const [rawBody, setRawBody] = useState<string>('')
  const [rendered, setRendered] = useState(true)
  // Track which date was last requested via the top "Generate" button so we can
  // auto-open it when the queue reports completion (preserving the old UX).
  const generateOpenTargetRef = useRef<string | null>(null)
  // Always-current refs the queue listener can read without re-subscribing.
  const selectedRef = useRef<DigestInfo | null>(null)
  const openRef = useRef<(d: DigestInfo) => Promise<void>>(async () => {})
  const [lang, setLang] = useState<string>(() => {
    try {
      return localStorage.getItem(LANG_STORAGE_KEY) ?? ''
    } catch {
      return ''
    }
  })
  const [translating, setTranslating] = useState(false)
  const [staleLang, setStaleLang] = useState(false)

  const [refineTarget, setRefineTarget] = useState<RefineTarget | null>(null)
  const isTranslated = lang !== '' && lang !== 'source'

  useEffect(() => {
    selectedRef.current = selected
  }, [selected])

  const refresh = async (): Promise<void> => {
    const [list, t] = await Promise.all([
      window.selfer.listDigests(),
      window.selfer.todayLocalDate()
    ])
    setDigests(list)
    setToday(t)
    if (!date) setDate(t)
  }

  useEffect(() => {
    void refresh()
    void window.selfer.getDigestQueueStatus().then(setQueue).catch(() => {})
    const unsub = window.selfer.onDigestQueueChanged((evt) => {
      setQueue({ current: evt.current, pending: evt.pending })
      if (!evt.lastCompleted) return
      const { date: finishedDate, info, error: errMsg } = evt.lastCompleted
      if (errMsg) {
        setError(errMsg)
        if (generateOpenTargetRef.current === finishedDate) {
          generateOpenTargetRef.current = null
        }
        return
      }
      void refresh()
      if (!info) return
      const shouldOpen =
        selectedRef.current?.date === finishedDate ||
        generateOpenTargetRef.current === finishedDate
      if (generateOpenTargetRef.current === finishedDate) {
        generateOpenTargetRef.current = null
      }
      if (shouldOpen) void openRef.current(info)
    })
    return () => {
      unsub()
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  const isQueued = (forDate: string): boolean =>
    queue.current === forDate || queue.pending.includes(forDate)

  const generate = async (): Promise<void> => {
    if (!date) return
    setError(null)
    generateOpenTargetRef.current = date
    try {
      await window.selfer.generateDigest(date)
    } catch (e) {
      setError((e as Error).message)
      generateOpenTargetRef.current = null
    }
  }

  const regenerate = async (forDate: string): Promise<void> => {
    if (isQueued(forDate)) return
    setError(null)
    try {
      await window.selfer.generateDigest(forDate)
    } catch (e) {
      setError((e as Error).message)
    }
  }

  const open = async (d: DigestInfo): Promise<void> => {
    setSelected(d)
    setRefineTarget(null)
    setError(null)
    try {
      // Always load raw markdown from disk (source language).
      const rawPromise = window.selfer.readDigest(d.path)
      let docPromise: Promise<DigestDoc>
      if (isTranslated) {
        setTranslating(true)
        docPromise = window.selfer.getDigestDocLocalized(d.date, lang)
      } else {
        docPromise = window.selfer.getDigestDoc(d.date)
      }
      const [doc, raw] = await Promise.all([docPromise, rawPromise])
      setDoc(doc)
      setRawBody(raw)
      await refreshStaleness(d.date)
    } catch (e) {
      setError((e as Error).message)
    } finally {
      setTranslating(false)
    }
  }
  openRef.current = open

  const refreshStaleness = async (forDate: string): Promise<void> => {
    if (!isTranslated) {
      setStaleLang(false)
      return
    }
    try {
      const list = await window.selfer.listAvailableTranslations(forDate)
      const entry = list.find((t) => t.lang === lang)
      setStaleLang(Boolean(entry?.isStale))
    } catch {
      setStaleLang(false)
    }
  }

  const handleLangChange = async (next: string): Promise<void> => {
    const prev = lang
    setLang(next)
    try {
      localStorage.setItem(LANG_STORAGE_KEY, next)
    } catch {
      /* localStorage unavailable — ignore */
    }
    if (!selected) return
    setError(null)
    setRefineTarget(null)
    if (next === '' || next === 'source') {
      try {
        const fresh = await window.selfer.getDigestDoc(selected.date)
        setDoc(fresh)
        setStaleLang(false)
      } catch (e) {
        setError((e as Error).message)
      }
      return
    }
    setTranslating(true)
    try {
      const fresh = await window.selfer.getDigestDocLocalized(selected.date, next)
      setDoc(fresh)
      setStaleLang(false)
    } catch (e) {
      setError((e as Error).message)
      setLang(prev)
      try {
        localStorage.setItem(LANG_STORAGE_KEY, prev)
      } catch {
        /* ignore */
      }
    } finally {
      setTranslating(false)
    }
  }

  const handleSectionApplied = (updated: DigestSection): void => {
    setDoc((prev) => {
      if (!prev) return prev
      return {
        ...prev,
        sections: prev.sections.map((s) =>
          s.sectionId === updated.sectionId ? updated : s
        )
      }
    })
    // The .md file was rewritten on the backend — refresh raw body in the background.
    if (selected) {
      void window.selfer.readDigest(selected.path).then(setRawBody).catch(() => {})
    }
  }

  const handleRevertSection = async (
    sectionId: string,
    itemId?: string
  ): Promise<void> => {
    if (!selected) return
    try {
      const updated = await window.selfer.revertDigestRefine(
        selected.date,
        sectionId,
        itemId
      )
      handleSectionApplied(updated)
    } catch (e) {
      setError((e as Error).message)
    }
  }

  const activeSection = doc && refineTarget
    ? doc.sections.find((s) => s.sectionId === refineTarget.sectionId) ?? null
    : null

  return (
    <div className="h-full flex">
      <div className="w-80 shrink-0 border-r border-neutral-800 flex flex-col">
        <div className="p-3 border-b border-neutral-800 flex gap-2">
          <input
            type="date"
            value={date}
            onChange={(e) => setDate(e.target.value)}
            className="flex-1 bg-neutral-900 border border-neutral-800 rounded px-2 py-1 text-sm"
          />
          <button
            disabled={!date || isQueued(date)}
            onClick={generate}
            className="inline-flex items-center justify-center gap-1.5 text-xs px-3 py-1 rounded-md border border-neutral-700 hover:bg-neutral-800 disabled:opacity-50 disabled:cursor-wait w-[104px]"
          >
            {date && isQueued(date) ? (
              <>
                <RefreshCw size={12} className={queue.current === date ? 'animate-spin' : ''} />{' '}
                {queue.current === date ? 'Generating' : 'Queued'}
              </>
            ) : (
              <>
                <Sparkles size={12} /> Generate
              </>
            )}
          </button>
        </div>

        {error && (
          <div className="m-3 p-2 rounded border border-rose-900 bg-rose-950/40 text-xs text-rose-300 whitespace-pre-wrap">
            {error}
          </div>
        )}

        <div className="flex-1 overflow-auto text-sm">
          {digests.map((d) => {
            const isActive = queue.current === d.date
            const isPending = queue.pending.includes(d.date)
            const inQueue = isActive || isPending
            return (
              <div
                key={d.date}
                role="button"
                tabIndex={0}
                onClick={() => void open(d)}
                onKeyDown={(e) => {
                  if (e.key === 'Enter' || e.key === ' ') {
                    e.preventDefault()
                    void open(d)
                  }
                }}
                className={`relative group w-full text-left px-3 py-2 border-b border-neutral-900 transition-colors cursor-pointer outline-none focus-visible:bg-neutral-900/60 ${
                  selected?.date === d.date
                    ? 'bg-neutral-900 text-neutral-100'
                    : 'hover:bg-neutral-900/60 text-neutral-300'
                }`}
              >
                <div className="flex items-center justify-between">
                  <span className="font-medium">{d.date}</span>
                  {d.date === today && (
                    <span className="text-[9px] px-1.5 py-0.5 rounded bg-emerald-950/60 text-emerald-300 uppercase tracking-wider">
                      today
                    </span>
                  )}
                </div>
                <div className="text-[10px] text-neutral-500 mt-0.5">
                  regenerated {relativeTime(d.generatedAt)}
                </div>
                <button
                  onClick={(e) => {
                    e.stopPropagation()
                    void regenerate(d.date)
                  }}
                  disabled={inQueue}
                  className={`absolute bottom-1.5 right-1.5 w-6 h-6 inline-flex items-center justify-center rounded border border-neutral-800 bg-neutral-950/80 text-neutral-400 hover:text-neutral-100 hover:border-neutral-600 hover:bg-neutral-800 disabled:cursor-wait transition-opacity ${
                    inQueue
                      ? 'opacity-100'
                      : 'opacity-0 group-hover:opacity-100 focus-visible:opacity-100'
                  }`}
                  title={
                    isActive ? 'Regenerating…' : isPending ? 'Queued' : `Regenerate ${d.date}`
                  }
                  aria-label={`Regenerate digest for ${d.date}`}
                >
                  <RefreshCw
                    size={11}
                    className={`${isActive ? 'animate-spin' : ''} ${isPending ? 'opacity-60' : ''}`}
                  />
                </button>
              </div>
            )
          })}
          {digests.length === 0 && (
            <div className="p-4 text-xs text-neutral-500">
              No digests yet. Auto-runs every 4 hours. Or pick a date above and click Generate.
            </div>
          )}
        </div>
      </div>

      <div className="flex-1 overflow-auto relative">
        {selected ? (
          <>
            <div className="h-10 px-6 border-b border-neutral-800 flex items-center justify-between">
              <span className="text-xs text-neutral-500 font-mono truncate">
                {selected.path}
              </span>
              <div className="flex items-center gap-2">
                <LanguagePicker
                  value={lang}
                  onChange={(l) => void handleLangChange(l)}
                  busy={translating}
                  isStale={staleLang}
                />
                <button
                  onClick={() => setRendered((r) => !r)}
                  className="text-xs px-2 py-0.5 rounded border border-neutral-700 hover:bg-neutral-800"
                >
                  {rendered ? 'Rendered' : 'Raw'}
                </button>
              </div>
            </div>
            <div className="p-6 max-w-3xl text-sm text-neutral-200">
              {rendered ? (
                doc ? (
                  <DigestView
                    doc={doc}
                    onRefineSection={(sectionId) =>
                      setRefineTarget({ date: selected.date, sectionId })
                    }
                    onRefineItem={(sectionId, itemId) =>
                      setRefineTarget({ date: selected.date, sectionId, itemId })
                    }
                    onRevertSection={handleRevertSection}
                    isTranslated={isTranslated}
                  />
                ) : (
                  <div className="text-neutral-500">Loading…</div>
                )
              ) : (
                <pre className="whitespace-pre-wrap font-sans">{rawBody}</pre>
              )}
            </div>
          </>
        ) : (
          <div className="p-6 text-neutral-500 text-sm">Select a digest on the left.</div>
        )}
      </div>

      <RefineDrawer
        open={Boolean(refineTarget)}
        target={refineTarget}
        section={activeSection}
        onClose={() => setRefineTarget(null)}
        onApplied={handleSectionApplied}
        onReverted={handleSectionApplied}
      />
    </div>
  )
}

function relativeTime(iso: string): string {
  const then = new Date(iso).getTime()
  if (Number.isNaN(then)) return iso
  const diff = Date.now() - then
  const m = Math.round(diff / 60_000)
  if (m < 1) return 'just now'
  if (m < 60) return `${m}m ago`
  const h = Math.floor(m / 60)
  if (h < 24) return `${h}h ago`
  const d = Math.floor(h / 24)
  return `${d}d ago`
}
