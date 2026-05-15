import { useEffect, useMemo, useState } from 'react'
import { Link } from 'react-router-dom'
import {
  Activity,
  Clock,
  Flame,
  Hash,
  MessageSquare,
  Sparkles,
  Wrench,
  Zap
} from 'lucide-react'
import type { DayActivity, ProjectStat, Stats } from '@shared/types'
import { formatDate } from '@shared/datetime'

export function StatsPage(): JSX.Element {
  const [stats, setStats] = useState<Stats | null>(null)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    window.selfer
      .getStats()
      .then(setStats)
      .catch((e: Error) => setError(e.message))
  }, [])

  if (error) return <div className="p-6 text-rose-400 text-sm">{error}</div>
  if (!stats) return <div className="p-6 text-neutral-500 text-sm">Loading…</div>

  const { overview } = stats
  const firstDate = formatDate(overview.firstSessionAt) || '—'
  const lastDate = formatDate(overview.lastSessionAt) || '—'

  return (
    <div className="h-full overflow-auto">
      <div className="px-8 py-6 border-b border-neutral-800">
        <h1 className="text-2xl font-semibold tracking-tight">Stats</h1>
        <p className="text-xs text-neutral-500 mt-1">
          {overview.totalSessions.toLocaleString()} sessions across{' '}
          {overview.totalProjects} projects · {firstDate} → {lastDate}
        </p>
      </div>

      <div className="p-8 space-y-8 max-w-6xl">
        <section className="grid grid-cols-2 md:grid-cols-4 gap-3">
          <MetricCard
            icon={<MessageSquare size={16} />}
            label="Messages"
            value={overview.totalMessages.toLocaleString()}
            accent="sky"
          />
          <MetricCard
            icon={<Zap size={16} />}
            label="Input tokens"
            value={formatTokens(overview.totalInputTokens)}
            accent="emerald"
          />
          <MetricCard
            icon={<Sparkles size={16} />}
            label="Output tokens"
            value={formatTokens(overview.totalOutputTokens)}
            accent="amber"
          />
          <MetricCard
            icon={<Hash size={16} />}
            label="Cache read"
            value={formatTokens(overview.totalCacheReadTokens)}
            accent="violet"
          />
          <MetricCard
            icon={<Flame size={16} />}
            label="Cache writes"
            value={formatTokens(overview.totalCacheCreationTokens)}
            accent="rose"
          />
          <MetricCard
            icon={<Wrench size={16} />}
            label="Tool uses"
            value={overview.totalToolUses.toLocaleString()}
            accent="indigo"
          />
          <MetricCard
            icon={<Clock size={16} />}
            label="Time engaged"
            value={formatDuration(overview.totalDurationSec)}
            accent="teal"
          />
          <MetricCard
            icon={<Activity size={16} />}
            label="Projects"
            value={overview.totalProjects.toLocaleString()}
            accent="slate"
          />
        </section>

        <section>
          <SectionHeader
            icon={<Activity size={14} />}
            title="Activity"
            subtitle="Last 180 days"
          />
          <ActivityGrid activity={stats.activity} />
        </section>

        <section className="grid grid-cols-1 lg:grid-cols-2 gap-6">
          <ProjectList
            title="Most chatty projects"
            subtitle="By message count"
            rows={stats.topProjectsByMessages}
            valueKey="messageCount"
            formatValue={(n) => n.toLocaleString()}
          />
          <ProjectList
            title="Deepest dives"
            subtitle="By total time"
            rows={stats.topProjectsByDuration}
            valueKey="durationSec"
            formatValue={formatDuration}
          />
          <ProjectList
            title="Most token-heavy"
            subtitle="Input + output + cache"
            rows={stats.topProjectsByTokens}
            valueKey="totalTokens"
            formatValue={formatTokens}
          />
          <LongestSessionList rows={stats.longestSessions} />
        </section>
      </div>
    </div>
  )
}

