import { useEffect, useMemo, useState } from 'react'
import {
  ArrowRight,
  Check,
  ChevronDown,
  ChevronRight,
  Plus,
  RefreshCw,
  RotateCcw,
  Sparkles,
  X
} from 'lucide-react'
import type { DigestRef, DigestSection } from '@shared/types'
import { ReferenceList } from './ReferenceList'

export interface RefineTarget {
  date: string
  sectionId: string
  itemId?: string
}

interface RefineDrawerProps {
  open: boolean
  target: RefineTarget | null
  section: DigestSection | null
  onClose: () => void
  onApplied: (section: DigestSection) => void
  onReverted?: (section: DigestSection) => void
}

const PRESETS: { label: string; instruction: string }[] = [
  { label: 'Tighter', instruction: 'Cut filler. Same content, fewer words.' },
  { label: 'More concrete', instruction: 'Replace abstractions with specific decisions, files, or trade-offs.' },
  { label: 'Add trade-offs', instruction: 'Surface a trade-off or constraint that drove the decision.' },
  { label: 'Less hype', instruction: 'Drop adjectives and self-praise. Stay neutral and observational.' }
]

const PLACEHOLDERS = [
  'Make this more concrete.',
  'Drop the auth bit, focus on the index rewrite.',
  'Cut to one sentence.',
  'Add the trade-off we landed on.'
]

