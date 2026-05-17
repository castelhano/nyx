'use client'

import {
  useEffect, useRef, useState, useCallback,
  type ReactNode, type RefObject,
} from 'react'
import { createPortal } from 'react-dom'
import Link from 'next/link'
import { cn } from '@/lib/utils'

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export type DropdownSide  = 'top' | 'bottom' | 'left' | 'right'
export type DropdownAlign = 'start' | 'center' | 'end'

interface Position { top: number; left: number }

interface DropdownProps {
  trigger:    ReactNode
  children:   ReactNode
  side?:      DropdownSide
  align?:     DropdownAlign
  sideOffset?: number   // gap entre trigger e conteúdo (px)
  className?: string
}

// ---------------------------------------------------------------------------
// Position calculator
// ---------------------------------------------------------------------------

const GAP = 4

function calcPosition(
  triggerRect: DOMRect,
  contentRect: DOMRect,
  side: DropdownSide,
  align: DropdownAlign,
  offset: number,
): Position {
  const gap = GAP + offset
  let top  = 0
  let left = 0

  // Posição base pelo lado
  if (side === 'bottom') {
    top  = triggerRect.bottom + gap
    left = alignOnAxis('h', triggerRect, contentRect, align)
  } else if (side === 'top') {
    top  = triggerRect.top - contentRect.height - gap
    left = alignOnAxis('h', triggerRect, contentRect, align)
  } else if (side === 'right') {
    left = triggerRect.right + gap
    top  = alignOnAxis('v', triggerRect, contentRect, align)
  } else {
    left = triggerRect.left - contentRect.width - gap
    top  = alignOnAxis('v', triggerRect, contentRect, align)
  }

  // Correções para não sair da viewport
  const vw = window.innerWidth
  const vh = window.innerHeight
  if (left + contentRect.width > vw - 8) left = vw - contentRect.width - 8
  if (left < 8) left = 8
  if (top + contentRect.height > vh - 8) top = vh - contentRect.height - 8
  if (top < 8) top = 8

  return { top, left }
}

function alignOnAxis(
  axis: 'h' | 'v',
  trigger: DOMRect,
  content: DOMRect,
  align: DropdownAlign,
): number {
  if (axis === 'h') {
    if (align === 'start')  return trigger.left
    if (align === 'end')    return trigger.right - content.width
    return trigger.left + (trigger.width - content.width) / 2
  }
  if (align === 'start')  return trigger.top
  if (align === 'end')    return trigger.bottom - content.height
  return trigger.top + (trigger.height - content.height) / 2
}

// ---------------------------------------------------------------------------
// Dropdown
// ---------------------------------------------------------------------------

export function Dropdown({
  trigger,
  children,
  side        = 'bottom',
  align       = 'end',
  sideOffset  = 0,
  className,
}: DropdownProps) {
  const [open, setOpen]       = useState(false)
  const [pos,  setPos]        = useState<Position>({ top: 0, left: 0 })
  const [ready, setReady]     = useState(false)
  const triggerRef            = useRef<HTMLDivElement>(null)
  const contentRef            = useRef<HTMLDivElement>(null)

  const reposition = useCallback(() => {
    if (!triggerRef.current || !contentRef.current) return
    const tRect = triggerRef.current.getBoundingClientRect()
    const cRect = contentRef.current.getBoundingClientRect()
    setPos(calcPosition(tRect, cRect, side, align, sideOffset))
    setReady(true)
  }, [side, align, sideOffset])

  // Recalcula quando o conteúdo monta (dimensões reais disponíveis)
  useEffect(() => {
    if (!open) { setReady(false); return }
    // Defer para o conteúdo ter dimensões reais
    const id = requestAnimationFrame(reposition)
    return () => cancelAnimationFrame(id)
  }, [open, reposition])

  // Fecha no click fora e no Esc
  useEffect(() => {
    if (!open) return
    function onPointerDown(e: PointerEvent) {
      if (
        triggerRef.current?.contains(e.target as Node) ||
        contentRef.current?.contains(e.target as Node)
      ) return
      setOpen(false)
    }
    function onKeyDown(e: KeyboardEvent) {
      if (e.key === 'Escape') setOpen(false)
    }
    document.addEventListener('pointerdown', onPointerDown)
    document.addEventListener('keydown', onKeyDown)
    return () => {
      document.removeEventListener('pointerdown', onPointerDown)
      document.removeEventListener('keydown', onKeyDown)
    }
  }, [open])

  // Fecha e reposiciona no scroll / resize enquanto aberto
  useEffect(() => {
    if (!open) return
    const onScroll = () => setOpen(false)
    const onResize = () => reposition()
    window.addEventListener('scroll', onScroll, { capture: true, passive: true })
    window.addEventListener('resize', onResize)
    return () => {
      window.removeEventListener('scroll', onScroll, { capture: true })
      window.removeEventListener('resize', onResize)
    }
  }, [open, reposition])

  return (
    <>
      <div ref={triggerRef} onClick={() => setOpen((v) => !v)}>
        {trigger}
      </div>

      {open && typeof document !== 'undefined' && createPortal(
        <div
          ref={contentRef}
          role="menu"
          style={{
            position: 'fixed',
            top:      pos.top,
            left:     pos.left,
            // Invisível até reposition() terminar — evita flash na posição errada
            visibility: ready ? 'visible' : 'hidden',
          }}
          className={cn(
            'z-50 min-w-[180px] rounded-md border border-border bg-popover p-1 shadow-lg',
            'text-popover-foreground text-sm',
            className,
          )}
          onClick={() => setOpen(false)}
        >
          {children}
        </div>,
        document.body,
      )}
    </>
  )
}

// ---------------------------------------------------------------------------
// Sub-components
// ---------------------------------------------------------------------------

interface DropdownItemProps {
  children:     ReactNode
  onClick?:     () => void
  href?:        string
  className?:   string
  destructive?: boolean
  disabled?:    boolean
}

export function DropdownItem({
  children, onClick, href, className, destructive, disabled,
}: DropdownItemProps) {
  const itemCls = cn(
    'flex w-full items-center gap-2 rounded-sm px-2 py-1.5 text-left text-sm',
    'transition-colors focus:outline-none',
    disabled
      ? 'opacity-50 cursor-not-allowed'
      : destructive
        ? 'cursor-pointer hover:bg-destructive hover:text-destructive-foreground'
        : 'cursor-pointer hover:bg-accent hover:text-accent-foreground',
    className,
  )

  if (href) {
    return (
      <Link href={href} role="menuitem" className={itemCls}>
        {children}
      </Link>
    )
  }

  return (
    <button
      type="button"
      role="menuitem"
      disabled={disabled}
      onClick={onClick}
      className={itemCls}
    >
      {children}
    </button>
  )
}

export function DropdownSeparator({ className }: { className?: string }) {
  return <div role="separator" className={cn('my-1 h-px bg-border', className)} />
}

export function DropdownLabel({ children, className }: { children: ReactNode; className?: string }) {
  return (
    <div className={cn('px-2 py-1 text-xs font-medium text-muted-foreground', className)}>
      {children}
    </div>
  )
}
