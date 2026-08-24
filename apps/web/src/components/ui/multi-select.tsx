'use client'

import { useEffect, useRef, useState } from 'react'
import { cn } from '@/lib/utils'
import { Icons } from '@/lib/icons'

export interface MultiSelectOption {
  id:         string
  label:      string
  secondary?: string
}

type Size = 'sm' | 'default'

const sizes: Record<Size, string> = {
  default: 'py-2',
  sm:      'py-1.5',
}

export interface MultiSelectProps {
  id?:                 string
  value:               string[]
  options:             MultiSelectOption[]
  onChange:            (ids: string[]) => void
  placeholder?:        string
  disabled?:           boolean
  size?:               Size
  className?:          string
  containerClassName?: string
  emptyMessage?:       string
}

export function MultiSelect({
  id, value, options, onChange, placeholder, disabled, size = 'default', className, containerClassName, emptyMessage,
}: MultiSelectProps) {
  const [open, setOpen]     = useState(false)
  const [cursor, setCursor] = useState(0)
  const containerRef = useRef<HTMLDivElement>(null)
  const triggerRef    = useRef<HTMLButtonElement>(null)
  const listRef        = useRef<HTMLUListElement>(null)

  useEffect(() => { setCursor(0) }, [open])

  useEffect(() => {
    if (!open) return
    function onPointerDown(e: MouseEvent) {
      if (containerRef.current && !containerRef.current.contains(e.target as Node)) setOpen(false)
    }
    document.addEventListener('mousedown', onPointerDown)
    return () => document.removeEventListener('mousedown', onPointerDown)
  }, [open])

  useEffect(() => {
    const el = listRef.current?.children[cursor] as HTMLElement | undefined
    el?.scrollIntoView({ block: 'nearest' })
  }, [cursor])

  function toggle(optId: string) {
    if (disabled) return
    onChange(value.includes(optId) ? value.filter(v => v !== optId) : [...value, optId])
  }

  function onKeyDown(e: React.KeyboardEvent<HTMLButtonElement>) {
    if (e.key === 'Escape') { setOpen(false); triggerRef.current?.blur(); return }
    if (!open) {
      if (e.key === 'ArrowDown' || e.key === 'ArrowUp' || e.key === 'Enter' || e.key === ' ') {
        e.preventDefault()
        setOpen(true)
      }
      return
    }
    if (e.key === 'ArrowDown') { e.preventDefault(); setCursor(c => Math.min(c + 1, options.length - 1)); return }
    if (e.key === 'ArrowUp')   { e.preventDefault(); setCursor(c => Math.max(c - 1, 0)); return }
    if ((e.key === 'Enter' || e.key === ' ') && options[cursor]) {
      e.preventDefault()
      toggle(options[cursor].id)
    }
  }

  const selected = options.filter(o => value.includes(o.id))
  const display  =
    selected.length === 0 ? (placeholder ?? 'Selecionar…') :
    selected.length <= 2  ? selected.map(o => o.label).join(', ') :
    `${selected.length} selecionados`

  return (
    <div className={cn('relative', containerClassName)} ref={containerRef}>
      <button
        id={id}
        ref={triggerRef}
        type="button"
        disabled={disabled}
        onClick={() => setOpen(o => !o)}
        onKeyDown={onKeyDown}
        className={cn(
          'w-full flex items-center gap-2 pl-3 pr-8 text-sm text-left border border-input rounded-sm bg-input-bg',
          sizes[size],
          'focus:outline-none focus:ring-1 focus:ring-ring',
          'disabled:opacity-60 disabled:cursor-not-allowed',
          className,
        )}
      >
        <span className={cn('flex-1 truncate', selected.length === 0 && 'text-muted-foreground')}>{display}</span>
        <Icons.ChevronDown className="pointer-events-none absolute right-2.5 top-1/2 -translate-y-1/2 w-3.5 h-3.5 text-muted-foreground" />
      </button>

      {open && (
        options.length > 0 ? (
          <ul ref={listRef} className="absolute left-0 top-full mt-1 z-50 w-full max-h-64 overflow-y-auto bg-card border border-border rounded-(--radius) shadow-md py-1">
            {options.map((opt, i) => {
              const checked = value.includes(opt.id)
              return (
                <li key={opt.id}>
                  <button
                    type="button"
                    onMouseDown={(e) => { e.preventDefault(); toggle(opt.id) }}
                    onMouseEnter={() => setCursor(i)}
                    className={cn(
                      'w-full flex items-center gap-2 text-left px-3 py-2 text-sm transition-colors',
                      i === cursor ? 'bg-accent text-accent-foreground' : 'hover:bg-accent/50',
                    )}
                  >
                    <span className={cn(
                      'flex-shrink-0 w-4 h-4 rounded-xs border flex items-center justify-center',
                      checked ? 'bg-accent border-accent' : 'border-input',
                    )}>
                      {checked && <Icons.Check className="w-3 h-3 text-accent-foreground" />}
                    </span>
                    <span className="flex-1 truncate">{opt.label}</span>
                    {opt.secondary && <span className="text-xs text-muted-foreground flex-shrink-0">{opt.secondary}</span>}
                  </button>
                </li>
              )
            })}
          </ul>
        ) : (
          <div className="absolute left-0 top-full mt-1 z-50 w-full bg-card border border-border rounded-(--radius) shadow-md px-3 py-2 text-sm text-muted-foreground">
            {emptyMessage ?? 'Nenhuma opção.'}
          </div>
        )
      )}
    </div>
  )
}
