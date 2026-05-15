import { useEffect, useRef, useState } from 'react'
import { Check, Globe, Loader2 } from 'lucide-react'
import { DIGEST_LANGUAGES } from '@shared/types'

interface LanguagePickerProps {
  value: string
  onChange: (lang: string) => void
  busy?: boolean
  isStale?: boolean
}

export function LanguagePicker({
  value,
  onChange,
  busy = false,
  isStale = false
}: LanguagePickerProps): JSX.Element {
  const [open, setOpen] = useState(false)
  const containerRef = useRef<HTMLDivElement | null>(null)

  useEffect(() => {
    if (!open) return
    const onDocClick = (e: MouseEvent): void => {
      if (!containerRef.current) return
      if (!containerRef.current.contains(e.target as Node)) setOpen(false)
    }
    const onKey = (e: KeyboardEvent): void => {
      if (e.key === 'Escape') setOpen(false)
    }
    document.addEventListener('mousedown', onDocClick)
    document.addEventListener('keydown', onKey)
    return () => {
      document.removeEventListener('mousedown', onDocClick)
      document.removeEventListener('keydown', onKey)
    }
  }, [open])

  const current = DIGEST_LANGUAGES.find((l) => l.code === value) ?? DIGEST_LANGUAGES[0]
  const isSource = !value || value === 'source'

  return (
    <div className="relative" ref={containerRef}>
      <button
        type="button"
        disabled={busy}
        onClick={() => setOpen((o) => !o)}
        className={`inline-flex items-center gap-1.5 text-xs px-2 py-0.5 rounded border transition-colors ${
          isSource
            ? 'border-neutral-700 hover:bg-neutral-800 text-neutral-300'
            : 'border-sky-900/60 bg-sky-950/30 hover:bg-sky-950/60 text-sky-300'
        } ${busy ? 'opacity-60 cursor-wait' : ''}`}
        title={busy ? 'Translating…' : `Language: ${current.label}`}
        aria-haspopup="listbox"
        aria-expanded={open}
      >
        {busy ? (
          <Loader2 size={12} className="animate-spin" />
        ) : (
          <Globe size={12} />
        )}
        <span className="font-medium tracking-wide">{current.tag}</span>
        {isStale && !busy && (
          <span
            className="ml-0.5 text-[8px] uppercase tracking-wider px-1 py-px rounded bg-amber-950/60 text-amber-300"
            title="Source has changed since this translation was made"
          >
            stale
          </span>
        )}
      </button>

      {open && (
        <div
          role="listbox"
          className="absolute right-0 top-full mt-1 w-44 rounded-md border border-neutral-800 bg-neutral-900 shadow-lg shadow-black/40 z-30 overflow-hidden"
        >
          {DIGEST_LANGUAGES.map((lang, idx) => {
            const selected = lang.code === value || (lang.code === '' && isSource)
            return (
              <div key={lang.code || 'source'}>
                <button
                  type="button"
                  role="option"
                  aria-selected={selected}
                  onClick={() => {
                    setOpen(false)
                    if (lang.code !== value) onChange(lang.code)
                  }}
                  className={`w-full flex items-center justify-between px-3 py-1.5 text-xs text-left transition-colors ${
                    selected
                      ? 'text-sky-300 bg-sky-950/30'
                      : 'text-neutral-300 hover:bg-neutral-800'
                  }`}
                >
                  <span className="flex items-center gap-2">
                    <span className="text-neutral-500 w-6 text-[10px] uppercase tracking-wider">
                      {lang.tag}
                    </span>
                    <span>{lang.label}</span>
                  </span>
                  {selected && <Check size={12} />}
                </button>
                {idx === 0 && <div className="h-px bg-neutral-800" />}
              </div>
            )
          })}
        </div>
      )}
    </div>
  )
}
