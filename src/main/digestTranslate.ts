import type { DB } from './db'
import type {
  AvailableTranslation,
  DigestDoc,
  DigestSection
} from '@shared/types'
import { DIGEST_LANGUAGES } from '@shared/types'
import { loadSettings } from './settings'
import { callProvider, getDigestDoc } from './digest'

const TRANSLATE_SYSTEM = `You translate diary entries between languages while preserving meaning, tone, and markdown formatting precisely.

Rules:
- Translate ONLY the values you are given. Do not summarize, expand, reorder, or add content.
- Preserve markdown syntax exactly: bullet markers, **bold**, *italic*, \`code\`, links [x](y), backticks.
- Do NOT translate inline code, file paths, identifiers, command names, or technical tokens that look like code.
- Do NOT translate the section "id" or item "id" fields — keep them as-is.
- Output ONLY a JSON object with the exact same shape as the input. No prose, no code fences.`

interface TranslatableSection {
  id: string
  heading: string
  bodyMd: string
  items: { id: string; textMd: string }[]
}

interface TranslatablePayload {
  lang: string
  sections: TranslatableSection[]
}

export async function getTranslatedDigest(
  db: DB,
  date: string,
  lang: string
): Promise<DigestDoc> {
  const source = await getDigestDoc(db, date)
  if (!lang || lang === 'source') return source

  if (!isKnownLanguage(lang)) {
    throw new Error(`Unsupported language: ${lang}`)
  }

  const cached = db
    .prepare(
      `SELECT doc_json, source_generated_at, translated_at
       FROM digest_translations WHERE date = ? AND lang = ?`
    )
    .get(date, lang) as
    | { doc_json: string; source_generated_at: string; translated_at: string }
    | undefined

  if (cached && cached.source_generated_at === source.info.generatedAt) {
    const translated = JSON.parse(cached.doc_json) as TranslatableSection[]
    return mergeTranslation(source, translated)
  }

  // Cache miss or stale — call the provider.
  const payload = buildPayload(source, lang)
  const settings = loadSettings()
  const provider = settings.translateProvider ?? settings.digestProvider
  const model =
    provider === 'claude-cli'
      ? settings.translateClaudeCliModel
      : provider === 'anthropic-api'
        ? settings.translateAnthropicModel
        : settings.translateOpenaiModel
  const text = await callProvider(
    settings,
    TRANSLATE_SYSTEM,
    buildUserPrompt(payload),
    {
      jsonMode: true,
      overrides: { provider, model: model || undefined }
    }
  )
  const parsed = parseTranslationResponse(text)
  if (!parsed) {
    throw new Error('Could not parse translation response — try a different provider.')
  }

  const merged = mergeTranslation(source, parsed)
  db.prepare(
    `INSERT OR REPLACE INTO digest_translations
     (date, lang, doc_json, source_generated_at, translated_at)
     VALUES (?, ?, ?, ?, ?)`
  ).run(
    date,
    lang,
    JSON.stringify(parsed),
    source.info.generatedAt,
    new Date().toISOString()
  )
  return merged
}

export function listAvailableTranslations(
  db: DB,
  date: string
): AvailableTranslation[] {
  const sourceGen = db
    .prepare('SELECT generated_at FROM digests WHERE date = ?')
    .get(date) as { generated_at?: string } | undefined
  if (!sourceGen?.generated_at) return []

  const rows = db
    .prepare(
      `SELECT lang, source_generated_at, translated_at
       FROM digest_translations WHERE date = ?`
    )
    .all(date) as { lang: string; source_generated_at: string; translated_at: string }[]

  return rows.map((r) => ({
    lang: r.lang,
    translatedAt: r.translated_at,
    isStale: r.source_generated_at !== sourceGen.generated_at
  }))
}

export function invalidateTranslations(db: DB, date: string): void {
  db.prepare('DELETE FROM digest_translations WHERE date = ?').run(date)
}

// --- helpers ---

function isKnownLanguage(code: string): boolean {
  return DIGEST_LANGUAGES.some((l) => l.code === code && l.code !== '')
}

function buildPayload(source: DigestDoc, lang: string): TranslatablePayload {
  return {
    lang,
    sections: source.sections.map((s) => ({
      id: s.sectionId,
      heading: s.heading,
      bodyMd: s.bodyMd,
      items: s.items.map((it) => ({ id: it.itemId, textMd: it.textMd }))
    }))
  }
}

function buildUserPrompt(payload: TranslatablePayload): string {
  const target = DIGEST_LANGUAGES.find((l) => l.code === payload.lang)
  const targetLabel = target ? target.label : payload.lang
  return `Target language: ${targetLabel} (${payload.lang}).

Translate the values of "heading", "bodyMd", and each item's "textMd" into ${targetLabel}.
Keep all "id" fields exactly as given.
Return ONE JSON object with the same shape as the input below.

INPUT:
${JSON.stringify(payload, null, 2)}

OUTPUT SHAPE (translated):
{ "lang": "${payload.lang}", "sections": [ { "id": "...", "heading": "<translated>", "bodyMd": "<translated md>", "items": [ { "id": "...", "textMd": "<translated md>" } ] } ] }`
}

function parseTranslationResponse(text: string): TranslatableSection[] | null {
  if (!text) return null
  let s = text.trim().replace(/^```(?:json)?\s*/i, '').replace(/```\s*$/i, '').trim()
  if (!s.startsWith('{')) {
    const start = s.indexOf('{')
    const end = s.lastIndexOf('}')
    if (start === -1 || end === -1 || end <= start) return null
    s = s.slice(start, end + 1)
  }
  try {
    const obj = JSON.parse(s) as { sections?: unknown }
    if (!Array.isArray(obj.sections)) return null
    const out: TranslatableSection[] = []
    for (const raw of obj.sections) {
      if (!raw || typeof raw !== 'object') return null
      const sec = raw as Record<string, unknown>
      if (typeof sec.id !== 'string' || typeof sec.heading !== 'string' || typeof sec.bodyMd !== 'string') {
        return null
      }
      const items: { id: string; textMd: string }[] = []
      const rawItems = Array.isArray(sec.items) ? sec.items : []
      for (const r of rawItems) {
        if (!r || typeof r !== 'object') return null
        const it = r as Record<string, unknown>
        if (typeof it.id !== 'string' || typeof it.textMd !== 'string') return null
        items.push({ id: it.id, textMd: it.textMd })
      }
      out.push({ id: sec.id, heading: sec.heading, bodyMd: sec.bodyMd, items })
    }
    return out
  } catch {
    return null
  }
}

/**
 * Overlay translated text onto the source DigestDoc, preserving structural metadata
 * (refs, kind, refinedAt, hasHistory). Sections/items missing from the translation
 * fall back to the source — the renderer never sees holes.
 */
function mergeTranslation(
  source: DigestDoc,
  translated: TranslatableSection[]
): DigestDoc {
  const byId = new Map(translated.map((t) => [t.id, t]))
  const sections: DigestSection[] = source.sections.map((s) => {
    const t = byId.get(s.sectionId)
    if (!t) return s
    const itemById = new Map(t.items.map((it) => [it.id, it]))
    return {
      ...s,
      heading: t.heading,
      bodyMd: t.bodyMd,
      items: s.items.map((it) => {
        const ti = itemById.get(it.itemId)
        return ti ? { ...it, textMd: ti.textMd } : it
      })
    }
  })
  return { ...source, sections }
}
