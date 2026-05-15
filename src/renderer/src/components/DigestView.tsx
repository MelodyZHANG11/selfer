import { useState } from 'react'
import { ChevronDown, ChevronRight, Info, RotateCcw, Sparkles } from 'lucide-react'
import type { DigestDoc, DigestItem, DigestSection } from '@shared/types'
import { Markdown } from './Markdown'
import { ReferenceList } from './ReferenceList'

interface DigestViewProps {
  doc: DigestDoc
  onRefineSection: (sectionId: string) => void
  onRefineItem: (sectionId: string, itemId: string) => void
  onRevertSection?: (sectionId: string, itemId?: string) => void
  isTranslated?: boolean
}

export function DigestView({
  doc,
  onRefineSection,
  onRefineItem,
  onRevertSection,
  isTranslated = false
}: DigestViewProps): JSX.Element {
  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-xl font-bold">Work Diary — {doc.info.date}</h1>
        {isTranslated && (
          <div className="mt-2 text-[11px] text-neutral-500">
            Translation view — switch to Source to refine.
          </div>
        )}
        {!doc.structured && !isTranslated && (
          <div className="mt-2 text-[11px] text-amber-400/80 bg-amber-950/30 border border-amber-900/40 rounded px-2 py-1 inline-block">
            Generated without references. Hover the date in the sidebar and click ↻ to
            regenerate with references.
          </div>
        )}
      </div>

      {doc.sections.map((sec) => (
        <SectionCard
          key={sec.sectionId}
          section={sec}
          onRefineSection={() => onRefineSection(sec.sectionId)}
          onRefineItem={(itemId) => onRefineItem(sec.sectionId, itemId)}
          onRevert={
            onRevertSection ? (itemId) => onRevertSection(sec.sectionId, itemId) : undefined
          }
          readOnly={isTranslated}
        />
      ))}
    </div>
  )
}

function SectionCard({
  section,
  onRefineSection,
  onRefineItem,
  onRevert,
  readOnly = false
}: {
  section: DigestSection
  onRefineSection: () => void
  onRefineItem: (itemId: string) => void
  onRevert?: (itemId?: string) => void
  readOnly?: boolean
}): JSX.Element {
  const [sourcesOpen, setSourcesOpen] = useState(false)
  const totalRefs =
    section.refs.length + section.items.reduce((n, it) => n + it.refs.length, 0)

  return (
    <section className="group/section relative rounded-md border border-neutral-800/70 bg-neutral-950/40 hover:border-neutral-700 transition-colors">
      <header className="flex items-center justify-between px-4 pt-3">
        <div className="flex items-center gap-2">
          <h2 className="text-lg font-semibold text-neutral-200">{section.heading}</h2>
          {section.refinedAt && !readOnly && (
            <span
              className="text-[9px] uppercase tracking-wider px-1.5 py-0.5 rounded bg-sky-950/50 text-sky-300"
              title={`Refined ${section.refinedAt}`}
            >
              refined
            </span>
          )}
        </div>
        {!readOnly && (
          <div className="flex items-center gap-1 opacity-0 group-hover/section:opacity-100 transition-opacity">
            {section.refinedAt && onRevert && (
              <button
                onClick={() => onRevert(undefined)}
                className="inline-flex items-center gap-1 text-[10px] px-1.5 py-1 rounded border border-neutral-800 hover:bg-neutral-900 text-neutral-400"
                title="Revert last refine of this section"
              >
                <RotateCcw size={11} /> Revert
              </button>
            )}
            <button
              onClick={onRefineSection}
              className="inline-flex items-center gap-1 text-[11px] px-2 py-1 rounded border border-neutral-700 hover:bg-neutral-800 text-neutral-200"
            >
              <Sparkles size={12} /> Refine section
            </button>
          </div>
        )}
      </header>

      <div className="px-4 pb-3 pt-1">
        {section.kind === 'paragraph' ? (
          <Markdown source={section.bodyMd} />
        ) : (
          <ItemList
            items={section.items}
            onRefineItem={onRefineItem}
            onRevertItem={onRevert ? (id) => onRevert(id) : undefined}
            readOnly={readOnly}
          />
        )}
        {section.kind === 'mixed' && extractTrailingBody(section) && (
          <div className="mt-2">
            <Markdown source={extractTrailingBody(section)} />
          </div>
        )}
      </div>

      <footer className="px-4 pb-3">
        <button
          onClick={() => setSourcesOpen((o) => !o)}
          className="inline-flex items-center gap-1 text-[10px] text-neutral-500 hover:text-neutral-300"
        >
          {sourcesOpen ? <ChevronDown size={11} /> : <ChevronRight size={11} />}
          <Info size={11} />
          Sources ({totalRefs})
        </button>
        {sourcesOpen && (
          <div className="mt-2">
            {section.refs.length > 0 && (
              <>
                <div className="text-[10px] uppercase tracking-wider text-neutral-500 mb-1">
                  Section references
                </div>
                <ReferenceList refs={section.refs} compact />
              </>
            )}
            {section.items.some((it) => it.refs.length > 0) && (
              <>
                <div className="text-[10px] uppercase tracking-wider text-neutral-500 mt-2 mb-1">
                  Per-item references
                </div>
                {section.items
                  .filter((it) => it.refs.length > 0)
                  .map((it) => (
                    <div key={it.itemId} className="mt-1">
                      <div className="text-[10px] text-neutral-500 mb-0.5 truncate">
                        ↳ {it.textMd.slice(0, 80)}
                      </div>
                      <ReferenceList refs={it.refs} compact />
                    </div>
                  ))}
              </>
            )}
            {totalRefs === 0 && (
              <div className="text-[11px] text-neutral-500">
                No references attached. Use Refine to add some.
              </div>
            )}
          </div>
        )}
      </footer>
    </section>
  )
}

