// Inputs are UTC ISO 8601 strings (ending in `Z`) as stored in SQLite.
// Outputs use the runtime's local timezone via Intl / toLocale*.

function parse(iso: string | null | undefined): Date | null {
  if (!iso) return null
  const d = new Date(iso)
  return Number.isNaN(d.getTime()) ? null : d
}

export function formatDateTime(iso: string | null | undefined): string {
  const d = parse(iso)
  return d ? d.toLocaleString() : ''
}

export function formatDate(iso: string | null | undefined): string {
  const d = parse(iso)
  return d ? d.toLocaleDateString() : ''
}

export function formatMonthDay(iso: string | null | undefined): string {
  const d = parse(iso)
  return d ? d.toLocaleDateString(undefined, { month: 'short', day: 'numeric' }) : ''
}

export function formatHM(iso: string | null | undefined): string {
  const d = parse(iso)
  if (!d) return iso ?? ''
  return d.toLocaleTimeString('en-GB', { hour: '2-digit', minute: '2-digit' })
}

export function relativeTime(iso: string | null | undefined): string {
  const d = parse(iso)
  if (!d) return iso ?? ''
  const diff = Date.now() - d.getTime()
  const m = Math.round(diff / 60_000)
  if (m < 1) return 'just now'
  if (m < 60) return `${m}m ago`
  const h = Math.floor(m / 60)
  if (h < 24) return `${h}h ago`
  return `${Math.floor(h / 24)}d ago`
}
