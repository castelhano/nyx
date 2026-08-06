'use client'

// Protótipo da modal de atalhos seccionada (ver discussão em docs/TODO.md) —
// compara quatro layouts (flat / accordion / grid / masonry) e testa busca +
// expansão de detalhes por atalho. Dados fake, espelhando atalhos reais do
// vehicle-plan pra ficar realista — nada aqui toca em lib/keywatch, é só
// validação visual antes de mexer na modal real.
//
// Seções são um registro à parte (SECTIONS), não um campo solto por atalho —
// cada MockShortcut só carrega `sectionId`, apontando pro registro. Isso evita
// duplicar o hint em cada uma das N entradas da mesma seção (e evita drift se
// o texto do hint mudar um dia).

import { useMemo, useState, useRef, useEffect, Fragment } from 'react'
import { X, Keyboard, Search, ChevronRight, Info, ArrowUp, ArrowDown, ArrowLeftRight, MousePointer2, PanelRight, Save } from 'lucide-react'

// ── registro de seções ───────────────────────────────────────────────────────

interface ShortcutSection {
  id:    string
  label: string
  hint:  string
}

const SECTIONS: ShortcutSection[] = [
  { id: 'geral',      label: 'Geral',                    hint: 'Disponível em qualquer modo, com a página em edição' },
  { id: 'nav',        label: 'Navegação',                hint: 'Move o foco entre viagens/blocos — não altera dados' },
  { id: 'selecao',    label: 'Seleção de viagem',         hint: 'Ações habilitadas quando existe seleção de viagens' },
  { id: 'mover',      label: 'Movimentação de bloco',     hint: 'Só aparece com uma seleção de viagens ativa' },
  { id: 'edicao',     label: 'Edição de grid',            hint: 'Ajusta horário da viagem/intervalo focado' },
  { id: 'paineis',    label: 'Painéis',                   hint: 'Mostra/oculta painéis auxiliares do Gantt' },
]

// ── mock data — espelha atalhos reais do vehicle-plan ───────────────────────

interface MockShortcut {
  id:        string
  desc:      string
  keys:      string[]
  sectionId: string
  icon:      React.ElementType
  context:   string
  origin:    string
  order:     number
}

const ORIGIN = 'apps/web/src/app/transit/vehicle-plan/[id]/page'

function s(partial: Omit<MockShortcut, 'context' | 'origin' | 'order'> & { order: number }): MockShortcut {
  return { context: 'default', origin: ORIGIN, ...partial }
}

