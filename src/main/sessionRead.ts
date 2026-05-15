import type { DB } from './db'
import type { SessionDoc, SessionRow, ToolName } from '@shared/types'
import { ClaudeCodeAdapter } from './adapters/claudeCode'
import { CodexAdapter } from './adapters/codex'
import type { SessionAdapter } from './adapters/types'

const adapterCache = new Map<ToolName, SessionAdapter>()

function adapterFor(tool: ToolName): SessionAdapter {
  let a = adapterCache.get(tool)
  if (a) return a
  switch (tool) {
    case 'codex':
      a = new CodexAdapter()
      break
    case 'claude-code':
    default:
      a = new ClaudeCodeAdapter()
      break
  }
  adapterCache.set(tool, a)
  return a
}

export function getSessionRow(db: DB, id: string): SessionRow {
  const row = db
    .prepare(
      `SELECT id, tool, project_path as projectPath, project_name as projectName,
              source_path as sourcePath, edited_path as editedPath,
              started_at as startedAt, ended_at as endedAt,
              message_count as messageCount, auto_title as autoTitle,
              custom_name as customName, source_mtime_ms as sourceMtimeMs,
              host, remote_source_path as remoteSourcePath
       FROM sessions WHERE id = ?`
    )
    .get(id) as Omit<SessionRow, 'tags'> | undefined
  if (!row) throw new Error(`Session not found: ${id}`)
  const tags = db
    .prepare('SELECT tag FROM tags WHERE session_id = ? ORDER BY tag')
    .all(id) as { tag: string }[]
  return { ...row, tool: row.tool as SessionRow['tool'], tags: tags.map((t) => t.tag) }
}

export async function readSessionDoc(db: DB, id: string): Promise<SessionDoc> {
  const meta = getSessionRow(db, id)
  const adapter = adapterFor(meta.tool)
  const fileToRead = meta.editedPath ?? meta.sourcePath
  const parsed = await adapter.read(fileToRead)
  return { meta, events: parsed.events }
}