function ItemList({
  items,
  onRefineItem,
  onRevertItem,
  readOnly = false
}: {
  items: DigestItem[]
  onRefineItem: (itemId: string) => void
  onRevertItem?: (itemId: string) => void
  readOnly?: boolean
}): JSX.Element {
  return (
    <ul className="list-disc pl-5 space-y-1.5 text-sm text-neutral-200">
      {items.map((it) => (
        <ItemRow
          key={it.itemId}
          item={it}
          onRefine={() => onRefineItem(it.itemId)}
          onRevert={onRevertItem ? () => onRevertItem(it.itemId) : undefined}
          readOnly={readOnly}
        />
      ))}
    </ul>
  )
}

function ItemRow({
  item,
  onRefine,
  onRevert,
  readOnly = false
}: {
  item: DigestItem
  onRefine: () => void
  onRevert?: () => void
  readOnly?: boolean
}): JSX.Element {
  const [refsOpen, setRefsOpen] = useState(false)
  return (
    <li className="group/item leading-relaxed">
      <div className="flex items-start gap-2">
        <div className="flex-1">
          <span className="whitespace-pre-wrap">{item.textMd}</span>
          {item.refinedAt && !readOnly && (
            <span className="ml-2 text-[9px] uppercase tracking-wider px-1 py-0.5 rounded bg-sky-950/50 text-sky-300 align-middle">
              refined
            </span>
          )}
        </div>
        <div className="flex items-center gap-1 shrink-0 opacity-0 group-hover/item:opacity-100 transition-opacity">
          {item.refs.length > 0 && (
            <button
              onClick={() => setRefsOpen((o) => !o)}
              className="inline-flex items-center gap-0.5 text-[10px] px-1 py-0.5 rounded border border-neutral-800 text-neutral-400 hover:text-neutral-200 hover:bg-neutral-900"
              title={`${item.refs.length} reference${item.refs.length === 1 ? '' : 's'}`}
            >
              <Info size={9} /> {item.refs.length}
            </button>
          )}
          {!readOnly && item.refinedAt && onRevert && (
            <button
              onClick={onRevert}
              className="inline-flex items-center gap-0.5 text-[10px] px-1 py-0.5 rounded border border-neutral-800 text-neutral-400 hover:text-neutral-200 hover:bg-neutral-900"
              title="Revert last refine of this item"
            >
              <RotateCcw size={9} />
            </button>
          )}
          {!readOnly && (
            <button
              onClick={onRefine}
              className="inline-flex items-center gap-0.5 text-[10px] px-1 py-0.5 rounded border border-neutral-800 text-neutral-400 hover:text-neutral-200 hover:bg-neutral-900"
              title="Refine this bullet"
            >
              <Sparkles size={10} />
            </button>
          )}
        </div>
      </div>
      {refsOpen && item.refs.length > 0 && (
        <div className="mt-1 ml-1">
          <ReferenceList refs={item.refs} compact />
        </div>
      )}
    </li>
  )
}

/**
 * For 'mixed' sections, the bodyMd contains bullets + a trailing narrative block.
 * The bullets are already rendered via items; this returns just the trailing narrative.
 */
function extractTrailingBody(section: DigestSection): string {
  if (section.kind !== 'mixed') return ''
  const lines = section.bodyMd.split(/\r?\n/)
  return lines.filter((l) => l.trim() && !/^\s*[-*]\s+/.test(l)).join('\n').trim()
}