const SHORTCUTS: MockShortcut[] = [
  s({ id: 's1', desc: 'Salvar',                                keys: ['alt', 'g'], sectionId: 'geral', icon: Save,           order: 1 }),
  s({ id: 's2', desc: 'Voltar',                                keys: ['alt', 'v'], sectionId: 'geral', icon: ArrowLeftRight, order: 2 }),
  s({ id: 's3', desc: 'Resetar ao estado do servidor',         keys: ['alt', 'l'], sectionId: 'geral', icon: ArrowLeftRight, order: 3 }),
  s({ id: 's4', desc: 'Barra de edição',                       keys: ['f9'],       sectionId: 'geral', icon: PanelRight,     order: 4 }),
  s({ id: 's5', desc: 'Painel de linhas',                      keys: ['f6'],       sectionId: 'geral', icon: PanelRight,     order: 5 }),

  s({ id: 'n1', desc: 'Viagem anterior no bloco',                  keys: ['←'],        sectionId: 'nav', icon: ArrowUp,   order: 1 }),
  s({ id: 'n2', desc: 'Próxima viagem no bloco',                   keys: ['→'],        sectionId: 'nav', icon: ArrowUp,   order: 2 }),
  s({ id: 'n3', desc: 'Bloco anterior (mesmo horário aproximado)', keys: ['↑'],        sectionId: 'nav', icon: ArrowUp,   order: 3 }),
  s({ id: 'n4', desc: 'Próximo bloco (mesmo horário aproximado)',  keys: ['↓'],        sectionId: 'nav', icon: ArrowDown, order: 4 }),
  s({ id: 'n5', desc: 'Próxima viagem mesmo sentido',              keys: ['pagedown'], sectionId: 'nav', icon: ArrowDown, order: 5 }),
  s({ id: 'n6', desc: 'Viagem anterior mesmo sentido',             keys: ['pageup'],   sectionId: 'nav', icon: ArrowUp,   order: 6 }),
  s({ id: 'n7', desc: 'Primeira viagem do dia',                    keys: ['home'],     sectionId: 'nav', icon: ArrowUp,   order: 7 }),
  s({ id: 'n8', desc: 'Última viagem do dia',                      keys: ['end'],      sectionId: 'nav', icon: ArrowDown, order: 8 }),

  s({ id: 'e1', desc: 'Estender seleção (bloco/intervalo)',                 keys: ['shift', '←'],        sectionId: 'selecao', icon: MousePointer2, order: 1 }),
  s({ id: 'e2', desc: 'Estender seleção (bloco/intervalo)',                 keys: ['shift', '→'],        sectionId: 'selecao', icon: MousePointer2, order: 2 }),
  s({ id: 'e3', desc: 'Estender seleção até próxima viagem mesmo sentido',  keys: ['shift', 'pagedown'], sectionId: 'selecao', icon: MousePointer2, order: 3 }),
  s({ id: 'e4', desc: 'Estender seleção até viagem anterior mesmo sentido', keys: ['shift', 'pageup'],   sectionId: 'selecao', icon: MousePointer2, order: 4 }),
  s({ id: 'e5', desc: 'Limpar seleção',                                    keys: ['esc'],               sectionId: 'selecao', icon: X,              order: 5 }),

  s({ id: 'm1', desc: 'Mover viagens para bloco alvo', keys: ['q', 'm'], sectionId: 'mover', icon: ArrowLeftRight, order: 1 }),
  s({ id: 'm2', desc: 'Bloco alvo anterior',           keys: ['↑'],      sectionId: 'mover', icon: ArrowUp,       order: 2 }),
  s({ id: 'm3', desc: 'Próximo bloco alvo',            keys: ['↓'],      sectionId: 'mover', icon: ArrowDown,     order: 3 }),

  s({ id: 'g1', desc: 'Crescer viagem (fim)',            keys: ['shift', '+'],         sectionId: 'edicao', icon: ArrowLeftRight, order: 1 }),
  s({ id: 'g2', desc: 'Encolher viagem (fim)',           keys: ['shift', '-'],         sectionId: 'edicao', icon: ArrowLeftRight, order: 2 }),
  s({ id: 'g3', desc: 'Empurrar viagem (início e fim)',  keys: ['shift', 'space'],     sectionId: 'edicao', icon: ArrowLeftRight, order: 3 }),
  s({ id: 'g4', desc: 'Puxar viagem (início e fim)',     keys: ['shift', 'backspace'], sectionId: 'edicao', icon: ArrowLeftRight, order: 4 }),
  s({ id: 'g5', desc: 'Nova viagem',                     keys: ['alt', 'n'],           sectionId: 'edicao', icon: ArrowLeftRight, order: 5 }),

  s({ id: 'p1', desc: 'Painel de frequência da linha', keys: ['ctrl', '.'], sectionId: 'paineis', icon: PanelRight, order: 1 }),
  s({ id: 'p2', desc: 'Frequência de atendimento',     keys: ['ctrl', ';'], sectionId: 'paineis', icon: PanelRight, order: 2 }),
]

// ── UI compartilhada (badge de tecla, igual à modal real) ───────────────────

