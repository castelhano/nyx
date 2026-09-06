'use client'

// Prototype: editor único de LineSchedule (OSO) + LineDeparture, ver
// docs/proposal/plan_line_schedule_editor_v1.md — grade de partidas navegável por
// teclado, um bloco por sentido, com painel lateral fixo para editar a partida
// focada (ou edição em lote da seleção). Buffer local (draft) com dirty-tracking,
// commit único no alt+g (cabeçalho + partidas juntos), alt+l reverte, alt+v volta
// para a lista real de OSOs. Dados 100% mockados — nada é persistido.

import { useMemo, useRef, useState } from 'react'
import { useRouter } from 'next/navigation'
import { Icons } from '@/lib/icons'
import { Button } from '@/components/ui/button'
import { Input, inputBaseCls } from '@/components/ui/input'
import { Select } from '@/components/ui/select'
import { ColorPicker } from '@/components/ui/color-picker'
import { useShortcut } from '@/lib/keywatch'
import { useConfirm } from '@/lib/confirm-context'
import { useToast } from '@/lib/toast-context'
import { cn } from '@/lib/utils'

// ── domínio mockado (espelha line-schedule.schema.ts / line-departure.schema.ts / trip-marking.schema.ts) ──

type Direction   = 'OUTBOUND' | 'INBOUND'
type VehicleType = 'STANDARD' | 'MICRO_BUS' | 'MINIBUS' | 'VAN'
type FontStyle   = 'BOLD' | 'ITALIC' | 'BOLD_ITALIC' | 'UNDERLINE' | 'STRIKETHROUGH'
type BgColor     = 'AZUL' | 'VERDE' | 'ROSA' | 'ROXO' | 'CINZA' | 'VERMELHO'

interface Marking { legendText: string; fontStyle?: FontStyle; bgColor?: BgColor }

interface Departure {
  id:                   string
  direction:            Direction
  departureMinutes:     number
  requiredVehicleType?: VehicleType
  notes?:               string
  markings?:            Marking[]
}

const DIRECTION_LABELS: Record<Direction, string>   = { OUTBOUND: 'Ida', INBOUND: 'Volta' }
const VEHICLE_LABELS:   Record<VehicleType, string>  = { STANDARD: 'Ônibus', MICRO_BUS: 'Micro-ônibus', MINIBUS: 'Miniônibus', VAN: 'Van' }

// mesma paleta fechada de TripMarkingsModal.tsx (docs/proposal/plan_trip_markings_v1.md) — copiada
// aqui só para o protótipo ficar autocontido num único arquivo, sem import cruzando pasta [id]
const BG_COLOR_OPTIONS: { value: BgColor; hex: string }[] = [
  { value: 'AZUL',     hex: '#BDD7EE' },
  { value: 'VERDE',    hex: '#C6E0B4' },
  { value: 'ROSA',     hex: '#F4B6C2' },
  { value: 'ROXO',     hex: '#D9C2EC' },
  { value: 'CINZA',    hex: '#D9D9D9' },
  { value: 'VERMELHO', hex: '#F2A5A0' },
]
const FONT_STYLE_OPTIONS: { value: FontStyle; label: string }[] = [
  { value: 'BOLD',          label: 'Negrito' },
  { value: 'ITALIC',        label: 'Itálico' },
  { value: 'BOLD_ITALIC',   label: 'Negrito + itálico' },
  { value: 'UNDERLINE',     label: 'Sublinhado' },
  { value: 'STRIKETHROUGH', label: 'Tachado' },
]

const DAY_TYPES = [
  { id: 'dt-util', name: 'Dia Útil' },
  { id: 'dt-sab',  name: 'Sábado' },
  { id: 'dt-dom',  name: 'Domingo' },
]

const COLS = 10 // aproximação fixa p/ navegação ↑/↓ (casa com grid-cols-10 abaixo) — implementação real deve medir colunas reais do layout

function minutesToHHMM(m: number): string {
  const h  = Math.floor(m / 60)
  const mm = m % 60
  return `${String(h).padStart(2, '0')}:${String(mm).padStart(2, '0')}`
}

function hhmmToMinutes(s: string): number | null {
  const match = /^(\d{1,2}):(\d{2})$/.exec(s.trim())
  if (!match) return null
  const h = Number(match[1]), mm = Number(match[2])
  if (mm > 59 || h < 0) return null
  return h * 60 + mm
}

