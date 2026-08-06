'use client'

import { useState, useEffect, useRef, useMemo, Fragment } from 'react'
import { createPortal } from 'react-dom'
import { X, Keyboard, Search, Info, Eye, EyeOff } from 'lucide-react'
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

function ShortcutIcon({ icon }: { icon: unknown }) {
  if (!icon) return null
  const Icon = icon as React.ElementType
  return <Icon className="h-3.5 w-3.5" />
}

function ShortcutBadge({ schema, core }: { schema: string; core: KeywatchCore }) {
  const combos = core.parseSchema(schema)
  return (
    <span className="inline-flex items-center gap-2 flex-wrap justify-end">
      {combos.map((combo, i) => (
        <Fragment key={i}>
          {i > 0 && <span className="text-muted-foreground text-xs">ou</span>}
          <Combo keys={combo} />
        </Fragment>
      ))}
    </span>
  )
}

// ── Painel de rastreio (detalhes de um atalho) ───────────────────────────────

function MetaRow({ label, value }: { label: string; value: React.ReactNode }) {
  return (
    <>
      <span className="text-muted-foreground/60 font-mono text-[9px] uppercase tracking-wide">
        {label}
      </span>
      <span className="text-muted-foreground font-mono text-[9px] truncate">{value}</span>
    </>
  )
}

function MetaPanel({ h }: { h: HandlerEntry }) {
  const events = [h.keydown && 'keydown', h.keyup && 'keyup'].filter(Boolean).join(' + ')

  return (
    <div className="px-3 pb-2 pt-0.5">
      <div
        className="grid gap-x-3 gap-y-0.5 p-2 rounded-md bg-background/60 border border-border/60"
        style={{ gridTemplateColumns: 'auto 1fr' }}
      >
        <MetaRow label="context" value={h.context} />
        <MetaRow label="event"    value={events || '—'} />
        <MetaRow label="origin"   value={h.origin  || <span className="opacity-30">—</span>} />
        <MetaRow label="group"    value={h.group   || <span className="opacity-30">—</span>} />
        <MetaRow label="order"    value={h.order} />
        <MetaRow label="composed" value={h.composed       ? 'sim' : 'não'} />
        <MetaRow label="prevent"  value={h.preventDefault ? 'sim' : 'não'} />
        <MetaRow label="capture"  value={h.useCapture     ? 'sim' : 'não'} />
      </div>
    </div>
  )
}

// ── linha de atalho ──────────────────────────────────────────────────────────

function ShortcutRow({ h, core, openId, onToggle }: {
  h:        HandlerEntry
  core:     KeywatchCore
  openId:   symbol | null
  onToggle: (id: symbol | null) => void
}) {
  const isOpen = openId === h.id
  return (
    <div>
      <div className={cn('flex items-center gap-2 px-3 py-1.5 text-xs hover:bg-accent/30 transition-colors', !h.display && 'opacity-50')}>
        <span className="text-muted-foreground shrink-0"><ShortcutIcon icon={h.icon} /></span>
        {!h.display && <EyeOff className="h-3 w-3 text-muted-foreground shrink-0" />}
        <span className="flex-1 truncate">{h.desc || <span className="text-muted-foreground/40">—</span>}</span>
        <ShortcutBadge schema={h.schema} core={core} />
        <button
          onClick={() => onToggle(isOpen ? null : h.id)}
          className={cn(
            'flex h-5 w-5 items-center justify-center rounded transition-colors shrink-0',
            'focus:outline-none',
            isOpen ? 'text-primary' : 'text-muted-foreground/40 hover:text-muted-foreground hover:bg-accent',
          )}
          aria-label="Detalhes do atalho"
        >
          <Info className="h-3 w-3" />
        </button>
      </div>
      {isOpen && <MetaPanel h={h} />}
    </div>
  )
}

