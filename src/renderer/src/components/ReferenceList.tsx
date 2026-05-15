import { useState } from 'react'
import { ChevronDown, ChevronRight, MessageSquare, Sparkles } from 'lucide-react'
import type { DigestRef } from '@shared/types'
import { formatHM } from '@shared/datetime'

interface ReferenceListProps {
  refs: DigestRef[]
  /** When provided, renders a checkbox per row and reports toggles. */
  selectable?: boolean
  selected?: Set<string>
  onToggle?: (refId: string) => void
  /** Compact = denser, used inside the drawer. */
  compact?: boolean
  /** Optional empty-state copy. */
  emptyText?: string
}

export function ReferenceList({
  refs,
  selectable,
  selected,
  onToggle,
  compact,
  emptyText
}: ReferenceListProps): JSX.Element {
  if (refs.length === 0) {
    return (
      <div className="text-xs text-neutral-500 px-2 py-1">
        {emptyText ?? 'No references.'}
      </div>
    )
  }
  return (
    <ul className={`space-y-1 ${compact ? '' : 'mt-1'}`}>
      {refs.map((r) => (
        <ReferenceRow
          key={r.refId}
          r={r}
          selectable={selectable}
          checked={selected?.has(r.refId) ?? false}
          onToggle={onToggle}
          compact={compact}
        />
      ))}
    </ul>
  )
}

function ReferenceRow({
  r,
  selectable,
  checked,
  onToggle,
  compact
}: {
  r: DigestRef
  selectable?: boolean
  checked: boolean
  onToggle?: (refId: string) => void
  compact?: boolean
}): JSX.Element {
  const [expanded, setExpanded] = useState(false)
  const time = formatHM(r.timestamp)

  return (
    <li
      className={`group rounded border border-neutral-800/70 bg-neutral-900/40 hover:border-neutral-700 transition-colors ${
        compact ? 'px-2 py-1.5' : 'px-2.5 py-2'
      }`}
    >
      <div className="flex items-start gap-2">
        {selectable && (
          <input
            type="checkbox"
            checked={checked}
            onChange={() => onToggle?.(r.refId)}
            className="mt-[3px] accent-sky-500"
          />
        )}
        <button
          onClick={() => setExpanded((e) => !e)}
          className="flex-1 text-left"
          title={expanded ? 'Collapse' : 'Expand'}
        >
          <div className="flex items-center gap-1.5 text-[10px] text-neutral-500">
            <span className="font-mono">{r.refId}</span>
            <span>·</span>
            <span className="font-mono">{time}</span>
            <span>·</span>
            <RoleBadge role={r.role} />
            <span className="truncate">{r.projectName}</span>
            <span className="ml-auto text-neutral-600 opacity-0 group-hover:opacity-100">
              {expanded ? <ChevronDown size={11} /> : <ChevronRight size={11} />}
            </span>
          </div>
          <div
            className={`text-xs text-neutral-300 leading-snug whitespace-pre-wrap ${
              expanded ? '' : 'line-clamp-2'
            }`}
          >
            {r.snippet}
          </div>
        </button>
      </div>
    </li>
  )
}

function RoleBadge({ role }: { role: 'USER' | 'ASSISTANT' }): JSX.Element {
  if (role === 'USER') {
    return (
      <span className="inline-flex items-center gap-0.5 px-1 rounded bg-sky-950/50 text-sky-300">
        <MessageSquare size={9} /> user
      </span>
    )
  }
  return (
    <span className="inline-flex items-center gap-0.5 px-1 rounded bg-violet-950/50 text-violet-300">
      <Sparkles size={9} /> asst
    </span>
  )
}

