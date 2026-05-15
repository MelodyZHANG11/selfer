import { useEffect, useRef, useState } from 'react'
import { Check, ChevronDown, RefreshCw, Trash2, X } from 'lucide-react'
import type {
  DigestProvider,
  OpenAIModelInfo,
  Settings,
  SshHostConfig
} from '@shared/types'
import { formatDateTime } from '@shared/datetime'

const LLLM_BASE = 'http://127.0.0.1:42424/v1'

type SaveState = 'idle' | 'saving' | 'saved'

export function SettingsPage(): JSX.Element {
  const [settings, setSettings] = useState<Settings | null>(null)
  const [saveState, setSaveState] = useState<SaveState>('idle')
  const [models, setModels] = useState<OpenAIModelInfo[]>([])
  const [modelsError, setModelsError] = useState<string | null>(null)
  const [fetchingModels, setFetchingModels] = useState(false)

  useEffect(() => {
    void window.selfer.getSettings().then(setSettings)
  }, [])

  const fetchModels = async (base?: string, key?: string): Promise<void> => {
    if (!settings) return
    const url = base ?? settings.openaiBaseUrl ?? ''
    if (!url) {
      setModelsError('Set a base URL first.')
      return
    }
    setFetchingModels(true)
    setModelsError(null)
    try {
      const list = await window.selfer.listOpenAIModels(url, key ?? settings.openaiApiKey)
      setModels(list)
      if (list.length === 0) setModelsError('Endpoint returned no models.')
    } catch (e) {
      setModelsError((e as Error).message)
      setModels([])
    } finally {
      setFetchingModels(false)
    }
  }

  // Auto-fetch models when the OpenAI-compatible provider is selected and the base URL exists.
  useEffect(() => {
    if (!settings) return
    if (settings.digestProvider === 'openai-compatible' && settings.openaiBaseUrl) {
      void fetchModels(settings.openaiBaseUrl, settings.openaiApiKey)
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [settings?.digestProvider])

  const save = async (): Promise<void> => {
    if (!settings) return
    setSaveState('saving')
    try {
      await window.selfer.saveSettings(settings)
      setSaveState('saved')
      window.setTimeout(() => setSaveState('idle'), 1600)
    } catch {
      setSaveState('idle')
    }
  }

  // Revert "saved" back to idle as soon as the user edits anything.
  useEffect(() => {
    if (saveState === 'saved') setSaveState('idle')
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [settings])

  if (!settings) return <div className="p-6 text-neutral-500">Loading…</div>

  const update = <K extends keyof Settings>(key: K, value: Settings[K]): void =>
    setSettings({ ...settings, [key]: value })

  return (
    <div className="p-6 max-w-2xl space-y-6 text-sm overflow-auto h-full">
      <h2 className="text-lg font-semibold">Settings</h2>

      <section className="space-y-2">
        <label className="block text-xs uppercase tracking-wide text-neutral-500">
          Digest provider
        </label>
        <div className="flex gap-2">
          {(
            [
              ['claude-cli', 'Claude CLI', 'Uses the `claude` command — no key needed.'],
              ['anthropic-api', 'Anthropic API', 'Direct API call, requires key.'],
              ['openai-compatible', 'OpenAI-compatible', 'Any endpoint: lllm, Ollama, LM Studio.']
            ] as [DigestProvider, string, string][]
          ).map(([v, label, hint]) => (
            <button
              key={v}
              onClick={() => update('digestProvider', v)}
              className={`flex-1 text-left px-3 py-2 rounded border ${
                settings.digestProvider === v
                  ? 'border-emerald-700 bg-emerald-950/40'
                  : 'border-neutral-800 hover:bg-neutral-900'
              }`}
            >
              <div className="font-medium">{label}</div>
              <div className="text-[11px] text-neutral-500 mt-0.5">{hint}</div>
            </button>
          ))}
        </div>
      </section>

      {settings.digestProvider === 'claude-cli' && (
        <section className="space-y-3 p-4 rounded border border-neutral-800 bg-neutral-900/40">
          <Field
            label="Claude CLI path (optional)"
            placeholder="auto — searches ~/.local/bin, /opt/homebrew/bin, /usr/local/bin"
            value={settings.claudeCliPath ?? ''}
            onChange={(v) => update('claudeCliPath', v)}
            mono
          />
          <Field
            label="Model"
            placeholder="sonnet"
            value={settings.claudeCliModel ?? ''}
            onChange={(v) => update('claudeCliModel', v)}
          />
          <p className="text-xs text-neutral-500">
            Runs <code>claude -p --bare</code> — uses your existing Claude Code auth. No key here.
          </p>
        </section>
      )}

      {settings.digestProvider === 'anthropic-api' && (
        <section className="space-y-3 p-4 rounded border border-neutral-800 bg-neutral-900/40">
          <Field
            label="API key"
            placeholder="sk-ant-…"
            value={settings.anthropicApiKey}
            onChange={(v) => update('anthropicApiKey', v)}
            password
          />
          <Field
            label="Model"
            placeholder="claude-opus-4-7"
            value={settings.anthropicModel ?? ''}
            onChange={(v) => update('anthropicModel', v)}
          />
        </section>
      )}

      {settings.digestProvider === 'openai-compatible' && (
        <section className="space-y-3 p-4 rounded border border-neutral-800 bg-neutral-900/40">
          <div className="flex items-center justify-between">
            <label className="text-xs uppercase tracking-wide text-neutral-500">Base URL</label>
            <button
              onClick={() => {
                update('openaiBaseUrl', LLLM_BASE)
                void fetchModels(LLLM_BASE, settings.openaiApiKey)
              }}
              className="text-[10px] px-2 py-0.5 rounded border border-neutral-800 hover:bg-neutral-800"
              title="Use local lllm gateway"
            >
              Use lllm (127.0.0.1:42424)
            </button>
          </div>
          <input
            className="w-full bg-neutral-900 border border-neutral-800 rounded px-2 py-1 font-mono text-xs"
            placeholder="http://localhost:11434/v1  (Ollama) — or your lllm endpoint"
            value={settings.openaiBaseUrl ?? ''}
            onChange={(e) => update('openaiBaseUrl', e.target.value)}
          />

          <div className="flex items-center justify-between">
            <label className="text-xs uppercase tracking-wide text-neutral-500">Model</label>
            <button
              onClick={() => void fetchModels()}
              disabled={fetchingModels}
              className="text-[10px] px-2 py-0.5 rounded border border-neutral-800 hover:bg-neutral-800 disabled:opacity-50 flex items-center gap-1"
            >
              <RefreshCw size={10} className={fetchingModels ? 'animate-spin' : ''} />
              {fetchingModels ? 'Fetching' : `Refresh${models.length ? ` (${models.length})` : ''}`}
            </button>
          </div>

          {models.length > 0 ? (
            <ModelPicker
              models={models}
              value={settings.openaiModel ?? ''}
              onChange={(v) => update('openaiModel', v)}
            />
          ) : (
            <input
              list="openai-models-list"
              className="w-full bg-neutral-900 border border-neutral-800 rounded px-2 py-1 font-mono text-xs"
              placeholder="click Refresh to load models from the endpoint"
              value={settings.openaiModel ?? ''}
              onChange={(e) => update('openaiModel', e.target.value)}
            />
          )}

          {modelsError && <p className="text-[11px] text-rose-400">{modelsError}</p>}

          <Field
            label="API key (optional)"
            placeholder="leave blank for local models"
            value={settings.openaiApiKey ?? ''}
            onChange={(v) => update('openaiApiKey', v)}
            password
          />
          <p className="text-xs text-neutral-500">
            POSTs to <code>{'{baseUrl}'}/chat/completions</code>. Works with lllm, Ollama, LM
            Studio, vllm — anything OpenAI-compatible.
          </p>
        </section>
      )}

      <section className="space-y-1">
        <label className="block text-xs uppercase tracking-wide text-neutral-500">
          Digests directory
        </label>
        <input
          className="w-full bg-neutral-900 border border-neutral-800 rounded px-2 py-1 font-mono text-xs"
          value={settings.digestsDir}
          onChange={(e) => update('digestsDir', e.target.value)}
        />
        <p className="text-xs text-neutral-500">
          Point this at your Obsidian vault or any notes folder.
        </p>
      </section>

      <TranslationSection
        settings={settings}
        update={update}
        models={models}
        fetchingModels={fetchingModels}
        modelsError={modelsError}
        onRefreshModels={() => void fetchModels()}
      />

      <SshHostsSection
        hosts={settings.sshHosts}
        onChange={(next) => update('sshHosts', next)}
        onPersist={async (next) => {
          const updated = { ...settings, sshHosts: next }
          setSettings(updated)
          await window.selfer.saveSettings(updated)
        }}
      />

      <div className="flex items-center gap-3 pb-2">
        <SaveButton state={saveState} onSave={save} />
      </div>
    </div>
  )
}

function TranslationSection({
  settings,
  update,
  models,
  fetchingModels,
  modelsError,
  onRefreshModels
}: {
  settings: Settings
  update: <K extends keyof Settings>(key: K, value: Settings[K]) => void
  models: OpenAIModelInfo[]
  fetchingModels: boolean
  modelsError: string | null
  onRefreshModels: () => void
}): JSX.Element {
  const overriding = Boolean(settings.translateProvider)
  const provider = settings.translateProvider ?? settings.digestProvider

  const setOverriding = (on: boolean): void => {
    if (on) {
      // Seed with the current digest provider so the user has a sensible start.
      update('translateProvider', settings.digestProvider)
    } else {
      update('translateProvider', undefined)
    }
  }

  const providerLabel = (p: DigestProvider): string =>
    p === 'claude-cli' ? 'Claude CLI' : p === 'anthropic-api' ? 'Anthropic API' : 'OpenAI-compatible'

  return (
    <section className="space-y-2">
      <label className="block text-xs uppercase tracking-wide text-neutral-500">
        Translation model
      </label>

      <div className="flex gap-2">
        <button
          onClick={() => setOverriding(false)}
          className={`flex-1 text-left px-3 py-2 rounded border ${
            !overriding
              ? 'border-emerald-700 bg-emerald-950/40'
              : 'border-neutral-800 hover:bg-neutral-900'
          }`}
        >
          <div className="font-medium text-sm">Inherit from digest</div>
          <div className="text-[11px] text-neutral-500 mt-0.5">
            Use the digest provider above ({providerLabel(settings.digestProvider)}).
          </div>
        </button>
        <button
          onClick={() => setOverriding(true)}
          className={`flex-1 text-left px-3 py-2 rounded border ${
            overriding
              ? 'border-emerald-700 bg-emerald-950/40'
              : 'border-neutral-800 hover:bg-neutral-900'
          }`}
        >
          <div className="font-medium text-sm">Use a different model</div>
          <div className="text-[11px] text-neutral-500 mt-0.5">
            Route translation through a separate provider/model.
          </div>
        </button>
      </div>

      {overriding && (
        <div className="space-y-3 p-4 rounded border border-neutral-800 bg-neutral-900/40 mt-2">
          <div className="flex gap-2">
            {(['claude-cli', 'anthropic-api', 'openai-compatible'] as DigestProvider[]).map((p) => (
              <button
                key={p}
                onClick={() => update('translateProvider', p)}
                className={`flex-1 text-center px-2 py-1.5 rounded border text-xs ${
                  provider === p
                    ? 'border-emerald-700 bg-emerald-950/40 text-emerald-200'
                    : 'border-neutral-800 hover:bg-neutral-900 text-neutral-300'
                }`}
              >
                {providerLabel(p)}
              </button>
            ))}
          </div>

          {provider === 'claude-cli' && (
            <Field
              label="Translation model"
              placeholder={settings.claudeCliModel || 'sonnet'}
              value={settings.translateClaudeCliModel ?? ''}
              onChange={(v) => update('translateClaudeCliModel', v || undefined)}
            />
          )}

          {provider === 'anthropic-api' && (
            <Field
              label="Translation model"
              placeholder={settings.anthropicModel || 'claude-haiku-4-5-20251001'}
              value={settings.translateAnthropicModel ?? ''}
              onChange={(v) => update('translateAnthropicModel', v || undefined)}
            />
          )}

          {provider === 'openai-compatible' && (
            <div className="space-y-2">
              <div className="flex items-center justify-between">
                <label className="text-xs uppercase tracking-wide text-neutral-500">
                  Translation model
                </label>
                <button
                  onClick={onRefreshModels}
                  disabled={fetchingModels}
                  className="text-[10px] px-2 py-0.5 rounded border border-neutral-800 hover:bg-neutral-800 disabled:opacity-50 flex items-center gap-1"
                >
                  <RefreshCw size={10} className={fetchingModels ? 'animate-spin' : ''} />
                  {fetchingModels ? 'Fetching' : `Refresh${models.length ? ` (${models.length})` : ''}`}
                </button>
              </div>
              {models.length > 0 ? (
                <ModelPicker
                  models={models}
                  value={settings.translateOpenaiModel ?? ''}
                  onChange={(v) => update('translateOpenaiModel', v || undefined)}
                />
              ) : (
                <input
                  className="w-full bg-neutral-900 border border-neutral-800 rounded px-2 py-1 font-mono text-xs"
                  placeholder={settings.openaiModel || 'click Refresh to load models'}
                  value={settings.translateOpenaiModel ?? ''}
                  onChange={(e) => update('translateOpenaiModel', e.target.value || undefined)}
                />
              )}
              {modelsError && <p className="text-[11px] text-rose-400">{modelsError}</p>}
            </div>
          )}

          <p className="text-[11px] text-neutral-500">
            Uses the same API key and base URL as the matching provider above. Leave the
            model blank to fall back to the digest model.
          </p>
        </div>
      )}
    </section>
  )
}

function SshHostsSection({
  hosts,
  onChange,
  onPersist
}: {
  hosts: SshHostConfig[]
  onChange: (next: SshHostConfig[]) => void
  onPersist: (next: SshHostConfig[]) => Promise<void>
}): JSX.Element {
  const [refreshing, setRefreshing] = useState(false)
  const [busyAlias, setBusyAlias] = useState<string | null>(null)
  const [statusByAlias, setStatusByAlias] = useState<Record<string, string>>({})

  const refreshFromConfig = async (): Promise<void> => {
    setRefreshing(true)
    try {
      const aliases = await window.selfer.listSshAliases()
      const byAlias = new Map(hosts.map((h) => [h.alias, h]))
      const merged: SshHostConfig[] = aliases.map(
        (a) => byAlias.get(a) ?? { alias: a, enabled: false }
      )
      // Preserve hosts not present in ~/.ssh/config (manual additions) at the end.
      for (const h of hosts) {
        if (!aliases.includes(h.alias)) merged.push(h)
      }
      await onPersist(merged)
    } finally {
      setRefreshing(false)
    }
  }

  const updateHost = (alias: string, patch: Partial<SshHostConfig>): void => {
    onChange(hosts.map((h) => (h.alias === alias ? { ...h, ...patch } : h)))
  }

  // Apply a patch and persist to disk in one shot — used for state changes that
  // should take effect immediately (enabled toggle, error dismiss, delete).
  const persistPatch = async (alias: string, patch: Partial<SshHostConfig>): Promise<void> => {
    const next = hosts.map((h) => (h.alias === alias ? { ...h, ...patch } : h))
    await onPersist(next)
  }

  const toggleEnabled = async (alias: string, enabled: boolean): Promise<void> => {
    // Clear any stale error — the user is reconfiguring.
    await persistPatch(alias, { enabled, lastError: undefined })
  }

  const dismissError = async (alias: string): Promise<void> => {
    await persistPatch(alias, { lastError: undefined })
    setStatusByAlias((s) => {
      const { [alias]: _drop, ...rest } = s
      return rest
    })
  }

  const removeHost = async (alias: string): Promise<void> => {
    const ok = window.confirm(
      `Remove SSH host "${alias}" from Selfer?\n\nThe local mirror at ~/.selfer/remote/${alias}/ is left intact and can be cleaned up manually.`
    )
    if (!ok) return
    const next = hosts.filter((h) => h.alias !== alias)
    await onPersist(next)
    setStatusByAlias((s) => {
      const { [alias]: _drop, ...rest } = s
      return rest
    })
  }

  const test = async (alias: string): Promise<void> => {
    setBusyAlias(alias)
    setStatusByAlias((s) => ({ ...s, [alias]: 'Testing…' }))
    try {
      // Persist any in-memory edits (e.g. override fields) so the backend reads
      // the same state we see.
      await onPersist(hosts)
      const r = await window.selfer.testSshHost(alias)
      if (r.ok) {
        updateHost(alias, {
          lastResolved: {
            at: new Date().toISOString(),
            home: r.resolvedHome ?? '',
            claudeProjectsDir: r.resolvedClaudeProjectsDir ?? '',
            codexSessionsDir: r.resolvedCodexSessionsDir ?? ''
          },
          lastError: undefined
        })
        setStatusByAlias((s) => ({
          ...s,
          [alias]: `OK · ${r.resolvedClaudeProjectsDir} · ${r.resolvedCodexSessionsDir}`
        }))
      } else {
        updateHost(alias, { lastError: r.error })
        setStatusByAlias((s) => ({ ...s, [alias]: `Error: ${r.error}` }))
      }
    } finally {
      setBusyAlias(null)
    }
  }

  const sync = async (alias: string): Promise<void> => {
    setBusyAlias(alias)
    setStatusByAlias((s) => ({ ...s, [alias]: 'Syncing…' }))
    try {
      // Persist before triggering — backend reads from disk.
      await onPersist(hosts)
      const r = await window.selfer.syncSshHost(alias)
      if (r.ok) {
        updateHost(alias, { lastSyncAt: new Date().toISOString(), lastError: undefined })
        setStatusByAlias((s) => ({ ...s, [alias]: 'Synced.' }))
      } else {
        updateHost(alias, { lastError: r.error })
        setStatusByAlias((s) => ({ ...s, [alias]: `Error: ${r.error}` }))
      }
    } finally {
      setBusyAlias(null)
    }
  }

  return (
    <section className="space-y-3">
      <div className="flex items-center justify-between">
        <label className="block text-xs uppercase tracking-wide text-neutral-500">
          SSH hosts
        </label>
        <button
          onClick={() => void refreshFromConfig()}
          disabled={refreshing}
          className="text-[10px] px-2 py-0.5 rounded border border-neutral-800 hover:bg-neutral-800 disabled:opacity-50 inline-flex items-center gap-1"
        >
          <RefreshCw size={10} className={refreshing ? 'animate-spin' : ''} />
          {refreshing ? 'Reading config' : 'Refresh from ~/.ssh/config'}
        </button>
      </div>
      <p className="text-xs text-neutral-500">
        Mirrors enabled hosts via <code>rsync</code> into{' '}
        <code className="bg-neutral-900 px-1 rounded">~/.selfer/remote/&lt;alias&gt;/</code>.
        Remote paths come from the host&apos;s own <code>$CLAUDE_CONFIG_DIR</code> /{' '}
        <code>$CODEX_HOME</code> (or <code>$HOME/.claude</code> · <code>$HOME/.codex</code>).
      </p>

      {hosts.length === 0 && (
        <div className="p-4 rounded border border-dashed border-neutral-800 text-xs text-neutral-500">
          No hosts. Click &ldquo;Refresh from ~/.ssh/config&rdquo;.
        </div>
      )}

      <div className="space-y-2">
        {hosts.map((h) => (
          <div
            key={h.alias}
            className="p-3 rounded border border-neutral-800 bg-neutral-900/40 space-y-2"
          >
            <div className="flex items-center gap-3">
              <label className="flex items-center gap-2 cursor-pointer">
                <input
                  type="checkbox"
                  checked={h.enabled}
                  onChange={(e) => void toggleEnabled(h.alias, e.target.checked)}
                />
                <span className="font-mono text-sm">{h.alias}</span>
              </label>
              <div className="flex-1" />
              <button
                onClick={() => void test(h.alias)}
                disabled={busyAlias === h.alias}
                className="text-[10px] px-2 py-0.5 rounded border border-neutral-800 hover:bg-neutral-800 disabled:opacity-50"
              >
                Test
              </button>
              <button
                onClick={() => void sync(h.alias)}
                disabled={busyAlias === h.alias || !h.enabled}
                className="text-[10px] px-2 py-0.5 rounded border border-neutral-800 hover:bg-neutral-800 disabled:opacity-50"
                title={h.enabled ? 'Pull and reindex this host now' : 'Enable this host to sync'}
              >
                Sync now
              </button>
              <button
                onClick={() => void removeHost(h.alias)}
                disabled={busyAlias === h.alias}
                className="text-[10px] p-1 rounded border border-neutral-800 text-neutral-500 hover:text-rose-300 hover:border-rose-900 hover:bg-rose-950/30 disabled:opacity-50"
                title="Remove this host from Selfer"
                aria-label={`Remove ${h.alias}`}
              >
                <Trash2 size={11} />
              </button>
            </div>
            {(statusByAlias[h.alias] || h.lastResolved || h.lastSyncAt || h.lastError) && (
              <div className="text-[11px] font-mono text-neutral-400 space-y-0.5">
                {statusByAlias[h.alias] && <div>{statusByAlias[h.alias]}</div>}
                {h.lastResolved && (
                  <div className="text-neutral-500">
                    HOME={h.lastResolved.home} · claude={h.lastResolved.claudeProjectsDir} ·
                    codex={h.lastResolved.codexSessionsDir}
                  </div>
                )}
                {h.lastSyncAt && (
                  <div className="text-neutral-500">
                    last sync: {formatDateTime(h.lastSyncAt)}
                  </div>
                )}
                {h.lastError && (
                  <div className="flex items-start gap-1.5 text-rose-400">
                    <span className="flex-1 break-words">{h.lastError}</span>
                    <button
                      onClick={() => void dismissError(h.alias)}
                      className="shrink-0 p-0.5 rounded text-rose-400/70 hover:text-rose-200 hover:bg-rose-950/50"
                      title="Dismiss this error"
                      aria-label="Dismiss error"
                    >
                      <X size={10} />
                    </button>
                  </div>
                )}
              </div>
            )}
            <details className="text-xs">
              <summary className="cursor-pointer text-neutral-500 hover:text-neutral-300">
                Advanced overrides
              </summary>
              <div className="mt-2 space-y-2">
                <input
                  className="w-full bg-neutral-900 border border-neutral-800 rounded px-2 py-1 font-mono text-xs"
                  placeholder="override remote claude projects dir (e.g. /home/me/.claude/projects)"
                  value={h.overrideClaudeProjectsDir ?? ''}
                  onChange={(e) =>
                    updateHost(h.alias, {
                      overrideClaudeProjectsDir: e.target.value || undefined
                    })
                  }
                />
                <input
                  className="w-full bg-neutral-900 border border-neutral-800 rounded px-2 py-1 font-mono text-xs"
                  placeholder="override remote codex sessions dir (e.g. /home/me/.codex/sessions)"
                  value={h.overrideCodexSessionsDir ?? ''}
                  onChange={(e) =>
                    updateHost(h.alias, {
                      overrideCodexSessionsDir: e.target.value || undefined
                    })
                  }
                />
                <p className="text-[11px] text-neutral-500">
                  Use overrides only if the remote&apos;s non-interactive shell
                  doesn&apos;t export <code>CLAUDE_CONFIG_DIR</code> /{' '}
                  <code>CODEX_HOME</code>.
                </p>
              </div>
            </details>
          </div>
        ))}
      </div>
    </section>
  )
}

function SaveButton({
  state,
  onSave
}: {
  state: SaveState
  onSave: () => void
}): JSX.Element {
  const isSaved = state === 'saved'
  const isSaving = state === 'saving'
  return (
    <button
      onClick={onSave}
      disabled={isSaving || isSaved}
      className={`group relative inline-flex items-center gap-2 px-4 py-1.5 rounded-md border text-sm transition-all duration-200 min-w-[96px] justify-center ${
        isSaved
          ? 'border-emerald-600/70 bg-emerald-600/15 text-emerald-300'
          : isSaving
            ? 'border-neutral-700 bg-neutral-900 text-neutral-400 cursor-wait'
            : 'border-neutral-700 hover:border-neutral-500 hover:bg-neutral-800 text-neutral-100'
      }`}
    >
      {isSaved ? (
        <>
          <Check size={14} className="animate-[pop_200ms_ease-out]" />
          Saved
        </>
      ) : isSaving ? (
        <>
          <RefreshCw size={14} className="animate-spin" />
          Saving
        </>
      ) : (
        <>Save</>
      )}
    </button>
  )
}

function ModelPicker({
  models,
  value,
  onChange
}: {
  models: OpenAIModelInfo[]
  value: string
  onChange: (v: string) => void
}): JSX.Element {
  const [open, setOpen] = useState(false)
  const [filter, setFilter] = useState('')
  const filterInputRef = useRef<HTMLInputElement | null>(null)
  const containerRef = useRef<HTMLDivElement | null>(null)

  // Close on outside click.
  useEffect(() => {
    if (!open) return
    const onDown = (e: MouseEvent): void => {
      if (!containerRef.current?.contains(e.target as Node)) setOpen(false)
    }
    const onKey = (e: KeyboardEvent): void => {
      if (e.key === 'Escape') setOpen(false)
    }
    document.addEventListener('mousedown', onDown)
    document.addEventListener('keydown', onKey)
    return () => {
      document.removeEventListener('mousedown', onDown)
      document.removeEventListener('keydown', onKey)
    }
  }, [open])

  // Focus filter when opened; reset filter when closed.
  useEffect(() => {
    if (open) {
      requestAnimationFrame(() => filterInputRef.current?.focus())
    } else {
      setFilter('')
    }
  }, [open])

  const q = filter.trim().toLowerCase()
  const filtered = q
    ? models.filter((m) => m.id.toLowerCase().includes(q) || m.ownedBy.toLowerCase().includes(q))
    : models

  const groups = new Map<string, OpenAIModelInfo[]>()
  for (const m of filtered) {
    const key = m.ownedBy || 'other'
    const arr = groups.get(key) ?? []
    arr.push(m)
    groups.set(key, arr)
  }

  const selected = models.find((m) => m.id === value)
  const pick = (id: string): void => {
    onChange(id)
    setOpen(false)
  }

  return (
    <div ref={containerRef} className="relative">
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        className={`w-full bg-neutral-900 border rounded px-3 py-1.5 text-left text-xs font-mono flex items-center justify-between gap-2 transition-colors ${
          open
            ? 'border-emerald-700'
            : 'border-neutral-800 hover:border-neutral-700'
        }`}
      >
        <span className={value ? 'text-neutral-100 truncate' : 'text-neutral-500'}>
          {value || 'Select a model…'}
        </span>
        <span className="flex items-center gap-2 shrink-0">
          {selected?.ownedBy && (
            <span className="text-[10px] px-1.5 py-0.5 rounded bg-neutral-800 text-neutral-400 font-sans normal-case tracking-normal">
              {selected.ownedBy}
            </span>
          )}
          <ChevronDown
            size={14}
            className={`text-neutral-500 transition-transform ${open ? 'rotate-180' : ''}`}
          />
        </span>
      </button>

      {open && (
        <div className="absolute z-20 mt-1 w-full rounded-md border border-neutral-700 bg-neutral-950 shadow-xl shadow-black/60 overflow-hidden animate-[fadeIn_120ms_ease-out]">
          <div className="p-2 border-b border-neutral-800">
            <input
              ref={filterInputRef}
              className="w-full bg-neutral-900 border border-neutral-800 rounded px-2 py-1 text-xs focus:outline-none focus:border-emerald-700"
              placeholder="filter…"
              value={filter}
              onChange={(e) => setFilter(e.target.value)}
            />
          </div>
          <div className="max-h-64 overflow-auto">
            {groups.size === 0 && (
              <div className="px-3 py-6 text-center text-xs text-neutral-500">No matches.</div>
            )}
            {[...groups.entries()].map(([owner, items]) => (
              <div key={owner}>
                <div className="px-3 py-1 text-[10px] uppercase tracking-wider text-neutral-500 bg-neutral-900/80 border-b border-neutral-800 sticky top-0">
                  {owner}
                  <span className="text-neutral-600"> · {items.length}</span>
                </div>
                {items.map((m) => (
                  <button
                    key={m.id}
                    onClick={() => pick(m.id)}
                    className={`w-full text-left px-3 py-1.5 text-xs font-mono flex items-center justify-between transition-colors ${
                      value === m.id
                        ? 'bg-emerald-950/50 text-emerald-200'
                        : 'text-neutral-300 hover:bg-neutral-900'
                    }`}
                  >
                    <span className="truncate">{m.id}</span>
                    {value === m.id && <Check size={12} className="shrink-0 text-emerald-400" />}
                  </button>
                ))}
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  )
}

function Field({
  label,
  placeholder,
  value,
  onChange,
  password,
  mono
}: {
  label: string
  placeholder?: string
  value: string
  onChange: (v: string) => void
  password?: boolean
  mono?: boolean
}): JSX.Element {
  return (
    <div className="space-y-1">
      <label className="block text-xs uppercase tracking-wide text-neutral-500">{label}</label>
      <input
        type={password ? 'password' : 'text'}
        className={`w-full bg-neutral-900 border border-neutral-800 rounded px-2 py-1 ${
          mono ? 'font-mono text-xs' : ''
        }`}
        placeholder={placeholder}
        value={value}
        onChange={(e) => onChange(e.target.value)}
      />
    </div>
  )
}