const ACCENTS = {
  sky: 'text-sky-300 border-sky-900/60 bg-sky-950/30',
  emerald: 'text-emerald-300 border-emerald-900/60 bg-emerald-950/30',
  amber: 'text-amber-300 border-amber-900/60 bg-amber-950/30',
  violet: 'text-violet-300 border-violet-900/60 bg-violet-950/30',
  rose: 'text-rose-300 border-rose-900/60 bg-rose-950/30',
  indigo: 'text-indigo-300 border-indigo-900/60 bg-indigo-950/30',
  teal: 'text-teal-300 border-teal-900/60 bg-teal-950/30',
  slate: 'text-slate-300 border-slate-800/60 bg-slate-950/30'
} as const

function MetricCard({
  icon,
  label,
  value,
  accent
}: {
  icon: JSX.Element
  label: string
  value: string
  accent: keyof typeof ACCENTS
}): JSX.Element {
  return (
    <div
      className={`rounded-lg border px-4 py-3 ${ACCENTS[accent]} transition-transform hover:-translate-y-0.5`}
    >
      <div className="flex items-center gap-1.5 text-[11px] uppercase tracking-wider opacity-80">
        {icon}
        <span>{label}</span>
      </div>
      <div className="mt-1.5 text-xl font-semibold tabular-nums tracking-tight text-neutral-100">
        {value}
      </div>
    </div>
  )
}

function SectionHeader({
  icon,
  title,
  subtitle
}: {
  icon: JSX.Element
  title: string
  subtitle?: string
}): JSX.Element {
  return (
    <div className="flex items-baseline justify-between mb-3">
      <div className="flex items-center gap-2">
        <span className="text-neutral-400">{icon}</span>
        <h3 className="text-sm font-semibold tracking-wide uppercase text-neutral-300">
          {title}
        </h3>
      </div>
      {subtitle && <span className="text-xs text-neutral-500">{subtitle}</span>}
    </div>
  )
}

function ActivityGrid({ activity }: { activity: DayActivity[] }): JSX.Element {
  const byDate = useMemo(() => {
    const m = new Map<string, DayActivity>()
    for (const a of activity) m.set(a.date, a)
    return m
  }, [activity])

  const maxMsgs = useMemo(
    () => Math.max(1, ...activity.map((a) => a.messageCount)),
    [activity]
  )

  const cells = useMemo(() => {
    const days: { date: string; count: number; msgs: number }[] = []
    const today = new Date()
    today.setHours(0, 0, 0, 0)
    for (let i = 179; i >= 0; i--) {
      const d = new Date(today)
      d.setDate(today.getDate() - i)
      const iso = d.toISOString().slice(0, 10)
      const a = byDate.get(iso)
      days.push({ date: iso, count: a?.sessionCount ?? 0, msgs: a?.messageCount ?? 0 })
    }
    return days
  }, [byDate])

  return (
    <div className="rounded-lg border border-neutral-800 bg-neutral-900/40 p-3">
      <div
        className="grid grid-rows-7 grid-flow-col gap-[3px]"
        style={{ gridAutoColumns: '11px' }}
      >
        {cells.map((c) => {
          const intensity = c.msgs === 0 ? 0 : 0.15 + (c.msgs / maxMsgs) * 0.85
          return (
            <div
              key={c.date}
              title={`${c.date} · ${c.count} session${c.count === 1 ? '' : 's'} · ${c.msgs} msgs`}
              className="w-[11px] h-[11px] rounded-[2px] border border-neutral-900"
              style={{
                backgroundColor:
                  c.msgs === 0
                    ? 'rgb(23 23 23)'
                    : `rgba(52, 211, 153, ${intensity.toFixed(2)})`
              }}
            />
          )
        })}
      </div>
      <div className="flex items-center gap-2 mt-3 text-[10px] text-neutral-500">
        <span>less</span>
        {[0.15, 0.35, 0.55, 0.75, 1].map((v) => (
          <div
            key={v}
            className="w-[11px] h-[11px] rounded-[2px] border border-neutral-900"
            style={{ backgroundColor: `rgba(52, 211, 153, ${v})` }}
          />
        ))}
        <span>more</span>
      </div>
    </div>
  )
}

