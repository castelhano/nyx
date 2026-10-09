'use client'

import { useState } from 'react'
import { cn } from '@/lib/utils'
import { formatDuration, parseDuration } from '@/lib/duration'

// Minutes in, minutes out — typed and shown as H:MM. A bare number is read as minutes (90 → 1:30).
// Every readable keystroke commits (clamped), so a save never sees a stale value; the text is
// only normalized on blur/Enter. ↑/↓ step 1 min, with shift 15 min.
export function DurationInput({ value, onChange, min = 0, max, disabled, className }: {
  value:      number
  onChange:   (minutes: number) => void
  min?:       number
  max?:       number
  disabled?:  boolean
  className?: string
}) {
  // text being typed — null while not editing, so outside changes (reset) show through
  const [draft, setDraft] = useState<string | null>(null)

  const clamp = (v: number) => Math.max(min, max !== undefined ? Math.min(max, v) : v)

  function commit(v: number) {
    const next = clamp(v)
    if (next !== value) onChange(next)
    return next
  }

  return (
    <input
      type="text"
      inputMode="numeric"
      value={draft ?? formatDuration(value)}
      disabled={disabled}
      onChange={(e) => {
        setDraft(e.target.value)
        const v = parseDuration(e.target.value)
        if (v !== null) commit(v)
      }}
      onBlur={() => setDraft(null)}
      onKeyDown={(e) => {
        if (e.key === 'Enter') {
          setDraft(null)
        } else if (e.key === 'ArrowUp' || e.key === 'ArrowDown') {
          e.preventDefault()
          const step = (e.shiftKey ? 15 : 1) * (e.key === 'ArrowUp' ? 1 : -1)
          const next = commit(value + step)
          if (draft !== null) setDraft(formatDuration(next))
        }
      }}
      className={cn(
        'h-8 w-20 rounded-sm border border-input bg-input-bg text-center text-sm tabular-nums',
        'focus:outline-none focus:ring-1 focus:ring-ring',
        'disabled:cursor-not-allowed disabled:opacity-60',
        className,
      )}
    />
  )
}