function newId(): string {
  return typeof crypto !== 'undefined' && crypto.randomUUID ? crypto.randomUUID() : `id-${Math.random().toString(36).slice(2)}`
}

function seedDirection(direction: Direction, offsetSeed: number): Departure[] {
  const list: Departure[] = []
  let t = 300 // 05:00
  let i = 0
  while (t <= 1380) { // 23:00
    const item: Departure = { id: `${direction}-${i}`, direction, departureMinutes: t }
    if (i === 4)  item.requiredVehicleType = 'VAN'
    if (i === 10) item.markings = [{ legendText: 'ESCOLAR', bgColor: 'AZUL' }]
    if (i === 18) item.markings = [{ legendText: 'REFORÇO', fontStyle: 'BOLD', bgColor: 'VERMELHO' }]
    list.push(item)
    t += (i % 3 === 0 ? 12 : 15) + (offsetSeed % 3)
    i++
  }
  return list
}

const SEED_DEPARTURES: Departure[] = [...seedDirection('OUTBOUND', 0), ...seedDirection('INBOUND', 1)]

interface HeaderState {
  dayTypeId:   string
  approvalRef: string
  notes:       string
  status:      'DRAFT' | 'APPROVED'
}

const SEED_HEADER: HeaderState = { dayTypeId: 'dt-util', approvalRef: 'OSO-2026-0142', notes: '', status: 'DRAFT' }

const SEC_GERAL = { label: 'Geral' }
const SEC_NAV   = { label: 'Navegação' }
const SEC_ED    = { label: 'Edição' }
const SHORTCUT_ORIGIN = 'apps/web/src/app/playground/page'

// ── subcomponentes ──────────────────────────────────────────────────────────

function DepartureChip({ dep, focused, selected, dirty, deleted, onClick }: {
  dep:      Departure
  focused:  boolean
  selected: boolean
  dirty:    boolean
  deleted:  boolean
  onClick:  (e: React.MouseEvent) => void
}) {
  const dotHex = dep.markings?.[0] ? BG_COLOR_OPTIONS.find(o => o.value === dep.markings![0].bgColor)?.hex : undefined

  return (
    <button
      type="button"
      onClick={onClick}
      className={cn(
        'relative h-9 flex items-center justify-center rounded-md border text-xs font-semibold tabular-nums transition-colors',
        'border-border bg-card hover:bg-muted',
        focused  && 'ring-2 ring-ring',
        selected && 'bg-accent/60 border-accent',
        dirty && !deleted && 'border-l-4 border-l-amber-500',
        deleted && 'opacity-40 line-through border-dashed border-destructive/60',
      )}
    >
      {dotHex && (
        <span className="absolute top-1 right-1 w-1.5 h-1.5 rounded-full" style={{ background: dotHex }} />
      )}
      {dep.requiredVehicleType && (
        <span className="absolute bottom-1 left-1 w-2 h-0.5 rounded-full bg-muted-foreground" />
      )}
      {minutesToHHMM(dep.departureMinutes)}
    </button>
  )
}

// ── página ────────────────────────────────────────────────────────────────

