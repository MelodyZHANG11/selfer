export type ToolName = 'claude-code' | 'copilot-cli' | 'codex' | 'opencode'

export interface SessionRow {
  id: string
  tool: ToolName
  projectPath: string
  projectName: string
  sourcePath: string
  editedPath: string | null
  startedAt: string | null
  endedAt: string | null
  messageCount: number
  autoTitle: string | null
  customName: string | null
  sourceMtimeMs: number
  tags: string[]
  /** SSH alias the session was pulled from; null = local. */
  host: string | null
  /** Path on the remote host (canonical source); null = local. */
  remoteSourcePath: string | null
}

export type ContentBlock =
  | { type: 'text'; text: string }
  | { type: 'thinking'; thinking: string }
  | { type: 'tool_use'; id: string; name: string; input: unknown }
  | { type: 'tool_result'; tool_use_id: string; content: unknown; is_error?: boolean }
  | { type: 'unknown'; raw: unknown }

export interface SessionEvent {
  uuid: string
  parentUuid: string | null
  timestamp: string | null
  isSidechain: boolean
  kind:
    | 'user'
    | 'assistant'
    | 'system'
    | 'permission-mode'
    | 'file-history-snapshot'
    | 'queue-operation'
    | 'last-prompt'
    | 'other'
  content: ContentBlock[]
  raw: unknown
}

export interface SessionDoc {
  meta: SessionRow
  events: SessionEvent[]
}

export interface SessionListFilters {
  query?: string
  projectPath?: string
  tag?: string
  tool?: ToolName
  /** 'local' (NULL host) or an SSH alias. Empty/undefined = no filter. */
  host?: string
  from?: string
  to?: string
  limit?: number
  offset?: number
}

export interface DigestInfo {
  date: string
  path: string
  generatedAt: string
}

export interface DigestRef {
  refId: string
  sessionId: string
  eventUuid: string
  role: 'USER' | 'ASSISTANT'
  timestamp: string
  projectName: string
  tool: ToolName
  snippet: string
}

export interface DigestItem {
  itemId: string
  textMd: string
  refs: DigestRef[]
  refinedAt: string | null
}

export type DigestSectionKind = 'bullets' | 'paragraph' | 'mixed'

export interface DigestSection {
  sectionId: string
  heading: string
  kind: DigestSectionKind
  bodyMd: string
  items: DigestItem[]
  refs: DigestRef[]
  refinedAt: string | null
  hasHistory: boolean
}

export interface DigestDoc {
  info: DigestInfo
  sections: DigestSection[]
  /** True when generation produced structured JSON; false for legacy markdown-only digests. */
  structured: boolean
}

export interface DigestLanguage {
  /** BCP-47-ish code. Empty string ('') represents the original "Source" view. */
  code: string
  /** Native-script display name shown in the picker. */
  label: string
  /** 1–2 character tag shown on the trigger button. */
  tag: string
}

export const DIGEST_LANGUAGES: DigestLanguage[] = [
  { code: '', label: 'Source', tag: 'EN' },
  { code: 'en', label: 'English', tag: 'EN' },
  { code: 'zh-CN', label: '简体中文', tag: '中' },
  { code: 'zh-TW', label: '繁體中文', tag: '繁' },
  { code: 'ja', label: '日本語', tag: '日' },
  { code: 'ko', label: '한국어', tag: '韓' },
  { code: 'es', label: 'Español', tag: 'ES' },
  { code: 'fr', label: 'Français', tag: 'FR' },
  { code: 'de', label: 'Deutsch', tag: 'DE' },
  { code: 'pt', label: 'Português', tag: 'PT' },
  { code: 'ru', label: 'Русский', tag: 'RU' },
  { code: 'it', label: 'Italiano', tag: 'IT' }
]

export interface AvailableTranslation {
  lang: string
  translatedAt: string
  isStale: boolean
}

export interface RefineDigestArgs {
  date: string
  sectionId: string
  itemId?: string
  userPrompt: string
  refIds: string[]
}

export interface DigestScheduleStatus {
  nextRunAt: string | null
  lastRun: { at: string; status: string } | null
}

export interface DigestQueueStatus {
  /** Date currently being generated, or null when idle. */
  current: string | null
  /** FIFO of dates waiting their turn. */
  pending: string[]
}

export interface DigestQueueChangeEvent extends DigestQueueStatus {
  /** Populated only on the event emitted right after a date finishes (success or failure). */
  lastCompleted?: {
    date: string
    info?: DigestInfo
    error?: string
  }
}

export type DigestProvider = 'claude-cli' | 'anthropic-api' | 'openai-compatible'

