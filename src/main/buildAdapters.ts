import path from 'node:path'
import { ClaudeCodeAdapter } from './adapters/claudeCode'
import { CodexAdapter } from './adapters/codex'
import type { SessionAdapter } from './adapters/types'
import {
  remoteMirrorClaudeProjectsDir,
  remoteMirrorCodexSessionsDir
} from '@shared/paths'
import { resolveRemotePaths, rsyncPull } from './ssh'
import { loadSettings, saveSettings } from './settings'
import type { SshHostConfig } from '@shared/types'

export interface RemoteSync {
  alias: string
  /** Pull both Claude and Codex dirs to the local mirror. */
  pull(): Promise<void>
}

export interface BuiltAdapter {
  adapter: SessionAdapter
  remote?: RemoteSync
}

/**
 * Build the full set of adapters: local Claude + Codex, plus per-host remote
 * adapters for every enabled SSH host. Each remote adapter points at the
 * local rsync mirror dir; the attached `RemoteSync` knows how to refresh it.
 */
export function buildAdapters(): BuiltAdapter[] {
  const built: BuiltAdapter[] = [
    { adapter: new ClaudeCodeAdapter() },
    { adapter: new CodexAdapter() }
  ]

  const settings = loadSettings()
  const hosts = (settings.sshHosts || []).filter((h) => h.enabled)
  for (const host of hosts) {
    built.push(...buildRemoteAdapters(host))
  }
  return built
}

function buildRemoteAdapters(host: SshHostConfig): BuiltAdapter[] {
  const claudeMirror = remoteMirrorClaudeProjectsDir(host.alias)
  const codexMirror = remoteMirrorCodexSessionsDir(host.alias)
  const idPrefix = `${host.alias}:`

  // Best-effort: use last-resolved paths (or overrides) at construction time.
  // The actual values are re-resolved on each pull() and persisted to settings.
  const initialClaudeRemote =
    host.overrideClaudeProjectsDir || host.lastResolved?.claudeProjectsDir || ''
  const initialCodexRemote =
    host.overrideCodexSessionsDir || host.lastResolved?.codexSessionsDir || ''

  const sync: RemoteSync = {
    alias: host.alias,
    async pull(): Promise<void> {
      // Re-read settings on every pull so the user's saved overrides /
      // last-resolved cache stay authoritative.
      const current = loadSettings()
      const idx = current.sshHosts.findIndex((h) => h.alias === host.alias)
      if (idx < 0) return
      const cur = current.sshHosts[idx]
      let claudeRemote = cur.overrideClaudeProjectsDir
      let codexRemote = cur.overrideCodexSessionsDir
      if (!claudeRemote || !codexRemote) {
        try {
          const resolved = await resolveRemotePaths(host.alias)
          claudeRemote = claudeRemote || resolved.claudeProjectsDir
          codexRemote = codexRemote || resolved.codexSessionsDir
          cur.lastResolved = {
            at: new Date().toISOString(),
            home: resolved.home,
            claudeProjectsDir: resolved.claudeProjectsDir,
            codexSessionsDir: resolved.codexSessionsDir
          }
        } catch (err) {
          cur.lastError = (err as Error).message
          saveSettings(current)
          throw err
        }
      }
      try {
        await rsyncPull(host.alias, claudeRemote, claudeMirror)
        await rsyncPull(host.alias, codexRemote, codexMirror)
        cur.lastSyncAt = new Date().toISOString()
        cur.lastError = undefined
      } catch (err) {
        cur.lastError = (err as Error).message
        saveSettings(current)
        throw err
      }
      saveSettings(current)
    }
  }

  // Map a mirror file path back to its canonical remote path. Used when we
  // need to push edits back via rsync.
  const claudeRemotePathFor = (mirrorPath: string): string => {
    if (!initialClaudeRemote) return ''
    const rel = path.relative(claudeMirror, mirrorPath)
    return joinRemote(initialClaudeRemote, rel)
  }
  const codexRemotePathFor = (mirrorPath: string): string => {
    if (!initialCodexRemote) return ''
    const rel = path.relative(codexMirror, mirrorPath)
    return joinRemote(initialCodexRemote, rel)
  }

  return [
    {
      adapter: new ClaudeCodeAdapter({
        rootDir: claudeMirror,
        idPrefix,
        host: host.alias,
        remotePathFor: claudeRemotePathFor
      }),
      remote: sync
    },
    {
      adapter: new CodexAdapter({
        rootDir: codexMirror,
        idPrefix,
        host: host.alias,
        remotePathFor: codexRemotePathFor
      }),
      remote: sync
    }
  ]
}

function joinRemote(base: string, rel: string): string {
  const normalizedRel = rel.split(path.sep).join('/')
  return base.replace(/\/+$/, '') + '/' + normalizedRel.replace(/^\/+/, '')
}
