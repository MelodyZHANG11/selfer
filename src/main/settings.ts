import fs from 'node:fs'
import { DIGESTS_DIR, SETTINGS_PATH } from '@shared/paths'
import type { Settings } from '@shared/types'

const DEFAULTS: Settings = {
  digestProvider: 'claude-cli',
  digestsDir: DIGESTS_DIR,
  claudeCliPath: '',
  claudeCliModel: 'sonnet',
  anthropicApiKey: '',
  anthropicModel: 'claude-opus-4-7',
  openaiBaseUrl: '',
  openaiApiKey: '',
  openaiModel: '',
  sshHosts: []
}

export function loadSettings(): Settings {
  try {
    const raw = fs.readFileSync(SETTINGS_PATH, 'utf8')
    const parsed = JSON.parse(raw) as Partial<Settings>
    return { ...DEFAULTS, ...parsed }
  } catch {
    return { ...DEFAULTS }
  }
}

export function saveSettings(s: Settings): void {
  fs.writeFileSync(SETTINGS_PATH, JSON.stringify(s, null, 2), 'utf8')
}
