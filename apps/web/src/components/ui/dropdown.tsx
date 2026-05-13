'use client'

import { useEffect, useRef, useState, type ReactNode } from 'react'
import { cn } from '@/lib/utils'

interface DropdownProps {
  trigger:   ReactNode
  children:  ReactNode
  align?:    'start' | 'end'
  side?:     'top' | 'bottom' | 'right' | 'left'
  className?: string
}

export function Dropdown({ trigger, children, align = 'end', side = 'bottom', className }: DropdownProps) {
  const [open, setOpen] = useState(false)
  const ref = useRef<HTMLDivElement>(null)

  useEffect(() => {
    if (!open) return
    function handleClickOutside(e: MouseEvent) {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false)
    }
    function handleEscape(e: KeyboardEvent) {
      if (e.key === 'Escape') setOpen(false)
    }
    document.addEventListener('mousedown', handleClickOutside)
    document.addEventListener('keydown', handleEscape)
    return () => {
      document.removeEventListener('mousedown', handleClickOutside)
      document.removeEventListener('keydown', handleEscape)
    }
  }, [open])

  const positionClasses = cn(
    'absolute z-50 min-w-[200px] rounded-md border border-border bg-popover p-1 shadow-lg',
    'text-popover-foreground text-sm',
    side === 'top'    && 'bottom-full mb-1',
    side === 'bottom' && 'top-full mt-1',
    side === 'right'  && 'left-full ml-1',
    side === 'left'   && 'right-full mr-1',
    align === 'end'   && 'right-0',
    align === 'start' && 'left-0',
  )

  return (
    <div ref={ref} className={cn('relative', className)}>
      <div onClick={() => setOpen((v) => !v)}>{trigger}</div>
      {open && (
        <div className={positionClasses} role="menu">
          <div onClick={() => setOpen(false)}>
            {children}
          </div>
        </div>
      )}
    </div>
  )
}

interface DropdownItemProps {
  children:  ReactNode
  onClick?:  () => void
  className?: string
  destructive?: boolean
}

export function DropdownItem({ children, onClick, className, destructive }: DropdownItemProps) {
  return (
    <button
      type="button"
      role="menuitem"
      onClick={onClick}
      className={cn(
        'flex w-full items-center gap-2 rounded-sm px-2 py-1.5 text-left cursor-pointer',
        'hover:bg-accent hover:text-accent-foreground focus:outline-none transition-colors',
        destructive && 'hover:bg-destructive/10 hover:text-destructive',
        className,
      )}
    >
      {children}
    </button>
  )
}

export function DropdownSeparator() {
  return <div className="my-1 h-px bg-border" role="separator" />
}
