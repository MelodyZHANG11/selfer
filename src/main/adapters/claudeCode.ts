import fs from 'node:fs'
import fsp from 'node:fs/promises'
import path from 'node:path'
import readline from 'node:readline'
import { CLAUDE_PROJECTS_DIR, unslugifyClaudeProject, projectNameFromPath } from '@shared/paths'
import type { ContentBlock, SessionEvent, ToolName } from '@shared/types'
import type { AdapterOpts, DiscoveredSession, ParsedSession, SessionAdapter } from './types'

export type { DiscoveredSession, ParsedSession } from './types'

export class ClaudeCodeAdapter implements SessionAdapter {
  readonly toolName: ToolName = 'claude-code'
  readonly rootDir: string
  readonly watchGlob: string = '**/*.jsonl'
  readonly host: string | null
  private readonly idPrefix: string
  private readonly remotePathFor?: (mirrorPath: string) => string

  constructor(opts: AdapterOpts = {}) {
    this.rootDir = opts.rootDir ?? CLAUDE_PROJECTS_DIR
    this.host = opts.host ?? null
    this.idPrefix = opts.idPrefix ?? ''
    this.remotePathFor = opts.remotePathFor
  }

  async discover(): Promise<DiscoveredSession[]> {
    const out: DiscoveredSession[] = []
    if (!fs.existsSync(this.rootDir)) return out

    const projectDirs = await fsp.readdir(this.rootDir, { withFileTypes: true })
    for (const d of projectDirs) {
      if (!d.isDirectory()) continue
      const slug = d.name
      const projectPath = unslugifyClaudeProject(slug)
      const projectName = projectNameFromPath(projectPath)
      const projectDir = path.join(this.rootDir, slug)
      let files: fs.Dirent[]
      try {
        files = await fsp.readdir(projectDir, { withFileTypes: true })
      } catch {
        continue
      }
      for (const f of files) {
        if (!f.isFile() || !f.name.endsWith('.jsonl')) continue
        const baseId = f.name.replace(/\.jsonl$/, '')
        const sourcePath = path.join(projectDir, f.name)
        let stat: fs.Stats
        try {
          stat = await fsp.stat(sourcePath)
        } catch {
          continue
        }
        out.push({
          id: `${this.idPrefix}${baseId}`,
          tool: this.toolName,
          sourcePath,
          projectPath,
          projectName,
          sourceMtimeMs: stat.mtimeMs,
          host: this.host,
          remoteSourcePath: this.remotePathFor ? this.remotePathFor(sourcePath) : null
        })
      }
    }
    return out
  }

  async read(sourcePath: string): Promise<ParsedSession> {
    const stream = fs.createReadStream(sourcePath, { encoding: 'utf8' })
    const rl = readline.createInterface({ input: stream, crlfDelay: Infinity })

    const events: SessionEvent[] = []
    const textChunks: string[] = []
    let startedAt: string | null = null
    let endedAt: string | null = null
    let messageCount = 0
    let autoTitle: string | null = null
    let inputTokens = 0
    let outputTokens = 0
    let cacheCreationTokens = 0
    let cacheReadTokens = 0
    let toolUseCount = 0
    const seenAssistantMsgs = new Set<string>()

    for await (const line of rl) {
      if (!line.trim()) continue
      let parsed: any
      try {
        parsed = JSON.parse(line)
      } catch {
        continue
      }
      const ev = normalizeEvent(parsed)
      events.push(ev)

      if (ev.timestamp) {
        if (!startedAt || ev.timestamp < startedAt) startedAt = ev.timestamp
        if (!endedAt || ev.timestamp > endedAt) endedAt = ev.timestamp
      }

      if (ev.kind === 'user' || ev.kind === 'assistant') {
        messageCount += 1
        for (const block of ev.content) {
          if (block.type === 'text') {
            textChunks.push(block.text)
            if (!autoTitle && ev.kind === 'user' && block.text.trim()) {
              autoTitle = firstLineTitle(block.text)
            }
          } else if (block.type === 'thinking') {
            textChunks.push(block.thinking)
          } else if (block.type === 'tool_use') {
            toolUseCount += 1
          }
        }
      }

      // Assistant turns often span multiple JSONL rows (same message.id repeated across
      // streaming chunks). Count usage once per unique message.id.
      if (ev.kind === 'assistant') {
        const msg = (parsed as any)?.message
        const msgId: string | undefined = msg?.id
        const usage = msg?.usage
        if (usage && msgId && !seenAssistantMsgs.has(msgId)) {
          seenAssistantMsgs.add(msgId)
          inputTokens += numOrZero(usage.input_tokens)
          outputTokens += numOrZero(usage.output_tokens)
          cacheCreationTokens += numOrZero(usage.cache_creation_input_tokens)
          cacheReadTokens += numOrZero(usage.cache_read_input_tokens)
        }
      }
    }

    return {
      startedAt,
      endedAt,
      messageCount,
      autoTitle,
      fullText: textChunks.join('\n\n'),
      inputTokens,
      outputTokens,
      cacheCreationTokens,
      cacheReadTokens,
      toolUseCount,
      events
    }
  }
}

