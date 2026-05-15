import os from 'node:os'
import path from 'node:path'

export const HOME = process.env.HOME || os.homedir()

const CLAUDE_DIR = process.env.CLAUDE_CONFIG_DIR || path.join(HOME, '.claude')
export const CLAUDE_PROJECTS_DIR = path.join(CLAUDE_DIR, 'projects')

const CODEX_DIR = process.env.CODEX_HOME || path.join(HOME, '.codex')
export const CODEX_SESSIONS_DIR = path.join(CODEX_DIR, 'sessions')

export const SELFER_DIR = process.env.SELFER_HOME || path.join(HOME, '.selfer')
export const DB_PATH = path.join(SELFER_DIR, 'selfer.db')
export const EDITS_DIR = path.join(SELFER_DIR, 'edits')
export const DIGESTS_DIR = path.join(SELFER_DIR, 'digests')
export const SETTINGS_PATH = path.join(SELFER_DIR, 'settings.json')
export const REMOTE_DIR = path.join(SELFER_DIR, 'remote')

export function unslugifyClaudeProject(slug: string): string {
  if (slug.startsWith('-')) return '/' + slug.slice(1).replace(/-/g, '/')
  return slug.replace(/-/g, '/')
}

export function projectNameFromPath(p: string): string {
  return path.basename(p) || p
}

/** Per-host mirror dirs under ~/.selfer/remote/<alias>/. */
export function remoteMirrorClaudeProjectsDir(alias: string): string {
  return path.join(REMOTE_DIR, alias, 'claude', 'projects')
}
export function remoteMirrorCodexSessionsDir(alias: string): string {
  return path.join(REMOTE_DIR, alias, 'codex', 'sessions')
}