export default function PlaygroundPage() {
  const router  = useRouter()
  const confirm = useConfirm()
  const { toast } = useToast()

  const [header,          setHeader]         = useState<HeaderState>(SEED_HEADER)
  const [baselineHeader,  setBaselineHeader] = useState<HeaderState>(SEED_HEADER)
  const [draft,           setDraft]          = useState<Departure[]>(SEED_DEPARTURES)
  const [baseline,        setBaseline]       = useState<Departure[]>(SEED_DEPARTURES)
  const [deletedIds,      setDeletedIds]     = useState<Set<string>>(new Set())
  const [focusedId,       setFocusedId]      = useState<string | null>(null)
  const [selectedIds,     setSelectedIds]    = useState<Set<string>>(new Set())
  const [markingDraft,    setMarkingDraft]   = useState('')
  const [bulkShiftMin,    setBulkShiftMin]   = useState('')
  const [viewDirection,   setViewDirection]  = useState<Direction>('OUTBOUND')

  const shiftAnchorRef = useRef<string | null>(null)

  const departuresDirty = useMemo(
    () => JSON.stringify(draft) !== JSON.stringify(baseline) || deletedIds.size > 0,
    [draft, baseline, deletedIds],
  )
  const headerDirty = useMemo(() => JSON.stringify(header) !== JSON.stringify(baselineHeader), [header, baselineHeader])
  const isDirty = departuresDirty || headerDirty

  function departuresFor(direction: Direction) {
    return draft.filter(d => d.direction === direction).sort((a, b) => a.departureMinutes - b.departureMinutes)
  }

  const focused = draft.find(d => d.id === focusedId) ?? null

  function switchTab(direction: Direction) {
    setViewDirection(direction)
    if (focused && focused.direction !== direction) {
      setFocusedId(null)
      setSelectedIds(new Set())
      shiftAnchorRef.current = null
    }
  }

  function patchDeparture(id: string, patch: Partial<Departure>) {
    setDraft(prev => prev.map(d => (d.id === id ? { ...d, ...patch } : d)))
  }

  function selectRange(direction: Direction, anchorId: string, targetId: string): Set<string> {
    const list = departuresFor(direction)
    const ai = list.findIndex(d => d.id === anchorId)
    const ti = list.findIndex(d => d.id === targetId)
    if (ai === -1 || ti === -1) return new Set([targetId])
    const [lo, hi] = ai < ti ? [ai, ti] : [ti, ai]
    return new Set(list.slice(lo, hi + 1).map(d => d.id))
  }

  function moveFocus(delta: number, extend: boolean) {
    if (!focused) {
      const first = departuresFor(viewDirection)[0]
      if (first) setFocusedId(first.id)
      return
    }
    const list = departuresFor(focused.direction)
    const idx  = list.findIndex(d => d.id === focused.id)
    const next = list[Math.min(list.length - 1, Math.max(0, idx + delta))]
    if (!next) return
    if (extend) {
      if (!shiftAnchorRef.current) shiftAnchorRef.current = focused.id
      setSelectedIds(selectRange(focused.direction, shiftAnchorRef.current, next.id))
    } else {
      shiftAnchorRef.current = null
      setSelectedIds(new Set())
    }
    setFocusedId(next.id)
  }

  function handleChipClick(dep: Departure, e: React.MouseEvent) {
    if (e.shiftKey && focused && focused.direction === dep.direction) {
      if (!shiftAnchorRef.current) shiftAnchorRef.current = focused.id
      setSelectedIds(selectRange(dep.direction, shiftAnchorRef.current, dep.id))
    } else {
      shiftAnchorRef.current = dep.id
      setSelectedIds(new Set())
    }
    setFocusedId(dep.id)
  }

  function toggleDeleteSelected() {
    const ids = selectedIds.size > 0 ? selectedIds : (focusedId ? new Set([focusedId]) : new Set<string>())
    if (ids.size === 0) return
    setDeletedIds(prev => {
      const next = new Set(prev)
      const allDeleted = [...ids].every(id => next.has(id))
      for (const id of ids) { if (allDeleted) next.delete(id); else next.add(id) }
      return next
    })
  }

  function addDeparture(direction: Direction) {
    const list = departuresFor(direction)
    const last = list[list.length - 1]
    const item: Departure = { id: newId(), direction, departureMinutes: last ? last.departureMinutes + 10 : 300 }
    setDraft(prev => [...prev, item])
    setFocusedId(item.id)
    setSelectedIds(new Set())
    shiftAnchorRef.current = item.id
  }

  function applyVehicleTypeToSelected(type: VehicleType | undefined) {
    setDraft(prev => prev.map(d => (selectedIds.has(d.id) ? { ...d, requiredVehicleType: type } : d)))
  }

  function shiftSelectedMinutes(delta: number) {
    if (!delta) return
    setDraft(prev => prev.map(d => (selectedIds.has(d.id) ? { ...d, departureMinutes: Math.max(0, d.departureMinutes + delta) } : d)))
  }

  async function handleSave() {
    if (!isDirty) return
    if (header.status !== 'DRAFT') {
      const ok = await confirm({
        title:        'Salvar alterações no quadro de horários',
        description:  'Esta OSO está aprovada e pode estar em uso operacional agora. As alterações valem imediatamente para este quadro.',
        badge:        'OSO ATIVA',
        confirmLabel: 'Salvar mesmo assim',
        cancelLabel:  'Cancelar',
        variant:      'default',
      })
      if (!ok) return
    }
    const committed = draft.filter(d => !deletedIds.has(d.id))
    setDraft(committed)
    setBaseline(committed)
    setDeletedIds(new Set())
    setBaselineHeader(header)
    toast.success('Alterações salvas — protótipo, nada foi persistido de verdade')
  }

  async function handleDiscard() {
    if (!isDirty) return
    const ok = await confirm({
      title:        'Reverter alterações',
      description:  'Volta ao último estado salvo. As alterações pendentes serão perdidas.',
      confirmLabel: 'Reverter',
      cancelLabel:  'Cancelar',
      variant:      'destructive',
    })
    if (!ok) return
    setDraft(baseline)
    setHeader(baselineHeader)
    setDeletedIds(new Set())
    setSelectedIds(new Set())
    setFocusedId(null)
  }

  async function handleBack() {
    if (isDirty) {
      const ok = await confirm({
        title:        'Sair sem salvar',
        description:  'Existem alterações pendentes que serão descartadas.',
        confirmLabel: 'Sair e descartar',
        cancelLabel:  'Cancelar',
        variant:      'destructive',
      })
      if (!ok) return
    }
    router.push('/transit/line-schedule')
  }

  // ── atalhos ────────────────────────────────────────────────────────────

  const origin = SHORTCUT_ORIGIN

  useShortcut('→', () => moveFocus(1, false),    { desc: 'Próxima partida',        icon: Icons.ArrowRight, origin, section: SEC_NAV })
  useShortcut('←', () => moveFocus(-1, false),   { desc: 'Partida anterior',       icon: Icons.ArrowLeft,  origin, section: SEC_NAV })
  useShortcut('↓', () => moveFocus(COLS, false), { desc: 'Uma linha abaixo',       icon: Icons.ArrowDown,  origin, section: SEC_NAV })
  useShortcut('↑', () => moveFocus(-COLS, false),{ desc: 'Uma linha acima',        icon: Icons.ArrowUp,    origin, section: SEC_NAV })
  useShortcut('shift+→', () => moveFocus(1, true),     { desc: 'Estender seleção →', origin, section: SEC_NAV })
  useShortcut('shift+←', () => moveFocus(-1, true),    { desc: 'Estender seleção ←', origin, section: SEC_NAV })
  useShortcut('shift+↓', () => moveFocus(COLS, true),  { desc: 'Estender seleção ↓', origin, section: SEC_NAV })
  useShortcut('shift+↑', () => moveFocus(-COLS, true), { desc: 'Estender seleção ↑', origin, section: SEC_NAV })

  useShortcut('delete', () => toggleDeleteSelected(), {
    desc: 'Excluir/restaurar partida(s) selecionada(s)', icon: Icons.Trash2, origin,
    enabled: !!focusedId || selectedIds.size > 0, section: SEC_ED,
  })
  useShortcut('escape', () => { setSelectedIds(new Set()); shiftAnchorRef.current = null }, {
    desc: 'Limpar seleção', icon: Icons.X, origin, enabled: selectedIds.size > 0, section: SEC_ED,
  })
  useShortcut('alt+n', () => addDeparture(viewDirection), {
    desc: 'Nova partida no sentido ativo', icon: Icons.Plus, origin, section: SEC_ED,
  })

  useShortcut('alt+g', () => { void handleSave() }, {
    desc: 'Salvar alterações', icon: Icons.Save, origin, enabled: isDirty, section: SEC_GERAL,
  })
  useShortcut('alt+l', () => { void handleDiscard() }, {
    desc: 'Reverter alterações', icon: Icons.Undo2, origin, enabled: isDirty, section: SEC_GERAL,
  })
  useShortcut('alt+v', () => { void handleBack() }, {
    desc: 'Voltar', icon: Icons.ArrowLeft, origin, section: SEC_GERAL,
  })

  // ── render ───────────────────────────────────────────────────────────────

  const isBulk = selectedIds.size > 1

  return (
    <div className="min-h-full bg-background text-foreground flex flex-col">
      {/* cabeçalho — edita LineSchedule */}
      <div className="border-b border-border px-6 py-4 space-y-3">
        <div className="flex items-center gap-1.5 text-xs text-muted-foreground">
          <Icons.CalendarSync className="w-3.5 h-3.5" />
          Protótipo — editor de Quadro de Horários (LineSchedule + LineDeparture)
        </div>

        <div className="flex flex-wrap items-center gap-4">
          <div>
            <div className="text-[10px] text-muted-foreground uppercase tracking-wide">Linha</div>
            <div className="text-sm font-semibold">105 — Cpa 1 x Centro <span className="text-muted-foreground font-normal">(mock)</span></div>
          </div>

          <div className="flex items-center gap-2">
            <span className={cn(
              'text-[10px] font-semibold uppercase tracking-wide px-2 py-1 rounded-full border',
              header.status === 'DRAFT'
                ? 'bg-muted text-muted-foreground border-border'
                : 'bg-emerald-500/15 text-emerald-600 dark:text-emerald-400 border-emerald-500/30',
            )}>
              {header.status === 'DRAFT' ? 'Rascunho' : 'Aprovado'}
            </span>
            {header.status !== 'DRAFT' && (
              <span className="inline-flex items-center gap-1 text-[10px] font-semibold uppercase tracking-wide px-2 py-1 rounded-full bg-amber-500/15 text-amber-600 dark:text-amber-400 border border-amber-500/30">
                <Icons.AlertTriangle className="w-3 h-3" /> OSO ativa
              </span>
            )}
          </div>

          <div className="flex gap-2 ml-auto">
            <Button variant="outline" size="sm" onClick={() => toast.info('Duplicar — protótipo, sem efeito')}>
              <Icons.Copy className="w-3.5 h-3.5" /> Duplicar
            </Button>
            <Button
              size="sm"
              onClick={() => {
                setHeader(h => ({ ...h, status: h.status === 'DRAFT' ? 'APPROVED' : 'DRAFT' }))
                toast.info(header.status === 'DRAFT' ? 'Aprovado — protótipo' : 'Voltou a rascunho — protótipo')
              }}
            >
              <Icons.Check className="w-3.5 h-3.5" /> {header.status === 'DRAFT' ? 'Aprovar' : 'Voltar a rascunho'}
            </Button>
          </div>
        </div>

        <div className="flex items-center gap-2">
          <Input
            size="sm"
            className="w-40"
            value={header.approvalRef}
            onChange={e => setHeader(h => ({ ...h, approvalRef: e.target.value }))}
          />
          <Select
            size="sm"
            className="w-36"
            value={header.dayTypeId}
            onChange={e => setHeader(h => ({ ...h, dayTypeId: e.target.value }))}
          >
            {DAY_TYPES.map(dt => <option key={dt.id} value={dt.id}>{dt.name}</option>)}
          </Select>
          <textarea
            placeholder="Observações"
            rows={1}
            value={header.notes}
            onChange={e => setHeader(h => ({ ...h, notes: e.target.value }))}
            className="flex-1 border border-input rounded-sm text-sm bg-input-bg focus:outline-none focus:ring-1 focus:ring-ring px-2 py-1.5 resize-none"
          />
        </div>
      </div>

      {/* corpo — grade do sentido ativo (aba) + painel de detalhe */}
      <div className="flex-1 flex overflow-hidden">
        <div className="flex-1 overflow-y-auto p-6 flex flex-col">
          <div className="flex border-b border-border mb-4">
            {(['OUTBOUND', 'INBOUND'] as Direction[]).map(direction => (
              <button
                key={direction}
                type="button"
                onClick={() => switchTab(direction)}
                className={cn(
                  'flex items-center gap-1.5 px-4 py-2 text-sm font-medium border-b-2 -mb-px transition-colors',
                  direction === viewDirection
                    ? 'border-ring text-ring'
                    : 'border-transparent text-muted-foreground hover:text-foreground',
                )}
              >
                <Icons.Route className="w-3.5 h-3.5" />
                {DIRECTION_LABELS[direction]}
                <span className="text-xs font-normal text-muted-foreground">({departuresFor(direction).length})</span>
              </button>
            ))}
            <Button variant="ghost" size="sm" className="ml-auto self-center" onClick={() => addDeparture(viewDirection)}>
              <Icons.Plus className="w-3.5 h-3.5" /> Partida
            </Button>
          </div>

          <div className="grid grid-cols-10 gap-1.5">
            {departuresFor(viewDirection).map(dep => (
              <DepartureChip
                key={dep.id}
                dep={dep}
                focused={dep.id === focusedId}
                selected={selectedIds.has(dep.id)}
                dirty={!baseline.some(b => JSON.stringify(b) === JSON.stringify(dep))}
                deleted={deletedIds.has(dep.id)}
                onClick={e => handleChipClick(dep, e)}
              />
            ))}
            {departuresFor(viewDirection).length === 0 && (
              <p className="col-span-10 text-xs text-muted-foreground">Nenhuma partida neste sentido.</p>
            )}
          </div>
        </div>

        {/* painel lateral — edita LineDeparture focada ou seleção em lote */}
        <div className="w-80 shrink-0 border-l border-border p-4 overflow-y-auto space-y-4">
          {isBulk ? (
            <>
              <h3 className="text-sm font-semibold">{selectedIds.size} partidas selecionadas</h3>

              <div className="space-y-1.5">
                <label className="text-[10px] text-muted-foreground uppercase tracking-wide">Deslocar horário (min)</label>
                <div className="flex gap-2">
                  <Input size="sm" className="flex-1" type="number" value={bulkShiftMin} onChange={e => setBulkShiftMin(e.target.value)} placeholder="ex: 5 ou -5" />
                  <Button size="sm" variant="outline" onClick={() => { shiftSelectedMinutes(Number(bulkShiftMin) || 0); setBulkShiftMin('') }}>
                    Aplicar
                  </Button>
                </div>
              </div>

              <div className="space-y-1.5">
                <label className="text-[10px] text-muted-foreground uppercase tracking-wide">Veículo requerido</label>
                <Select size="sm" defaultValue="" onChange={e => applyVehicleTypeToSelected((e.target.value || undefined) as VehicleType | undefined)}>
                  <option value="">Aplicar a todas — sem alterar</option>
                  {(Object.keys(VEHICLE_LABELS) as VehicleType[]).map(v => <option key={v} value={v}>{VEHICLE_LABELS[v]}</option>)}
                </Select>
              </div>

              <Button variant="destructive" size="sm" onClick={toggleDeleteSelected} className="w-full">
                <Icons.Trash2 className="w-3.5 h-3.5" /> Excluir/restaurar selecionadas
              </Button>
            </>
          ) : focused ? (
            <>
              <div className="flex items-center justify-between">
                <h3 className="text-sm font-semibold flex items-center gap-1.5">
                  <Icons.Timer className="w-3.5 h-3.5 text-muted-foreground" />
                  {DIRECTION_LABELS[focused.direction]}
                </h3>
                <button
                  type="button"
                  title={deletedIds.has(focused.id) ? 'Restaurar' : 'Excluir'}
                  onClick={toggleDeleteSelected}
                  className="p-1 rounded hover:bg-destructive/10 text-muted-foreground hover:text-destructive"
                >
                  {deletedIds.has(focused.id) ? <Icons.Undo2 className="w-4 h-4" /> : <Icons.Trash2 className="w-4 h-4" />}
                </button>
              </div>

              <div className="space-y-1.5">
                <label className="text-[10px] text-muted-foreground uppercase tracking-wide">Partida</label>
                <Input
                  size="sm"
                  className="w-full"
                  defaultValue={minutesToHHMM(focused.departureMinutes)}
                  onBlur={e => {
                    const m = hhmmToMinutes(e.target.value)
                    if (m != null) patchDeparture(focused.id, { departureMinutes: m })
                    else e.target.value = minutesToHHMM(focused.departureMinutes)
                  }}
                />
              </div>

              <div className="space-y-1.5">
                <label className="text-[10px] text-muted-foreground uppercase tracking-wide">Veículo requerido</label>
                <Select
                  size="sm"
                  value={focused.requiredVehicleType ?? ''}
                  onChange={e => patchDeparture(focused.id, { requiredVehicleType: (e.target.value || undefined) as VehicleType | undefined })}
                >
                  <option value="">Padrão da linha</option>
                  {(Object.keys(VEHICLE_LABELS) as VehicleType[]).map(v => <option key={v} value={v}>{VEHICLE_LABELS[v]}</option>)}
                </Select>
              </div>

              <div className="space-y-1.5">
                <label className="text-[10px] text-muted-foreground uppercase tracking-wide">Observações</label>
                <textarea
                  rows={2}
                  value={focused.notes ?? ''}
                  onChange={e => patchDeparture(focused.id, { notes: e.target.value })}
                  className={cn(inputBaseCls, 'w-full resize-none')}
                />
              </div>

              <div className="space-y-1.5">
                <label className="text-[10px] text-muted-foreground uppercase tracking-wide">Marcações</label>
                <div className="space-y-1.5">
                  {(focused.markings ?? []).map((m, idx) => (
                    <div key={idx} className="flex items-center gap-1.5 border border-border rounded-md p-1.5">
                      <span className="flex-1 text-xs truncate">{m.legendText}</span>
                      <Select
                        size="sm"
                        className="text-[11px] w-28"
                        value={m.fontStyle ?? ''}
                        onChange={e => {
                          const style = (e.target.value || undefined) as FontStyle | undefined
                          setDraft(prev => prev.map(d => d.id === focused.id
                            ? { ...d, markings: (d.markings ?? []).map((mm, i) => i === idx ? { ...mm, fontStyle: style } : mm) }
                            : d))
                        }}
                      >
                        <option value="">Estilo</option>
                        {FONT_STYLE_OPTIONS.map(o => <option key={o.value} value={o.value}>{o.label}</option>)}
                      </Select>
                      <ColorPicker
                        value={m.bgColor ? BG_COLOR_OPTIONS.find(o => o.value === m.bgColor)!.hex : null}
                        onChange={hex => {
                          const bgColor = hex ? BG_COLOR_OPTIONS.find(o => o.hex === hex)!.value : undefined
                          setDraft(prev => prev.map(d => d.id === focused.id
                            ? { ...d, markings: (d.markings ?? []).map((mm, i) => i === idx ? { ...mm, bgColor } : mm) }
                            : d))
                        }}
                        palette={BG_COLOR_OPTIONS.map(o => o.hex)}
                        autoColor="#e5e7eb"
                        autoLabel="Sem cor"
                      />
                      <button
                        type="button"
                        onClick={() => setDraft(prev => prev.map(d => d.id === focused.id
                          ? { ...d, markings: (d.markings ?? []).filter((_, i) => i !== idx) }
                          : d))}
                        className="p-1 rounded hover:bg-destructive/10 text-muted-foreground hover:text-destructive"
                      >
                        <Icons.X className="w-3.5 h-3.5" />
                      </button>
                    </div>
                  ))}
                  <div className="flex gap-1.5">
                    <Input
                      size="sm"
                      className="flex-1"
                      placeholder="Nova marcação…"
                      value={markingDraft}
                      onChange={e => setMarkingDraft(e.target.value)}
                      onKeyDown={e => {
                        if (e.key !== 'Enter' || !markingDraft.trim()) return
                        setDraft(prev => prev.map(d => d.id === focused.id
                          ? { ...d, markings: [...(d.markings ?? []), { legendText: markingDraft.trim() }] }
                          : d))
                        setMarkingDraft('')
                      }}
                    />
                    <Button
                      size="sm"
                      variant="outline"
                      onClick={() => {
                        if (!markingDraft.trim()) return
                        setDraft(prev => prev.map(d => d.id === focused.id
                          ? { ...d, markings: [...(d.markings ?? []), { legendText: markingDraft.trim() }] }
                          : d))
                        setMarkingDraft('')
                      }}
                    >
                      <Icons.Plus className="w-3.5 h-3.5" />
                    </Button>
                  </div>
                </div>
              </div>
            </>
          ) : (
            <p className="text-xs text-muted-foreground">
              Selecione uma partida na grade — clique ou use as setas do teclado.
            </p>
          )}
        </div>
      </div>

      {/* legenda de atalhos */}
      <div className="border-t border-border px-6 py-2 text-[11px] text-muted-foreground flex flex-wrap gap-x-4 gap-y-1">
        <span>← → ↑ ↓ navegar</span>
        <span>shift+seta selecionar intervalo</span>
        <span>delete excluir/restaurar</span>
        <span>alt+n nova partida</span>
        <span className={cn(isDirty && 'text-foreground font-medium')}>alt+g salvar{isDirty ? ' (pendente)' : ''}</span>
        <span>alt+l reverter</span>
        <span>alt+v voltar</span>
      </div>
    </div>
  )
}
