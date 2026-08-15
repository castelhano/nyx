'use client'

import { useEffect, useRef, useState, forwardRef, type Ref } from 'react'
import { cn } from '@/lib/utils'
import { Icons } from '@/lib/icons'

export interface ComboboxOption {
  id: string
  label: string
  secondary?: string
  /** Original record this option was built from — lets callers recover fields beyond id/label on selection. */
  raw?: Record<string, unknown>
}

export interface ComboboxProps {
  id?: string
  value: string | null
  displayValue: string
  search: string
  onSearchChange: (v: string) => void
  options: ComboboxOption[]
  isLoading?: boolean
  onSelect: (option: ComboboxOption | null) => void
  placeholder?: string
  disabled?: boolean
  autoFocus?: boolean
  className?: string
  containerClassName?: string
  emptyMessage?: string
  onCommitNext?: () => void
  onBlur?: () => void
}

export const Combobox = forwardRef(function Combobox({
  id, value, displayValue, search, onSearchChange, options, isLoading, onSelect,
  placeholder, disabled, autoFocus, className, containerClassName, emptyMessage, onCommitNext, onBlur,
}: ComboboxProps, ref: Ref<HTMLInputElement>) {
  const [open, setOpen]     = useState(false)
  const [cursor, setCursor] = useState(0)
  const [cursorTouched, setCursorTouched] = useState(false)
  const containerRef = useRef<HTMLDivElement>(null)
  const listRef       = useRef<HTMLUListElement>(null)

  useEffect(() => { setCursor(0) }, [options])
  useEffect(() => { if (!open) setCursorTouched(false) }, [open])

  useEffect(() => {
    if (!open) return
    function onPointerDown(e: MouseEvent) {
      if (containerRef.current && !containerRef.current.contains(e.target as Node)) {
        setOpen(false)
        onBlur?.()
      }
    }
    document.addEventListener('mousedown', onPointerDown)
    return () => document.removeEventListener('mousedown', onPointerDown)
  }, [open]) // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => {
    const el = listRef.current?.children[cursor] as HTMLElement | undefined
    el?.scrollIntoView({ block: 'nearest' })
  }, [cursor])

  function commit(option: ComboboxOption) {
    onSelect(option)
    setOpen(false)
    onCommitNext?.()
  }

  function onKeyDown(e: React.KeyboardEvent<HTMLInputElement>) {
    if (e.key === 'Escape') { setOpen(false); (e.target as HTMLInputElement).blur(); return }
    if (!open && (e.key === 'ArrowDown' || e.key === 'ArrowUp')) { setOpen(true); return }
    if (e.key === 'ArrowDown') { e.preventDefault(); setCursor((c) => Math.min(c + 1, options.length - 1)); setCursorTouched(true); return }
    if (e.key === 'ArrowUp')   { e.preventDefault(); setCursor((c) => Math.max(c - 1, 0)); setCursorTouched(true); return }
    // Só confirma no Enter se o usuário de fato interagiu com a lista (digitou ou
    // navegou) — do contrário um Enter "de passagem" (tabOnEnter do keywatch, usado
    // pra avançar entre campos do form) pegaria a primeira opção carregada.
    if (e.key === 'Enter' && open && (cursorTouched || search.length > 0) && options[cursor]) {
      e.preventDefault()
      commit(options[cursor])
    }
  }

  return (
    <div className={cn('relative', containerClassName)} ref={containerRef}>
      <div className="relative">
        <Icons.Search className="pointer-events-none absolute left-2.5 top-1/2 -translate-y-1/2 w-3.5 h-3.5 text-muted-foreground" />
        <input
          id={id}
          ref={ref}
          type="text"
          autoComplete="off"
          autoFocus={autoFocus}
          disabled={disabled}
          value={open ? search : displayValue}
          placeholder={placeholder ?? 'Buscar…'}
          onChange={(e) => { onSearchChange(e.target.value); if (!open) setOpen(true) }}
          onFocus={(e) => e.currentTarget.select()}
          onClick={() => setOpen(true)}
          onKeyDown={onKeyDown}
          className={cn(className, 'pl-8 pr-8')}
        />
        {isLoading ? (
          <Icons.Loader2 className="animate-spin absolute right-2.5 top-1/2 -translate-y-1/2 w-3.5 h-3.5 text-muted-foreground" />
        ) : value && !disabled ? (
          <button
            type="button"
            tabIndex={-1}
            title="Limpar"
            onMouseDown={(e) => { e.preventDefault(); onSelect(null); onSearchChange('') }}
            className="absolute right-2.5 top-1/2 -translate-y-1/2 text-muted-foreground hover:text-foreground transition-colors"
          >
            <Icons.X className="w-3.5 h-3.5" />
          </button>
        ) : (
          <Icons.ChevronDown className="pointer-events-none absolute right-2.5 top-1/2 -translate-y-1/2 w-3.5 h-3.5 text-muted-foreground" />
        )}
      </div>

      {open && (
        options.length > 0 ? (
          <ul ref={listRef} className="absolute left-0 top-full mt-1 z-50 w-full max-h-64 overflow-y-auto bg-card border border-border rounded-(--radius) shadow-md py-1">
            {options.map((opt, i) => (
              <li key={opt.id}>
                <button
                  type="button"
                  onMouseDown={(e) => { e.preventDefault(); commit(opt) }}
                  onMouseEnter={() => setCursor(i)}
                  className={cn(
                    'w-full flex items-baseline gap-2 text-left px-3 py-2 text-sm transition-colors',
                    i === cursor ? 'bg-accent text-accent-foreground' : 'hover:bg-accent/50',
                  )}
                >
                  <span className="flex-1 truncate">{opt.label}</span>
                  {opt.secondary && <span className="text-xs text-muted-foreground flex-shrink-0">{opt.secondary}</span>}
                </button>
              </li>
            ))}
          </ul>
        ) : !isLoading && search.length > 0 ? (
          <div className="absolute left-0 top-full mt-1 z-50 w-full bg-card border border-border rounded-(--radius) shadow-md px-3 py-2 text-sm text-muted-foreground">
            {emptyMessage ?? 'Nenhum resultado.'}
          </div>
        ) : null
      )}
    </div>
  )
})
