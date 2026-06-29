'use client'

import { useEffect, useRef, useState } from 'react'
import { createPortal } from 'react-dom'
import { Button } from '@/components/ui/button'
import { cn } from '@/lib/utils'
import { useShortcutContext } from '@/lib/keywatch'

export interface ConfirmModalOptions {
  title:          string
  description?:   string
  confirmLabel?:  string
  cancelLabel?:   string
  variant?:       'destructive' | 'default' | 'safeConfirm'
  /** When true, pressing Escape does not close the modal. Default: true */
  dismissOnEsc?:  boolean
  /** Seconds the confirm button stays disabled before the user can click it */
  confirmDelay?:  number
}

interface ConfirmModalProps extends ConfirmModalOptions {
  onConfirm: () => void
  onCancel:  () => void
}

export function ConfirmModal({
  title,
  description,
  confirmLabel = 'Excluir',
  cancelLabel  = 'Cancelar',
  variant      = 'destructive',
  dismissOnEsc = true,
  confirmDelay = 0,
  onConfirm,
  onCancel,
}: ConfirmModalProps) {
  const confirmRef                  = useRef<HTMLButtonElement>(null)
  const [remaining, setRemaining]   = useState(confirmDelay)
  const isLocked                    = remaining > 0

  useShortcutContext('modal')

  useEffect(() => {
    if (!isLocked) confirmRef.current?.focus()
  }, [isLocked])

  useEffect(() => {
    if (confirmDelay <= 0) return
    const id = setInterval(() => {
      setRemaining((s) => {
        if (s <= 1) { clearInterval(id); return 0 }
        return s - 1
      })
    }, 1000)
    return () => clearInterval(id)
  }, [confirmDelay])

  useEffect(() => {
    if (!dismissOnEsc) return
    function handleKey(e: KeyboardEvent) {
      if (e.key === 'Escape') onCancel()
    }
    document.addEventListener('keydown', handleKey)
    return () => document.removeEventListener('keydown', handleKey)
  }, [dismissOnEsc, onCancel])

  return createPortal(
    <div
      className="fixed inset-0 z-50 flex items-start justify-center pt-32"
      role="dialog"
      aria-modal="true"
      aria-labelledby="confirm-modal-title"
    >
      {/* Backdrop */}
      <div
        className="absolute inset-0 bg-black/50"
        onClick={dismissOnEsc ? onCancel : undefined}
      />

      {/* Panel */}
      <div className={cn(
        'relative z-10 w-full max-w-sm rounded-md border border-border bg-background p-6 shadow-lg',
        'flex flex-col gap-4',
        'animate-confirm-in',
      )}>
        <div className="flex flex-col gap-1">
          <h2 id="confirm-modal-title" className="text-base font-semibold text-foreground">
            {title}
          </h2>
          {description && (
            <p className="text-sm text-muted-foreground">{description}</p>
          )}
        </div>

        <div className="flex justify-end gap-2">
          <Button variant="outline" tabIndex={-1} onClick={onCancel}>
            {cancelLabel}
          </Button>
          <Button ref={confirmRef} variant={variant} onClick={onConfirm} disabled={isLocked}>
            {isLocked ? `${confirmLabel} (${remaining}s)` : confirmLabel}
          </Button>
        </div>
      </div>
    </div>,
    document.body,
  )
}
