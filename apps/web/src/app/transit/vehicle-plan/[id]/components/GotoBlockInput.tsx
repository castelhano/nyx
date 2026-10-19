'use client'

import { useState } from 'react'
import { Icons } from '@/lib/icons'

// block: a block number; line: a line code — the line's next trip after the focus
export type GotoMode = 'block' | 'line'

interface Props {
  initialMode: GotoMode
  // Returns an error message to show inline, or null when the jump succeeded
  // (the caller closes the input in that case).
  onGoto:  (mode: GotoMode, value: string) => string | null
  onClose: () => void
}

export function GotoBlockInput({ initialMode, onGoto, onClose }: Props) {
  const [mode,  setMode]  = useState<GotoMode>(initialMode)
  const [value, setValue] = useState('')
  const [error, setError] = useState<string | null>(null)

  function submit() {
    const v = value.trim()
    if (mode === 'block') {
      const n = Number(v)
      if (!v || !Number.isInteger(n)) { setError('Informe o número do bloco'); return }
    } else if (!v) { setError('Informe o código da linha'); return }
    setError(onGoto(mode, v))
  }

  // Tab switches the mode — a block number can't carry over into a line code (or back)
  function toggleMode() {
    setMode(m => m === 'block' ? 'line' : 'block')
    setValue('')
    setError(null)
  }

  return (
    <div
      style={{ animation: 'var(--animate-action-bar-in)' }}
      // Same spot as BlockFilterBar, one layer above it — transient, so covering it is fine.
      className="absolute top-1 inset-x-0 mx-auto w-fit z-30 flex items-center gap-2 px-2.5 py-1 bg-background border border-border rounded-lg shadow-lg text-xs"
    >
      <Icons.Search className="w-3.5 h-3.5 text-muted-foreground" />
      <button
        // keeps the input focused (its blur closes the bar)
        onMouseDown={e => { e.preventDefault(); toggleMode() }}
        title="Tab alterna entre bloco e linha"
        className="h-6 rounded px-2 font-medium bg-muted hover:bg-muted/70 text-foreground"
      >
        {mode === 'block' ? 'Bloco' : 'Linha'}
      </button>
      <input
        autoFocus
        inputMode={mode === 'block' ? 'numeric' : 'text'}
        value={value}
        placeholder={mode === 'block' ? 'Nº do bloco…' : 'Código da linha…'}
        onChange={e => { setValue(mode === 'block' ? e.target.value.replace(/\D/g, '') : e.target.value); setError(null) }}
        onBlur={onClose}
        onKeyDown={e => {
          if (e.key === 'Enter')  { e.preventDefault(); submit() }
          if (e.key === 'Tab')    { e.preventDefault(); toggleMode() }
          if (e.key === 'Escape') { e.preventDefault(); e.stopPropagation(); onClose() }
        }}
        className="h-6 w-28 rounded-sm border border-input bg-input-bg px-1.5 text-xs focus:outline-none focus:ring-1 focus:ring-ring"
      />
      {error && <span className="text-destructive whitespace-nowrap">{error}</span>}
    </div>
  )
}
