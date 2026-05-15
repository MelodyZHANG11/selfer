import Database from 'better-sqlite3'
import { DB_PATH } from '@shared/paths'

export type DB = Database.Database

export function openDb(): DB {
  const db = new Database(DB_PATH)
  db.pragma('journal_mode = WAL')
  db.pragma('synchronous = NORMAL')
  db.pragma('foreign_keys = ON')
  return db
}

// Timestamp storage contract:
//   *_at / timestamp / source_generated_at / translated_at / saved_at / refined_at
//     → ISO 8601 in UTC (suffix `Z`). Always produced via `new Date().toISOString()`
//       or copied verbatim from adapter JSONL (Claude Code / Codex also write UTC `Z`).
//   date (on `digests`, `digest_sections`, `digest_items`, `digest_refs`,
//         `digest_section_history`, `digest_translations`)
//     → `YYYY-MM-DD` in the app's LOCAL calendar — the user's notion of "today",
//       not a UTC date. See digest.localDayWindow / digest.todayLocalISODate.
//   *_mtime_ms / *_tokens / *_count → integers, timezone-agnostic.
// Display-side conversion to local time happens in src/shared/datetime.ts.
export function migrate(db: DB): void {
  db.exec(`
    CREATE TABLE IF NOT EXISTS sessions (
      id TEXT PRIMARY KEY,
      tool TEXT NOT NULL,
      project_path TEXT NOT NULL,
      project_name TEXT NOT NULL,
      source_path TEXT NOT NULL,
      edited_path TEXT,
      started_at TEXT,
      ended_at TEXT,
      message_count INTEGER NOT NULL DEFAULT 0,
      auto_title TEXT,
      custom_name TEXT,
      source_mtime_ms INTEGER NOT NULL DEFAULT 0,
      input_tokens INTEGER NOT NULL DEFAULT 0,
      output_tokens INTEGER NOT NULL DEFAULT 0,
      cache_creation_tokens INTEGER NOT NULL DEFAULT 0,
      cache_read_tokens INTEGER NOT NULL DEFAULT 0,
      tool_use_count INTEGER NOT NULL DEFAULT 0
    );
    CREATE INDEX IF NOT EXISTS sessions_by_project ON sessions(project_path);
    CREATE INDEX IF NOT EXISTS sessions_by_started ON sessions(started_at DESC);

    CREATE TABLE IF NOT EXISTS tags (
      session_id TEXT NOT NULL REFERENCES sessions(id) ON DELETE CASCADE,
      tag TEXT NOT NULL,
      PRIMARY KEY (session_id, tag)
    );
    CREATE INDEX IF NOT EXISTS tags_by_tag ON tags(tag);

    CREATE VIRTUAL TABLE IF NOT EXISTS session_fts USING fts5(
      session_id UNINDEXED,
      body,
      tokenize = 'porter unicode61'
    );

    CREATE TABLE IF NOT EXISTS digests (
      date TEXT PRIMARY KEY,
      path TEXT NOT NULL,
      generated_at TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS digest_sections (
      date       TEXT NOT NULL,
      section_id TEXT NOT NULL,
      ord        INTEGER NOT NULL,
      heading    TEXT NOT NULL,
      kind       TEXT NOT NULL,
      body_md    TEXT NOT NULL,
      refined_at TEXT,
      PRIMARY KEY (date, section_id),
      FOREIGN KEY (date) REFERENCES digests(date) ON DELETE CASCADE
    );

    CREATE TABLE IF NOT EXISTS digest_items (
      date       TEXT NOT NULL,
      section_id TEXT NOT NULL,
      item_id    TEXT NOT NULL,
      ord        INTEGER NOT NULL,
      text_md    TEXT NOT NULL,
      refined_at TEXT,
      PRIMARY KEY (date, section_id, item_id),
      FOREIGN KEY (date) REFERENCES digests(date) ON DELETE CASCADE
    );

    CREATE TABLE IF NOT EXISTS digest_refs (
      date         TEXT NOT NULL,
      section_id   TEXT NOT NULL,
      item_id      TEXT NOT NULL DEFAULT '',
      ref_id       TEXT NOT NULL,
      session_id   TEXT NOT NULL,
      event_uuid   TEXT NOT NULL,
      role         TEXT NOT NULL,
      timestamp    TEXT NOT NULL,
      project_name TEXT NOT NULL,
      tool         TEXT NOT NULL,
      snippet      TEXT NOT NULL,
      PRIMARY KEY (date, section_id, item_id, ref_id),
      FOREIGN KEY (date) REFERENCES digests(date) ON DELETE CASCADE
    );
    CREATE INDEX IF NOT EXISTS digest_refs_by_section ON digest_refs(date, section_id);

    CREATE TABLE IF NOT EXISTS digest_section_history (
      date        TEXT NOT NULL,
      section_id  TEXT NOT NULL,
      item_id     TEXT NOT NULL DEFAULT '',
      saved_at    TEXT NOT NULL,
      kind        TEXT NOT NULL,
      heading     TEXT NOT NULL,
      body_md     TEXT NOT NULL,
      items_json  TEXT NOT NULL,
      refs_json   TEXT NOT NULL,
      PRIMARY KEY (date, section_id, item_id, saved_at),
      FOREIGN KEY (date) REFERENCES digests(date) ON DELETE CASCADE
    );

    CREATE TABLE IF NOT EXISTS digest_translations (
      date                TEXT NOT NULL,
      lang                TEXT NOT NULL,
      doc_json            TEXT NOT NULL,
      source_generated_at TEXT NOT NULL,
      translated_at       TEXT NOT NULL,
      PRIMARY KEY (date, lang),
      FOREIGN KEY (date) REFERENCES digests(date) ON DELETE CASCADE
    );
  `)

  // Lightweight forward migration: add columns on pre-existing DBs.
  const cols = db.prepare("PRAGMA table_info(sessions)").all() as { name: string }[]
  const names = new Set(cols.map((c) => c.name))
  const additions: [string, string][] = [
    ['input_tokens', 'INTEGER NOT NULL DEFAULT 0'],
    ['output_tokens', 'INTEGER NOT NULL DEFAULT 0'],
    ['cache_creation_tokens', 'INTEGER NOT NULL DEFAULT 0'],
    ['cache_read_tokens', 'INTEGER NOT NULL DEFAULT 0'],
    ['tool_use_count', 'INTEGER NOT NULL DEFAULT 0'],
    ['host', 'TEXT'],
    ['remote_source_path', 'TEXT']
  ]
  for (const [col, type] of additions) {
    if (!names.has(col)) {
      db.exec(`ALTER TABLE sessions ADD COLUMN ${col} ${type}`)
    }
  }
}
