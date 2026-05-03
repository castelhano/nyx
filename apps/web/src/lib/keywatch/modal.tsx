'use client'

import { useState, useEffect, useRef, Fragment } from 'react'
import { createPortal } from 'react-dom'
import { X, Keyboard, Search, Info } from 'lucide-react'
import { cn } from '@/lib/utils'
import { useKeywatch } from './context'
import type { HandlerEntry, KeywatchCore } from './core'

// ── Badge de tecla ─────────────────────────────────────────────────────────

function Key({ label }: { label: string }) {
  return (
    <kbd className={cn(
      'inline-flex items-center justify-center min-w-[1.8em]',
      'rounded border border-b-2 border-border',
      'bg-muted px-1.5 py-0.5',
      'font-mono text-[10px] text-foreground/80',
    )}>
      {label.toUpperCase()}
    </kbd>
  )
}

function Combo({ keys }: { keys: string[] }) {
  return (
    <span className="inline-flex items-center gap-1">
      {keys.map((k, i) => (
        <Fragment key={i}>
          {i > 0 && <span className="text-muted-foreground text-[10px]">+</span>}
          <Key label={k} />
        </Fragment>
      ))}
    </span>
  )
}

function ShortcutBadge({ schema, core }: { schema: string; core: KeywatchCore }) {
  const combos = core.parseSchema(schema)
  return (
    <span className="inline-flex items-center gap-2">
      {combos.map((combo, i) => (
        <Fragment key={i}>
          {i > 0 && <span className="text-muted-foreground text-xs">ou</span>}
          <Combo keys={combo} />
        </Fragment>
      ))}
    </span>
  )
}

// ── Painel de rastreio ─────────────────────────────────────────────────────

function MetaRow({ label, value }: { label: string; value: React.ReactNode }) {
  return (
    <>
      <span className="text-muted-foreground/60 font-mono text-[10px] uppercase tracking-wide">
        {label}
      </span>
      <span className="text-muted-foreground font-mono text-[10px]">{value}</span>
    </>
  )
}

function MetaPanel({ h }: { h: HandlerEntry }) {
  const events = [h.keydown && 'keydown', h.keyup && 'keyup'].filter(Boolean).join(' + ')

  return (
    <tr>
      <td colSpan={3} className="px-4 pb-2.5 pt-0">
        <div className={cn(
          'grid gap-x-4 gap-y-1 p-3 rounded-md',
          'bg-muted/50 border border-border/60',
        )}
          style={{ gridTemplateColumns: 'auto 1fr auto 1fr' }}
        >
          <MetaRow label="context"  value={h.context} />
          <MetaRow label="event"    value={events || '—'} />
          <MetaRow label="origin"   value={h.origin  || <span className="opacity-30">—</span>} />
          <MetaRow label="group"    value={h.group   || <span className="opacity-30">—</span>} />
          <MetaRow label="order"    value={h.order} />
          <MetaRow label="composed" value={h.composed       ? 'sim' : 'não'} />
          <MetaRow label="prevent"  value={h.preventDefault ? 'sim' : 'não'} />
          <MetaRow label="capture"  value={h.useCapture     ? 'sim' : 'não'} />
        </div>
      </td>
    </tr>
  )
}

// ── Modal ──────────────────────────────────────────────────────────────────

interface ShortcutsModalProps {
  onClose: () => void
}

