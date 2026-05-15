import type { DB } from './db'
import type {
  DigestDoc,
  DigestInfo,
  DigestItem,
  DigestRef,
  DigestSection,
  DigestSectionKind,
  ToolName
} from '@shared/types'

export interface ParsedItem {
  itemId: string
  textMd: string
  refIds: string[]
}

export interface ParsedSection {
  sectionId: string
  ord: number
  heading: string
  kind: DigestSectionKind
  bodyMd: string
  items: ParsedItem[]
  refIds: string[]
}

interface SectionRow {
  date: string
  section_id: string
  ord: number
  heading: string
  kind: string
  body_md: string
  refined_at: string | null
}
interface ItemRow {
  date: string
  section_id: string
  item_id: string
  ord: number
  text_md: string
  refined_at: string | null
}
interface RefRow {
  date: string
  section_id: string
  item_id: string
  ref_id: string
  session_id: string
  event_uuid: string
  role: string
  timestamp: string
  project_name: string
  tool: string
  snippet: string
}
interface HistoryRow {
  date: string
  section_id: string
  item_id: string
  saved_at: string
  kind: string
  heading: string
  body_md: string
  items_json: string
  refs_json: string
}

const refRowToDigestRef = (r: RefRow): DigestRef => ({
  refId: r.ref_id,
  sessionId: r.session_id,
  eventUuid: r.event_uuid,
  role: r.role === 'USER' ? 'USER' : 'ASSISTANT',
  timestamp: r.timestamp,
  projectName: r.project_name,
  tool: r.tool as ToolName,
  snippet: r.snippet
})

export function hasStructuredDigest(db: DB, date: string): boolean {
  const r = db
    .prepare('SELECT 1 AS x FROM digest_sections WHERE date = ? LIMIT 1')
    .get(date) as { x: number } | undefined
  return Boolean(r)
}

