import fs from 'node:fs'
import fsp from 'node:fs/promises'
import path from 'node:path'
import readline from 'node:readline'
import { CODEX_SESSIONS_DIR, projectNameFromPath } from '@shared/paths'
import type { ContentBlock, SessionEvent, ToolName } from '@shared/types'
import type { AdapterOpts, DiscoveredSession, ParsedSession, SessionAdapter } from './types'

/**
 * Codex rollout format (JSONL), file per session at
 *   ~/.codex/sessions/YYYY/MM/DD/rollout-<iso>-<uuid>.jsonl
 *
 * Each line: {timestamp, type, payload} where type is one of:
 *   - session_meta:   has payload.{id, cwd, originator, cli_version, model_provider}
 *   - event_msg:      UI-layer event stream (task_started, agent_message, token_count, ...)
 *   - response_item:  canonical model I/O (message, reasoning, function_call, ...)
 *   - token_count (wrapper under event_msg.payload)
 *
 * We prefer response_item for user/assistant text (canonical) and skip the
 * event_msg.user_message / agent_message duplicates.
 */
export class CodexAdapter implements SessionAdapter {
  readonly toolName: ToolName = 'codex'
  readonly rootDir: string
  readonly watchGlob: string = '**/rollout-*.jsonl'
  readonly host: string | null
  private readonly idPrefix: string
  private readonly remotePathFor?: (mirrorPath: string) => string

  constructor(opts: AdapterOpts = {}) {
    this.rootDir = opts.rootDir ?? CODEX_SESSIONS_DIR
    this.host = opts.host ?? null
    this.idPrefix = opts.idPrefix ?? ''
    this.remotePathFor = opts.remotePathFor
  }

