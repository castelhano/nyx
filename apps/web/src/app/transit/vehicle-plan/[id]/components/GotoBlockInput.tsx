'use client'

import { useState } from 'react'
import { Icons } from '@/lib/icons'

interface Props {
  // Returns an error message to show inline, or null when the jump succeeded
  // (the caller closes the input in that case).
  onGoto:  (blockNumber: number) => string | null
  onClose: () => void
}

export function GotoBlockInput({ onGoto, onClose }: Props) {
  const [value, setValue] = useState('')
  const [error, setError] = useState<string | null>(null)

  function submit() {
    const n = Number(value)
    if (!value || !Number.isInteger(n)) { setError('Informe o número do bloco'); return }
    setError(onGoto(n))
  }

  return (
    <div
      style={{ animation: 'var(--animate-action-bar-in)' }}
      // Same spot as BlockFilterBar, one layer above it — transient, so covering it is fine.
      className="absolute top-1 inset-x-0 mx-auto w-fit z-30 flex items-center gap-2 px-2.5 py-1 bg-background border border-border rounded-lg shadow-lg text-xs"
    >
      <Icons.Search className="w-3.5 h-3.5 text-muted-foreground" />
      <input
        autoFocus
        inputMode="numeric"
        value={value}
        placeholder="Ir para bloco…"
        onChange={e => { setValue(e.target.value.replace(/\D/g, '')); setError(null) }}
        onBlur={onClose}
        onKeyDown={e => {
          if (e.key === 'Enter')  { e.preventDefault(); submit() }
          if (e.key === 'Escape') { e.preventDefault(); e.stopPropagation(); onClose() }
        }}
        className="h-6 w-28 rounded-sm border border-input bg-input-bg px-1.5 text-xs focus:outline-none focus:ring-1 focus:ring-ring"
      />
      {error && <span className="text-destructive whitespace-nowrap">{error}</span>}
    </div>
  )
}