function Key({ label }: { label: string }) {
  return (
    <kbd className="inline-flex items-center justify-center min-w-[1.8em] rounded border border-b-2 border-border bg-muted px-1.5 py-0.5 font-mono text-[11px] text-foreground/80">
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

function sectionOf(id: string): ShortcutSection {
  return SECTIONS.find(sec => sec.id === id) ?? { id, label: id, hint: '' }
}

function matches(sh: MockShortcut, q: string): boolean {
  if (!q.trim()) return true
  const sec = sectionOf(sh.sectionId)
  const hay = `${sh.desc} ${sec.label} ${sec.hint} ${sh.keys.join(' ')}`.toLowerCase()
  return hay.includes(q.toLowerCase())
}

function groupBySection(items: MockShortcut[]) {
  const map = new Map<string, MockShortcut[]>()
  for (const sh of items) {
    if (!map.has(sh.sectionId)) map.set(sh.sectionId, [])
    map.get(sh.sectionId)!.push(sh)
  }
  return SECTIONS
    .filter(sec => map.has(sec.id))
    .map(sec => ({ section: sec, items: map.get(sec.id)!.sort((a, b) => a.order - b.order) }))
}

// ── detalhes por atalho (expande no clique — mesmo padrão da modal atual) ───

function MetaDetails({ sh }: { sh: MockShortcut }) {
  return (
    <div className="grid gap-x-3 gap-y-0.5 px-3 pb-2 pt-0.5" style={{ gridTemplateColumns: 'auto 1fr' }}>
      <span className="text-muted-foreground/60 font-mono text-[9px] uppercase tracking-wide">contexto</span>
      <span className="text-muted-foreground font-mono text-[9px]">{sh.context}</span>
      <span className="text-muted-foreground/60 font-mono text-[9px] uppercase tracking-wide">origin</span>
      <span className="text-muted-foreground font-mono text-[9px] truncate">{sh.origin}</span>
      <span className="text-muted-foreground/60 font-mono text-[9px] uppercase tracking-wide">ordem</span>
      <span className="text-muted-foreground font-mono text-[9px]">{sh.order}</span>
    </div>
  )
}

// ── linha de atalho (usada nas 3 variantes) ─────────────────────────────────

function ShortcutRow({ sh, openId, onToggle }: {
  sh:       MockShortcut
  openId:   string | null
  onToggle: (id: string | null) => void
}) {
  const Icon   = sh.icon
  const isOpen = openId === sh.id
  return (
    <div>
      <div className="flex items-center gap-2 px-3 py-1.5 text-xs hover:bg-accent/30 transition-colors">
        <Icon className="h-3.5 w-3.5 text-muted-foreground shrink-0" />
        <span className="flex-1 truncate">{sh.desc}</span>
        <Combo keys={sh.keys} />
        <button
          onClick={() => onToggle(isOpen ? null : sh.id)}
          className={`flex h-5 w-5 items-center justify-center rounded transition-colors shrink-0 ${
            isOpen ? 'text-primary' : 'text-muted-foreground/40 hover:text-muted-foreground hover:bg-accent'
          }`}
          aria-label="Detalhes do atalho"
        >
          <Info className="h-3 w-3" />
        </button>
      </div>
      {isOpen && <MetaDetails sh={sh} />}
    </div>
  )
}

// ── variante 1: flat (sem seções) ────────────────────────────────────────────

function FlatList({ items, openId, onToggle }: { items: MockShortcut[]; openId: string | null; onToggle: (id: string | null) => void }) {
  if (items.length === 0) {
    return <p className="text-center text-sm text-muted-foreground italic py-12">Nenhum atalho encontrado</p>
  }
  return (
    <div className="divide-y divide-border/40">
      {items.map(sh => <ShortcutRow key={sh.id} sh={sh} openId={openId} onToggle={onToggle} />)}
    </div>
  )
}

// ── variante 2: seccionada (accordion) ───────────────────────────────────────

function SectionedList({ items, filtering, openId, onToggle }: {
  items:    MockShortcut[]
  filtering: boolean
  openId:   string | null
  onToggle: (id: string | null) => void
}) {
  const bySection = useMemo(() => groupBySection(items), [items])
  const [openManual, setOpenManual] = useState<Set<string>>(new Set())

  function toggleSection(id: string) {
    setOpenManual(prev => {
      const next = new Set(prev)
      if (next.has(id)) next.delete(id)
      else next.add(id)
      return next
    })
  }

  if (bySection.length === 0) {
    return <p className="text-center text-sm text-muted-foreground italic py-12">Nenhum atalho encontrado</p>
  }

  return (
    <div className="divide-y divide-border/40">
      {bySection.map(({ section, items: sectionItems }) => {
        const isOpen = filtering ? true : openManual.has(section.id)
        return (
          <div key={section.id}>
            <button
              onClick={() => toggleSection(section.id)}
              className="w-full flex items-center gap-2 px-4 py-2.5 text-left hover:bg-accent/20 transition-colors"
            >
              <ChevronRight className={`h-3.5 w-3.5 text-muted-foreground transition-transform ${isOpen ? 'rotate-90' : ''}`} />
              <span className="text-sm font-medium">{section.label}</span>
              <span className="text-[10px] font-mono text-muted-foreground/50 ml-1">{sectionItems.length}</span>
              <span className="flex-1" />
            </button>
            {isOpen && (
              <div className="pb-1">
                {sectionItems.map(sh => <ShortcutRow key={sh.id} sh={sh} openId={openId} onToggle={onToggle} />)}
              </div>
            )}
          </div>
        )
      })}
    </div>
  )
}

// ── variante 3: grid (todas as seções abertas, lado a lado) ─────────────────

function SectionCard({ section, items, openId, onToggle, grow }: {
  section:  ShortcutSection
  items:    MockShortcut[]
  openId:   string | null
  onToggle: (id: string | null) => void
  grow?:    boolean
}) {
  return (
    <div className={`rounded-md bg-muted/40 overflow-hidden min-w-0 ${grow ? 'flex-1' : ''}`}>
      <div className="px-3 pt-2.5 pb-1.5">
        <div className="flex items-baseline justify-between gap-2">
          <span className="text-xs font-semibold">{section.label}</span>
          <span className="text-[10px] font-mono text-muted-foreground/50 shrink-0">{items.length}</span>
        </div>
        {section.hint && (
          <p className="text-[10px] text-muted-foreground mt-0.5 leading-snug">{section.hint}</p>
        )}
      </div>
      <div className="pb-1.5">
        {items.map(sh => <ShortcutRow key={sh.id} sh={sh} openId={openId} onToggle={onToggle} />)}
      </div>
    </div>
  )
}

function GridSections({ items, openId, onToggle }: {
  items:    MockShortcut[]
  openId:   string | null
  onToggle: (id: string | null) => void
}) {
  const bySection = useMemo(() => groupBySection(items), [items])

  if (bySection.length === 0) {
    return <p className="text-center text-sm text-muted-foreground italic py-12">Nenhum atalho encontrado</p>
  }

  return (
    <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 items-start gap-3 p-4">
      {bySection.map(({ section, items: sectionItems }) => (
        <SectionCard key={section.id} section={section} items={sectionItems} openId={openId} onToggle={onToggle} />
      ))}
    </div>
  )
}

// ── variante 4: masonry (empilhado, empacotamento guloso por coluna) ────────
//
// Sem lib externa: mede a largura do container (ResizeObserver, mesmos
// breakpoints do grid — 1/2/3 colunas) e distribui as seções, na ordem fixa
// do registro SECTIONS, sempre pra coluna mais "vazia" no momento (peso =
// nº de itens + overhead do cabeçalho). Cada coluna empilha só o que recebeu,
// sem alinhar com as outras — sem buraco embaixo de seção curta.

const HEADER_WEIGHT = 2 // itens-equivalentes que o bloco título+hint ocupa

function packColumns(sections: ReturnType<typeof groupBySection>, cols: number) {
  const columns: typeof sections[] = Array.from({ length: cols }, () => [])
  const heights  = new Array(cols).fill(0)
  for (const entry of sections) {
    let target = 0
    for (let i = 1; i < cols; i++) if (heights[i] < heights[target]) target = i
    columns[target].push(entry)
    heights[target] += entry.items.length + HEADER_WEIGHT
  }
  return columns
}

function useContainerCols(): [React.RefObject<HTMLDivElement | null>, number] {
  const ref  = useRef<HTMLDivElement>(null)
  const [cols, setCols] = useState(1)

  useEffect(() => {
    const el = ref.current
    if (!el) return
    const ro = new ResizeObserver((entries) => {
      const w = entries[0].contentRect.width
      setCols(w >= 1024 ? 3 : w >= 640 ? 2 : 1)
    })
    ro.observe(el)
    return () => ro.disconnect()
  }, [])

  return [ref, cols]
}

function MasonrySections({ items, openId, onToggle }: {
  items:    MockShortcut[]
  openId:   string | null
  onToggle: (id: string | null) => void
}) {
  const [containerRef, cols] = useContainerCols()
  const bySection = useMemo(() => groupBySection(items), [items])
  const columns   = useMemo(() => packColumns(bySection, cols), [bySection, cols])

  return (
    <div ref={containerRef} className="p-4">
      {bySection.length === 0 ? (
        <p className="text-center text-sm text-muted-foreground italic py-12">Nenhum atalho encontrado</p>
      ) : (
        <div className="flex gap-3">
          {columns.map((col, i) => (
            <div key={i} className="flex-1 min-w-0 flex flex-col gap-3">
              {col.map(({ section, items: sectionItems }, idx) => (
                <SectionCard
                  key={section.id}
                  section={section}
                  items={sectionItems}
                  openId={openId}
                  onToggle={onToggle}
                  grow={idx === col.length - 1}
                />
              ))}
            </div>
          ))}
        </div>
      )}
    </div>
  )
}

// ── shell da modal (igual à real: overlay + box + header + busca) ──────────

type Variant = 'flat' | 'sectioned' | 'grid' | 'masonry'

function ModalPreview({ variant, search, onSearch }: {
  variant:  Variant
  search:   string
  onSearch: (v: string) => void
}) {
  const filtered = useMemo(() => SHORTCUTS.filter(sh => matches(sh, search)), [search])
  const isWide    = variant === 'grid' || variant === 'masonry'
  const [openId, setOpenId] = useState<string | null>(null)

  return (
    <div className={[
      'flex flex-col rounded-lg border border-border bg-popover text-popover-foreground shadow-xl overflow-hidden',
      isWide ? 'w-[92vw] max-w-6xl max-h-[88vh]' : 'w-full max-w-2xl max-h-[70vh]',
    ].join(' ')}>
      <div className="flex items-center gap-2 px-4 py-3 border-b border-border shrink-0">
        <Keyboard className="h-4 w-4 text-muted-foreground shrink-0" />
        <span className="text-sm font-semibold flex-1">Atalhos de teclado</span>
        <button className="flex h-6 w-6 items-center justify-center rounded-md text-muted-foreground hover:bg-accent hover:text-accent-foreground">
          <X className="h-3.5 w-3.5" />
        </button>
      </div>

      <div className="relative px-4 py-2 border-b border-border shrink-0">
        <Search className="absolute left-7 top-1/2 -translate-y-1/2 h-3.5 w-3.5 text-muted-foreground pointer-events-none" />
        <input
          type="search"
          placeholder="Pesquisar descrição, atalho ou seção..."
          value={search}
          onChange={e => onSearch(e.target.value)}
          className="w-full pl-8 pr-4 py-1.5 text-sm rounded-md border border-input bg-input-bg placeholder:text-muted-foreground focus:outline-none focus:ring-1 focus:ring-ring"
        />
      </div>

      <div className="flex-1 overflow-y-auto">
        {variant === 'flat'      && <FlatList items={filtered} openId={openId} onToggle={setOpenId} />}
        {variant === 'sectioned' && <SectionedList items={filtered} filtering={!!search.trim()} openId={openId} onToggle={setOpenId} />}
        {variant === 'grid'      && <GridSections items={filtered} openId={openId} onToggle={setOpenId} />}
        {variant === 'masonry'   && <MasonrySections items={filtered} openId={openId} onToggle={setOpenId} />}
      </div>
    </div>
  )
}

// ── playground shell ─────────────────────────────────────────────────────────

export default function PlaygroundPage() {
  const [variant, setVariant] = useState<Variant>('flat')
  const [search,  setSearch]  = useState('')

  return (
    <div className="p-8 flex flex-col gap-4 items-start">
      <div className="flex items-center gap-3">
        <h1 className="text-base font-semibold">Modal de atalhos — protótipo</h1>
        <div className="flex rounded-md border border-border overflow-hidden text-xs">
          <button
            onClick={() => setVariant('flat')}
            className={`px-3 py-1.5 ${variant === 'flat' ? 'bg-primary text-primary-foreground' : 'hover:bg-accent'}`}
          >
            1) Sem seções
          </button>
          <button
            onClick={() => setVariant('sectioned')}
            className={`px-3 py-1.5 border-l border-border ${variant === 'sectioned' ? 'bg-primary text-primary-foreground' : 'hover:bg-accent'}`}
          >
            2) Com seções
          </button>
          <button
            onClick={() => setVariant('grid')}
            className={`px-3 py-1.5 border-l border-border ${variant === 'grid' ? 'bg-primary text-primary-foreground' : 'hover:bg-accent'}`}
          >
            3) Grid (tudo visível)
          </button>
          <button
            onClick={() => setVariant('masonry')}
            className={`px-3 py-1.5 border-l border-border ${variant === 'masonry' ? 'bg-primary text-primary-foreground' : 'hover:bg-accent'}`}
          >
            4) Empilhado (masonry)
          </button>
        </div>
      </div>
      <p className="text-xs text-muted-foreground max-w-lg">
        Busca funcional nas quatro (descrição, seção, hint ou tecla). Clique no
        ícone <Info className="inline h-3 w-3 align-text-top" /> de qualquer
        atalho pra ver os detalhes (contexto/origin/ordem) expandindo inline.
        Compare 3 (grid) com 4 (masonry) — redimensione a janela pra ver as
        colunas recalcularem em ambos.
      </p>

      <ModalPreview variant={variant} search={search} onSearch={setSearch} />
    </div>
  )
}
