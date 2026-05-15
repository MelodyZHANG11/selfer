import { useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react'
import { Link, useSearchParams } from 'react-router-dom'
import { Cpu, Folder, RefreshCw, Search, Server, Tag } from 'lucide-react'
import type { SessionListFilters, SessionRow, ToolName } from '@shared/types'

const TOOL_LABELS: Record<ToolName, string> = {
  'claude-code': 'Claude Code',
  codex: 'Codex',
  'copilot-cli': 'Copilot',
  opencode: 'OpenCode'
}

// Persists across navigations for the lifetime of the renderer process.
// Keyed by the current filter URL so each filter view keeps its own scroll position.
const SCROLL_MEMORY = new Map<string, number>()

const TOOL_COLORS: Record<ToolName, string> = {
  'claude-code': 'bg-amber-950/60 text-amber-300 border-amber-900/60',
  codex: 'bg-sky-950/60 text-sky-300 border-sky-900/60',
  'copilot-cli': 'bg-violet-950/60 text-violet-300 border-violet-900/60',
  opencode: 'bg-fuchsia-950/60 text-fuchsia-300 border-fuchsia-900/60'
}

export function SessionListPage(): JSX.Element {
  const [rows, setRows] = useState<SessionRow[]>([])
  const [total, setTotal] = useState(0)
  const [loading, setLoading] = useState(false)
  const [projects, setProjects] = useState<
    { projectPath: string; projectName: string; count: number }[]
  >([])
  const [tags, setTags] = useState<{ tag: string; count: number }[]>([])
  const [hosts, setHosts] = useState<string[]>([])
  const [searchParams, setSearchParams] = useSearchParams()
  const [reindexing, setReindexing] = useState(false)
  const listRef = useRef<HTMLDivElement>(null)
  const restoredKey = useRef<string | null>(null)

  const filters: SessionListFilters = useMemo(
    () => ({
      query: searchParams.get('q') ?? undefined,
      tool: (searchParams.get('tool') as ToolName | null) ?? undefined,
      projectPath: searchParams.get('project') ?? undefined,
      tag: searchParams.get('tag') ?? undefined,
      host: searchParams.get('host') ?? undefined,
      limit: 200
    }),
    [searchParams]
  )

  const patchFilters = (patch: Partial<SessionListFilters>): void => {
    const next = new URLSearchParams(searchParams)
    const map: Record<string, keyof SessionListFilters> = {
      q: 'query',
      tool: 'tool',
      project: 'projectPath',
      tag: 'tag',
      host: 'host'
    }
    for (const [urlKey, filterKey] of Object.entries(map)) {
      if (filterKey in patch) {
        const v = patch[filterKey as keyof SessionListFilters]
        if (v == null || v === '') next.delete(urlKey)
        else next.set(urlKey, String(v))
      }
    }
    setSearchParams(next, { replace: true })
  }

  const refresh = async (f: SessionListFilters): Promise<void> => {
    setLoading(true)
    try {
      const res = await window.selfer.listSessions(f)
      setRows(res.rows)
      setTotal(res.total)
    } finally {
      setLoading(false)
    }
  }

  useEffect(() => {
    void refresh(filters)
  }, [filters])

  // Restore scroll once per filter-key change, but only after rows actually land in the DOM.
  // Otherwise the initial (empty, loading=false) render would consume the "restore" slot
  // with a no-op against an empty container.
  const scrollKey = searchParams.toString()
  useLayoutEffect(() => {
    if (loading) return
    if (rows.length === 0) return
    const el = listRef.current
    if (!el) return
    if (restoredKey.current === scrollKey) return
    el.scrollTop = SCROLL_MEMORY.get(scrollKey) ?? 0
    restoredKey.current = scrollKey
  }, [loading, scrollKey, rows.length])

  useEffect(() => {
    void window.selfer.listProjects().then(setProjects)
    void window.selfer.listTags().then(setTags)
    void window.selfer.getSettings().then((s) => {
      setHosts(s.sshHosts.filter((h) => h.enabled).map((h) => h.alias))
    })
  }, [])

  const handleReindex = async (): Promise<void> => {
    setReindexing(true)
    try {
      await window.selfer.reindex()
      await refresh(filters)
      setProjects(await window.selfer.listProjects())
      setTags(await window.selfer.listTags())
    } finally {
      setReindexing(false)
    }
  }

  return (
    <div className="h-full flex flex-col">
      <div className="h-14 px-5 border-b border-neutral-800/80 flex items-center gap-3 bg-neutral-950/60 backdrop-blur">
        <div className="relative flex-1 max-w-md">
          <Search
            size={14}
            className="absolute left-2.5 top-1/2 -translate-y-1/2 text-neutral-500 pointer-events-none"
          />
          <input
            placeholder="Search sessions…"
            className="w-full bg-neutral-900 border border-neutral-800 rounded-md pl-8 pr-3 py-1.5 text-sm focus:outline-none focus:ring-1 focus:ring-emerald-700 focus:border-emerald-800 transition-colors"
            value={filters.query ?? ''}
            onChange={(e) => patchFilters({ query: e.target.value })}
          />
        </div>
        <FilterSelect
          icon={<Cpu size={12} />}
          value={filters.tool ?? ''}
          onChange={(v) => patchFilters({ tool: (v as ToolName) || undefined })}
        >
          <option value="">All tools</option>
          <option value="claude-code">Claude Code</option>
          <option value="codex">Codex</option>
        </FilterSelect>
        <FilterSelect
          icon={<Folder size={12} />}
          value={filters.projectPath ?? ''}
          onChange={(v) => patchFilters({ projectPath: v || undefined })}
        >
          <option value="">All projects</option>
          {projects.map((p) => (
            <option key={p.projectPath} value={p.projectPath}>
              {p.projectName} ({p.count})
            </option>
          ))}
        </FilterSelect>
        <FilterSelect
          icon={<Tag size={12} />}
          value={filters.tag ?? ''}
          onChange={(v) => patchFilters({ tag: v || undefined })}
        >
          <option value="">All tags</option>
          {tags.map((t) => (
            <option key={t.tag} value={t.tag}>
              {t.tag} ({t.count})
            </option>
          ))}
        </FilterSelect>
        {hosts.length > 0 && (
          <FilterSelect
            icon={<Server size={12} />}
            value={filters.host ?? ''}
            onChange={(v) => patchFilters({ host: v || undefined })}
          >
            <option value="">All hosts</option>
            <option value="local">local</option>
            {hosts.map((h) => (
              <option key={h} value={h}>
                {h}
              </option>
            ))}
          </FilterSelect>
        )}
        <div className="flex-1" />
        <span className="text-xs text-neutral-500 tabular-nums text-right w-24 shrink-0">
          {loading ? 'loading…' : `${rows.length} / ${total}`}
        </span>
        <button
          onClick={handleReindex}
          disabled={reindexing}
          className="inline-flex items-center justify-center gap-1.5 text-xs px-3 py-1.5 rounded-md border border-neutral-800 hover:bg-neutral-900 hover:border-neutral-700 disabled:opacity-60 disabled:cursor-wait transition-colors w-[104px] shrink-0"
        >
          <RefreshCw size={12} className={reindexing ? 'animate-spin' : ''} />
          {reindexing ? 'Reindexing' : 'Reindex'}
        </button>
      </div>

      <div
        ref={listRef}
        onScroll={(e) => SCROLL_MEMORY.set(scrollKey, e.currentTarget.scrollTop)}
        className="flex-1 overflow-auto"
      >
        {rows.map((r) => (
          <SessionRowView key={r.id} row={r} />
        ))}
        {!loading && rows.length === 0 && (
          <div className="p-12 text-center">
            <div className="text-sm text-neutral-500">
              No sessions indexed yet. Click <b className="text-neutral-300">Reindex</b> to scan{' '}
              <code className="text-xs bg-neutral-900 px-1 py-0.5 rounded">
                ~/.claude/projects
              </code>{' '}
              and{' '}
              <code className="text-xs bg-neutral-900 px-1 py-0.5 rounded">
                ~/.codex/sessions
              </code>
              .
            </div>
          </div>
        )}
      </div>
    </div>
  )
}

function FilterSelect({
  icon,
  value,
  onChange,
  children
}: {
  icon: JSX.Element
  value: string
  onChange: (v: string) => void
  children: React.ReactNode
}): JSX.Element {
  return (
    <div className="relative">
      <span className="absolute left-2 top-1/2 -translate-y-1/2 text-neutral-500 pointer-events-none">
        {icon}
      </span>
      <select
        className="bg-neutral-900 border border-neutral-800 rounded-md pl-6 pr-2 py-1.5 text-xs appearance-none cursor-pointer hover:border-neutral-700 transition-colors"
        value={value}
        onChange={(e) => onChange(e.target.value)}
      >
        {children}
      </select>
    </div>
  )
}

function SessionRowView({ row }: { row: SessionRow }): JSX.Element {
  const title = row.customName ?? row.autoTitle ?? '(untitled)'
  const date = row.startedAt ? formatDate(row.startedAt) : '—'
  return (
    <Link
      to={`/sessions/${row.id}`}
      className="group flex items-baseline gap-4 px-5 py-3 border-b border-neutral-900 hover:bg-neutral-900/50 transition-colors"
    >
      <div className="shrink-0 w-24 text-xs text-neutral-500 tabular-nums">{date}</div>
      <div className="shrink-0 w-16">
        <span
          className={`text-[10px] px-1.5 py-0.5 rounded border ${TOOL_COLORS[row.tool]} whitespace-nowrap`}
          title={TOOL_LABELS[row.tool]}
        >
          {row.tool === 'claude-code' ? 'CC' : row.tool === 'codex' ? 'Cdx' : row.tool}
        </span>
      </div>
      <div className="shrink-0 w-40 text-xs text-neutral-400 truncate" title={row.projectPath}>
        {row.projectName}
      </div>
      <div className="flex-1 min-w-0">
        <div className="text-sm text-neutral-100 truncate group-hover:text-white transition-colors">
          {title}
        </div>
        {row.tags.length > 0 && (
          <div className="mt-1 flex flex-wrap gap-1">
            {row.tags.map((t) => (
              <span
                key={t}
                className="text-[10px] px-1.5 py-0.5 rounded bg-neutral-800 text-neutral-300"
              >
                {t}
              </span>
            ))}
          </div>
        )}
      </div>
      <div className="shrink-0 text-xs text-neutral-500 tabular-nums">
        {row.messageCount} msgs
      </div>
    </Link>
  )
}

function formatDate(iso: string): string {
  const d = new Date(iso)
  if (Number.isNaN(d.getTime())) return iso
  const now = new Date()
  const sameDay = d.toDateString() === now.toDateString()
  if (sameDay) return d.toTimeString().slice(0, 5)
  const sameYear = d.getFullYear() === now.getFullYear()
  return sameYear
    ? d.toLocaleDateString(undefined, { month: 'short', day: 'numeric' })
    : d.toISOString().slice(0, 10)
}
