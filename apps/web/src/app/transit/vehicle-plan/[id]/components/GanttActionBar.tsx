'use client'

import { useEffect }                 from 'react'
import { resolveIcon, Icons }        from '@/lib/icons'
import type { Selection, ActionItem } from '../engine/gantt.types'

interface Props {
  selection: Selection
  actions:   ActionItem[]
  onDismiss: () => void
}

export function GanttActionBar({ selection, actions, onDismiss }: Props) {
  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      if (e.key === 'Escape') onDismiss()
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [onDismiss])

  const summary = selectionSummary(selection)

  return (
    <div style={{ animation: 'var(--animate-action-bar-in)' }} className="absolute bottom-6 inset-x-0 mx-auto w-fit z-20 flex items-center gap-3 px-4 py-2.5 bg-background border border-border rounded-xl shadow-lg">
      <span className="text-sm font-medium text-foreground whitespace-nowrap select-none">
        {summary}
      </span>

      <div className="w-px h-4 bg-border shrink-0" />

      <div className="flex items-center gap-1">
        {actions.map(action => (
          <ActionButton key={action.id} action={action} />
        ))}
      </div>

      <div className="w-px h-4 bg-border shrink-0" />

      <button
        onClick={onDismiss}
        title="Dispensar (Esc)"
        className="flex items-center justify-center w-6 h-6 rounded text-muted-foreground hover:text-foreground hover:bg-muted transition-colors"
      >
        <Icons.X className="w-3.5 h-3.5" />
      </button>
    </div>
  )
}

function ActionButton({ action }: { action: ActionItem }) {
  const Icon = action.icon ? resolveIcon(action.icon) : null

  const colorClass = action.danger
    ? 'bg-destructive/10 hover:bg-destructive/20 text-destructive'
    : 'bg-muted hover:bg-muted/70 text-foreground'

  return (
    <button
      onClick={action.onClick}
      disabled={action.disabled}
      title={action.variant === 'icon' ? (action.label ?? action.id) : undefined}
      className={[
        'flex items-center gap-1.5 h-8 rounded px-2.5 text-sm font-medium transition-colors',
        colorClass,
        action.disabled ? 'opacity-50 pointer-events-none' : '',
      ].join(' ')}
    >
      {(action.variant === 'icon' || action.variant === 'both') && Icon && (
        <Icon className="w-4 h-4 shrink-0" />
      )}
      {(action.variant === 'text' || action.variant === 'both') && action.label && (
        <span>{action.label}</span>
      )}
    </button>
  )
}

function minutesToHHMM(minutes: number): string {
  const h = Math.floor(minutes / 60) % 24
  const m = minutes % 60
  return `${String(h).padStart(2, '0')}:${String(m).padStart(2, '0')}`
}

function selectionSummary(selection: Selection): string {
  if (selection.type === 'trip') {
    const { label, startMinute, endMinute } = selection.segment
    return `${label}  ${minutesToHHMM(startMinute)} – ${minutesToHHMM(endMinute)}`
  }
  const n     = selection.segments.length
  const start = Math.min(...selection.segments.map(s => s.startMinute))
  const end   = Math.max(...selection.segments.map(s => s.endMinute))
  return `[ ${n} ]  ${minutesToHHMM(start)} – ${minutesToHHMM(end)}`
}
