'use client'

// Single editor for a Schedule (LineSchedule + LineDeparture) — replaces the
// generic form + breadcrumb-linked departure list. Header edits LineSchedule;
// grid + side panel edit LineDeparture, with a local buffer (dirty-tracking)
// and a single commit to `/departures-batch`.

import { useEffect, useMemo, useRef, useState } from 'react'
import { useRouter, useSearchParams, useParams } from 'next/navigation'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import type {
  LineSchedule, LineDeparture, Route, DayType,
  CreateLineDepartureDto, UpdateLineDepartureDto,
  TripMarking, TripMarkingFontStyle, TripMarkingBgColor,
} from '@nyx/schemas'
import { Icons } from '@/lib/icons'
import { Button } from '@/components/ui/button'
import { Input, inputBaseCls } from '@/components/ui/input'
import { Select } from '@/components/ui/select'
import { ColorPicker } from '@/components/ui/color-picker'
import { AutoBreadcrumb } from '@/core/AutoBreadcrumb'
import { KeyHint } from '@/core/FieldRenderer'
import { usePageGuard } from '@/core/usePageGuard'
import { useRecordQuery } from '@/core/useRecordQuery'
import { useTopbarActions } from '@/components/layout/topbar-actions-context'
import { useShortcut, useFieldKeybinds } from '@/lib/keywatch'
import { useConfirm } from '@/lib/confirm-context'
import { useToast } from '@/lib/toast-context'
import { apiFetch } from '@/lib/auth'
import { msgs } from '@/lib/messages'
import { cn, extractError } from '@/lib/utils'

const DOMAIN   = 'transit'
const RESOURCE = 'line-schedule'

type VehicleType = NonNullable<LineDeparture['requiredVehicleType']>

type StopPattern = LineDeparture['stopPattern']

interface DraftDeparture {
  id:                   string
  routeId:              string
  departureMinutes:     number
  requiredVehicleType?: VehicleType
  stopPattern:          StopPattern
  notes?:               string
  markings?:            TripMarking[]
}

interface HeaderDraft {
  dayTypeId:   string
  approvalRef: string
  notes:       string
}

const DIRECTION_LABELS: Record<Route['direction'], string>       = { OUTBOUND: 'Ida', INBOUND: 'Volta', CIRCULAR: 'Circular' }
const VEHICLE_LABELS:   Record<VehicleType, string>               = { STANDARD: 'Ônibus', MICRO_BUS: 'Micro-ônibus', MINIBUS: 'Miniônibus', VAN: 'Van' }
const UNSET_VEHICLE_TYPE = '__unset__' // sentinel option value for the bulk-edit "Não especificado" choice
const STATUS_LABELS:    Record<LineSchedule['status'], string>    = { DRAFT: 'Rascunho', APPROVED: 'Aprovada', SUPERSEDED: 'Substituída', ARCHIVED: 'Arquivada' }

// same closed palette as TripDetailsModal.tsx (docs/proposal/plan_trip_markings_v1.md)
const BG_COLOR_OPTIONS: { value: TripMarkingBgColor; hex: string }[] = [
  { value: 'AZUL',     hex: '#BDD7EE' },
  { value: 'VERDE',    hex: '#C6E0B4' },
  { value: 'ROSA',     hex: '#F4B6C2' },
  { value: 'ROXO',     hex: '#D9C2EC' },
  { value: 'CINZA',    hex: '#D9D9D9' },
  { value: 'VERMELHO', hex: '#F2A5A0' },
]
const FONT_STYLE_OPTIONS: { value: TripMarkingFontStyle; label: string }[] = [
  { value: 'BOLD',          label: 'Negrito' },
  { value: 'ITALIC',        label: 'Itálico' },
  { value: 'BOLD_ITALIC',   label: 'Negrito + itálico' },
  { value: 'UNDERLINE',     label: 'Sublinhado' },
  { value: 'STRIKETHROUGH', label: 'Tachado' },
]

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
  return `new-${typeof crypto !== 'undefined' && crypto.randomUUID ? crypto.randomUUID() : Math.random().toString(36).slice(2)}`
}

function toDraft(d: LineDeparture): DraftDeparture {
  return {
    id:                   d.id,
    routeId:              d.routeId,
    departureMinutes:     d.departureMinutes,
    requiredVehicleType:  d.requiredVehicleType,
    stopPattern:          d.stopPattern,
    notes:                d.notes,
    markings:             d.markings,
  }
}

function toPayload(d: DraftDeparture) {
  return {
    routeId:             d.routeId,
    departureMinutes:    d.departureMinutes,
    requiredVehicleType: d.requiredVehicleType,
    stopPattern:         d.stopPattern,
    notes:               d.notes,
    markings:            d.markings,
  }
}

// ── subcomponents ──────────────────────────────────────────────────────────