function ProjectList({
  title,
  subtitle,
  rows,
  valueKey,
  formatValue
}: {
  title: string
  subtitle: string
  rows: ProjectStat[]
  valueKey: keyof ProjectStat
  formatValue: (n: number) => string
}): JSX.Element {
  const max = Math.max(1, ...rows.map((r) => r[valueKey] as number))
  return (
    <div>
      <SectionHeader icon={<Flame size={14} />} title={title} subtitle={subtitle} />
      <div className="rounded-lg border border-neutral-800 bg-neutral-900/40 divide-y divide-neutral-900">
        {rows.map((r) => {
          const v = r[valueKey] as number
          const pct = (v / max) * 100
          return (
            <div key={r.projectPath} className="px-4 py-2.5 group">
              <div className="flex items-baseline justify-between gap-3">
                <span className="text-sm truncate text-neutral-200" title={r.projectPath}>
                  {r.projectName}
                </span>
                <span className="text-xs tabular-nums text-neutral-400">
                  {formatValue(v)}
                </span>
              </div>
              <div className="mt-1.5 h-1 rounded-full bg-neutral-800 overflow-hidden">
                <div
                  className="h-full bg-gradient-to-r from-emerald-700 to-emerald-400 transition-all"
                  style={{ width: `${pct}%` }}
                />
              </div>
              <div className="mt-1 text-[10px] text-neutral-500">
                {r.sessionCount} sessions · {r.messageCount.toLocaleString()} msgs
              </div>
            </div>
          )
        })}
        {rows.length === 0 && (
          <div className="px-4 py-6 text-center text-xs text-neutral-500">No data yet.</div>
        )}
      </div>
    </div>
  )
}

function LongestSessionList({
  rows
}: {
  rows: Stats['longestSessions']
}): JSX.Element {
  return (
    <div>
      <SectionHeader icon={<Clock size={14} />} title="Longest sessions" subtitle="By duration" />
      <div className="rounded-lg border border-neutral-800 bg-neutral-900/40 divide-y divide-neutral-900">
        {rows.map((r) => (
          <Link
            key={r.id}
            to={`/sessions/${r.id}`}
            className="block px-4 py-2.5 hover:bg-neutral-900/80 transition-colors"
          >
            <div className="flex items-baseline justify-between gap-3">
              <span className="text-sm truncate">
                {r.customName ?? r.autoTitle ?? '(untitled)'}
              </span>
              <span className="text-xs tabular-nums text-neutral-400">
                {formatDuration(r.durationSec)}
              </span>
            </div>
            <div className="mt-1 text-[10px] text-neutral-500 truncate">
              {r.projectName} · {r.messageCount} msgs · {formatTokens(r.totalTokens)} tokens
            </div>
          </Link>
        ))}
        {rows.length === 0 && (
          <div className="px-4 py-6 text-center text-xs text-neutral-500">No data yet.</div>
        )}
      </div>
    </div>
  )
}

function formatTokens(n: number): string {
  if (n >= 1_000_000_000) return (n / 1_000_000_000).toFixed(1) + 'B'
  if (n >= 1_000_000) return (n / 1_000_000).toFixed(1) + 'M'
  if (n >= 1_000) return (n / 1_000).toFixed(1) + 'K'
  return n.toLocaleString()
}

function formatDuration(seconds: number): string {
  if (seconds < 60) return `${Math.round(seconds)}s`
  const m = Math.floor(seconds / 60)
  if (m < 60) return `${m}m`
  const h = Math.floor(m / 60)
  const rem = m % 60
  if (h < 24) return rem === 0 ? `${h}h` : `${h}h ${rem}m`
  const d = Math.floor(h / 24)
  const hr = h % 24
  return hr === 0 ? `${d}d` : `${d}d ${hr}h`
}