export function writeStructuredDigest(
  db: DB,
  date: string,
  sections: ParsedSection[],
  references: DigestRef[]
): void {
  const refByRefId = new Map(references.map((r) => [r.refId, r]))

  const tx = db.transaction(() => {
    db.prepare('DELETE FROM digest_refs WHERE date = ?').run(date)
    db.prepare('DELETE FROM digest_items WHERE date = ?').run(date)
    db.prepare('DELETE FROM digest_sections WHERE date = ?').run(date)
    db.prepare('DELETE FROM digest_section_history WHERE date = ?').run(date)

    const insSection = db.prepare(
      `INSERT INTO digest_sections (date, section_id, ord, heading, kind, body_md, refined_at)
       VALUES (?, ?, ?, ?, ?, ?, NULL)`
    )
    const insItem = db.prepare(
      `INSERT INTO digest_items (date, section_id, item_id, ord, text_md, refined_at)
       VALUES (?, ?, ?, ?, ?, NULL)`
    )
    const insRef = db.prepare(
      `INSERT INTO digest_refs
       (date, section_id, item_id, ref_id, session_id, event_uuid, role, timestamp, project_name, tool, snippet)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
    )

    for (const sec of sections) {
      insSection.run(date, sec.sectionId, sec.ord, sec.heading, sec.kind, sec.bodyMd)

      for (const refId of sec.refIds) {
        const ref = refByRefId.get(refId)
        if (!ref) continue
        insRef.run(
          date,
          sec.sectionId,
          '',
          ref.refId,
          ref.sessionId,
          ref.eventUuid,
          ref.role,
          ref.timestamp,
          ref.projectName,
          ref.tool,
          ref.snippet
        )
      }

      for (let i = 0; i < sec.items.length; i++) {
        const it = sec.items[i]
        insItem.run(date, sec.sectionId, it.itemId, i, it.textMd)
        for (const refId of it.refIds) {
          const ref = refByRefId.get(refId)
          if (!ref) continue
          insRef.run(
            date,
            sec.sectionId,
            it.itemId,
            ref.refId,
            ref.sessionId,
            ref.eventUuid,
            ref.role,
            ref.timestamp,
            ref.projectName,
            ref.tool,
            ref.snippet
          )
        }
      }
    }
  })

  tx()
}

export function readDigestDoc(db: DB, info: DigestInfo): DigestDoc {
  const date = info.date
  const sectionRows = db
    .prepare(
      `SELECT date, section_id, ord, heading, kind, body_md, refined_at
       FROM digest_sections WHERE date = ? ORDER BY ord ASC`
    )
    .all(date) as SectionRow[]

  if (sectionRows.length === 0) {
    return { info, sections: [], structured: false }
  }

  const itemRows = db
    .prepare(
      `SELECT date, section_id, item_id, ord, text_md, refined_at
       FROM digest_items WHERE date = ? ORDER BY section_id, ord ASC`
    )
    .all(date) as ItemRow[]
  const refRows = db
    .prepare(
      `SELECT date, section_id, item_id, ref_id, session_id, event_uuid, role,
              timestamp, project_name, tool, snippet
       FROM digest_refs WHERE date = ? ORDER BY ref_id ASC`
    )
    .all(date) as RefRow[]
  const historyRows = db
    .prepare(
      `SELECT date, section_id, item_id, COUNT(*) as n
       FROM digest_section_history WHERE date = ?
       GROUP BY section_id, item_id`
    )
    .all(date) as { section_id: string; item_id: string; n: number }[]
  const histKey = (s: string, i: string): string => `${s}::${i}`
  const historyCount = new Map<string, number>()
  for (const h of historyRows) historyCount.set(histKey(h.section_id, h.item_id), h.n)

  const itemsBySection = new Map<string, ItemRow[]>()
  for (const ir of itemRows) {
    const arr = itemsBySection.get(ir.section_id) ?? []
    arr.push(ir)
    itemsBySection.set(ir.section_id, arr)
  }

  const sectionRefs = new Map<string, RefRow[]>()
  const itemRefs = new Map<string, RefRow[]>()
  for (const r of refRows) {
    if (r.item_id === '') {
      const arr = sectionRefs.get(r.section_id) ?? []
      arr.push(r)
      sectionRefs.set(r.section_id, arr)
    } else {
      const k = `${r.section_id}::${r.item_id}`
      const arr = itemRefs.get(k) ?? []
      arr.push(r)
      itemRefs.set(k, arr)
    }
  }

  const sections: DigestSection[] = sectionRows.map((sr) => {
    const items: DigestItem[] = (itemsBySection.get(sr.section_id) ?? []).map((ir) => ({
      itemId: ir.item_id,
      textMd: ir.text_md,
      refs: (itemRefs.get(`${sr.section_id}::${ir.item_id}`) ?? []).map(refRowToDigestRef),
      refinedAt: ir.refined_at
    }))
    return {
      sectionId: sr.section_id,
      heading: sr.heading,
      kind: (sr.kind as DigestSectionKind) ?? 'paragraph',
      bodyMd: sr.body_md,
      items,
      refs: (sectionRefs.get(sr.section_id) ?? []).map(refRowToDigestRef),
      refinedAt: sr.refined_at,
      hasHistory:
        (historyCount.get(histKey(sr.section_id, '')) ?? 0) > 0 ||
        items.some((it) => (historyCount.get(histKey(sr.section_id, it.itemId)) ?? 0) > 0)
    }
  })

  return { info, sections, structured: true }
}

export function getSection(db: DB, date: string, sectionId: string): DigestSection | null {
  const sr = db
    .prepare(
      `SELECT date, section_id, ord, heading, kind, body_md, refined_at
       FROM digest_sections WHERE date = ? AND section_id = ?`
    )
    .get(date, sectionId) as SectionRow | undefined
  if (!sr) return null
  const items = (
    db
      .prepare(
        `SELECT date, section_id, item_id, ord, text_md, refined_at
         FROM digest_items WHERE date = ? AND section_id = ? ORDER BY ord ASC`
      )
      .all(date, sectionId) as ItemRow[]
  ).map((ir) => ({
    itemId: ir.item_id,
    textMd: ir.text_md,
    refs: getRefs(db, date, sectionId, ir.item_id),
    refinedAt: ir.refined_at
  }))

  return {
    sectionId: sr.section_id,
    heading: sr.heading,
    kind: (sr.kind as DigestSectionKind) ?? 'paragraph',
    bodyMd: sr.body_md,
    items,
    refs: getRefs(db, date, sectionId, ''),
    refinedAt: sr.refined_at,
    hasHistory: countHistory(db, date, sectionId, '') > 0 ||
      items.some((it) => countHistory(db, date, sectionId, it.itemId) > 0)
  }
}

export function getRefs(db: DB, date: string, sectionId: string, itemId: string): DigestRef[] {
  return (
    db
      .prepare(
        `SELECT * FROM digest_refs
         WHERE date = ? AND section_id = ? AND item_id = ? ORDER BY ref_id ASC`
      )
      .all(date, sectionId, itemId) as RefRow[]
  ).map(refRowToDigestRef)
}

function countHistory(db: DB, date: string, sectionId: string, itemId: string): number {
  const r = db
    .prepare(
      `SELECT COUNT(*) AS n FROM digest_section_history
       WHERE date = ? AND section_id = ? AND item_id = ?`
    )
    .get(date, sectionId, itemId) as { n: number }
  return r.n
}

/** Snapshot the current section/item before a refine, so we can revert later. */
export function pushHistory(
  db: DB,
  date: string,
  sectionId: string,
  itemId: string
): void {
  const sr = db
    .prepare(
      `SELECT kind, heading, body_md FROM digest_sections WHERE date = ? AND section_id = ?`
    )
    .get(date, sectionId) as { kind: string; heading: string; body_md: string } | undefined
  if (!sr) return

  let bodyMd = sr.body_md
  let itemsJson = '[]'
  if (itemId) {
    const it = db
      .prepare(
        `SELECT text_md FROM digest_items WHERE date = ? AND section_id = ? AND item_id = ?`
      )
      .get(date, sectionId, itemId) as { text_md: string } | undefined
    if (!it) return
    bodyMd = it.text_md
  } else {
    const items = db
      .prepare(
        `SELECT item_id, ord, text_md FROM digest_items WHERE date = ? AND section_id = ? ORDER BY ord`
      )
      .all(date, sectionId)
    itemsJson = JSON.stringify(items)
  }

  const refs = db
    .prepare(`SELECT * FROM digest_refs WHERE date = ? AND section_id = ? AND item_id = ?`)
    .all(date, sectionId, itemId)

  db.prepare(
    `INSERT INTO digest_section_history
     (date, section_id, item_id, saved_at, kind, heading, body_md, items_json, refs_json)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`
  ).run(
    date,
    sectionId,
    itemId,
    new Date().toISOString(),
    sr.kind,
    sr.heading,
    bodyMd,
    itemsJson,
    JSON.stringify(refs)
  )
}

/** Pop most recent history entry and write it back over the current row. Returns true if reverted. */
export function popHistory(
  db: DB,
  date: string,
  sectionId: string,
  itemId: string
): boolean {
  const row = db
    .prepare(
      `SELECT * FROM digest_section_history
       WHERE date = ? AND section_id = ? AND item_id = ?
       ORDER BY saved_at DESC LIMIT 1`
    )
    .get(date, sectionId, itemId) as HistoryRow | undefined
  if (!row) return false

  const tx = db.transaction(() => {
    if (itemId) {
      db.prepare(
        `UPDATE digest_items SET text_md = ?, refined_at = NULL
         WHERE date = ? AND section_id = ? AND item_id = ?`
      ).run(row.body_md, date, sectionId, itemId)
    } else {
      db.prepare(
        `UPDATE digest_sections SET body_md = ?, refined_at = NULL, kind = ?, heading = ?
         WHERE date = ? AND section_id = ?`
      ).run(row.body_md, row.kind, row.heading, date, sectionId)

      const items = JSON.parse(row.items_json) as { item_id: string; ord: number; text_md: string }[]
      db.prepare(
        `DELETE FROM digest_items WHERE date = ? AND section_id = ?`
      ).run(date, sectionId)
      const ins = db.prepare(
        `INSERT INTO digest_items (date, section_id, item_id, ord, text_md, refined_at)
         VALUES (?, ?, ?, ?, ?, NULL)`
      )
      for (const it of items) ins.run(date, sectionId, it.item_id, it.ord, it.text_md)
    }

    const refs = JSON.parse(row.refs_json) as RefRow[]
    db.prepare(
      `DELETE FROM digest_refs WHERE date = ? AND section_id = ? AND item_id = ?`
    ).run(date, sectionId, itemId)
    const insRef = db.prepare(
      `INSERT INTO digest_refs
       (date, section_id, item_id, ref_id, session_id, event_uuid, role, timestamp, project_name, tool, snippet)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
    )
    for (const r of refs) {
      insRef.run(
        date, sectionId, itemId, r.ref_id, r.session_id, r.event_uuid,
        r.role, r.timestamp, r.project_name, r.tool, r.snippet
      )
    }

    db.prepare(
      `DELETE FROM digest_section_history
       WHERE date = ? AND section_id = ? AND item_id = ? AND saved_at = ?`
    ).run(date, sectionId, itemId, row.saved_at)
  })
  tx()
  return true
}

