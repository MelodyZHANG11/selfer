import type { DB } from './db'
import type {
  DayActivity,
  LongSession,
  ProjectStat,
  Stats,
  StatsOverview
} from '@shared/types'

export function getStats(db: DB): Stats {
  const overview = getOverview(db)
  return {
    overview,
    topProjectsByMessages: projectStats(db, 'message_count', 5),
    topProjectsByDuration: projectStats(db, 'duration', 5),
    topProjectsByTokens: projectStats(db, 'total_tokens', 5),
    longestSessions: longestSessions(db, 5),
    activity: dailyActivity(db, 180)
  }
}

function getOverview(db: DB): StatsOverview {
  const row = db
    .prepare(
      `SELECT
         COUNT(*) AS totalSessions,
         COALESCE(SUM(message_count), 0) AS totalMessages,
         COALESCE(SUM(input_tokens), 0) AS totalInputTokens,
         COALESCE(SUM(output_tokens), 0) AS totalOutputTokens,
         COALESCE(SUM(cache_creation_tokens), 0) AS totalCacheCreationTokens,
         COALESCE(SUM(cache_read_tokens), 0) AS totalCacheReadTokens,
         COALESCE(SUM(tool_use_count), 0) AS totalToolUses,
         COALESCE(SUM(
           CASE WHEN started_at IS NOT NULL AND ended_at IS NOT NULL
             THEN (julianday(ended_at) - julianday(started_at)) * 86400
             ELSE 0 END
         ), 0) AS totalDurationSec,
         COUNT(DISTINCT project_path) AS totalProjects,
         MIN(started_at) AS firstSessionAt,
         MAX(ended_at) AS lastSessionAt
       FROM sessions`
    )
    .get() as StatsOverview
  return {
    ...row,
    totalDurationSec: Math.round(row.totalDurationSec)
  }
}

type ProjectOrder = 'message_count' | 'duration' | 'total_tokens'

function projectStats(db: DB, order: ProjectOrder, limit: number): ProjectStat[] {
  const orderExpr =
    order === 'message_count'
      ? 'SUM(s.message_count)'
      : order === 'duration'
        ? 'SUM(CASE WHEN s.started_at IS NOT NULL AND s.ended_at IS NOT NULL THEN (julianday(s.ended_at) - julianday(s.started_at)) * 86400 ELSE 0 END)'
        : 'SUM(s.input_tokens + s.output_tokens + s.cache_creation_tokens + s.cache_read_tokens)'

  const rows = db
    .prepare(
      `SELECT
         s.project_path AS projectPath,
         s.project_name AS projectName,
         COUNT(*) AS sessionCount,
         COALESCE(SUM(s.message_count), 0) AS messageCount,
         COALESCE(SUM(s.input_tokens + s.output_tokens + s.cache_creation_tokens + s.cache_read_tokens), 0) AS totalTokens,
         COALESCE(SUM(
           CASE WHEN s.started_at IS NOT NULL AND s.ended_at IS NOT NULL
             THEN (julianday(s.ended_at) - julianday(s.started_at)) * 86400
             ELSE 0 END
         ), 0) AS durationSec
       FROM sessions s
       GROUP BY s.project_path
       ORDER BY ${orderExpr} DESC
       LIMIT ?`
    )
    .all(limit) as ProjectStat[]

  return rows.map((r) => ({ ...r, durationSec: Math.round(r.durationSec) }))
}

function longestSessions(db: DB, limit: number): LongSession[] {
  return db
    .prepare(
      `SELECT
         id,
         project_name AS projectName,
         auto_title AS autoTitle,
         custom_name AS customName,
         CAST((julianday(ended_at) - julianday(started_at)) * 86400 AS INTEGER) AS durationSec,
         message_count AS messageCount,
         (input_tokens + output_tokens + cache_creation_tokens + cache_read_tokens) AS totalTokens
       FROM sessions
       WHERE started_at IS NOT NULL AND ended_at IS NOT NULL
       ORDER BY durationSec DESC
       LIMIT ?`
    )
    .all(limit) as LongSession[]
}

function dailyActivity(db: DB, days: number): DayActivity[] {
  const rows = db
    .prepare(
      `SELECT
         substr(started_at, 1, 10) AS date,
         COUNT(*) AS sessionCount,
         COALESCE(SUM(message_count), 0) AS messageCount,
         COALESCE(SUM(input_tokens + output_tokens + cache_creation_tokens + cache_read_tokens), 0) AS totalTokens
       FROM sessions
       WHERE started_at IS NOT NULL
       GROUP BY substr(started_at, 1, 10)
       ORDER BY date DESC
       LIMIT ?`
    )
    .all(days) as DayActivity[]
  return rows
}
