import { spawn } from 'node:child_process'
import fs from 'node:fs'
import fsp from 'node:fs/promises'
import path from 'node:path'
import { HOME } from '@shared/paths'

const SSH_OPTS = [
  '-o', 'BatchMode=yes',
  '-o', 'ConnectTimeout=8',
  '-o', 'StrictHostKeyChecking=accept-new'
]

export class SshError extends Error {
  constructor(
    message: string,
    public readonly stderr: string,
    public readonly code: number | null
  ) {
    super(message)
    this.name = 'SshError'
  }
}

interface RunResult {
  code: number | null
  stdout: string
  stderr: string
}

function run(cmd: string, args: string[], opts: { timeoutMs?: number } = {}): Promise<RunResult> {
  return new Promise((resolve, reject) => {
    const child = spawn(cmd, args, { stdio: ['ignore', 'pipe', 'pipe'] })
    let stdout = ''
    let stderr = ''
    child.stdout.on('data', (b) => (stdout += b.toString('utf8')))
    child.stderr.on('data', (b) => (stderr += b.toString('utf8')))
    const timeout = opts.timeoutMs
      ? setTimeout(() => {
          try {
            child.kill('SIGKILL')
          } catch {
            /* noop */
          }
        }, opts.timeoutMs)
      : null
    child.on('error', (err) => {
      if (timeout) clearTimeout(timeout)
      reject(err)
    })
    child.on('close', (code) => {
      if (timeout) clearTimeout(timeout)
      resolve({ code, stdout, stderr })
    })
  })
}

/**
 * Parse `~/.ssh/config` and any top-level `Include` directives, returning the
 * list of concrete (non-wildcard, non-negated) Host aliases.
 */