export function updateSectionContent(
  db: DB,
  date: string,
  sectionId: string,
  bodyMd: string,
  kind: DigestSectionKind,
  items: { itemId: string; textMd: string }[],
  refs: DigestRef[]
): void {
  const refinedAt = new Date().toISOString()
  const tx = db.transaction(() => {
    db.prepare(
      `UPDATE digest_sections SET body_md = ?, kind = ?, refined_at = ? WHERE date = ? AND section_id = ?`
    ).run(bodyMd, kind, refinedAt, date, sectionId)

    db.prepare(`DELETE FROM digest_items WHERE date = ? AND section_id = ?`).run(date, sectionId)
    db.prepare(`DELETE FROM digest_refs WHERE date = ? AND section_id = ?`).run(date, sectionId)

    const insItem = db.prepare(
      `INSERT INTO digest_items (date, section_id, item_id, ord, text_md, refined_at) VALUES (?, ?, ?, ?, ?, NULL)`
    )
    items.forEach((it, i) => insItem.run(date, sectionId, it.itemId, i, it.textMd))

    const insRef = db.prepare(
      `INSERT INTO digest_refs
       (date, section_id, item_id, ref_id, session_id, event_uuid, role, timestamp, project_name, tool, snippet)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
    )
    for (const r of refs) {
      insRef.run(
        date, sectionId, '', r.refId, r.sessionId, r.eventUuid,
        r.role, r.timestamp, r.projectName, r.tool, r.snippet
      )
    }
  })
  tx()
}

export function updateItemContent(
  db: DB,
  date: string,
  sectionId: string,
  itemId: string,
  textMd: string,
  refs: DigestRef[]
): void {
  const refinedAt = new Date().toISOString()
  const tx = db.transaction(() => {
    db.prepare(
      `UPDATE digest_items SET text_md = ?, refined_at = ?
       WHERE date = ? AND section_id = ? AND item_id = ?`
    ).run(textMd, refinedAt, date, sectionId, itemId)

    db.prepare(
      `DELETE FROM digest_refs WHERE date = ? AND section_id = ? AND item_id = ?`
    ).run(date, sectionId, itemId)
    const insRef = db.prepare(
      `INSERT INTO digest_refs
       (date, section_id, item_id, ref_id, session_id, event_uuid, role, timestamp, project_name, tool, snippet)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
    )
    for (const r of refs) {
      insRef.run(
        date, sectionId, itemId, r.refId, r.sessionId, r.eventUuid,
        r.role, r.timestamp, r.projectName, r.tool, r.snippet
      )
    }
  })
  tx()
}