export function ShortcutsModal({ onClose }: ShortcutsModalProps) {
  const { coreRef, currentContext } = useKeywatch()
  const [search, setSearch]         = useState('')
  const [openInfoId, setOpenInfoId] = useState<symbol | null>(null)
  const searchRef                   = useRef<HTMLInputElement>(null)
  const core                        = coreRef.current

  useEffect(() => {
    const timer = setTimeout(() => searchRef.current?.focus(), 60)
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') { e.preventDefault(); onClose() }
    }
    document.addEventListener('keydown', onKey)
    return () => { clearTimeout(timer); document.removeEventListener('keydown', onKey) }
  }, [onClose])

  if (!core) return null

  const handlers = core.getVisibleHandlers()
  const filtered = search.trim()
    ? handlers.filter(h =>
        `${h.desc} ${h.schema} ${h.origin ?? ''} ${h.context}`
          .toLowerCase()
          .includes(search.toLowerCase()),
      )
    : handlers

  return createPortal(
    <>
      {/* Overlay */}
      <div
        className="fixed inset-0 z-50 bg-black/50"
        onClick={onClose}
        aria-hidden="true"
      />

      {/* Box */}
      <div
        role="dialog"
        aria-modal="true"
        aria-label="Atalhos de teclado"
        className={cn(
          'fixed z-50 left-1/2 top-16 -translate-x-1/2',
          'flex flex-col w-full max-w-2xl max-h-[80vh]',
          'rounded-lg border border-border bg-popover text-popover-foreground shadow-xl',
          'overflow-hidden',
        )}
      >
        {/* Header */}
        <div className="flex items-center gap-2 px-4 py-3 border-b border-border shrink-0">
          <Keyboard className="h-4 w-4 text-muted-foreground shrink-0" />
          <span className="text-sm font-semibold flex-1">Atalhos de teclado</span>
          <button
            onClick={onClose}
            className={cn(
              'flex h-6 w-6 items-center justify-center rounded-md',
              'text-muted-foreground hover:bg-accent hover:text-accent-foreground',
              'transition-colors focus:outline-none',
            )}
            aria-label="Fechar"
          >
            <X className="h-3.5 w-3.5" />
          </button>
        </div>

        {/* Search */}
        <div className="relative px-4 py-2 border-b border-border shrink-0">
          <Search className="absolute left-7 top-1/2 -translate-y-1/2 h-3.5 w-3.5 text-muted-foreground pointer-events-none" />
          <input
            ref={searchRef}
            type="search"
            placeholder="Pesquisar descrição, atalho, origin ou contexto..."
            value={search}
            onChange={e => { setSearch(e.target.value); setOpenInfoId(null) }}
            className={cn(
              'w-full pl-8 pr-24 py-1.5 text-sm rounded-md',
              'border border-input bg-input-bg',
              'placeholder:text-muted-foreground',
              'focus:outline-none focus:ring-1 focus:ring-ring',
            )}
          />
          <span className="absolute right-7 top-1/2 -translate-y-1/2 font-mono text-[10px] text-muted-foreground/50 uppercase select-none">
            {currentContext}
          </span>
        </div>

        {/* Lista */}
        <div className="flex-1 overflow-y-auto">
          {filtered.length === 0 ? (
            <p className="text-center text-sm text-muted-foreground italic py-12">
              Nenhum atalho encontrado
            </p>
          ) : (
            <table className="w-full text-sm">
              <thead>
                <tr className="sticky top-0 bg-popover border-b border-border">
                  <th className="text-left px-4 py-2 text-xs font-medium text-muted-foreground">
                    Descrição
                  </th>
                  <th className="text-right px-4 py-2 text-xs font-medium text-muted-foreground">
                    Atalho
                  </th>
                  <th className="w-8" />
                </tr>
              </thead>
              <tbody>
                {filtered.map((h, i) => {
                  const isOpen = openInfoId === h.id
                  return (
                    <Fragment key={String(h.id) + i}>
                      <tr className={cn(
                        'border-b transition-colors',
                        isOpen
                          ? 'border-border/0 bg-accent/20'
                          : 'border-border/40 hover:bg-accent/20',
                      )}>
                        <td className="px-4 py-2.5">
                          {h.desc || <span className="text-muted-foreground/40">—</span>}
                        </td>
                        <td className="px-4 py-2.5 text-right">
                          <ShortcutBadge schema={h.schema} core={core} />
                        </td>
                        <td className="pr-2 text-center">
                          <button
                            onClick={() => setOpenInfoId(isOpen ? null : h.id)}
                            className={cn(
                              'flex h-6 w-6 items-center justify-center rounded-md transition-colors',
                              'focus:outline-none',
                              isOpen
                                ? 'text-primary'
                                : 'text-muted-foreground/40 hover:text-muted-foreground hover:bg-accent',
                            )}
                            aria-label="Detalhes do atalho"
                          >
                            <Info className="h-3.5 w-3.5" />
                          </button>
                        </td>
                      </tr>

                      {isOpen && <MetaPanel h={h} />}
                    </Fragment>
                  )
                })}
              </tbody>
            </table>
          )}
        </div>
      </div>
    </>,
    document.body,
  )
}
