import { ipcMain } from 'electron'
import type { DB } from './db'
import type { Indexer } from './indexer'
import type {
  RefineDigestArgs,
  SessionListFilters,
  SessionRow,
  Settings,
  SshSyncResult,
  SshTestResult
} from '@shared/types'
import { getSessionRow, readSessionDoc } from './sessionRead'
import {
  ensureEditCopy,
  isLive,
  matchesEvent,
  replaceTextInMessage,
  revertEdits,
  transformJsonl
} from './edit'
import {
  getDigestDoc,
  listDigests,
  listDigestTimeline,
  readDigest,
  todayLocalISODate
} from './digest'
import { refineDigestSection, revertDigestRefine } from './digestRefine'
import {
  getTranslatedDigest,
  listAvailableTranslations
} from './digestTranslate'
import type { DigestScheduler } from './digestScheduler'
import type { DigestQueue } from './digestQueue'
import { loadSettings, saveSettings } from './settings'
import { getStats } from './stats'
import {
  isRemoteLive,
  parseSshConfigAliases,
  resolveRemotePaths,
  rsyncPush
} from './ssh'
import { buildAdapters } from './buildAdapters'

interface Deps {
  db: DB
  indexer: Indexer
  digestScheduler: DigestScheduler
  digestQueue: DigestQueue
}