function firstLineTitle(s: string): string {
  const line = s.split('\n').find((l) => l.trim()) ?? s
  return line.trim().slice(0, 120)
}

function normalizeEvent(raw: any): SessionEvent {
  const uuid: string = raw.uuid ?? raw.messageId ?? cryptoRandom()
  const parentUuid: string | null = raw.parentUuid ?? null
  const timestamp: string | null = raw.timestamp ?? raw.snapshot?.timestamp ?? null
  const isSidechain: boolean = Boolean(raw.isSidechain)

  const rawType: string = raw.type ?? 'other'
  let kind: SessionEvent['kind'] = 'other'
  let content: ContentBlock[] = []

  if (rawType === 'user') {
    kind = 'user'
    content = extractContent(raw.message?.content)
  } else if (rawType === 'message' || rawType === 'assistant') {
    kind = 'assistant'
    content = extractContent(raw.message?.content)
  } else if (rawType === 'system') {
    kind = 'system'
    content = extractContent(raw.content ?? raw.message?.content)
  } else if (
    rawType === 'permission-mode' ||
    rawType === 'file-history-snapshot' ||
    rawType === 'queue-operation' ||
    rawType === 'last-prompt'
  ) {
    kind = rawType as SessionEvent['kind']
  }

  return { uuid, parentUuid, timestamp, isSidechain, kind, content, raw }
}

function extractContent(content: unknown): ContentBlock[] {
  if (content == null) return []
  if (typeof content === 'string') return [{ type: 'text', text: content }]
  if (!Array.isArray(content)) return [{ type: 'unknown', raw: content }]

  const blocks: ContentBlock[] = []
  for (const item of content) {
    if (typeof item === 'string') {
      blocks.push({ type: 'text', text: item })
    } else if (item && typeof item === 'object') {
      const t = (item as any).type
      if (t === 'text' && typeof (item as any).text === 'string') {
        blocks.push({ type: 'text', text: (item as any).text })
      } else if (t === 'thinking') {
        blocks.push({ type: 'thinking', thinking: String((item as any).thinking ?? '') })
      } else if (t === 'tool_use') {
        blocks.push({
          type: 'tool_use',
          id: String((item as any).id ?? ''),
          name: String((item as any).name ?? ''),
          input: (item as any).input
        })
      } else if (t === 'tool_result') {
        blocks.push({
          type: 'tool_result',
          tool_use_id: String((item as any).tool_use_id ?? ''),
          content: (item as any).content,
          is_error: Boolean((item as any).is_error)
        })
      } else {
        blocks.push({ type: 'unknown', raw: item })
      }
    }
  }
  return blocks
}

function cryptoRandom(): string {
  return Math.random().toString(36).slice(2) + Date.now().toString(36)
}

function numOrZero(v: unknown): number {
  return typeof v === 'number' && Number.isFinite(v) ? v : 0
}
