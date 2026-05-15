import fs from 'node:fs'
import { watch, type FSWatcher } from 'chokidar'
import type { DB } from './db'
import type { DiscoveredSession, ParsedSession, SessionAdapter } from './adapters/types'
import type { BuiltAdapter, RemoteSync } from './buildAdapters'

const REMOTE_POLL_INTERVAL_MS = 10 * 60 * 1000

export class Indexer {
  private watchers: FSWatcher[] = []
  private remotePollTimer: NodeJS.Timeout | null = null

  constructor(
    private db: DB,
    private built: BuiltAdapter[]
  ) {}

  get adapters(): SessionAdapter[] {
    return this.built.map((b) => b.adapter)
  }

  /** Replace the adapter set (used after settings change). */
  setAdapters(built: BuiltAdapter[]): void {
    this.built = built
  }

  async reindexAll(): Promise<{ scanned: number; inserted: number; updated: number }> {
    // Pull every distinct remote sync first (parallel across hosts). Failures
    // are logged but don't abort the whole reindex — local sessions still get
    // indexed even if a remote is unreachable.
    const seenSyncs = new Set<string>()
    const syncTasks: Promise<unknown>[] = []
    for (const b of this.built) {
      if (!b.remote) continue
      if (seenSyncs.has(b.remote.alias)) continue
      seenSyncs.add(b.remote.alias)
      const sync = b.remote
      syncTasks.push(
        sync.pull().catch((err) => {
          console.error(`[indexer] remote sync ${sync.alias} failed:`, err)
        })
      )
    }
    if (syncTasks.length) await Promise.all(syncTasks)

    let scanned = 0
    let inserted = 0
    let updated = 0

    const getMtime = this.db.prepare<[string], { source_mtime_ms: number }>(
      'SELECT source_mtime_ms FROM sessions WHERE id = ?'
    )

    for (const { adapter } of this.built) {
      let discovered: DiscoveredSession[]
      try {
        discovered = await adapter.discover()
      } catch (err) {
        console.error(`[indexer] ${adapter.toolName} discover failed:`, err)
        continue
      }
      scanned += discovered.length

      for (const d of discovered) {
        const existing = getMtime.get(d.id)
        if (existing && existing.source_mtime_ms === d.sourceMtimeMs) continue
        let parsed: ParsedSession
        try {
          parsed = await adapter.read(d.sourcePath)
        } catch (err) {
          console.error(`[indexer] ${adapter.toolName} read failed for ${d.sourcePath}:`, err)
          continue
        }
        this.upsertSession(d, parsed)
        if (existing) updated += 1
        else inserted += 1
      }
    }

    return { scanned, inserted, updated }
  }

