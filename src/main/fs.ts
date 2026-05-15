import fs from 'node:fs'
import { SELFER_DIR, EDITS_DIR, DIGESTS_DIR, REMOTE_DIR } from '@shared/paths'

export function ensureSelferDirs(): void {
  for (const dir of [SELFER_DIR, EDITS_DIR, DIGESTS_DIR, REMOTE_DIR]) {
    fs.mkdirSync(dir, { recursive: true })
  }
}