export function registerIpc(deps: Deps): void {
  const { db, indexer, digestScheduler, digestQueue } = deps

  ipcMain.handle('selfer:reindex', async () => {
    return indexer.reindexAll()
  })

  ipcMain.handle(
    'selfer:listSessions',
    async (_e, filters: SessionListFilters = {}) => {
      return listSessions(db, filters)
    }
  )

  ipcMain.handle('selfer:listProjects', async () => {
    return db
      .prepare(
        `SELECT project_path as projectPath, project_name as projectName, COUNT(*) as count
         FROM sessions GROUP BY project_path ORDER BY count DESC`
      )
      .all()
  })

  ipcMain.handle('selfer:listTags', async () => {
    return db
      .prepare('SELECT tag, COUNT(*) as count FROM tags GROUP BY tag ORDER BY count DESC')
      .all()
  })

  ipcMain.handle('selfer:getSession', async (_e, id: string) => {
    return readSessionDoc(db, id)
  })

  ipcMain.handle(
    'selfer:setCustomName',
    async (_e, id: string, name: string | null) => {
      db.prepare('UPDATE sessions SET custom_name = ? WHERE id = ?').run(name, id)
    }
  )

  ipcMain.handle('selfer:addTag', async (_e, id: string, tag: string) => {
    const clean = tag.trim().toLowerCase()
    if (!clean) return
    db.prepare('INSERT OR IGNORE INTO tags (session_id, tag) VALUES (?, ?)').run(id, clean)
  })

  ipcMain.handle('selfer:removeTag', async (_e, id: string, tag: string) => {
    db.prepare('DELETE FROM tags WHERE session_id = ? AND tag = ?').run(id, tag)
  })

  ipcMain.handle(
    'selfer:editMessage',
    async (_e, id: string, eventUuid: string, newText: string) => {
      const meta = getSessionRow(db, id)
      if (meta.tool === 'codex')
        throw new Error('Editing Codex sessions is not supported yet.')
      if (isLive(meta.sourcePath)) throw new Error('Session is active — editing is disabled.')
      if (meta.host && meta.remoteSourcePath) {
        if (await isRemoteLive(meta.host, meta.remoteSourcePath)) {
          throw new Error('Remote session is active — editing is disabled.')
        }
      }
      const edited = await ensureEditCopy(id, meta.sourcePath)
      await transformJsonl(edited, (obj) => {
        if (!matchesEvent(obj, eventUuid)) return obj
        return replaceTextInMessage(obj, newText)
      })
      db.prepare('UPDATE sessions SET edited_path = ? WHERE id = ?').run(edited, id)
      if (meta.host && meta.remoteSourcePath) {
        await rsyncPush(meta.host, edited, meta.remoteSourcePath)
      }
    }
  )

  ipcMain.handle('selfer:deleteMessage', async (_e, id: string, eventUuid: string) => {
    const meta = getSessionRow(db, id)
    if (isLive(meta.sourcePath)) throw new Error('Session is active — editing is disabled.')
    if (meta.host && meta.remoteSourcePath) {
      if (await isRemoteLive(meta.host, meta.remoteSourcePath)) {
        throw new Error('Remote session is active — editing is disabled.')
      }
    }
    const edited = await ensureEditCopy(id, meta.sourcePath)
    await transformJsonl(edited, (obj) => (matchesEvent(obj, eventUuid) ? null : obj))
    db.prepare('UPDATE sessions SET edited_path = ? WHERE id = ?').run(edited, id)
    if (meta.host && meta.remoteSourcePath) {
      await rsyncPush(meta.host, edited, meta.remoteSourcePath)
    }
  })

  ipcMain.handle('selfer:revertEdits', async (_e, id: string) => {
    await revertEdits(id)
    db.prepare('UPDATE sessions SET edited_path = NULL WHERE id = ?').run(id)
  })

  ipcMain.handle('selfer:generateDigest', async (_e, date: string) => {
    return digestQueue.enqueue(date)
  })

  ipcMain.handle('selfer:getDigestQueueStatus', async () => digestQueue.getStatus())

  ipcMain.handle('selfer:todayLocalDate', async () => todayLocalISODate())

  ipcMain.handle('selfer:getDigestSchedule', async () => digestScheduler.getStatus())

  ipcMain.handle('selfer:listDigests', async () => listDigests(db))

  ipcMain.handle('selfer:readDigest', async (_e, filePath: string) => readDigest(filePath))

  ipcMain.handle('selfer:getDigestDoc', async (_e, date: string) => getDigestDoc(db, date))

  ipcMain.handle(
    'selfer:getDigestDocLocalized',
    async (_e, date: string, lang: string) => {
      try {
        return await getTranslatedDigest(db, date, lang)
      } catch (err) {
        console.warn('[selfer:getDigestDocLocalized] failed:', (err as Error).message)
        throw err
      }
    }
  )

  ipcMain.handle('selfer:listAvailableTranslations', async (_e, date: string) =>
    listAvailableTranslations(db, date)
  )

  ipcMain.handle('selfer:listDigestTimeline', async (_e, date: string) =>
    listDigestTimeline(db, date)
  )

  ipcMain.handle('selfer:refineDigestSection', async (_e, args: RefineDigestArgs) =>
    refineDigestSection(db, args)
  )

  ipcMain.handle(
    'selfer:revertDigestRefine',
    async (_e, date: string, sectionId: string, itemId?: string) =>
      revertDigestRefine(db, date, sectionId, itemId)
  )

  ipcMain.handle('selfer:getSettings', async () => loadSettings())

  ipcMain.handle('selfer:saveSettings', async (_e, s: Settings) => {
    saveSettings(s)
    // Settings (specifically sshHosts) drive the adapter set, so rebuild it.
    indexer.setAdapters(buildAdapters())
  })

  ipcMain.handle('selfer:getStats', async () => getStats(db))

  ipcMain.handle(
    'selfer:listOpenAIModels',
    async (_e, baseUrl: string, apiKey?: string) => listOpenAIModels(baseUrl, apiKey)
  )

  ipcMain.handle('selfer:listSshAliases', async () => parseSshConfigAliases())

  ipcMain.handle('selfer:testSshHost', async (_e, alias: string): Promise<SshTestResult> => {
    try {
      const r = await resolveRemotePaths(alias)
      // Persist resolution so future indexer runs can use it without re-querying.
      const settings = loadSettings()
      const idx = settings.sshHosts.findIndex((h) => h.alias === alias)
      if (idx >= 0) {
        settings.sshHosts[idx].lastResolved = {
          at: new Date().toISOString(),
          home: r.home,
          claudeProjectsDir: r.claudeProjectsDir,
          codexSessionsDir: r.codexSessionsDir
        }
        settings.sshHosts[idx].lastError = undefined
        saveSettings(settings)
      }
      return {
        ok: true,
        resolvedHome: r.home,
        resolvedClaudeProjectsDir: r.claudeProjectsDir,
        resolvedCodexSessionsDir: r.codexSessionsDir
      }
    } catch (err) {
      return { ok: false, error: (err as Error).message }
    }
  })

  ipcMain.handle('selfer:syncSshHost', async (_e, alias: string): Promise<SshSyncResult> => {
    try {
      const settings = loadSettings()
      const host = settings.sshHosts.find((h) => h.alias === alias)
      if (!host) {
        return { ok: false, error: `Unknown SSH host "${alias}". Add it in Settings first.` }
      }
      if (!host.enabled) {
        return {
          ok: false,
          error: `Enable host "${alias}" in Settings before syncing.`
        }
      }
      // Make sure the indexer knows about this host (in case enabled was just toggled).
      indexer.setAdapters(buildAdapters())
      await indexer.syncOne(alias)
      return { ok: true }
    } catch (err) {
      return { ok: false, error: (err as Error).message }
    }
  })
}

