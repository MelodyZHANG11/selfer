import { useEffect, useState } from 'react'
import { Clock, Server } from 'lucide-react'
import type { DigestScheduleStatus, SshHostConfig } from '@shared/types'
import { relativeTime } from '@shared/datetime'

export function StatusBar(): JSX.Element {
  const [schedule, setSchedule] = useState<DigestScheduleStatus | null>(null)
  const [sshHosts, setSshHosts] = useState<SshHostConfig[]>([])
  const [, setTick] = useState(0) // force re-render every minute to update "in 2h 10m"

  useEffect(() => {
    const load = async (): Promise<void> => {
      const [sch, settings] = await Promise.all([
        window.selfer.getDigestSchedule(),
        window.selfer.getSettings()
      ])
      setSchedule(sch)
      setSshHosts(settings.sshHosts ?? [])
    }
    void load()
    const iv = setInterval(() => {
      void load()
      setTick((t) => t + 1)
    }, 60_000)
    return () => clearInterval(iv)
  }, [])

  const next = schedule?.nextRunAt ? new Date(schedule.nextRunAt) : null
  const last = schedule?.lastRun

  return (
    <div className="h-7 shrink-0 border-t border-neutral-800/80 bg-neutral-950/90 backdrop-blur px-4 flex items-center gap-4 text-[11px] text-neutral-500 font-medium">
      <div className="flex items-center gap-1.5">
        <Clock size={11} className="text-emerald-400/80" />
        <span className="text-neutral-300">Auto-digest</span>
        <span className="text-neutral-600">·</span>
        <span>every 4h</span>
      </div>

      {next && (
        <>
          <Divider />
          <div>
            Next at <span className="text-neutral-300">{formatTime(next)}</span>
            <span className="text-neutral-600"> ({relativeTo(next)})</span>
          </div>
        </>
      )}

      {last && (
        <>
          <Divider />
          <div className="truncate">
            Last:{' '}
            <span className={statusColor(last.status)}>{last.status}</span>
            <span className="text-neutral-600"> · {relativeTime(last.at)}</span>
          </div>
        </>
      )}

      <div className="flex-1" />

      <SshSummary hosts={sshHosts} />
    </div>
  )
}

function SshSummary({ hosts }: { hosts: SshHostConfig[] }): JSX.Element | null {
  if (hosts.length === 0) return null
  const enabled = hosts.filter((h) => h.enabled)
  const enabledCount = enabled.length
  const totalCount = hosts.length

  return (
    <div className="relative group">
      <div className="flex items-center gap-1.5 cursor-default">
        <Server size={11} className="text-sky-400/80" />
        <span className="text-neutral-300">SSH</span>
        <span className="tabular-nums font-mono text-neutral-300">
          {enabledCount}
          {totalCount > enabledCount && (
            <span className="text-neutral-600">/{totalCount}</span>
          )}
        </span>
      </div>
      <div
        className="absolute bottom-full right-0 mb-1.5 z-50 min-w-[220px] max-w-[360px] opacity-0 pointer-events-none group-hover:opacity-100 group-hover:pointer-events-auto transition-opacity bg-neutral-900 border border-neutral-800 rounded-md shadow-lg px-3 py-2 text-[11px]"
        role="tooltip"
      >
        {enabledCount === 0 ? (
          <div className="text-neutral-500">No enabled SSH hosts.</div>
        ) : (
          <ul className="flex flex-col gap-1">
            {enabled.map((h) => (
              <SshRow key={h.alias} host={h} />
            ))}
          </ul>
        )}
        {totalCount > enabledCount && (
          <div className="mt-1.5 pt-1.5 border-t border-neutral-800 text-neutral-500">
            {totalCount - enabledCount} disabled
          </div>
        )}
      </div>
    </div>
  )
}

function SshRow({ host }: { host: SshHostConfig }): JSX.Element {
  const hasError = !!host.lastError
  const isResolved = !!host.lastResolved && !hasError
  const dotColor = hasError
    ? 'bg-rose-400'
    : isResolved
      ? 'bg-emerald-400'
      : 'bg-neutral-500'
  const detail = hasError
    ? host.lastError
    : host.lastSyncAt
      ? `synced ${relativeTime(host.lastSyncAt)}`
      : host.lastResolved
        ? `tested ${relativeTime(host.lastResolved.at)}`
        : 'not yet tested'
  return (
    <li className="flex items-center gap-2">
      <span className={`inline-block w-1.5 h-1.5 rounded-full shrink-0 ${dotColor}`} />
      <span className="font-mono text-neutral-200 truncate">{host.alias}</span>
      <span
        className={`ml-auto truncate ${hasError ? 'text-rose-400/80' : 'text-neutral-500'}`}
        title={detail}
      >
        {detail}
      </span>
    </li>
  )
}

function Divider(): JSX.Element {
  return <span className="text-neutral-700">·</span>
}

function statusColor(status: string): string {
  if (status === 'generated') return 'text-emerald-400'
  if (status.startsWith('error')) return 'text-rose-400'
  if (status.startsWith('skipped')) return 'text-neutral-400'
  return 'text-neutral-300'
}

function formatTime(d: Date): string {
  return d.toLocaleTimeString(undefined, { hour: '2-digit', minute: '2-digit' })
}

function relativeTo(target: Date): string {
  const diff = target.getTime() - Date.now()
  if (diff <= 0) return 'any moment'
  const mins = Math.round(diff / 60_000)
  if (mins < 60) return `in ${mins}m`
  const hrs = Math.floor(mins / 60)
  const rem = mins % 60
  return rem === 0 ? `in ${hrs}h` : `in ${hrs}h ${rem}m`
}
