'use client'

import { useEffect, useState, useRef } from 'react'
import { resolveIcon, Icons }          from '@/lib/icons'
import type { Selection, ActionItem, SplitMenuItem } from '../engine/gantt.types'

interface Props {
  selection: Selection
  actions:   ActionItem[]
  onDismiss: () => void
}

export function GanttActionBar({ selection, actions, onDismiss }: Props) {
  const [openMenuId, setOpenMenuId] = useState<string | null>(null)

  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      if (e.key === 'Escape') {
        if (openMenuId) { setOpenMenuId(null); return }
        onDismiss()
      }
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [onDismiss, openMenuId])

  // close dropdown on outside click
  useEffect(() => {
    if (!openMenuId) return
    function onPointer(e: PointerEvent) {
      const target = e.target as Element
      if (!target.closest('[data-action-menu]')) setOpenMenuId(null)
    }
    window.addEventListener('pointerdown', onPointer)
    return () => window.removeEventListener('pointerdown', onPointer)
  }, [openMenuId])

  const summary = selectionSummary(selection)

  return (
    <div
      style={{ animation: 'var(--animate-action-bar-in)' }}
      className="absolute bottom-6 inset-x-0 mx-auto w-fit z-20 flex items-center gap-3 px-4 py-2.5 bg-background border border-border rounded-xl shadow-lg"
    >
      <span className="text-sm font-medium text-foreground whitespace-nowrap select-none">
        {summary}
      </span>

      <div className="w-px h-4 bg-border shrink-0" />

      <div className="flex items-center gap-1">
        {actions.map(action => (
          action.splitMenu
            ? <SplitButton
                key={action.id}
                action={action}
                menuOpen={openMenuId === action.id}
                onToggleMenu={() => setOpenMenuId(v => v === action.id ? null : action.id)}
              />
            : <ActionButton key={action.id} action={action} />
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

// ── plain action button ───────────────────────────────────────────────────────

function ActionButton({ action }: { action: ActionItem }) {
  const Icon = action.icon ? resolveIcon(action.icon) : null

  const colorClass = action.danger
    ? 'bg-destructive/10 hover:bg-destructive/20 text-destructive'
    : action.active
      ? 'bg-amber-500/15 hover:bg-amber-500/25 text-amber-600 dark:text-amber-400'
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

// ── split button ──────────────────────────────────────────────────────────────

function SplitButton({
  action,
  menuOpen,
  onToggleMenu,
}: {
  action:        ActionItem
  menuOpen:      boolean
  onToggleMenu:  () => void
}) {
  const Icon = action.icon ? resolveIcon(action.icon) : null

  const baseColor = action.active
    ? 'bg-amber-500/15 text-amber-600 dark:text-amber-400'
    : 'bg-muted text-foreground'
  const hoverMain    = action.active ? 'hover:bg-amber-500/25' : 'hover:bg-muted/70'
  const hoverChevron = action.active ? 'hover:bg-amber-500/30' : 'hover:bg-accent'

  return (
    <div data-action-menu className="relative flex items-center">
      {/* main button */}
      <button
        onClick={action.onClick}
        disabled={action.disabled}
        title={action.variant === 'icon' ? (action.label ?? action.id) : undefined}
        className={[
          'flex items-center gap-1.5 h-8 rounded-l px-2.5 text-sm font-medium transition-colors border-r border-background/30',
          baseColor, hoverMain,
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

      {/* chevron toggle */}
      <button
        onClick={onToggleMenu}
        className={[
          'flex items-center justify-center h-8 w-6 rounded-r text-sm transition-colors',
          baseColor, hoverChevron,
        ].join(' ')}
      >
        <Icons.ChevronDown className={['w-3 h-3 transition-transform', menuOpen ? 'rotate-180' : ''].join(' ')} />
      </button>

      {/* dropdown */}
      {menuOpen && action.splitMenu && (
        <SplitMenuDropdown items={action.splitMenu} />
      )}
    </div>
  )
}

function SplitMenuDropdown({ items }: { items: SplitMenuItem[] }) {
  return (
    <div className="absolute bottom-full left-0 mb-2 min-w-48 bg-popover border border-border rounded-lg shadow-lg py-1 z-30">
      {items.map((item, i) => (
        <label
          key={item.id}
          className={[
            'flex items-center gap-2.5 px-3 py-1.5 text-sm cursor-pointer select-none transition-colors hover:bg-muted',
            i > 0 && items[i - 1].id === 'sep' ? 'border-t border-border mt-1 pt-2' : '',
          ].join(' ')}
        >
          <CheckBox checked={item.checked} onChange={item.onToggle} />
          <span className="text-foreground">{item.label}</span>
        </label>
      ))}
    </div>
  )
}

function CheckBox({ checked, onChange }: { checked: boolean; onChange: () => void }) {
  const ref = useRef<HTMLInputElement>(null)
  return (
    <input
      ref={ref}
      type="checkbox"
      checked={checked}
      onChange={onChange}
      className="w-4 h-4 shrink-0 rounded"
    />
  )
}

// ── helpers ───────────────────────────────────────────────────────────────────

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
