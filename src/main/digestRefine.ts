import type { DB } from './db'
import type {
  DigestRef,
  DigestSection,
  RefineDigestArgs
} from '@shared/types'
import { formatHM } from '@shared/datetime'
import { loadSettings } from './settings'
import {
  callProvider,
  listDigestTimeline,
  renderSectionBodyMd,
  rewriteDigestFile,
  SYSTEM_PROMPT
} from './digest'
import {
  getRefs,
  getSection,
  popHistory,
  pushHistory,
  updateItemContent,
  updateSectionContent
} from './digestStore'

const REFINE_SYSTEM = `${SYSTEM_PROMPT}

You are refining ONE part of an already-written diary entry. Stay in voice. Respect the user's instruction precisely. Cite the references you actually used.`

export async function refineDigestSection(
  db: DB,
  args: RefineDigestArgs
): Promise<DigestSection> {
  const { date, sectionId, itemId, userPrompt, refIds } = args

  const section = getSection(db, date, sectionId)
  if (!section) throw new Error(`No section ${sectionId} for ${date}`)

  // Resolve full ref objects for the chosen IDs. We trust IDs that already attach to this
  // section/item, plus any from the day's full timeline (for the "add reference" picker).
  const attached = itemId
    ? section.items.find((it) => it.itemId === itemId)?.refs ?? []
    : section.refs
  const knownById = new Map<string, DigestRef>()
  for (const r of attached) knownById.set(r.refId, r)

  const missing = refIds.filter((id) => !knownById.has(id))
  if (missing.length > 0) {
    const timeline = await listDigestTimeline(db, date)
    for (const r of timeline) {
      if (refIds.includes(r.refId) && !knownById.has(r.refId)) knownById.set(r.refId, r)
    }
  }

  const chosenRefs = refIds.map((id) => knownById.get(id)).filter(Boolean) as DigestRef[]
  if (chosenRefs.length === 0 && refIds.length > 0) {
    throw new Error('Selected references not found.')
  }

  const isItem = Boolean(itemId)
  const targetText = itemId
    ? section.items.find((it) => it.itemId === itemId)?.textMd ?? ''
    : section.bodyMd

  const prompt = buildRefinePrompt({
    sectionHeading: section.heading,
    sectionKind: section.kind,
    isItem,
    currentText: targetText,
    refs: chosenRefs,
    userInstruction: userPrompt.trim()
  })

  const settings = loadSettings()
  const text = await callProvider(settings, REFINE_SYSTEM, prompt, { jsonMode: true })
  const parsed = parseRefineResponse(text)
  if (!parsed) {
    throw new Error('Could not parse refine response — try a different provider or simpler instruction.')
  }

  const newRefIds = (parsed.refs ?? []).filter((r) => knownById.has(r))
  const newRefs = newRefIds.map((id) => knownById.get(id)!).filter(Boolean)

  // Snapshot before mutating so revert works.
  pushHistory(db, date, sectionId, itemId ?? '')

  if (isItem && itemId) {
    updateItemContent(db, date, sectionId, itemId, parsed.text.trim(), newRefs)
    const refreshed = getSection(db, date, sectionId)
    if (refreshed) {
      db.prepare(
        `UPDATE digest_sections SET body_md = ? WHERE date = ? AND section_id = ?`
      ).run(rebuildSectionBody(refreshed), date, sectionId)
    }
  } else {
    // Whole-section refine: re-parse bullets from the new text if the section is bullet-shaped.
    const items = sectionTextToItems(section.kind, parsed.text)
    const bodyMd = renderSectionBodyMd(section.kind, items.body, items.items.map((it) => ({ textMd: it.textMd })))
    updateSectionContent(db, date, sectionId, bodyMd, section.kind, items.items, newRefs)
  }

  await rewriteDigestFile(db, date)
  db.prepare('DELETE FROM digest_translations WHERE date = ?').run(date)
  const updated = getSection(db, date, sectionId)
  if (!updated) throw new Error('Section disappeared after refine')
  return updated
}

export async function revertDigestRefine(
  db: DB,
  date: string,
  sectionId: string,
  itemId?: string
): Promise<DigestSection> {
  const popped = popHistory(db, date, sectionId, itemId ?? '')
  if (!popped) throw new Error('Nothing to revert.')
  // After popping an item, recompute section body.
  if (itemId) {
    const refreshed = getSection(db, date, sectionId)
    if (refreshed) {
      db.prepare(
        `UPDATE digest_sections SET body_md = ? WHERE date = ? AND section_id = ?`
      ).run(rebuildSectionBody(refreshed), date, sectionId)
    }
  }
  await rewriteDigestFile(db, date)
  db.prepare('DELETE FROM digest_translations WHERE date = ?').run(date)
  const sec = getSection(db, date, sectionId)
  if (!sec) throw new Error('Section disappeared after revert')
  return sec
}

