import fs from 'node:fs'
import fsp from 'node:fs/promises'
import path from 'node:path'
import readline from 'node:readline'
import { EDITS_DIR } from '@shared/paths'

export const LIVE_WINDOW_MS = 10 * 60 * 1000

export function isLive(sourcePath: string): boolean {
  try {
    const stat = fs.statSync(sourcePath)
    return Date.now() - stat.mtimeMs < LIVE_WINDOW_MS
  } catch {
    return false
  }
}

export function editDirFor(sessionId: string): string {
  return path.join(EDITS_DIR, sessionId)
}

export function editedPathFor(sessionId: string): string {
  return path.join(editDirFor(sessionId), 'edited.jsonl')
}

export function originalCopyFor(sessionId: string): string {
  return path.join(editDirFor(sessionId), 'original.jsonl')
}

export async function ensureEditCopy(sessionId: string, sourcePath: string): Promise<string> {
  const dir = editDirFor(sessionId)
  await fsp.mkdir(dir, { recursive: true })
  const edited = editedPathFor(sessionId)
  const original = originalCopyFor(sessionId)
  if (!fs.existsSync(edited)) {
    await fsp.copyFile(sourcePath, original)
    await fsp.copyFile(sourcePath, edited)
  }
  return edited
}

export async function revertEdits(sessionId: string): Promise<void> {
  const dir = editDirFor(sessionId)
  if (fs.existsSync(dir)) await fsp.rm(dir, { recursive: true, force: true })
}

/**
 * Rewrite a JSONL file by streaming lines and applying a transform to each parsed object.
 * If transform returns null, the line is dropped.
 */
export async function transformJsonl(
  filePath: string,
  transform: (obj: any) => any | null
): Promise<void> {
  const tmp = filePath + '.tmp'
  const input = fs.createReadStream(filePath, { encoding: 'utf8' })
  const rl = readline.createInterface({ input, crlfDelay: Infinity })
  const output = fs.createWriteStream(tmp, { encoding: 'utf8' })

  for await (const line of rl) {
    if (!line.trim()) continue
    let obj: any
    try {
      obj = JSON.parse(line)
    } catch {
      output.write(line + '\n')
      continue
    }
    const next = transform(obj)
    if (next == null) continue
    output.write(JSON.stringify(next) + '\n')
  }
  output.end()
  await new Promise<void>((resolve, reject) => {
    output.on('finish', () => resolve())
    output.on('error', reject)
  })
  await fsp.rename(tmp, filePath)
}

export function matchesEvent(obj: any, eventUuid: string): boolean {
  return obj?.uuid === eventUuid || obj?.messageId === eventUuid
}

export function replaceTextInMessage(obj: any, newText: string): any {
  if (!obj?.message) return obj
  const content = obj.message.content
  if (typeof content === 'string') {
    return { ...obj, message: { ...obj.message, content: newText } }
  }
  if (Array.isArray(content)) {
    let replaced = false
    const next = content.map((block: any) => {
      if (!replaced && block && block.type === 'text') {
        replaced = true
        return { ...block, text: newText }
      }
      return block
    })
    if (!replaced) next.unshift({ type: 'text', text: newText })
    return { ...obj, message: { ...obj.message, content: next } }
  }
  return { ...obj, message: { ...obj.message, content: newText } }
}