export async function parseSshConfigAliases(): Promise<string[]> {
  const root = path.join(HOME, '.ssh', 'config')
  const aliases: string[] = []
  const seen = new Set<string>()

  const visit = async (file: string): Promise<void> => {
    let text: string
    try {
      text = await fsp.readFile(file, 'utf8')
    } catch {
      return
    }
    const lines = text.split(/\r?\n/)
    for (const raw of lines) {
      const line = raw.replace(/#.*$/, '').trim()
      if (!line) continue
      const m = line.match(/^(\w+)\s+(.+)$/)
      if (!m) continue
      const key = m[1].toLowerCase()
      const value = m[2].trim()
      if (key === 'host') {
        const tokens = value.split(/\s+/)
        for (const t of tokens) {
          if (!t) continue
          if (t.includes('*') || t.includes('?') || t.startsWith('!')) continue
          if (!seen.has(t)) {
            seen.add(t)
            aliases.push(t)
          }
        }
      } else if (key === 'include') {
        const tokens = value.split(/\s+/)
        for (const t of tokens) {
          const expanded = t.startsWith('~/')
            ? path.join(HOME, t.slice(2))
            : path.isAbsolute(t)
              ? t
              : path.join(HOME, '.ssh', t)
          // Globless include only — keep this simple.
          if (fs.existsSync(expanded)) await visit(expanded)
        }
      }
    }
  }

  await visit(root)
  return aliases
}

export interface RemotePathResolution {
  home: string
  claudeProjectsDir: string
  codexSessionsDir: string
}

/**
 * Resolve the remote's effective Claude/Codex session paths by reading its
 * env vars over SSH. Honors CLAUDE_CONFIG_DIR / CODEX_HOME on the remote
 * side, mirroring how src/shared/paths.ts resolves them locally.
 */
export async function resolveRemotePaths(alias: string): Promise<RemotePathResolution> {
  const script = [
    'printf "HOME=%s\\n" "$HOME"',
    'printf "CLAUDE_CONFIG_DIR=%s\\n" "${CLAUDE_CONFIG_DIR:-}"',
    'printf "CODEX_HOME=%s\\n" "${CODEX_HOME:-}"'
  ].join('; ')
  const res = await run('ssh', [...SSH_OPTS, alias, script], { timeoutMs: 15000 })
  if (res.code !== 0) {
    throw new SshError(
      `ssh ${alias} failed (exit ${res.code})`,
      res.stderr.trim(),
      res.code
    )
  }
  const env: Record<string, string> = {}
  for (const line of res.stdout.split(/\r?\n/)) {
    const m = line.match(/^([A-Z_]+)=(.*)$/)
    if (m) env[m[1]] = m[2]
  }
  const home = env.HOME || ''
  if (!home) {
    throw new SshError(`could not resolve $HOME on ${alias}`, res.stdout, res.code)
  }
  const claudeBase = env.CLAUDE_CONFIG_DIR || posixJoin(home, '.claude')
  const codexBase = env.CODEX_HOME || posixJoin(home, '.codex')
  return {
    home,
    claudeProjectsDir: posixJoin(claudeBase, 'projects'),
    codexSessionsDir: posixJoin(codexBase, 'sessions')
  }
}

/** Joins POSIX-style path segments (the remote is assumed POSIX). */
function posixJoin(...parts: string[]): string {
  return parts
    .map((p, i) => (i === 0 ? p.replace(/\/+$/, '') : p.replace(/^\/+|\/+$/g, '')))
    .filter((p) => p.length > 0)
    .join('/')
}

/** Returns true if the directory exists on the remote. */
export async function remoteDirExists(alias: string, remoteDir: string): Promise<boolean> {
  const res = await run(
    'ssh',
    [...SSH_OPTS, alias, `test -d ${shellQuote(remoteDir)}`],
    { timeoutMs: 12000 }
  )
  return res.code === 0
}

/**
 * Pull a remote directory to a local mirror via rsync. Skips if the remote
 * directory is missing. Returns true if pulled, false if skipped.
 */
export async function rsyncPull(
  alias: string,
  remoteDir: string,
  localDir: string
): Promise<boolean> {
  if (!(await remoteDirExists(alias, remoteDir))) return false
  await fsp.mkdir(localDir, { recursive: true })
  const res = await run(
    'rsync',
    [
      '-az',
      '--delete',
      '--prune-empty-dirs',
      '-e',
      `ssh ${SSH_OPTS.join(' ')}`,
      `${alias}:${remoteDir}/`,
      `${localDir}/`
    ],
    { timeoutMs: 10 * 60 * 1000 }
  )
  if (res.code !== 0) {
    throw new SshError(
      `rsync pull from ${alias}:${remoteDir} failed (exit ${res.code})`,
      res.stderr.trim(),
      res.code
    )
  }
  return true
}

/** Push a single local file back to the remote, overwriting it. */
export async function rsyncPush(
  alias: string,
  localFile: string,
  remoteFile: string
): Promise<void> {
  const res = await run(
    'rsync',
    ['-az', '-e', `ssh ${SSH_OPTS.join(' ')}`, localFile, `${alias}:${remoteFile}`],
    { timeoutMs: 5 * 60 * 1000 }
  )
  if (res.code !== 0) {
    throw new SshError(
      `rsync push to ${alias}:${remoteFile} failed (exit ${res.code})`,
      res.stderr.trim(),
      res.code
    )
  }
}

/** Returns mtime in ms for a remote file, or null if it doesn't exist. */
export async function statRemote(
  alias: string,
  remotePath: string
): Promise<{ mtimeMs: number } | null> {
  // GNU stat is `-c %Y`, BSD/macOS stat is `-f %m`. Try both, take whichever works.
  const cmd = `stat -c %Y ${shellQuote(remotePath)} 2>/dev/null || stat -f %m ${shellQuote(remotePath)} 2>/dev/null`
  const res = await run('ssh', [...SSH_OPTS, alias, cmd], { timeoutMs: 12000 })
  if (res.code !== 0) return null
  const epochSec = Number.parseInt(res.stdout.trim(), 10)
  if (!Number.isFinite(epochSec)) return null
  return { mtimeMs: epochSec * 1000 }
}

const REMOTE_LIVE_WINDOW_MS = 10 * 60 * 1000

export async function isRemoteLive(alias: string, remotePath: string): Promise<boolean> {
  const stat = await statRemote(alias, remotePath)
  if (!stat) return false
  return Date.now() - stat.mtimeMs < REMOTE_LIVE_WINDOW_MS
}

/** Single-quote a string for the remote shell, escaping any embedded single quotes. */
function shellQuote(s: string): string {
  return `'${s.replace(/'/g, `'\\''`)}'`
}