  async discover(): Promise<DiscoveredSession[]> {
    const out: DiscoveredSession[] = []
    if (!fs.existsSync(this.rootDir)) return out

    const years = await readdirSafe(this.rootDir)
    for (const y of years) {
      if (!/^\d{4}$/.test(y)) continue
      const yDir = path.join(this.rootDir, y)
      const months = await readdirSafe(yDir)
      for (const m of months) {
        if (!/^\d{2}$/.test(m)) continue
        const mDir = path.join(yDir, m)
        const days = await readdirSafe(mDir)
        for (const d of days) {
          if (!/^\d{2}$/.test(d)) continue
          const dDir = path.join(mDir, d)
          const files = await readdirSafe(dDir)
          for (const f of files) {
            if (!f.startsWith('rollout-') || !f.endsWith('.jsonl')) continue
            const sourcePath = path.join(dDir, f)
            const id = deriveId(f)
            let stat: fs.Stats
            try {
              stat = await fsp.stat(sourcePath)
            } catch {
              continue
            }
            out.push({
              id: `${this.idPrefix}codex:${id}`,
              tool: this.toolName,
              sourcePath,
              // projectPath is populated on first read of session_meta.
              // For discovery we fall back to "(codex)" and let read() refine.
              projectPath: '(codex)',
              projectName: '(codex)',
              sourceMtimeMs: stat.mtimeMs,
              host: this.host,
              remoteSourcePath: this.remotePathFor ? this.remotePathFor(sourcePath) : null
            })
          }
        }
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
    let cacheReadTokens = 0
    let toolUseCount = 0
    let _cwd: string | null = null
    let _threadName: string | null = null

    let eventSeq = 0

    for await (const line of rl) {
      if (!line.trim()) continue
      let parsed: any
      try {
        parsed = JSON.parse(line)
      } catch {
        continue
      }
      eventSeq += 1
      const ts: string | null = typeof parsed.timestamp === 'string' ? parsed.timestamp : null
      if (ts) {
        if (!startedAt || ts < startedAt) startedAt = ts
        if (!endedAt || ts > endedAt) endedAt = ts
      }

      const wrapperType: string = parsed.type ?? 'other'
      const payload: any = parsed.payload ?? {}

      if (wrapperType === 'session_meta') {
        _cwd = typeof payload.cwd === 'string' ? payload.cwd : _cwd
        events.push({
          uuid: `${wrapperType}-${eventSeq}`,
          parentUuid: null,
          timestamp: ts,
          isSidechain: false,
          kind: 'system',
          content: [{ type: 'text', text: `Codex session opened in ${payload.cwd ?? '?'}` }],
          raw: parsed
        })
        continue
      }

      if (wrapperType === 'response_item') {
        const rType = payload.type
        if (rType === 'message') {
          const role = payload.role
          if (role === 'user' || role === 'assistant') {
            const content = codexMessageContent(payload.content)
            const kind: SessionEvent['kind'] = role
            events.push({
              uuid: `resp-${eventSeq}`,
              parentUuid: null,
              timestamp: ts,
              isSidechain: false,
              kind,
              content,
              raw: parsed
            })
            messageCount += 1
            for (const block of content) {
              if (block.type === 'text') {
                textChunks.push(block.text)
                if (!autoTitle && role === 'user' && block.text.trim()) {
                  autoTitle = firstLineTitle(block.text)
                }
              }
            }
          }
          continue
        }
        if (rType === 'reasoning') {
          const text = codexReasoningText(payload)
          if (text) textChunks.push(text)
          events.push({
            uuid: `reason-${eventSeq}`,
            parentUuid: null,
            timestamp: ts,
            isSidechain: false,
            kind: 'assistant',
            content: [{ type: 'thinking', thinking: text }],
            raw: parsed
          })
          continue
        }
        if (rType === 'function_call' || rType === 'custom_tool_call' || rType === 'web_search_call') {
          toolUseCount += 1
          const name =
            typeof payload.name === 'string'
              ? payload.name
              : rType === 'web_search_call'
                ? 'web_search'
                : 'tool'
          events.push({
            uuid: `call-${eventSeq}`,
            parentUuid: null,
            timestamp: ts,
            isSidechain: false,
            kind: 'assistant',
            content: [
              {
                type: 'tool_use',
                id: String(payload.call_id ?? payload.id ?? eventSeq),
                name,
                input: payload.arguments ?? payload.input ?? payload
              }
            ],
            raw: parsed
          })
          continue
        }
        if (rType === 'function_call_output' || rType === 'custom_tool_call_output') {
          events.push({
            uuid: `out-${eventSeq}`,
            parentUuid: null,
            timestamp: ts,
            isSidechain: false,
            kind: 'user',
            content: [
              {
                type: 'tool_result',
                tool_use_id: String(payload.call_id ?? payload.id ?? ''),
                content: payload.output ?? payload.content ?? payload,
                is_error: Boolean(payload.success === false)
              }
            ],
            raw: parsed
          })
          continue
        }
        // unknown response_item kind
        events.push({
          uuid: `resp-${eventSeq}`,
          parentUuid: null,
          timestamp: ts,
          isSidechain: false,
          kind: 'other',
          content: [{ type: 'unknown', raw: payload }],
          raw: parsed
        })
        continue
      }

      if (wrapperType === 'event_msg') {
        const eType = payload.type
        if (eType === 'token_count' && payload.info?.total_token_usage) {
          const u = payload.info.total_token_usage
          // total_token_usage is cumulative; last-writer wins.
          inputTokens = numOrZero(u.input_tokens)
          outputTokens = numOrZero(u.output_tokens) + numOrZero(u.reasoning_output_tokens)
          cacheReadTokens = numOrZero(u.cached_input_tokens)
          continue
        }
        if (eType === 'thread_name_updated') {
          const name = typeof payload.name === 'string' ? payload.name : null
          if (name) _threadName = name
          continue
        }
        // event_msg.user_message / agent_message are duplicates of response_item.message — skip.
        // task_started / task_complete / turn_aborted / etc — skip for rendering.
        continue
      }

      // Unknown wrapper type — stash under 'other' so nothing is silently dropped.
      events.push({
        uuid: `raw-${eventSeq}`,
        parentUuid: null,
        timestamp: ts,
        isSidechain: false,
        kind: 'other',
        content: [{ type: 'unknown', raw: parsed }],
        raw: parsed
      })
    }

    return {
      startedAt,
      endedAt,
      messageCount,
      autoTitle: _threadName ?? autoTitle,
      fullText: textChunks.join('\n\n'),
      inputTokens,
      outputTokens,
      cacheCreationTokens: 0,
      cacheReadTokens,
      toolUseCount,
      events,
      projectPath: _cwd,
      projectName: _cwd ? projectNameFromPath(_cwd) : null
    }
  }
}

// --- helpers ---

function codexMessageContent(content: unknown): ContentBlock[] {
  if (!Array.isArray(content)) return []
  const out: ContentBlock[] = []
  for (const item of content) {
    if (!item || typeof item !== 'object') continue
    const t = (item as any).type
    const text = (item as any).text
    if ((t === 'input_text' || t === 'output_text' || t === 'text') && typeof text === 'string') {
      out.push({ type: 'text', text })
    } else {
      out.push({ type: 'unknown', raw: item })
    }
  }
  return out
}

function codexReasoningText(payload: any): string {
  const content = payload.content
  if (Array.isArray(content)) {
    const parts: string[] = []
    for (const item of content) {
      if (!item || typeof item !== 'object') continue
      const t = (item as any).type
      if (t === 'summary_text' || t === 'reasoning_text' || t === 'text') {
        if (typeof (item as any).text === 'string') parts.push((item as any).text)
      }
    }
    if (parts.length) return parts.join('\n\n')
  }
  if (typeof payload.summary === 'string') return payload.summary
  return ''
}

function firstLineTitle(s: string): string {
  const line = s.split('\n').find((l) => l.trim()) ?? s
  return line.trim().slice(0, 120)
}

function deriveId(filename: string): string {
  // rollout-2026-04-17T21-19-26-019d9b98-a895-74e2-841c-e0fd5500d183.jsonl
  // UUID lives at the tail (5 dash-separated UUID segments).
  const base = filename.replace(/^rollout-/, '').replace(/\.jsonl$/, '')
  const parts = base.split('-')
  if (parts.length >= 5) {
    const uuid = parts.slice(-5).join('-')
    if (/^[0-9a-f-]{36}$/i.test(uuid)) return uuid
  }
  return base
}

async function readdirSafe(dir: string): Promise<string[]> {
  try {
    return await fsp.readdir(dir)
  } catch {
    return []
  }
}

function numOrZero(v: unknown): number {
  return typeof v === 'number' && Number.isFinite(v) ? v : 0
}
