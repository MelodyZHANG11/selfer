import type { DB } from './db'
import type { DigestInfo, DigestQueueChangeEvent, DigestQueueStatus } from '@shared/types'
import { generateDigest } from './digest'

/**
 * Single-threaded FIFO queue for digest regenerations. Lives in the main process so
 * the in-flight state survives renderer route changes. The renderer mirrors status
 * via getStatus() on mount and the onChange push events thereafter.
 */
export class DigestQueue {
  private current: string | null = null
  private pending: string[] = []
  private listeners = new Set<(e: DigestQueueChangeEvent) => void>()

  constructor(private db: DB) {}

  getStatus(): DigestQueueStatus {
    return { current: this.current, pending: [...this.pending] }
  }

  enqueue(date: string): DigestQueueStatus {
    if (this.current === date || this.pending.includes(date)) {
      return this.getStatus()
    }
    this.pending.push(date)
    this.emit()
    void this.tick()
    return this.getStatus()
  }

  onChange(fn: (e: DigestQueueChangeEvent) => void): () => void {
    this.listeners.add(fn)
    return () => {
      this.listeners.delete(fn)
    }
  }

  private async tick(): Promise<void> {
    if (this.current !== null) return
    const next = this.pending.shift()
    if (!next) return
    this.current = next
    this.emit()
    let info: DigestInfo | undefined
    let error: string | undefined
    try {
      info = await generateDigest(this.db, next)
    } catch (err) {
      error = err instanceof Error ? err.message : String(err)
      console.warn(`[digest-queue] ${next} failed:`, error)
    }
    this.current = null
    this.emit({ date: next, info, error })
    void this.tick()
  }

  private emit(lastCompleted?: DigestQueueChangeEvent['lastCompleted']): void {
    const evt: DigestQueueChangeEvent = { ...this.getStatus(), lastCompleted }
    for (const fn of this.listeners) {
      try {
        fn(evt)
      } catch (err) {
        console.warn('[digest-queue] listener threw:', err)
      }
    }
  }
}