// ── agrupamento por seção (masonry, empacotamento guloso por coluna) ────────
//
// `section` é opcional por atalho (ver HandlerOptions.section) — quem não
// declara cai em "Geral" (mesmo texto que uma página usaria pra seus próprios
// atalhos genéricos — de propósito: agrupa por texto do label, não por uma
// chave interna, então um "Geral" explícito e o fallback implícito viram o
// mesmo card em vez de dois cards duplicados). A ordem das seções vem da
// primeira ocorrência na lista já ordenada por `order` (getVisibleHandlers),
// sem inventar mais um campo de ordenação. Sem lib externa: mede a largura do
// container e decide 1/2/3 colunas, empacota cada seção na coluna mais
// "vazia" no momento (peso = nº de itens + overhead do cabeçalho), e o último
// card de cada coluna estica pra preencher o espaço sobrando (flex-1 +
// stretch, sem hack).

interface SectionGroup {
  key:   string
  label: string
  hint?: string
  items: HandlerEntry[]
}

const HEADER_WEIGHT = 2 // itens-equivalentes que o bloco título+hint ocupa

function groupBySection(handlers: HandlerEntry[]): SectionGroup[] {
  const order = new Map<string, SectionGroup>()
  for (const h of handlers) {
    const label = h.section?.label ?? 'Geral'
    let entry = order.get(label)
    if (!entry) {
      entry = { key: label, label, hint: h.section?.hint, items: [] }
      order.set(label, entry)
    }
    if (!entry.hint && h.section?.hint) entry.hint = h.section.hint
    entry.items.push(h)
  }
  return [...order.values()]
}

function packColumns(sections: SectionGroup[], cols: number): SectionGroup[][] {
  const columns: SectionGroup[][] = Array.from({ length: cols }, () => [])
  const heights = new Array(cols).fill(0)
  for (const entry of sections) {
    let target = 0
    for (let i = 1; i < cols; i++) if (heights[i] < heights[target]) target = i
    columns[target].push(entry)
    heights[target] += entry.items.length + HEADER_WEIGHT
  }
  return columns
}

const COL_WIDTH_PX = 390 // largura fixa de cada coluna — a caixa da modal (w-fit) é quem se adapta a isso, não o contrário

/** Quantas colunas cabem na largura da janela (não do container — medir o
 *  container aqui seria circular, já que a largura da caixa passou a depender
 *  do nº de colunas escolhido). Independente disso, quem decide o teto real
 *  é sempre `Math.min(..., seções existentes)`, feito por quem chama. */
function useViewportCols(max: number): number {
  const [cols, setCols] = useState(1)

  useEffect(() => {
    function recalc() {
      const w = window.innerWidth * 0.9
      setCols(Math.max(1, Math.min(max, Math.floor(w / (COL_WIDTH_PX + 12)))))
    }
    recalc()
    window.addEventListener('resize', recalc)
    return () => window.removeEventListener('resize', recalc)
  }, [max])

  return cols
}

function SectionCard({ group, core, openId, onToggle, grow }: {
  group:    SectionGroup
  core:     KeywatchCore
  openId:   symbol | null
  onToggle: (id: symbol | null) => void
  grow?:    boolean
}) {
  return (
    <div className={cn('rounded-md bg-muted/40 overflow-hidden', grow && 'flex-1')}>
      <div className="px-3 pt-2.5 pb-1.5">
        <div className="flex items-baseline justify-between gap-2">
          <span className="text-xs font-semibold">{group.label}</span>
          <span className="text-[10px] font-mono text-muted-foreground/50 shrink-0">{group.items.length}</span>
        </div>
        {group.hint && (
          <p className="text-[10px] text-muted-foreground mt-0.5 leading-snug">{group.hint}</p>
        )}
      </div>
      <div className="pb-1.5">
        {group.items.map((h, i) => <ShortcutRow key={i} h={h} core={core} openId={openId} onToggle={onToggle} />)}
      </div>
    </div>
  )
}

