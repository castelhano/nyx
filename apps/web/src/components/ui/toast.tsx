'use client'

import { useEffect, useRef, useState } from 'react'
import { createPortal } from 'react-dom'
import { X, CheckCircle, XCircle, AlertTriangle, Info } from 'lucide-react'
import { cn } from '@/lib/utils'
import { useToastContext, type Position, type ToastItem } from '@/lib/toast-context'

function useIsMobile() {
  const [isMobile, setIsMobile] = useState(false)
  useEffect(() => {
    const mq = window.matchMedia('(max-width: 768px)')
    setIsMobile(mq.matches)
    const handler = (e: MediaQueryListEvent) => setIsMobile(e.matches)
    mq.addEventListener('change', handler)
    return () => mq.removeEventListener('change', handler)
  }, [])
  return isMobile
}

const POSITION_CLS: Record<Position, string> = {
  'top-right':     'top-4 right-4 items-end',
  'top-left':      'top-4 left-4 items-start',
  'top-center':    'top-4 left-1/2 -translate-x-1/2 items-center',
  'bottom-right':  'bottom-4 right-4 items-end',
  'bottom-left':   'bottom-4 left-4 items-start',
  'bottom-center': 'bottom-4 left-1/2 -translate-x-1/2 items-center',
}

const SLIDE_FROM: Record<Position, string> = {
  'top-right':     '-translate-y-2',
  'top-left':      '-translate-y-2',
  'top-center':    '-translate-y-2',
  'bottom-right':  'translate-y-2',
  'bottom-left':   'translate-y-2',
  'bottom-center': 'translate-y-2',
}

const VARIANT_ICON_CLS: Record<string, string> = {
  success: 'text-emerald-500',
  error:   'text-destructive',
  warning: 'text-yellow-500',
  info:    'text-ring',
}

const VARIANT_BORDER_CLS: Record<string, string> = {
  success: 'border-emerald-500/25',
  error:   'border-destructive/35',
  warning: 'border-yellow-500/25',
  info:    'border-ring/25',
}

const ICONS = {
  success: CheckCircle,
  error:   XCircle,
  warning: AlertTriangle,
  info:    Info,
}

interface ToastCardProps {
  item:      ToastItem
  slideFrom: string
  onDismiss: (id: string) => void
}

function ToastCard({ item, slideFrom, onDismiss }: ToastCardProps) {
  const [visible, setVisible]   = useState(false)
  const timerRef = useRef<ReturnType<typeof setTimeout> | undefined>(undefined)

  useEffect(() => {
    requestAnimationFrame(() => setVisible(true))

    if (item.autoDismiss) {
      timerRef.current = setTimeout(handleDismiss, item.autoDismissDelay)
    }

    return () => { if (timerRef.current) clearTimeout(timerRef.current) }
  }, []) // eslint-disable-line react-hooks/exhaustive-deps

  function handleDismiss() {
    if (timerRef.current) clearTimeout(timerRef.current)
    setVisible(false)
    setTimeout(() => onDismiss(item.id), 200)
  }

  const Icon = ICONS[item.variant]

  return (
    <div
      role="alert"
      aria-live="polite"
      className={cn(
        'flex items-start gap-3 w-80 max-w-[calc(100vw-2rem)]',
        'rounded-md border bg-card px-4 py-3 shadow-lg',
        'transition-all duration-200',
        visible ? 'opacity-100 translate-y-0' : `opacity-0 ${slideFrom}`,
        VARIANT_BORDER_CLS[item.variant],
      )}
    >
      <Icon className={cn('mt-0.5 h-4 w-4 shrink-0', VARIANT_ICON_CLS[item.variant])} />
      <p className="flex-1 text-sm leading-snug text-foreground">{item.message}</p>
      <button
        onClick={handleDismiss}
        className="shrink-0 text-muted-foreground hover:text-foreground transition-colors"
        aria-label="Fechar notificação"
      >
        <X className="h-3.5 w-3.5" />
      </button>
    </div>
  )
}

export function Toaster() {
  const { toasts, remove, defaultPosition, defaultPositionMobile } = useToastContext()
  const isMobile = useIsMobile()
  const [mounted, setMounted] = useState(false)

  useEffect(() => { setMounted(true) }, [])
  if (!mounted) return null

  const groups = new Map<Position, ToastItem[]>()
  for (const toast of toasts) {
    const pos = toast.position ?? (isMobile ? defaultPositionMobile : defaultPosition)
    if (!groups.has(pos)) groups.set(pos, [])
    groups.get(pos)!.push(toast)
  }

  return createPortal(
    <>
      {Array.from(groups.entries()).map(([pos, items]) => (
        <div
          key={pos}
          className={cn(
            'fixed z-[100] flex flex-col gap-2 pointer-events-none',
            POSITION_CLS[pos],
          )}
        >
          {items.map((item) => (
            <div key={item.id} className="pointer-events-auto">
              <ToastCard
                item={item}
                slideFrom={SLIDE_FROM[pos]}
                onDismiss={remove}
              />
            </div>
          ))}
        </div>
      ))}
    </>,
    document.body,
  )
}
