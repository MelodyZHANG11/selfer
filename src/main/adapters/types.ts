import type { SessionEvent, ToolName } from '@shared/types'

export interface DiscoveredSession {
  id: string
  tool: ToolName
  sourcePath: string
  projectPath: string
  projectName: string
  sourceMtimeMs: number
  /** SSH alias for remote sessions; null/undefined for local. */
  host?: string | null
  /** Path on the remote host (the source of truth before the rsync mirror). Null for local. */
  remoteSourcePath?: string | null
}

export interface ParsedSession {
  startedAt: string | null
  endedAt: string | null
  messageCount: number
  autoTitle: string | null
  fullText: string
  inputTokens: number
  outputTokens: number
  cacheCreationTokens: number
  cacheReadTokens: number
  toolUseCount: number
  events: SessionEvent[]
  /** Adapter can refine the project path after actually reading session content (e.g. Codex cwd). */
  projectPath?: string | null
  projectName?: string | null
}

export interface AdapterOpts {
  /** Override the directory the adapter scans. Defaults to the local Claude/Codex dir. */
  rootDir?: string
  /** Prefix prepended to every discovered session id (used to namespace remote ids per host). */
  idPrefix?: string
  /** SSH alias this adapter is reading from. Null/undefined = local. */
  host?: string | null
  /** Function that maps a mirror file path back to the canonical path on the remote host. */
  remotePathFor?: (mirrorPath: string) => string
}

export interface SessionAdapter {
  readonly toolName: ToolName
  readonly rootDir: string
  readonly watchGlob: string
  readonly host: string | null
  discover(): Promise<DiscoveredSession[]>
  read(sourcePath: string): Promise<ParsedSession>
}
