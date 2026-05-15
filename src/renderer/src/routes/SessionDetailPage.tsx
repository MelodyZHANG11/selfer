import { useEffect, useState } from 'react'
import { Link, useNavigate, useParams } from 'react-router-dom'
import type { ContentBlock, SessionDoc, SessionEvent } from '@shared/types'
import { formatDateTime } from '@shared/datetime'
import { Markdown } from '../components/Markdown'

export function SessionDetailPage(): JSX.Element {
  const { id } = useParams<{ id: string }>()
  const navigate = useNavigate()
  const [doc, setDoc] = useState<SessionDoc | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [newTag, setNewTag] = useState('')
  const [nameDraft, setNameDraft] = useState('')
  const [rendered, setRendered] = useState(true)

  const load = async (): Promise<void> => {
    if (!id) return
    setError(null)
    try {
      const d = await window.selfer.getSession(id)
      setDoc(d)
      setNameDraft(d.meta.customName ?? '')
    } catch (e) {
      setError((e as Error).message)
    }
  }

  useEffect(() => {
    void load()
  }, [id])

  if (error) return <div className="p-6 text-red-400">{error}</div>
  if (!doc) return <div className="p-6 text-neutral-500">Loading…</div>

  const isLiveGuess = Date.now() - doc.meta.sourceMtimeMs < 10 * 60 * 1000
  const editableTool = doc.meta.tool === 'claude-code'
  const isEdited = Boolean(doc.meta.editedPath)

  const addTag = async (): Promise<void> => {
    const t = newTag.trim()
    if (!t || !id) return
    await window.selfer.addTag(id, t)
    setNewTag('')
    await load()
  }

  const removeTag = async (tag: string): Promise<void> => {
    if (!id) return
    await window.selfer.removeTag(id, tag)
    await load()
  }

  const saveName = async (): Promise<void> => {
    if (!id) return
    await window.selfer.setCustomName(id, nameDraft.trim() || null)
    await load()
  }

  const revert = async (): Promise<void> => {
    if (!id) return
    await window.selfer.revertEdits(id)
    await load()
  }

  return (
    <div className="h-full flex">
      <div className="flex-1 overflow-auto">
        <div className="h-12 px-4 border-b border-neutral-800 flex items-center gap-3 text-sm">
          <button
            onClick={() => navigate(-1)}
            className="text-neutral-400 hover:text-white"
          >
            ← Back
          </button>
          <span
            className={`text-[10px] px-1.5 py-0.5 rounded border whitespace-nowrap ${
              doc.meta.tool === 'claude-code'
                ? 'bg-amber-950/60 text-amber-300 border-amber-900/60'
                : doc.meta.tool === 'codex'
                  ? 'bg-sky-950/60 text-sky-300 border-sky-900/60'
                  : 'bg-neutral-900 text-neutral-400 border-neutral-800'
            }`}
          >
            {doc.meta.tool === 'claude-code'
              ? 'Claude Code'
              : doc.meta.tool === 'codex'
                ? 'Codex'
                : doc.meta.tool}
          </span>
          <div className="text-neutral-500 truncate">
            {doc.meta.projectName} · {doc.meta.id.replace(/^codex:/, '').slice(0, 8)}
          </div>
          {isEdited && (
            <span className="text-xs px-2 py-0.5 rounded bg-amber-900/50 text-amber-300 border border-amber-800">
              edited
            </span>
          )}
          {isLiveGuess && (
            <span className="text-xs px-2 py-0.5 rounded bg-rose-900/50 text-rose-300 border border-rose-800">
              active — editing disabled
            </span>
          )}
          {!editableTool && (
            <span className="text-xs px-2 py-0.5 rounded bg-neutral-900 text-neutral-400 border border-neutral-800">
              read-only
            </span>
          )}
          <div className="flex-1" />
          <button
            onClick={() => setRendered((r) => !r)}
            className="text-xs px-2 py-0.5 rounded border border-neutral-700 hover:bg-neutral-800"
            title={rendered ? 'Switch to raw text' : 'Switch to rendered markdown'}
          >
            {rendered ? 'Rendered' : 'Raw'}
          </button>
        </div>
        <div className="p-4 space-y-4">
          {doc.events.map((ev) => (
            <EventView
              key={ev.uuid}
              sessionId={doc.meta.id}
              event={ev}
              canEdit={editableTool && !isLiveGuess}
              rendered={rendered}
              onChange={load}
            />
          ))}
        </div>
      </div>
      <aside className="w-72 shrink-0 border-l border-neutral-800 bg-neutral-900/40 p-4 space-y-6 text-sm">
        <section>
          <div className="text-xs uppercase tracking-wide text-neutral-500 mb-1">
            Custom name
          </div>
          <input
            className="w-full bg-neutral-900 border border-neutral-800 rounded px-2 py-1"
            value={nameDraft}
            onChange={(e) => setNameDraft(e.target.value)}
            onBlur={saveName}
            placeholder={doc.meta.autoTitle ?? ''}
          />
        </section>

        <section>
          <div className="text-xs uppercase tracking-wide text-neutral-500 mb-1">Tags</div>
          <div className="flex flex-wrap gap-1 mb-2">
            {doc.meta.tags.map((t) => (
              <button
                key={t}
                onClick={() => removeTag(t)}
                className="px-1.5 py-0.5 rounded bg-neutral-800 text-neutral-200 text-xs hover:bg-rose-900"
                title="Click to remove"
              >
                {t} ×
              </button>
            ))}
          </div>
          <div className="flex gap-1">
            <input
              className="flex-1 bg-neutral-900 border border-neutral-800 rounded px-2 py-1 text-xs"
              value={newTag}
              onChange={(e) => setNewTag(e.target.value)}
              onKeyDown={(e) => e.key === 'Enter' && addTag()}
              placeholder="add tag"
            />
            <button
              onClick={addTag}
              className="text-xs px-2 py-1 rounded border border-neutral-700 hover:bg-neutral-800"
            >
              Add
            </button>
          </div>
        </section>

        <section>
          <div className="text-xs uppercase tracking-wide text-neutral-500 mb-1">Info</div>
          <ul className="text-xs text-neutral-400 space-y-1">
            <li>Messages: {doc.meta.messageCount}</li>
            <li>Started: {doc.meta.startedAt ?? '—'}</li>
            <li>Ended: {doc.meta.endedAt ?? '—'}</li>
            <li>
              Source: <code className="text-[10px]">{doc.meta.sourcePath}</code>
            </li>
            {isEdited && (
              <li>
                Edited: <code className="text-[10px]">{doc.meta.editedPath}</code>
              </li>
            )}
          </ul>
          {isEdited && (
            <button
              onClick={revert}
              className="mt-2 text-xs px-2 py-1 rounded border border-rose-800 text-rose-300 hover:bg-rose-950"
            >
              Revert edits
            </button>
          )}
        </section>
      </aside>
    </div>
  )
}