export interface SshHostConfig {
  alias: string
  enabled: boolean
  /** Manual override if the remote's non-interactive shell doesn't export CLAUDE_CONFIG_DIR. */
  overrideClaudeProjectsDir?: string
  /** Manual override if the remote's non-interactive shell doesn't export CODEX_HOME. */
  overrideCodexSessionsDir?: string
  /** Filled by `testSshHost` / first sync. */
  lastResolved?: {
    at: string
    home: string
    claudeProjectsDir: string
    codexSessionsDir: string
  }
  lastSyncAt?: string
  lastError?: string
}

export interface Settings {
  digestProvider: DigestProvider
  digestsDir: string
  claudeCliPath?: string
  claudeCliModel?: string
  anthropicApiKey: string
  anthropicModel?: string
  openaiBaseUrl?: string
  openaiApiKey?: string
  openaiModel?: string
  /** When unset, translation uses digestProvider. */
  translateProvider?: DigestProvider
  /** Per-provider translate model. Falls back to the matching digest model when unset. */
  translateClaudeCliModel?: string
  translateAnthropicModel?: string
  translateOpenaiModel?: string
  /** SSH hosts to mirror sessions from. */
  sshHosts: SshHostConfig[]
}

export interface SshTestResult {
  ok: boolean
  resolvedHome?: string
  resolvedClaudeProjectsDir?: string
  resolvedCodexSessionsDir?: string
  error?: string
}

export interface SshSyncResult {
  ok: boolean
  error?: string
  pulledClaude?: boolean
  pulledCodex?: boolean
}

export interface StatsOverview {
  totalSessions: number
  totalMessages: number
  totalInputTokens: number
  totalOutputTokens: number
  totalCacheCreationTokens: number
  totalCacheReadTokens: number
  totalToolUses: number
  totalDurationSec: number
  totalProjects: number
  firstSessionAt: string | null
  lastSessionAt: string | null
}

export interface ProjectStat {
  projectPath: string
  projectName: string
  sessionCount: number
  messageCount: number
  totalTokens: number
  durationSec: number
}

export interface DayActivity {
  date: string
  sessionCount: number
  messageCount: number
  totalTokens: number
}

export interface LongSession {
  id: string
  projectName: string
  autoTitle: string | null
  customName: string | null
  durationSec: number
  messageCount: number
  totalTokens: number
}

export interface Stats {
  overview: StatsOverview
  topProjectsByMessages: ProjectStat[]
  topProjectsByDuration: ProjectStat[]
  topProjectsByTokens: ProjectStat[]
  longestSessions: LongSession[]
  activity: DayActivity[]
}

export interface OpenAIModelInfo {
  id: string
  ownedBy: string
}

export interface SelferAPI {
  reindex(): Promise<{ scanned: number; inserted: number; updated: number }>
  listSessions(filters: SessionListFilters): Promise<{ rows: SessionRow[]; total: number }>
  listProjects(): Promise<{ projectPath: string; projectName: string; count: number }[]>
  listTags(): Promise<{ tag: string; count: number }[]>
  getSession(id: string): Promise<SessionDoc>
  setCustomName(id: string, name: string | null): Promise<void>
  addTag(id: string, tag: string): Promise<void>
  removeTag(id: string, tag: string): Promise<void>
  editMessage(id: string, eventUuid: string, newText: string): Promise<void>
  deleteMessage(id: string, eventUuid: string): Promise<void>
  revertEdits(id: string): Promise<void>
  generateDigest(date: string): Promise<DigestQueueStatus>
  getDigestQueueStatus(): Promise<DigestQueueStatus>
  onDigestQueueChanged(cb: (e: DigestQueueChangeEvent) => void): () => void
  listDigests(): Promise<DigestInfo[]>
  readDigest(path: string): Promise<string>
  getDigestDoc(date: string): Promise<DigestDoc>
  getDigestDocLocalized(date: string, lang: string): Promise<DigestDoc>
  listAvailableTranslations(date: string): Promise<AvailableTranslation[]>
  listDigestTimeline(date: string): Promise<DigestRef[]>
  refineDigestSection(args: RefineDigestArgs): Promise<DigestSection>
  revertDigestRefine(date: string, sectionId: string, itemId?: string): Promise<DigestSection>
  todayLocalDate(): Promise<string>
  getDigestSchedule(): Promise<DigestScheduleStatus>
  getSettings(): Promise<Settings>
  saveSettings(s: Settings): Promise<void>
  getStats(): Promise<Stats>
  listOpenAIModels(baseUrl: string, apiKey?: string): Promise<OpenAIModelInfo[]>
  listSshAliases(): Promise<string[]>
  testSshHost(alias: string): Promise<SshTestResult>
  syncSshHost(alias: string): Promise<SshSyncResult>
}

declare global {
  interface Window {
    selfer: SelferAPI
  }
}