export function RefineDrawer({
  open,
  target,
  section,
  onClose,
  onApplied,
  onReverted
}: RefineDrawerProps): JSX.Element | null {
  const [userPrompt, setUserPrompt] = useState('')
  const [selectedRefIds, setSelectedRefIds] = useState<Set<string>>(new Set())
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [adding, setAdding] = useState(false)
  const [timeline, setTimeline] = useState<DigestRef[]>([])
  const [timelineQuery, setTimelineQuery] = useState('')
  const [beforeText, setBeforeText] = useState<string | null>(null)
  const [afterText, setAfterText] = useState<string | null>(null)
  const [showDiff, setShowDiff] = useState(false)
  const [refsExpanded, setRefsExpanded] = useState(false)

  const placeholder = useMemo(
    () => PLACEHOLDERS[Math.floor(Math.random() * PLACEHOLDERS.length)],
    [target?.sectionId, target?.itemId]
  )

  const item = target?.itemId
    ? section?.items.find((it) => it.itemId === target.itemId)
    : null

  // For section-level refines, seed with the union of section refs + all child item refs,
  // since the model often attaches refs only to items.
  const targetRefs = useMemo<DigestRef[]>(() => {
    if (!section) return []
    if (item) return item.refs
    const seen = new Set<string>()
    const merged: DigestRef[] = []
    for (const r of section.refs) {
      if (seen.has(r.refId)) continue
      seen.add(r.refId)
      merged.push(r)
    }
    for (const it of section.items) {
      for (const r of it.refs) {
        if (seen.has(r.refId)) continue
        seen.add(r.refId)
        merged.push(r)
      }
    }
    return merged
  }, [section, item])
  const currentText = item ? item.textMd : section?.bodyMd ?? ''

  // Reset state when target changes.
  useEffect(() => {
    if (!open || !target || !section) return
    setUserPrompt('')
    setError(null)
    setBusy(false)
    setAdding(false)
    setTimelineQuery('')
    setSelectedRefIds(new Set(targetRefs.map((r) => r.refId)))
    setBeforeText(null)
    setAfterText(null)
    setShowDiff(false)
    setRefsExpanded(false)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, target?.sectionId, target?.itemId, section?.sectionId])

  if (!open || !target || !section) return null

  const ensureTimeline = async (): Promise<void> => {
    if (timeline.length > 0) return
    try {
      const t = await window.selfer.listDigestTimeline(target.date)
      setTimeline(t)
    } catch (e) {
      setError((e as Error).message)
    }
  }

  const toggleRef = (refId: string): void => {
    setSelectedRefIds((prev) => {
      const next = new Set(prev)
      if (next.has(refId)) next.delete(refId)
      else next.add(refId)
      return next
    })
  }

  const togglePreset = (instruction: string): void => {
    setUserPrompt((prev) => {
      const lines = prev.split('\n')
      const idx = lines.findIndex((l) => l.trim() === instruction)
      if (idx !== -1) {
        lines.splice(idx, 1)
        return lines.join('\n').replace(/^\n+/, '')
      }
      return prev ? `${instruction}\n${prev}` : instruction
    })
  }

  const isPresetActive = (instruction: string): boolean =>
    userPrompt.split('\n').some((l) => l.trim() === instruction)

  const regenerate = async (): Promise<void> => {
    if (!target || busy) return
    setBusy(true)
    setError(null)
    try {
      const before = currentText
      const updated = await window.selfer.refineDigestSection({
        date: target.date,
        sectionId: target.sectionId,
        itemId: target.itemId,
        userPrompt,
        refIds: [...selectedRefIds]
      })
      const newItem = target.itemId
        ? updated.items.find((it) => it.itemId === target.itemId)
        : null
      setBeforeText(before)
      setAfterText(newItem ? newItem.textMd : updated.bodyMd)
      onApplied(updated)
    } catch (e) {
      setError((e as Error).message)
    } finally {
      setBusy(false)
    }
  }

  const revert = async (): Promise<void> => {
    if (!target || busy) return
    setBusy(true)
    setError(null)
    try {
      const updated = await window.selfer.revertDigestRefine(
        target.date,
        target.sectionId,
        target.itemId
      )
      onReverted?.(updated)
      setBeforeText(null)
      setAfterText(null)
    } catch (e) {
      setError((e as Error).message)
    } finally {
      setBusy(false)
    }
  }

  const attachedRefIds = new Set(targetRefs.map((r) => r.refId))
  const additionalSelectedRefs = timeline.filter(
    (r) => selectedRefIds.has(r.refId) && !attachedRefIds.has(r.refId)
  )
  const filteredTimeline = (timelineQuery
    ? timeline.filter((r) =>
        `${r.projectName} ${r.role} ${r.snippet}`.toLowerCase().includes(timelineQuery.toLowerCase())
      )
    : timeline
  ).filter((r) => !attachedRefIds.has(r.refId))

  const titleScope = target.itemId ? 'bullet' : 'section'

  return (
    <div className="fixed inset-y-0 right-0 z-30 flex">
      <button
        aria-label="Close drawer backdrop"
        onClick={onClose}
        className="w-screen -ml-[100vw] bg-black/30 backdrop-blur-[1px] cursor-default"
      />
      <aside
        className="w-[480px] max-w-[90vw] h-full bg-neutral-950 border-l border-neutral-800 shadow-xl flex flex-col"
        onClick={(e) => e.stopPropagation()}
      >
        <header className="h-12 flex items-center justify-between px-4 border-b border-neutral-800 shrink-0">
          <div className="flex items-center gap-2">
            <Sparkles size={14} className="text-sky-400" />
            <h3 className="text-sm font-medium text-neutral-200">
              Refine {titleScope} <span className="text-neutral-500">·</span>{' '}
              <span className="text-neutral-400">{section.heading}</span>
            </h3>
          </div>
          <button
            onClick={onClose}
            className="p-1 text-neutral-500 hover:text-neutral-200 rounded hover:bg-neutral-900"
          >
            <X size={14} />
          </button>
        </header>

        <div className="flex-1 overflow-auto">
          <Block label="Current text">
            <div className="rounded border border-neutral-800/60 bg-neutral-900/40 p-2.5 text-xs text-neutral-300 whitespace-pre-wrap leading-relaxed">
              {currentText.trim() || <em className="text-neutral-500">empty</em>}
            </div>
          </Block>

          <Block
            label={
              <span className="flex items-center justify-between">
                <button
                  onClick={() => setRefsExpanded((v) => !v)}
                  className="inline-flex items-center gap-1 text-neutral-300 hover:text-neutral-100"
                >
                  {refsExpanded ? <ChevronDown size={12} /> : <ChevronRight size={12} />}
                  <span>References</span>
                  <span className="text-neutral-500">({selectedRefIds.size})</span>
                </button>
                <button
                  onClick={async () => {
                    await ensureTimeline()
                    setRefsExpanded(true)
                    setAdding((a) => !a)
                  }}
                  className="text-[11px] inline-flex items-center gap-1 text-sky-400 hover:text-sky-300"
                >
                  <Plus size={11} /> {adding ? 'Hide picker' : 'Add reference'}
                </button>
              </span>
            }
          >
            {refsExpanded ? (
              <>
                <ReferenceList
                  refs={targetRefs}
                  selectable
                  selected={selectedRefIds}
                  onToggle={toggleRef}
                  compact
                  emptyText="No references attached. Add one below."
                />
                {additionalSelectedRefs.length > 0 && (
                  <>
                    <div className="text-[10px] uppercase tracking-wider text-neutral-500 mt-2 mb-1">
                      Added from timeline
                    </div>
                    <ReferenceList
                      refs={additionalSelectedRefs}
                      selectable
                      selected={selectedRefIds}
                      onToggle={toggleRef}
                      compact
                    />
                  </>
                )}

                {adding && (
                  <div className="mt-2 rounded border border-neutral-800/60 bg-neutral-900/30 p-2">
                    <input
                      value={timelineQuery}
                      onChange={(e) => setTimelineQuery(e.target.value)}
                      placeholder="Filter day's timeline…"
                      className="w-full bg-neutral-950 border border-neutral-800 rounded px-2 py-1 text-xs mb-2"
                    />
                    <div className="max-h-48 overflow-auto">
                      <ReferenceList
                        refs={filteredTimeline}
                        selectable
                        selected={selectedRefIds}
                        onToggle={toggleRef}
                        compact
                        emptyText={
                          timeline.length === 0
                            ? 'No timeline available.'
                            : 'No matches.'
                        }
                      />
                    </div>
                  </div>
                )}
              </>
            ) : (
              <button
                onClick={() => setRefsExpanded(true)}
                className="text-[11px] text-neutral-500 hover:text-neutral-300"
              >
                {selectedRefIds.size > 0
                  ? `${selectedRefIds.size} reference${selectedRefIds.size === 1 ? '' : 's'} included · click to review`
                  : 'No references attached · click to add'}
              </button>
            )}
          </Block>

          <Block label="Quick presets">
            <div className="flex flex-wrap gap-1.5">
              {PRESETS.map((p) => {
                const active = isPresetActive(p.instruction)
                return (
                  <button
                    key={p.label}
                    onClick={() => togglePreset(p.instruction)}
                    className={
                      active
                        ? 'text-[11px] px-2 py-0.5 rounded-full border border-sky-700 bg-sky-900/40 text-sky-100'
                        : 'text-[11px] px-2 py-0.5 rounded-full border border-neutral-800 text-neutral-300 hover:bg-neutral-900 hover:border-neutral-700'
                    }
                  >
                    {p.label}
                  </button>
                )
              })}
            </div>
          </Block>

          <Block label="Your instruction">
            <textarea
              value={userPrompt}
              onChange={(e) => setUserPrompt(e.target.value)}
              placeholder={placeholder}
              rows={4}
              className="w-full resize-y bg-neutral-900 border border-neutral-800 rounded px-2 py-1.5 text-xs leading-relaxed focus:outline-none focus:border-neutral-600"
            />
          </Block>

          {error && (
            <div className="mx-4 mb-3 p-2 rounded border border-rose-900 bg-rose-950/40 text-xs text-rose-300 whitespace-pre-wrap">
              {error}
            </div>
          )}

          {beforeText !== null && afterText !== null && (
            <Block
              label={
                <span className="flex items-center justify-between">
                  <span className="flex items-center gap-1">
                    <Check size={12} className="text-emerald-400" /> Refined
                  </span>
                  <button
                    onClick={() => setShowDiff((d) => !d)}
                    className="text-[11px] text-sky-400 hover:text-sky-300"
                  >
                    {showDiff ? 'Hide changes' : 'Show changes'}
                  </button>
                </span>
              }
            >
              {showDiff && (
                <div className="space-y-2">
                  <div>
                    <div className="text-[10px] uppercase tracking-wider text-neutral-500 mb-1">
                      Before
                    </div>
                    <div className="rounded border border-rose-950/60 bg-rose-950/10 p-2 text-xs text-rose-200/80 whitespace-pre-wrap">
                      {beforeText}
                    </div>
                  </div>
                  <div className="flex justify-center text-neutral-600">
                    <ArrowRight size={12} />
                  </div>
                  <div>
                    <div className="text-[10px] uppercase tracking-wider text-neutral-500 mb-1">
                      After
                    </div>
                    <div className="rounded border border-emerald-950/60 bg-emerald-950/10 p-2 text-xs text-emerald-200/90 whitespace-pre-wrap">
                      {afterText}
                    </div>
                  </div>
                </div>
              )}
            </Block>
          )}
        </div>

        <footer className="h-12 flex items-center justify-between gap-2 px-4 border-t border-neutral-800 shrink-0">
          <div>
            {section.refinedAt && section.hasHistory && (
              <button
                onClick={revert}
                disabled={busy}
                className="inline-flex items-center gap-1 text-[11px] px-2 py-1 rounded text-neutral-400 hover:text-neutral-200 disabled:opacity-50"
              >
                <RotateCcw size={11} /> Revert
              </button>
            )}
          </div>
          <div className="flex items-center gap-2">
            <button
              onClick={onClose}
              disabled={busy}
              className="text-xs px-3 py-1 rounded border border-neutral-800 text-neutral-300 hover:bg-neutral-900 disabled:opacity-50"
            >
              Close
            </button>
            <button
              onClick={regenerate}
              disabled={busy}
              className="inline-flex items-center gap-1.5 text-xs px-3 py-1 rounded border border-sky-700 bg-sky-900/40 text-sky-100 hover:bg-sky-900/70 disabled:opacity-50 disabled:cursor-wait"
            >
              {busy ? (
                <>
                  <RefreshCw size={11} className="animate-spin" /> Regenerating
                </>
              ) : (
                <>
                  <Sparkles size={11} /> Regenerate
                </>
              )}
            </button>
          </div>
        </footer>
      </aside>
    </div>
  )
}

function Block({
  label,
  children
}: {
  label: React.ReactNode
  children: React.ReactNode
}): JSX.Element {
  return (
    <section className="px-4 py-3 border-b border-neutral-900/80">
      <div className="text-[11px] font-medium text-neutral-400 mb-1.5">{label}</div>
      {children}
    </section>
  )
}