  private upsertSession(d: DiscoveredSession, p: ParsedSession): void {
    const upsert = this.db.prepare(`
      INSERT INTO sessions (
        id, tool, project_path, project_name, source_path, edited_path,
        started_at, ended_at, message_count, auto_title, custom_name, source_mtime_ms,
        input_tokens, output_tokens, cache_creation_tokens, cache_read_tokens, tool_use_count,
        host, remote_source_path
      ) VALUES (
        @id, @tool, @project_path, @project_name, @source_path, NULL,
        @started_at, @ended_at, @message_count, @auto_title, NULL, @source_mtime_ms,
        @input_tokens, @output_tokens, @cache_creation_tokens, @cache_read_tokens, @tool_use_count,
        @host, @remote_source_path
      )
      ON CONFLICT(id) DO UPDATE SET
        project_path = excluded.project_path,
        project_name = excluded.project_name,
        source_path = excluded.source_path,
        started_at = excluded.started_at,
        ended_at = excluded.ended_at,
        message_count = excluded.message_count,
        auto_title = excluded.auto_title,
        source_mtime_ms = excluded.source_mtime_ms,
        input_tokens = excluded.input_tokens,
        output_tokens = excluded.output_tokens,
        cache_creation_tokens = excluded.cache_creation_tokens,
        cache_read_tokens = excluded.cache_read_tokens,
        tool_use_count = excluded.tool_use_count,
        host = excluded.host,
        remote_source_path = excluded.remote_source_path
    `)

    const delFts = this.db.prepare('DELETE FROM session_fts WHERE session_id = ?')
    const insFts = this.db.prepare(
      'INSERT INTO session_fts (session_id, body) VALUES (?, ?)'
    )

    const projectPath = p.projectPath && p.projectPath.trim() ? p.projectPath : d.projectPath
    const projectName = p.projectName && p.projectName.trim() ? p.projectName : d.projectName

    const tx = this.db.transaction(() => {
      upsert.run({
        id: d.id,
        tool: d.tool,
        project_path: projectPath,
        project_name: projectName,
        source_path: d.sourcePath,
        started_at: p.startedAt,
        ended_at: p.endedAt,
        message_count: p.messageCount,
        auto_title: p.autoTitle,
        source_mtime_ms: d.sourceMtimeMs,
        input_tokens: p.inputTokens,
        output_tokens: p.outputTokens,
        cache_creation_tokens: p.cacheCreationTokens,
        cache_read_tokens: p.cacheReadTokens,
        tool_use_count: p.toolUseCount,
        host: d.host ?? null,
        remote_source_path: d.remoteSourcePath ?? null
      })
      delFts.run(d.id)
      if (p.fullText) insFts.run(d.id, p.fullText)
    })
    tx()
  }

  startWatching(): void {
    if (this.watchers.length > 0) return
    for (const { adapter, remote } of this.built) {
      // Only watch local adapters with chokidar — remote dirs are mirrored
      // periodically instead.
      if (remote) continue
      if (!fs.existsSync(adapter.rootDir)) continue
      const w = watch(adapter.watchGlob, {
        cwd: adapter.rootDir,
        ignoreInitial: true,
        awaitWriteFinish: { stabilityThreshold: 1500, pollInterval: 200 }
      })
      w.on('add', () => this.debouncedReindex())
      w.on('change', () => this.debouncedReindex())
      w.on('unlink', () => this.debouncedReindex())
      this.watchers.push(w)
    }

    // Periodic remote poll if any remote adapter exists.
    const hasRemote = this.built.some((b) => b.remote)
    if (hasRemote && !this.remotePollTimer) {
      this.remotePollTimer = setInterval(() => {
        this.reindexAll().catch((err) =>
          console.error('[indexer] remote poll failed:', err)
        )
      }, REMOTE_POLL_INTERVAL_MS)
      // Don't keep the event loop alive just for polling.
      this.remotePollTimer.unref?.()
    }
  }

  stopWatching(): void {
    for (const w of this.watchers) w.close()
    this.watchers = []
    if (this.remotePollTimer) {
      clearInterval(this.remotePollTimer)
      this.remotePollTimer = null
    }
  }

  /** Pull and reindex one specific remote host on demand. */
  async syncOne(alias: string): Promise<void> {
    const remoteForHost = this.built.find((b) => b.remote?.alias === alias)?.remote as
      | RemoteSync
      | undefined
    if (!remoteForHost) throw new Error(`No remote adapter registered for host ${alias}`)
    await remoteForHost.pull()

    const getMtime = this.db.prepare<[string], { source_mtime_ms: number }>(
      'SELECT source_mtime_ms FROM sessions WHERE id = ?'
    )
    for (const { adapter } of this.built) {
      if (adapter.host !== alias) continue
      const discovered = await adapter.discover()
      for (const d of discovered) {
        const existing = getMtime.get(d.id)
        if (existing && existing.source_mtime_ms === d.sourceMtimeMs) continue
        const parsed = await adapter.read(d.sourcePath)
        this.upsertSession(d, parsed)
      }
    }
  }

  private reindexTimer: NodeJS.Timeout | null = null
  private debouncedReindex(): void {
    if (this.reindexTimer) clearTimeout(this.reindexTimer)
    this.reindexTimer = setTimeout(() => {
      this.reindexAll().catch((err) => console.error('[indexer] incremental failed:', err))
    }, 2000)
  }
}