function SectionedShortcuts({ handlers, core, openId, onToggle }: {
  handlers: HandlerEntry[]
  core:     KeywatchCore
  openId:   symbol | null
  onToggle: (id: symbol | null) => void
}) {
  const sections    = useMemo(() => groupBySection(handlers), [handlers])
  const viewportCap = useViewportCols(3)
  const cols        = Math.max(1, Math.min(sections.length, viewportCap))
  const columns     = useMemo(() => packColumns(sections, cols), [sections, cols])

  if (sections.length === 0) {
    return <p className="text-center text-sm text-muted-foreground italic py-12">Nenhum atalho encontrado</p>
  }

  return (
    <div className="p-4">
      <div className="flex gap-3">
        {columns.map((col, i) => (
          <div key={i} className="shrink-0 flex flex-col gap-3" style={{ width: COL_WIDTH_PX }}>
            {col.map((group, idx) => (
              <SectionCard
                key={group.key}
                group={group}
                core={core}
                openId={openId}
                onToggle={onToggle}
                grow={idx === col.length - 1}
              />
            ))}
          </div>
        ))}
      </div>
    </div>
  )
}

// ── Modal ──────────────────────────────────────────────────────────────────

interface ShortcutsModalProps {
  onClose: () => void
}

export function ShortcutsModal({ onClose }: ShortcutsModalProps) {
  const { coreRef, currentContext } = useKeywatch()
  const [search, setSearch]         = useState('')
  const [openId, setOpenId]         = useState<symbol | null>(null)
  const [showHidden, setShowHidden] = useState(false)
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

  const handlers = showHidden ? core.getAllHandlers() : core.getVisibleHandlers()
  const filtered = search.trim()
    ? handlers.filter(h =>
        `${h.desc} ${h.schema} ${h.origin ?? ''} ${h.context} ${h.section?.label ?? ''} ${h.section?.hint ?? ''}`
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
          'fixed z-50 left-1/2 top-12 -translate-x-1/2',
          'flex flex-col w-fit min-w-[332px] max-w-[92vw] lg:max-w-[1300px] max-h-[88vh]',
          'rounded-lg border border-border bg-popover text-popover-foreground shadow-xl',
          'overflow-hidden',
        )}
      >
        {/* Header */}
        <div className="flex items-center gap-2 px-4 py-3 border-b border-border shrink-0">
          <Keyboard className="h-4 w-4 text-muted-foreground shrink-0" />
          <span className="text-sm font-semibold flex-1">Atalhos de teclado</span>
          {/* display:none proposital — mantido no código pra uso futuro, ver
              docs/TODO.md; toda a página vehicle-plan já não usa display:false
              então não há mais nada pra este toggle revelar hoje */}
          <button
            onClick={() => setShowHidden(v => !v)}
            className={cn(
              'hidden items-center gap-1.5 h-6 px-2 rounded-md text-[11px] transition-colors focus:outline-none',
              showHidden
                ? 'bg-accent text-accent-foreground'
                : 'text-muted-foreground hover:bg-accent hover:text-accent-foreground',
            )}
            title={showHidden ? 'Ocultar atalhos internos' : 'Mostrar atalhos internos (display:false)'}
          >
            {showHidden ? <EyeOff className="h-3 w-3" /> : <Eye className="h-3 w-3" />}
            ocultos
          </button>
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
            placeholder="Pesquisar..."
            value={search}
            onChange={e => { setSearch(e.target.value); setOpenId(null) }}
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

        {/* Hint */}
        <div className="px-4 pt-3 shrink-0">
          <div className="flex items-center gap-1.5 rounded-md bg-muted/30 px-3 py-1.5">
            <Info className="h-3 w-3 text-muted-foreground/50 shrink-0" />
            <span className="text-[11px] text-muted-foreground/50">
              <kbd className="font-mono text-[10px] px-1 py-0.5 rounded border border-border bg-muted">Ctrl+Shift+[tecla]</kbd> navega em campos do form
            </span>
          </div>
        </div>

        {/* Lista */}
        <div className="flex-1 overflow-y-auto">
          <SectionedShortcuts handlers={filtered} core={core} openId={openId} onToggle={setOpenId} />
        </div>
      </div>
    </>,
    document.body,
  )
}