function DepartureChip({ dep, focused, selected, dirty, deleted, onClick }: {
  dep:      DraftDeparture
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
        dirty && !deleted && 'border-l-2 border-l-foreground/30',
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

const SEC_GERAL = { label: 'Geral' }
const SEC_NAV   = { label: 'Navegação' }
const SEC_ED    = { label: 'Edição' }
const SHORTCUT_ORIGIN = 'apps/web/src/app/transit/line-schedule/[id]/page'

// ── page ────────────────────────────────────────────────────────────────

export default function LineScheduleDetailPage() {
  const { id }        = useParams<{ id: string }>()
  const router         = useRouter()
  const searchParams   = useSearchParams()
  const queryClient    = useQueryClient()
  const confirm        = useConfirm()
  const { toast }      = useToast()
  const isNew          = id === 'new'

  const contextParams: Record<string, string> = {}
  for (const [key, value] of searchParams.entries()) contextParams[key] = value
  const lineIdParam = contextParams.lineId

  // ── creation (isNew) ───────────────────────────────────────────────────
  const [newDayTypeId,   setNewDayTypeId]   = useState('')
  const [newApprovalRef, setNewApprovalRef] = useState('')
  const [creating,       setCreating]       = useState(false)

  // ── data ──────────────────────────────────────────────────────────────
  const { data: schedule, error: scheduleError } = useRecordQuery<LineSchedule>(
    [DOMAIN, RESOURCE, id], `/${DOMAIN}/${RESOURCE}/${id}`, { enabled: !isNew },
  )

  const { guardNode, canCreate, canUpdate } = usePageGuard(DOMAIN, RESOURCE, isNew, scheduleError ?? undefined)

  const lineId = isNew ? lineIdParam : schedule?.lineId

  const { data: line } = useRecordQuery<{ id: string; code: string; name: string }>(
    ['transit', 'transit-line', lineId], `/transit/transit-line/${lineId}`, { enabled: !!lineId },
  )

  const { data: routesPage } = useQuery({
    queryKey: ['transit', 'transit-route', lineId],
    queryFn:  async () => {
      const res = await apiFetch(`/transit/transit-route?lineId=${lineId}&pageSize=20`)
      if (!res.ok) throw new Error('Failed to fetch routes')
      return res.json() as Promise<{ data: Route[] }>
    },
    enabled: !!lineId,
  })
  const routes = useMemo(() => routesPage?.data ?? [], [routesPage])

  const { data: dayTypesPage } = useQuery({
    queryKey: ['transit', 'day-type', 'all'],
    queryFn:  async () => {
      const res = await apiFetch('/transit/day-type?pageSize=100')
      if (!res.ok) throw new Error('Failed to fetch day types')
      return res.json() as Promise<{ data: DayType[] }>
    },
  })
  const dayTypes = dayTypesPage?.data ?? []

  const { data: departuresPage } = useQuery({
    queryKey: ['transit', 'line-departure', id],
    queryFn:  async () => {
      const res = await apiFetch(`/transit/line-departure?lineScheduleId=${id}&pageSize=1000`)
      if (!res.ok) throw new Error('Failed to fetch departures')
      return res.json() as Promise<{ data: LineDeparture[] }>
    },
    enabled: !isNew,
  })

  // ── local buffers (dirty-tracking) ───────────────────────────────────
  const [header,         setHeader]         = useState<HeaderDraft | null>(null)
  const [baselineHeader, setBaselineHeader] = useState<HeaderDraft | null>(null)
  const [draft,          setDraft]          = useState<DraftDeparture[] | null>(null)
  const [baseline,       setBaseline]       = useState<DraftDeparture[] | null>(null)
  const [deletedIds,     setDeletedIds]     = useState<Set<string>>(new Set())
  const [focusedId,      setFocusedId]      = useState<string | null>(null)
  const [selectedIds,    setSelectedIds]    = useState<Set<string>>(new Set())
  const [markingDraft,   setMarkingDraft]   = useState('')
  const [bulkShiftMin,   setBulkShiftMin]   = useState('')
  const [viewRouteId,    setViewRouteId]    = useState<string | null>(null)

  const shiftAnchorRef = useRef<string | null>(null)
  const gridRef         = useRef<HTMLDivElement>(null)
  const [gridCols, setGridCols] = useState(10)

  // Grid is responsive (auto-fill columns) — measure the actually rendered column
  // count instead of assuming a fixed value, so ctrl+↑/↓ lands on the right chip
  // at any screen width.
  useEffect(() => {
    const el = gridRef.current
    if (!el) return
    const measure = () => {
      const cols = getComputedStyle(el).gridTemplateColumns.split(' ').filter(Boolean).length
      if (cols > 0) setGridCols(cols)
    }
    measure()
    const ro = new ResizeObserver(measure)
    ro.observe(el)
    return () => ro.disconnect()
  }, [])

  // Both effects below seed an editable draft once its query result loads —
  // legitimate async-query dependency, not computable during render.
  /* eslint-disable react-hooks/set-state-in-effect */
  useEffect(() => {
    if (schedule && !header) {
      const seed: HeaderDraft = { dayTypeId: schedule.dayTypeId, approvalRef: schedule.approvalRef, notes: schedule.notes ?? '' }
      setHeader(seed)
      setBaselineHeader(seed)
    }
  }, [schedule, header])

  useEffect(() => {
    if (departuresPage && !draft) {
      const seeded = departuresPage.data.map(toDraft)
      setDraft(seeded)
      setBaseline(seeded)
    }
  }, [departuresPage, draft])
  /* eslint-enable react-hooks/set-state-in-effect */

  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect
    if (!viewRouteId && routes.length > 0) setViewRouteId(routes[0].id)
  }, [routes, viewRouteId])

  const departuresDirty = useMemo(
    () => !!draft && !!baseline && (JSON.stringify(draft) !== JSON.stringify(baseline) || deletedIds.size > 0),
    [draft, baseline, deletedIds],
  )
  const headerDirty = useMemo(
    () => !!header && !!baselineHeader && JSON.stringify(header) !== JSON.stringify(baselineHeader),
    [header, baselineHeader],
  )
  const isDirty = departuresDirty || headerDirty

  function departuresFor(routeId: string | null): DraftDeparture[] {
    if (!draft || !routeId) return []
    return draft.filter(d => d.routeId === routeId).sort((a, b) => a.departureMinutes - b.departureMinutes)
  }

  const focused = draft?.find(d => d.id === focusedId) ?? null

  // O(1) lookup for the dirty check below, instead of scanning + JSON.stringify-ing
  // the whole baseline array for every rendered chip.
  const baselineById = useMemo(
    () => new Map((baseline ?? []).map(d => [d.id, d])),
    [baseline],
  )

  const markingQuickPicks = useMemo(() => {
    const byText = new Map<string, TripMarking>()
    for (const d of draft ?? []) {
      for (const m of d.markings ?? []) if (!byText.has(m.legendText)) byText.set(m.legendText, m)
    }
    return [...byText.values()]
  }, [draft])

  function switchTab(routeId: string) {
    setViewRouteId(routeId)
    if (focused && focused.routeId !== routeId) {
      setFocusedId(null)
      setSelectedIds(new Set())
      shiftAnchorRef.current = null
    }
  }

  function cycleTab(delta: number) {
    if (routes.length < 2) return
    const idx  = routes.findIndex(r => r.id === viewRouteId)
    const next = routes[(idx + delta + routes.length) % routes.length]
    if (next) switchTab(next.id)
  }

  function patchDeparture(depId: string, patch: Partial<DraftDeparture>) {
    setDraft(prev => prev ? prev.map(d => (d.id === depId ? { ...d, ...patch } : d)) : prev)
  }

  function selectRange(routeId: string, anchorId: string, targetId: string): Set<string> {
    const list = departuresFor(routeId)
    const ai = list.findIndex(d => d.id === anchorId)
    const ti = list.findIndex(d => d.id === targetId)
    if (ai === -1 || ti === -1) return new Set([targetId])
    const [lo, hi] = ai < ti ? [ai, ti] : [ti, ai]
    return new Set(list.slice(lo, hi + 1).map(d => d.id))
  }

  function moveFocus(delta: number, extend: boolean) {
    // Ctrl+arrow is also the browser's native shortcut (jump word) inside a text
    // field — without this, the input's cursor moves along with the departure
    // focus. Blurring the DOM focus avoids the double effect.
    ;(document.activeElement as HTMLElement | null)?.blur?.()
    if (!focused) {
      const first = departuresFor(viewRouteId)[0]
      if (first) setFocusedId(first.id)
      return
    }
    const list = departuresFor(focused.routeId)
    const idx  = list.findIndex(d => d.id === focused.id)
    const next = list[Math.min(list.length - 1, Math.max(0, idx + delta))]
    if (!next) return
    if (extend) {
      if (!shiftAnchorRef.current) shiftAnchorRef.current = focused.id
      setSelectedIds(selectRange(focused.routeId, shiftAnchorRef.current, next.id))
    } else {
      shiftAnchorRef.current = null
      setSelectedIds(new Set())
    }
    setFocusedId(next.id)
  }

  function handleChipClick(dep: DraftDeparture, e: React.MouseEvent) {
    if (e.shiftKey && focused && focused.routeId === dep.routeId) {
      if (!shiftAnchorRef.current) shiftAnchorRef.current = focused.id
      setSelectedIds(selectRange(dep.routeId, shiftAnchorRef.current, dep.id))
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
      const allDeleted = [...ids].every(depId => next.has(depId))
      for (const depId of ids) { if (allDeleted) next.delete(depId); else next.add(depId) }
      return next
    })
  }

  function addDeparture(routeId: string) {
    const list = departuresFor(routeId)
    const last = list[list.length - 1]
    const item: DraftDeparture = { id: newId(), routeId, departureMinutes: last ? last.departureMinutes + 10 : 300, stopPattern: 'LOCAL' }
    setDraft(prev => (prev ? [...prev, item] : [item]))
    setFocusedId(item.id)
    setSelectedIds(new Set())
    shiftAnchorRef.current = item.id
  }

  function applyVehicleTypeToSelected(type: VehicleType | undefined) {
    setDraft(prev => prev ? prev.map(d => (selectedIds.has(d.id) ? { ...d, requiredVehicleType: type } : d)) : prev)
  }

  function shiftSelectedMinutes(delta: number) {
    if (!delta) return
    setDraft(prev => prev ? prev.map(d => (selectedIds.has(d.id) ? { ...d, departureMinutes: Math.max(0, d.departureMinutes + delta) } : d)) : prev)
  }

  // Returns whether the marking was actually added — callers use this to decide
  // whether to clear the input (previously cleared unconditionally, which made a
  // no-op — no focused departure, or a duplicate legendText — look like the typed
  // text had silently vanished).
  function addMarkingToFocused(marking: TripMarking): boolean {
    if (!focused) return false
    if ((focused.markings ?? []).some(m => m.legendText === marking.legendText)) return false
    patchDeparture(focused.id, { markings: [...(focused.markings ?? []), marking] })
    return true
  }

  // ── top-level actions ──────────────────────────────────────────────────

  async function handleCreate() {
    if (!newDayTypeId || !newApprovalRef.trim()) { toast.error('Preencha o tipo de dia e a OSO'); return }
    if (!lineIdParam) { toast.error('Linha não informada'); return }
    setCreating(true)
    try {
      const res = await apiFetch(`/${DOMAIN}/${RESOURCE}`, {
        method: 'POST',
        body:   JSON.stringify({ lineId: lineIdParam, dayTypeId: newDayTypeId, approvalRef: newApprovalRef.trim() }),
      })
      if (!res.ok) { const json = await res.json().catch(() => ({})); throw json }
      const created = await res.json()
      toast.success(msgs.created('Quadro de horários'))
      router.replace(`/${DOMAIN}/${RESOURCE}/${created.id}`)
    } catch (err) {
      toast.error(extractError(err as Record<string, unknown>, msgs.error.save()))
      setCreating(false)
    }
  }

  async function handleSave() {
    if (!draft || !baseline || !header || !baselineHeader || !schedule) return
    if (!isDirty) return

    if (schedule.status !== 'DRAFT') {
      const ok = await confirm({
        title:        'Salvar alterações no quadro de horários',
        description:  'Esta OSO não está mais em rascunho. As alterações valem imediatamente para este quadro.',
        badge:        'OSO ATIVA',
        confirmLabel: 'Salvar mesmo assim',
        cancelLabel:  'Cancelar',
        variant:      'default',
      })
      if (!ok) return
    }

    const create: Omit<CreateLineDepartureDto, 'lineScheduleId'>[] = []
    const update: { id: string; data: UpdateLineDepartureDto }[]  = []
    const deleteIds = [...deletedIds].filter(depId => !depId.startsWith('new-'))

    for (const d of draft) {
      if (deletedIds.has(d.id)) continue
      if (d.id.startsWith('new-')) {
        create.push(toPayload(d))
      } else {
        const base = baselineById.get(d.id)
        const dirty = !base || JSON.stringify(base) !== JSON.stringify(d)
        if (dirty) update.push({ id: d.id, data: toPayload(d) })
      }
    }

    const payload = {
      header: headerDirty ? { dayTypeId: header.dayTypeId, approvalRef: header.approvalRef, notes: header.notes } : undefined,
      create, update, deleteIds,
    }

    try {
      const res = await apiFetch(`/${DOMAIN}/${RESOURCE}/${id}/departures-batch`, {
        method: 'PATCH',
        body:   JSON.stringify(payload),
      })
      if (!res.ok) { const json = await res.json().catch(() => ({})); throw json }
      const result: { schedule: LineSchedule; departures: LineDeparture[] } = await res.json()

      // Seed local buffers straight from the mutation response instead of
      // nulling them and relying on invalidateQueries + the seed effects below:
      // that path raced the still-cached (pre-save) query data — clearing
      // draft/header triggered the seed effect immediately, before the
      // refetch resolved, so it re-seeded from stale data and the fresh
      // response was silently discarded (fixed only by a manual F5).
      const seedHeader: HeaderDraft = { dayTypeId: result.schedule.dayTypeId, approvalRef: result.schedule.approvalRef, notes: result.schedule.notes ?? '' }
      const seedDraft = result.departures.map(toDraft)

      queryClient.setQueryData([DOMAIN, RESOURCE, id], result.schedule)
      queryClient.setQueryData(['transit', 'line-departure', id], { data: result.departures })

      setHeader(seedHeader); setBaselineHeader(seedHeader)
      setDraft(seedDraft); setBaseline(seedDraft)
      setDeletedIds(new Set()); setFocusedId(null); setSelectedIds(new Set())
      toast.success(msgs.saved('Quadro de horários'))
    } catch (err) {
      toast.error(extractError(err as Record<string, unknown>, msgs.error.save()))
    }
  }

  async function handleDiscard() {
    if (!isDirty || !baseline || !baselineHeader) return
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
    router.push(lineId ? `/${DOMAIN}/${RESOURCE}?lineId=${lineId}` : `/${DOMAIN}/${RESOURCE}`)
  }

  async function handleDuplicate() {
    try {
      const res = await apiFetch(`/${DOMAIN}/${RESOURCE}/${id}/duplicate`, { method: 'POST' })
      if (!res.ok) { const json = await res.json().catch(() => ({})); throw json }
      const created = await res.json()
      toast.success('Novo rascunho criado a partir desta OSO')
      router.push(`/${DOMAIN}/${RESOURCE}/${created.id}`)
    } catch (err) {
      toast.error(extractError(err as Record<string, unknown>, msgs.error.save()))
    }
  }

  async function handleApprove(force = false) {
    try {
      const res = await apiFetch(`/${DOMAIN}/${RESOURCE}/${id}/approve`, {
        method: 'POST',
        body:   JSON.stringify({ force }),
      })
      if (!res.ok) { const json = await res.json().catch(() => ({})); throw json }
      const json = await res.json()
      if (json?.conflict) {
        const ok = await confirm({
          title:        'Já existe uma OSO aprovada para esta linha e tipo de dia',
          description:  `A OSO ${json.conflict.approvalRef} será marcada como substituída. Confirma a aprovação desta?`,
          confirmLabel: 'Aprovar mesmo assim',
          cancelLabel:  'Cancelar',
          variant:      'default',
        })
        if (ok) return handleApprove(true)
        return
      }
      toast.success('OSO aprovada')
      await queryClient.invalidateQueries({ queryKey: [DOMAIN, RESOURCE, id] })
    } catch (err) {
      toast.error(extractError(err as Record<string, unknown>, msgs.error.save()))
    }
  }

  // ── topbar ─────────────────────────────────────────────────────────────

  useTopbarActions(
    isNew
      ? [
          { label: creating ? 'Criando…' : 'Criar', icon: Icons.Save, onClick: () => { void handleCreate() }, primary: true, disabled: creating || !canCreate },
        ]
      : [
          ...(canCreate ? [{ label: 'Duplicar', icon: Icons.Copy, overflow: true, onClick: () => { void handleDuplicate() }, variant: 'outline' as const }] : []),
          ...(schedule?.status === 'DRAFT' && canUpdate ? [{ label: 'Aprovar', icon: Icons.Check, onClick: () => { void handleApprove(false) } }] : []),
          { label: 'Limpar', icon: Icons.Undo2, onClick: () => { void handleDiscard() }, variant: 'outline', disabled: !isDirty },
          { label: 'Salvar', icon: Icons.Save, onClick: () => { void handleSave() }, primary: true, disabled: !isDirty || !canUpdate },
        ],
    [isNew, creating, schedule?.status, isDirty, canCreate, canUpdate, header, draft, deletedIds],
  )

  // ── shortcuts ────────────────────────────────────────────────────────────

  const origin = SHORTCUT_ORIGIN

  // Navigating between departures uses ctrl+arrows — plain arrows stay free for
  // editing text in the side panel fields, which is always mounted next to the
  // grid (no "modal closed" moment to isolate the two contexts, unlike vehicle-plan).
  useShortcut('ctrl+→', () => moveFocus(1, false),     { desc: 'Próxima partida',  icon: Icons.ArrowRight, origin, enabled: !isNew, section: SEC_NAV })
  useShortcut('ctrl+←', () => moveFocus(-1, false),    { desc: 'Partida anterior', icon: Icons.ArrowLeft,  origin, enabled: !isNew, section: SEC_NAV })
  useShortcut('ctrl+↓', () => moveFocus(gridCols, false),  { desc: 'Uma linha abaixo', icon: Icons.ArrowDown,  origin, enabled: !isNew, section: SEC_NAV })
  useShortcut('ctrl+↑', () => moveFocus(-gridCols, false), { desc: 'Uma linha acima',  icon: Icons.ArrowUp,    origin, enabled: !isNew, section: SEC_NAV })
  useShortcut('ctrl+shift+→', () => moveFocus(1, true),     { desc: 'Estender seleção →', origin, enabled: !isNew, section: SEC_NAV })
  useShortcut('ctrl+shift+←', () => moveFocus(-1, true),    { desc: 'Estender seleção ←', origin, enabled: !isNew, section: SEC_NAV })
  useShortcut('ctrl+shift+↓', () => moveFocus(gridCols, true),  { desc: 'Estender seleção ↓', origin, enabled: !isNew, section: SEC_NAV })
  useShortcut('ctrl+shift+↑', () => moveFocus(-gridCols, true), { desc: 'Estender seleção ↑', origin, enabled: !isNew, section: SEC_NAV })

  useShortcut('delete', () => toggleDeleteSelected(), {
    desc: 'Excluir/restaurar partida(s) selecionada(s)', icon: Icons.Trash2, origin,
    enabled: !isNew && (!!focusedId || selectedIds.size > 0), section: SEC_ED,
  })
  useShortcut('escape', () => { setSelectedIds(new Set()); shiftAnchorRef.current = null }, {
    desc: 'Limpar seleção', icon: Icons.X, origin, enabled: !isNew && selectedIds.size > 0, section: SEC_ED,
  })
  useShortcut('alt+n', () => { if (viewRouteId) addDeparture(viewRouteId) }, {
    desc: 'Nova partida no sentido ativo', icon: Icons.Plus, origin, enabled: !isNew && !!viewRouteId, section: SEC_ED,
  })

  useShortcut('alt+[', () => cycleTab(-1), {
    desc: 'Aba anterior', icon: Icons.ChevronLeft, origin, order: 9, enabled: !isNew && routes.length > 1, section: SEC_NAV,
  })
  useShortcut('alt+]', () => cycleTab(1), {
    desc: 'Próxima aba', icon: Icons.ChevronRight, origin, order: 9, enabled: !isNew && routes.length > 1, section: SEC_NAV,
  })

  // Ctrl+Shift+[key] — focuses the field via the keybind already declared in the
  // schema, where one exists (docs/architecture/keyboard-shortcuts.md)
  useFieldKeybinds([
    { key: 'o', fieldId: 'ls-approvalRef' },         // LineSchedule.approvalRef
    { key: 'd', fieldId: 'ls-dayTypeId' },           // LineSchedule.dayTypeId
    { key: 'e', fieldId: 'ls-notes' },                // LineSchedule.notes
    { key: 's', fieldId: 'ld-departureMinutes' },    // LineDeparture.departureMinutes
    { key: 'v', fieldId: 'ld-requiredVehicleType' }, // LineDeparture.requiredVehicleType
    { key: 'a', fieldId: 'ld-notes' },                // LineDeparture.notes
    { key: 'k', fieldId: 'ld-markingInput' },         // new marking field
  ], origin)

  useShortcut('alt+g', () => { void (isNew ? handleCreate() : handleSave()) }, {
    desc: 'Salvar', icon: Icons.Save, origin, enabled: isNew ? !creating : isDirty, section: SEC_GERAL,
  })
  useShortcut('alt+l', () => { void handleDiscard() }, {
    desc: 'Reverter alterações', icon: Icons.Undo2, origin, enabled: !isNew && isDirty, section: SEC_GERAL,
  })
  useShortcut('alt+v', () => { void handleBack() }, {
    desc: 'Voltar', icon: Icons.ArrowLeft, origin, section: SEC_GERAL,
  })

  if (guardNode) return guardNode

  // ── render: creation ───────────────────────────────────────────────────

  if (isNew) {
    return (
      <div className="p-6 space-y-4 max-w-lg">
        <AutoBreadcrumb domain={DOMAIN} resource={RESOURCE} contextParams={contextParams} />
        <h1 className="text-sm font-semibold">Novo Quadro de Horários</h1>
        {line && <p className="text-xs text-muted-foreground">Linha {line.code} — {line.name}</p>}
        <div className="space-y-3">
          <div>
            <label className="text-[10px] text-muted-foreground uppercase tracking-wide block mb-1">OSO</label>
            <Input size="sm" className="w-full" placeholder="No do processo" value={newApprovalRef} onChange={e => setNewApprovalRef(e.target.value)} />
          </div>
          <div>
            <label className="text-[10px] text-muted-foreground uppercase tracking-wide block mb-1">Tipo de Dia</label>
            <Select size="sm" className="w-full" value={newDayTypeId} onChange={e => setNewDayTypeId(e.target.value)}>
              <option value="">Selecione…</option>
              {dayTypes.map(dt => <option key={dt.id} value={dt.id}>{dt.name}</option>)}
            </Select>
          </div>
        </div>
      </div>
    )
  }

  // ── render: edit ───────────────────────────────────────────────────────

  const isReady = !!schedule && !!header && !!draft
  const isBulk  = selectedIds.size > 1
  const currentRouteDepartures = departuresFor(viewRouteId)

  return (
    <div className="min-h-full bg-background text-foreground flex flex-col">
      <div className="px-6 pt-4">
        <AutoBreadcrumb domain={DOMAIN} resource={RESOURCE} id={id} recordName={schedule?.approvalRef} contextParams={contextParams} />
      </div>

      {!isReady ? (
        <div className="p-6 text-sm text-muted-foreground">Carregando…</div>
      ) : (
        <>
          <div className="border-b border-border px-6 py-4 space-y-3">
            <div className="flex flex-wrap items-center gap-4">
              <div>
                <div className="text-[10px] text-muted-foreground uppercase tracking-wide">Linha</div>
                <div className="text-sm font-semibold">{line ? `${line.code} — ${line.name}` : '…'}</div>
              </div>

              <div className="flex items-center gap-2">
                <span className={cn(
                  'text-[10px] font-semibold uppercase tracking-wide px-2 py-1 rounded-full border',
                  schedule!.status === 'APPROVED'
                    ? 'bg-emerald-500/15 text-emerald-600 dark:text-emerald-400 border-emerald-500/30'
                    : 'bg-muted text-muted-foreground border-border',
                )}>
                  {STATUS_LABELS[schedule!.status]}
                </span>
                {schedule!.status === 'APPROVED' && (
                  <span className="inline-flex items-center gap-1 text-[10px] font-semibold uppercase tracking-wide px-3 py-1 rounded-full bg-amber-500/15 text-amber-600 dark:text-amber-400 border border-amber-500/30">
                    <Icons.AlertTriangle className="w-3 h-3" /></span>
                )}
              </div>
            </div>

            <form onSubmit={e => e.preventDefault()} className="flex items-center gap-2">
              <div className="relative w-40">
                <Input
                  id="ls-approvalRef"
                  size="sm"
                  className="w-full md:pr-10"
                  value={header!.approvalRef}
                  onChange={e => setHeader(h => (h ? { ...h, approvalRef: e.target.value } : h))}
                />
                <KeyHint k="o" />
              </div>
              <Select
                id="ls-dayTypeId"
                size="sm"
                className="w-36"
                keybind="d"
                value={header!.dayTypeId}
                onChange={e => setHeader(h => (h ? { ...h, dayTypeId: e.target.value } : h))}
              >
                {dayTypes.map(dt => <option key={dt.id} value={dt.id}>{dt.name}</option>)}
              </Select>
              <div className="relative flex-1">
                <Input
                  id="ls-notes"
                  size="sm"
                  className="w-full md:pr-10"
                  placeholder="Observações"
                  value={header!.notes}
                  onChange={e => setHeader(h => (h ? { ...h, notes: e.target.value } : h))}
                />
                <KeyHint k="e" />
              </div>
            </form>
          </div>

          <div className="flex-1 flex overflow-hidden">
            <div className="flex-1 overflow-y-auto p-6 flex flex-col">
              <div className="flex border-b border-border mb-4">
                {routes.map(route => (
                  <button
                    key={route.id}
                    type="button"
                    onClick={() => switchTab(route.id)}
                    className={cn(
                      'flex items-center gap-1.5 px-4 py-2 text-sm font-medium border-b-2 -mb-px transition-colors',
                      route.id === viewRouteId
                        ? 'border-ring text-ring'
                        : 'border-transparent text-muted-foreground hover:text-foreground',
                    )}
                  >
                    <Icons.Route className="w-3.5 h-3.5" />
                    {DIRECTION_LABELS[route.direction]}
                    <span className="text-xs font-normal text-muted-foreground">({departuresFor(route.id).length})</span>
                  </button>
                ))}
                <Button
                  variant="ghost" size="sm" className="ml-auto self-center"
                  onClick={() => viewRouteId && addDeparture(viewRouteId)}
                  disabled={!viewRouteId}
                >
                  <Icons.Plus className="w-3.5 h-3.5" /> Partida
                </Button>
              </div>

              <div ref={gridRef} className="grid grid-cols-[repeat(auto-fill,minmax(4.25rem,1fr))] gap-1.5">
                {currentRouteDepartures.map(dep => (
                  <DepartureChip
                    key={dep.id}
                    dep={dep}
                    focused={dep.id === focusedId}
                    selected={selectedIds.has(dep.id)}
                    dirty={JSON.stringify(baselineById.get(dep.id)) !== JSON.stringify(dep)}
                    deleted={deletedIds.has(dep.id)}
                    onClick={e => handleChipClick(dep, e)}
                  />
                ))}
                {currentRouteDepartures.length === 0 && (
                  <p className="col-span-full text-xs text-muted-foreground">Nenhuma partida neste sentido.</p>
                )}
              </div>
            </div>

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
                    <Select
                      size="sm"
                      defaultValue=""
                      onChange={e => {
                        if (e.target.value === '') return // "Manter atual" — no-op
                        applyVehicleTypeToSelected(e.target.value === UNSET_VEHICLE_TYPE ? undefined : e.target.value as VehicleType)
                      }}
                    >
                      <option value="">Manter atual</option>
                      <option value={UNSET_VEHICLE_TYPE}>Não especificado</option>
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
                      {DIRECTION_LABELS[routes.find(r => r.id === focused.routeId)?.direction ?? 'OUTBOUND']}
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

                  <form onSubmit={e => e.preventDefault()} className="space-y-4">
                    <div className="space-y-1.5">
                      <label className="text-[10px] text-muted-foreground uppercase tracking-wide">Partida</label>
                      <div className="relative">
                        <Input
                          key={focused.id}
                          id="ld-departureMinutes"
                          size="sm"
                          className="w-full md:pr-10"
                          defaultValue={minutesToHHMM(focused.departureMinutes)}
                          onBlur={e => {
                            const m = hhmmToMinutes(e.target.value)
                            if (m != null) patchDeparture(focused.id, { departureMinutes: m })
                            else e.target.value = minutesToHHMM(focused.departureMinutes)
                          }}
                        />
                        <KeyHint k="s" />
                      </div>
                    </div>

                    <div className="space-y-1.5">
                      <label className="text-[10px] text-muted-foreground uppercase tracking-wide">Veículo requerido</label>
                      <Select
                        id="ld-requiredVehicleType"
                        size="sm"
                        keybind="v"
                        value={focused.requiredVehicleType ?? ''}
                        onChange={e => patchDeparture(focused.id, { requiredVehicleType: (e.target.value || undefined) as VehicleType | undefined })}
                      >
                        <option value="">Padrão da linha</option>
                        {(Object.keys(VEHICLE_LABELS) as VehicleType[]).map(v => <option key={v} value={v}>{VEHICLE_LABELS[v]}</option>)}
                      </Select>
                    </div>

                    <div className="space-y-1.5">
                      <label className="text-[10px] text-muted-foreground uppercase tracking-wide">Observações</label>
                      <div className="relative">
                        <textarea
                          id="ld-notes"
                          rows={2}
                          value={focused.notes ?? ''}
                          onChange={e => patchDeparture(focused.id, { notes: e.target.value })}
                          className={cn(inputBaseCls, 'w-full resize-none md:pr-10')}
                        />
                        <KeyHint k="a" className="top-3 -translate-y-0" />
                      </div>
                    </div>
                  </form>

                  <div className="space-y-1.5">
                    <label className="text-[10px] text-muted-foreground uppercase tracking-wide">Marcações</label>
                    <div className="space-y-1.5">
                      {(focused.markings ?? []).map((m, idx) => (
                        <div key={idx} className="border border-border rounded-md p-1.5 space-y-1.5">
                          <div className="flex items-start gap-1.5">
                            <textarea
                              rows={2}
                              value={m.legendText}
                              onChange={e => patchDeparture(focused.id, { markings: (focused.markings ?? []).map((mm, i) => i === idx ? { ...mm, legendText: e.target.value } : mm) })}
                              className="flex-1 text-xs rounded px-1.5 py-1 resize-none border border-input bg-input-bg focus:outline-none focus:ring-1 focus:ring-ring"
                            />
                            <button
                              type="button"
                              onClick={() => patchDeparture(focused.id, { markings: (focused.markings ?? []).filter((_, i) => i !== idx) })}
                              className="p-1 rounded hover:bg-destructive/10 text-muted-foreground hover:text-destructive"
                            >
                              <Icons.X className="w-3.5 h-3.5" />
                            </button>
                          </div>
                          <div className="flex items-start gap-2 mt-2 mb-1">
                            <Select
                              size="sm"
                              className="text-[11px] w-30"
                              value={m.fontStyle ?? ''}
                              onChange={e => {
                                const style = (e.target.value || undefined) as TripMarkingFontStyle | undefined
                                patchDeparture(focused.id, { markings: (focused.markings ?? []).map((mm, i) => i === idx ? { ...mm, fontStyle: style } : mm) })
                              }}
                            >
                              <option value="">Estilo</option>
                              {FONT_STYLE_OPTIONS.map(o => <option key={o.value} value={o.value}>{o.label}</option>)}
                            </Select>
                            <ColorPicker
                              value={m.bgColor ? BG_COLOR_OPTIONS.find(o => o.value === m.bgColor)!.hex : null}
                              onChange={hex => {
                                const bgColor = hex ? BG_COLOR_OPTIONS.find(o => o.hex === hex)!.value : undefined
                                patchDeparture(focused.id, { markings: (focused.markings ?? []).map((mm, i) => i === idx ? { ...mm, bgColor } : mm) })
                              }}
                              palette={BG_COLOR_OPTIONS.map(o => o.hex)}
                              autoColor="#e5e7eb"
                              autoLabel="Sem cor"
                            />
                          </div>
                        </div>
                      ))}
                      <div className="flex gap-1.5">
                        <div className="relative flex-1">
                          <Input
                            id="ld-markingInput"
                            size="sm"
                            className="w-full md:pr-10"
                            placeholder="Nova marcação…"
                            value={markingDraft}
                            onChange={e => setMarkingDraft(e.target.value)}
                            onKeyDown={e => {
                              if (e.key !== 'Enter' || !markingDraft.trim()) return
                              if (addMarkingToFocused({ legendText: markingDraft.trim() })) setMarkingDraft('')
                            }}
                          />
                          <KeyHint k="k" />
                        </div>
                        <Button
                          size="sm"
                          variant="outline"
                          onClick={() => {
                            if (!markingDraft.trim()) return
                            if (addMarkingToFocused({ legendText: markingDraft.trim() })) setMarkingDraft('')
                          }}
                        >
                          <Icons.Plus className="w-3.5 h-3.5" />
                        </Button>
                      </div>
                      {markingQuickPicks.filter(q => !(focused.markings ?? []).some(m => m.legendText === q.legendText)).length > 0 && (
                        <div className="space-y-1">
                          <p className="text-[10px] text-muted-foreground">Já usadas neste quadro:</p>
                          <div className="flex flex-col gap-1.5">
                            {markingQuickPicks
                              .filter(q => !(focused.markings ?? []).some(m => m.legendText === q.legendText))
                              .map(q => (
                                <button
                                  key={q.legendText}
                                  type="button"
                                  title={q.legendText}
                                  onClick={() => addMarkingToFocused(q)}
                                  className="w-full truncate text-left text-xs px-2 py-1 rounded-full border border-border hover:bg-muted transition-colors"
                                >
                                  {q.legendText}
                                </button>
                              ))}
                          </div>
                        </div>
                      )}
                    </div>
                  </div>
                </>
              ) : (
                <p className="text-xs text-muted-foreground">
                  Selecione uma partida na grade — clique ou use ctrl+setas.
                </p>
              )}
            </div>
          </div>
        </>
      )}
    </div>
  )
}