function EventView({
  sessionId,
  event,
  canEdit,
  rendered,
  onChange
}: {
  sessionId: string
  event: SessionEvent
  canEdit: boolean
  rendered: boolean
  onChange: () => void
}): JSX.Element | null {
  const [editing, setEditing] = useState(false)
  const [draft, setDraft] = useState('')

  if (event.kind === 'user' || event.kind === 'assistant') {
    const firstText = event.content.find((b) => b.type === 'text') as
      | Extract<ContentBlock, { type: 'text' }>
      | undefined
    const roleLabel = event.kind === 'user' ? 'USER' : 'ASSISTANT'
    const roleClass = event.kind === 'user' ? 'text-sky-300' : 'text-emerald-300'

    const startEdit = (): void => {
      setDraft(firstText?.text ?? '')
      setEditing(true)
    }
    const save = async (): Promise<void> => {
      await window.selfer.editMessage(sessionId, event.uuid, draft)
      setEditing(false)
      onChange()
    }
    const del = async (): Promise<void> => {
      if (!confirm('Delete this message from the edited copy?')) return
      await window.selfer.deleteMessage(sessionId, event.uuid)
      onChange()
    }

    return (
      <div className="rounded border border-neutral-800 bg-neutral-900/40">
        <div className="flex items-center justify-between px-3 py-1 border-b border-neutral-800 text-xs">
          <span className={`font-mono ${roleClass}`}>{roleLabel}</span>
          <div className="flex items-center gap-2 text-neutral-500">
            <span>{formatDateTime(event.timestamp)}</span>
            {canEdit && !editing && (
              <>
                <button
                  onClick={startEdit}
                  className="hover:text-neutral-200"
                  title="Edit text"
                >
                  edit
                </button>
                <button
                  onClick={del}
                  className="hover:text-rose-300"
                  title="Delete message"
                >
                  delete
                </button>
              </>
            )}
          </div>
        </div>
        <div className="p-3 space-y-3">
          {editing ? (
            <div>
              <textarea
                className="w-full h-40 bg-neutral-950 border border-neutral-800 rounded p-2 font-mono text-xs"
                value={draft}
                onChange={(e) => setDraft(e.target.value)}
              />
              <div className="mt-2 flex gap-2">
                <button
                  onClick={save}
                  className="text-xs px-2 py-1 rounded border border-emerald-800 text-emerald-300 hover:bg-emerald-950"
                >
                  Save
                </button>
                <button
                  onClick={() => setEditing(false)}
                  className="text-xs px-2 py-1 rounded border border-neutral-700 hover:bg-neutral-800"
                >
                  Cancel
                </button>
              </div>
            </div>
          ) : (
            event.content.map((b, i) => <BlockView key={i} block={b} rendered={rendered} />)
          )}
        </div>
      </div>
    )
  }

  if (event.kind === 'system') {
    const txt = event.content
      .map((b) => (b.type === 'text' ? b.text : ''))
      .join('')
      .trim()
    if (!txt) return null
    return (
      <details className="rounded border border-neutral-800/60 bg-neutral-900/20 text-xs">
        <summary className="px-3 py-1 text-neutral-500 cursor-pointer">system</summary>
        <pre className="px-3 py-2 whitespace-pre-wrap text-neutral-400">{txt}</pre>
      </details>
    )
  }

  return null
}