// --- helpers ---

interface RefinePromptArgs {
  sectionHeading: string
  sectionKind: 'bullets' | 'paragraph' | 'mixed'
  isItem: boolean
  currentText: string
  refs: DigestRef[]
  userInstruction: string
}

function buildRefinePrompt(args: RefinePromptArgs): string {
  const { sectionHeading, sectionKind, isItem, currentText, refs, userInstruction } = args

  const refsBlock = refs.length
    ? refs
        .map(
          (r) =>
            `[${r.refId}] [${formatHM(r.timestamp)}] [${r.tool}] ${r.projectName} :: ${r.role}:\n${r.snippet}`
        )
        .join('\n\n')
    : '(no references provided)'

  const target = isItem
    ? `one bullet/item inside the "${sectionHeading}" section`
    : `the entire "${sectionHeading}" section (kind: ${sectionKind})`

  const shape = isItem
    ? `Output JSON: { "text": "<rewritten bullet — plain markdown, NO leading dash>", "refs": ["R3","R7"] }`
    : sectionKind === 'paragraph'
      ? `Output JSON: { "text": "<rewritten paragraph in plain markdown>", "refs": ["R..."] }`
      : sectionKind === 'bullets'
        ? `Output JSON: { "text": "<rewritten section as a markdown bullet list, each line starting with '- '>", "refs": ["R..."] }`
        : `Output JSON: { "text": "<rewritten section in plain markdown — bullets prefixed '- ', then any narrative below>", "refs": ["R..."] }`

  return `You are refining ${target}.

CURRENT TEXT:
"""
${currentText}
"""

REFERENCES (cite by [Rx] inline only if it strengthens the text — usually leave inline citations out):
${refsBlock}

USER INSTRUCTION:
${userInstruction || '(no instruction — tighten and improve)'}

${shape}

Rules:
- Respond with ONE JSON object only — no prose, no code fences.
- "refs" is the list of [Rx] IDs you actually drew from. Use only IDs from the REFERENCES block above.
- Stay concrete and concise. No filler. Match the diary voice.`
}

interface RefineResponse {
  text: string
  refs?: string[]
}

export function parseRefineResponse(text: string): RefineResponse | null {
  if (!text) return null
  let s = text.trim().replace(/^```(?:json)?\s*/i, '').replace(/```\s*$/i, '').trim()
  if (!s.startsWith('{')) {
    const start = s.indexOf('{')
    const end = s.lastIndexOf('}')
    if (start === -1 || end === -1 || end <= start) return null
    s = s.slice(start, end + 1)
  }
  try {
    const obj = JSON.parse(s) as { text?: unknown; refs?: unknown }
    if (typeof obj.text !== 'string') return null
    const refs = Array.isArray(obj.refs)
      ? obj.refs.filter((r): r is string => typeof r === 'string')
      : []
    return { text: obj.text, refs }
  } catch {
    return null
  }
}

function sectionTextToItems(
  kind: 'bullets' | 'paragraph' | 'mixed',
  text: string
): { items: { itemId: string; textMd: string }[]; body: string } {
  if (kind === 'paragraph') return { items: [], body: text.trim() }
  const lines = text.split(/\r?\n/)
  const itemLines: string[] = []
  const bodyLines: string[] = []
  for (const l of lines) {
    if (/^\s*[-*]\s+/.test(l)) itemLines.push(l.replace(/^\s*[-*]\s+/, '').trim())
    else if (l.trim()) bodyLines.push(l)
  }
  // If bullets-kind but the model returned no bullets (e.g. it ignored the rule),
  // split by newline as a fallback so we still have items.
  if (kind === 'bullets' && itemLines.length === 0) {
    for (const l of bodyLines) itemLines.push(l.trim())
  }
  const items = itemLines.map((t, i) => ({ itemId: `i${i + 1}`, textMd: t }))
  const body = kind === 'bullets' ? '' : bodyLines.join('\n').trim()
  return { items, body }
}

function rebuildSectionBody(section: DigestSection): string {
  if (section.kind === 'paragraph') return section.bodyMd
  if (section.kind === 'bullets') {
    return section.items.map((it) => `- ${it.textMd}`).join('\n')
  }
  // mixed: bullets above, narrative below. We don't have the narrative tail
  // separated from the merged bodyMd, so derive it by stripping bullet lines.
  const lines = section.bodyMd.split(/\r?\n/)
  const tail = lines.filter((l) => l.trim() && !/^\s*[-*]\s+/.test(l)).join('\n').trim()
  const bullets = section.items.map((it) => `- ${it.textMd}`).join('\n')
  if (!tail) return bullets
  return `${bullets}\n\n${tail}`
}

