'use client'

import { useEffect } from 'react'
import { resolveIcon } from '@/lib/icons'
import type { ActionItem } from '../engine/gantt.types'

interface Props {
  x:       number
  y:       number
  actions: ActionItem[]
  onClose: () => void
}

export function GanttContextMenu({ x, y, actions, onClose }: Props) {
  useEffect(() => {
    function onKey(e: KeyboardEvent) { if (e.key === 'Escape') onClose() }
    function onPointer(e: PointerEvent) {
      if (!(e.target as Element).closest('[data-context-menu]')) onClose()
    }
    window.addEventListener('keydown',    onKey)
    window.addEventListener('pointerdown', onPointer)
    return () => {
      window.removeEventListener('keydown',    onKey)
      window.removeEventListener('pointerdown', onPointer)
    }
  }, [onClose])

  // keep the menu inside the viewport
  const safeX = Math.min(x, window.innerWidth  - 192)
  const safeY = Math.min(y, window.innerHeight - actions.length * 36 - 8)

  return (
    <div
      data-context-menu
      style={{ position: 'fixed', top: safeY, left: safeX }}
      className="z-50 min-w-48 bg-popover border border-border rounded-lg shadow-lg py-1 select-none"
    >
      {actions.map((action, i) => {
        const Icon = action.icon ? resolveIcon(action.icon) : null
        return (
          <button
            key={`${action.id}-${i}`}
            onClick={() => { action.onClick(); onClose() }}
            disabled={action.disabled}
            className={[
              'w-full flex items-center gap-2.5 px-3 py-1.5 text-sm text-left transition-colors',
              action.danger
                ? 'text-destructive hover:bg-destructive/10'
                : 'text-foreground hover:bg-muted',
              action.disabled ? 'opacity-40 pointer-events-none' : '',
            ].join(' ')}
          >
            {Icon && <Icon className="w-4 h-4 shrink-0 text-muted-foreground" />}
            <span>{action.label ?? action.id}</span>
          </button>
        )
      })}
    </div>
  )
}