function BlockView({
  block,
  rendered
}: {
  block: ContentBlock
  rendered: boolean
}): JSX.Element | null {
  if (block.type === 'text') {
    if (rendered) {
      return (
        <div className="text-sm text-neutral-100">
          <Markdown source={block.text} />
        </div>
      )
    }
    return <div className="whitespace-pre-wrap text-sm text-neutral-100">{block.text}</div>
  }
  if (block.type === 'thinking') {
    return (
      <details className="text-xs">
        <summary className="text-neutral-500 cursor-pointer">thinking</summary>
        <pre className="mt-1 p-2 rounded bg-neutral-950/80 border border-neutral-800 whitespace-pre-wrap text-neutral-400">
          {block.thinking}
        </pre>
      </details>
    )
  }
  if (block.type === 'tool_use') {
    return (
      <details className="text-xs">
        <summary className="text-amber-400 cursor-pointer">
          tool_use · {block.name}
        </summary>
        <pre className="mt-1 p-2 rounded bg-neutral-950/80 border border-neutral-800 whitespace-pre-wrap text-neutral-400">
          {safeJson(block.input)}
        </pre>
      </details>
    )
  }
  if (block.type === 'tool_result') {
    return (
      <details className="text-xs">
        <summary
          className={`cursor-pointer ${block.is_error ? 'text-rose-400' : 'text-indigo-400'}`}
        >
          tool_result{block.is_error ? ' (error)' : ''}
        </summary>
        <pre className="mt-1 p-2 rounded bg-neutral-950/80 border border-neutral-800 whitespace-pre-wrap text-neutral-400">
          {typeof block.content === 'string' ? block.content : safeJson(block.content)}
        </pre>
      </details>
    )
  }
  return (
    <details className="text-xs">
      <summary className="text-neutral-500 cursor-pointer">unknown block</summary>
      <pre className="mt-1 p-2 rounded bg-neutral-950/80 border border-neutral-800 whitespace-pre-wrap text-neutral-500">
        {safeJson(block.raw)}
      </pre>
    </details>
  )
}

function safeJson(v: unknown): string {
  try {
    return JSON.stringify(v, null, 2)
  } catch {
    return String(v)
  }
}