async function listOpenAIModels(
  baseUrl: string,
  apiKey?: string
): Promise<{ id: string; ownedBy: string }[]> {
  const base = (baseUrl || '').replace(/\/$/, '')
  if (!base) throw new Error('Base URL is empty.')
  const headers: Record<string, string> = {}
  if (apiKey) headers.Authorization = `Bearer ${apiKey}`
  const ctrl = new AbortController()
  const t = setTimeout(() => ctrl.abort(), 8000)
  try {
    const res = await fetch(`${base}/models`, { headers, signal: ctrl.signal })
    if (!res.ok) {
      const body = await res.text().catch(() => '')
      throw new Error(`GET ${base}/models → ${res.status} ${res.statusText}\n${body.slice(0, 200)}`)
    }
    const data = (await res.json()) as {
      data?: { id: string; owned_by?: string }[]
    }
    const rows = data.data ?? []
    return rows
      .map((r) => ({ id: r.id, ownedBy: r.owned_by ?? '' }))
      .sort((a, b) => {
        if (a.ownedBy !== b.ownedBy) return a.ownedBy.localeCompare(b.ownedBy)
        return a.id.localeCompare(b.id)
      })
  } finally {
    clearTimeout(t)
  }
}

function listSessions(
  db: DB,
  f: SessionListFilters
): { rows: SessionRow[]; total: number } {
  const limit = Math.max(1, Math.min(500, f.limit ?? 100))
  const offset = Math.max(0, f.offset ?? 0)

  const clauses: string[] = []
  const params: Record<string, unknown> = {}

  if (f.query && f.query.trim()) {
    clauses.push(
      `s.id IN (SELECT session_id FROM session_fts WHERE session_fts MATCH @query)`
    )
    params.query = f.query.trim() + '*'
  }
  if (f.projectPath) {
    clauses.push('s.project_path = @projectPath')
    params.projectPath = f.projectPath
  }
  if (f.tool) {
    clauses.push('s.tool = @tool')
    params.tool = f.tool
  }
  if (f.host) {
    if (f.host === 'local') {
      clauses.push('s.host IS NULL')
    } else {
      clauses.push('s.host = @host')
      params.host = f.host
    }
  }
  if (f.tag) {
    clauses.push(
      's.id IN (SELECT session_id FROM tags WHERE tag = @tag)'
    )
    params.tag = f.tag
  }
  if (f.from) {
    clauses.push('(s.started_at >= @from OR s.ended_at >= @from)')
    params.from = f.from
  }
  if (f.to) {
    clauses.push('(s.started_at <= @to OR s.ended_at <= @to)')
    params.to = f.to
  }

  const where = clauses.length ? 'WHERE ' + clauses.join(' AND ') : ''
  const totalRow = db.prepare(`SELECT COUNT(*) as c FROM sessions s ${where}`).get(params) as {
    c: number
  }

  const rows = db
    .prepare(
      `SELECT s.id, s.tool, s.project_path as projectPath, s.project_name as projectName,
              s.source_path as sourcePath, s.edited_path as editedPath,
              s.started_at as startedAt, s.ended_at as endedAt,
              s.message_count as messageCount, s.auto_title as autoTitle,
              s.custom_name as customName, s.source_mtime_ms as sourceMtimeMs,
              s.host, s.remote_source_path as remoteSourcePath
       FROM sessions s
       ${where}
       ORDER BY COALESCE(s.started_at, '') DESC
       LIMIT @limit OFFSET @offset`
    )
    .all({ ...params, limit, offset }) as Omit<SessionRow, 'tags'>[]

  const ids = rows.map((r) => r.id)
  const tagMap = new Map<string, string[]>()
  if (ids.length) {
    const placeholders = ids.map(() => '?').join(',')
    const tagRows = db
      .prepare(`SELECT session_id, tag FROM tags WHERE session_id IN (${placeholders}) ORDER BY tag`)
      .all(...ids) as { session_id: string; tag: string }[]
    for (const t of tagRows) {
      const arr = tagMap.get(t.session_id) ?? []
      arr.push(t.tag)
      tagMap.set(t.session_id, arr)
    }
  }

  const full: SessionRow[] = rows.map((r) => ({
    ...r,
    tool: r.tool as SessionRow['tool'],
    tags: tagMap.get(r.id) ?? []
  }))

  return { rows: full, total: totalRow.c }
}
