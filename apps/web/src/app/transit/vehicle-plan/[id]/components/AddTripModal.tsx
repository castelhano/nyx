'use client'

import { useState, useEffect, useRef, useMemo } from 'react'
import { useQuery } from '@tanstack/react-query'
import { Button }   from '@/components/ui/button'
import { Icons }    from '@/lib/icons'
import { apiFetch } from '@/lib/auth'
import { useToast } from '@/lib/toast-context'
import { useShortcut, useShortcutContext } from '@/lib/keywatch'
import type { GanttBlock, GanttBlockTrip, LineMetrics } from '../views/vehicles.view'
import { resolveCycleWindow, resolveCycleMinutes } from '../views/vehicles.view'
import { getTravelTime } from '../travel-time'

// ── module-level cache — persists across modal opens within the session ────────
const lineMetricsCache = new Map<string, LineMetrics | null>()

async function getLineMetrics(lineId: string): Promise<LineMetrics | null> {
  if (lineMetricsCache.has(lineId)) return lineMetricsCache.get(lineId)!
  try {
    const r = await apiFetch(`/transit/transit-line/${lineId}`)
    if (!r.ok) { lineMetricsCache.set(lineId, null); return null }
    const j       = await r.json()
    const metrics = (j.metrics ?? null) as LineMetrics | null
    lineMetricsCache.set(lineId, metrics)
    return metrics
  } catch {
    lineMetricsCache.set(lineId, null)
    return null
  }
}

// ── types ─────────────────────────────────────────────────────────────────────

interface PlanLine {
  lineId: string
  line:   { id: string; code: string; name: string; metrics: LineMetrics | null }
}

// ── pending add types (exported for page.tsx) ──────────────────────────────────

export interface PendingAddTrip {
  _kind:               'trip'
  _tempId:             string
  routeId:             string
  direction:           string
  lineId:              string
  lineCode:            string
  lineName:            string
  lineMetrics:         LineMetrics | null
  originLocality:      { id: string; name: string }
  destinationLocality: { id: string; name: string }
  departureMinutes:    number
  arrivalMinutes:      number
  blockId:             string
  access?: { localityId: string; travelMinutes: number }
  return?: { localityId: string; travelMinutes: number }
}

export interface PendingAddDeadrun {
  _kind:               'deadrun'
  _tempId:             string
  originLocality:      { id: string; name: string }
  destinationLocality: { id: string; name: string }
  departureMinutes:    number
  arrivalMinutes:      number
  blockId:             string
}

export interface PendingAddInterval {
  _kind:            'break'
  _tempId:          string
  intervalTypeId:   string
  intervalTypeCode: string
  intervalTypeName: string
  isPaid:           boolean
  minMinutes:       number | null
  maxMinutes:       number | null
  departureMinutes: number
  arrivalMinutes:   number
  blockId:          string
}

export type PendingAddEntry = PendingAddTrip | PendingAddDeadrun | PendingAddInterval

interface Route {
  id:                    string
  direction:             'OUTBOUND' | 'INBOUND' | 'CIRCULAR'
  name:                  string
  originLocalityId:      string
  destinationLocalityId: string
  isPrimary:             boolean
}

interface Locality {
  id:      string
  name:    string
  isDepot: boolean
}

interface IntervalType {
  id:         string
  code:       string
  name:       string
  isPaid:     boolean
  minMinutes: number | null
  maxMinutes: number | null
}

// Prefill context: the trip to anchor the new (opposite-direction) trip off of,
// and its block/vehicle — the focused trip itself, or, if focus is on a rest
// break, the last productive trip before it (see page.tsx's addTripReference).
export interface AddTripReference {
  block:         GanttBlock
  referenceTrip: GanttBlockTrip
}

interface Props {
  planId:        string
  plottedLines:  PlanLine[]
  plottedBlocks: GanttBlock[]
  reference:     AddTripReference | null
  onClose:       () => void
  onPendingAdd:  (entry: PendingAddEntry) => void
}

// ── helpers ───────────────────────────────────────────────────────────────────

const DIR_LABELS: Record<string, string> = {
  OUTBOUND: 'Ida',
  INBOUND:  'Volta',
  CIRCULAR: 'Circular',
}

const DIR_ORDER: Record<string, number> = {
  CIRCULAR: 0,
  OUTBOUND: 1,
  INBOUND:  2,
}

function fmtMinutes(m: number): string {
  const h   = Math.floor(m / 60) % 24
  const min = m % 60
  return `${String(h).padStart(2, '0')}:${String(min).padStart(2, '0')}`
}

// Narrower than GanttBlock — lets hasOverlap check a locally-accumulated batch
// (real block items + entries generated earlier in the same submit) without a
// full GanttBlock (e.g. blockNumber, depot) existing yet.
type OverlapSource = Pick<GanttBlock, 'blockTrips' | 'blockDeadruns' | 'blockIntervals'>

function hasOverlap(block: OverlapSource, dep: number, arr: number): boolean {
  for (const bt of block.blockTrips) {
    if (dep < bt.trip.arrivalMinutes && arr > bt.trip.departureMinutes) return true
  }
  for (const d of block.blockDeadruns) {
    if (dep < d.arrivalMinutes && arr > d.departureMinutes) return true
  }
  for (const bi of block.blockIntervals) {
    if (dep < bi.arrivalMinutes && arr > bi.departureMinutes) return true
  }
  return false
}

const selectCls = [
  'w-full appearance-none text-sm rounded-sm border border-input bg-input-bg',
  'px-3 py-1.5 pe-7 focus:outline-none focus:ring-1 focus:ring-ring',
].join(' ')

const inputCls = 'w-full text-sm rounded-sm border border-input bg-input-bg px-2 py-1.5 text-center focus:outline-none focus:ring-1 focus:ring-ring'

// ── component ─────────────────────────────────────────────────────────────────

export function AddTripModal({ plottedLines, plottedBlocks, reference, onClose, onPendingAdd }: Props) {
  const { toast } = useToast()
  useShortcutContext('modal')

  // Only honored if the reference trip's line is itself plotted — the line select
  // only lists plottedLines, so anything else can't be preselected.
  const referenceLineId = reference?.referenceTrip.trip.route.line.id ?? null
  const referenceEligible = !!referenceLineId && plottedLines.some(l => l.lineId === referenceLineId)
  const appliedReferenceRef = useRef(false)

  const [tripType,     setTripType]     = useState<'productive' | 'deadrun' | 'interval'>('productive')
  const [lineId,       setLineId]       = useState(referenceEligible ? referenceLineId! : (plottedLines[0]?.lineId ?? ''))
  const [routeId,      setRouteId]      = useState('')
  const [originId,     setOriginId]     = useState('')
  const [destinationId, setDestinationId] = useState('')
  const [intervalTypeId, setIntervalTypeId] = useState('')
  const [depHH,        setDepHH]        = useState('')
  const [depMM,        setDepMM]        = useState('')
  const [cycleMinutes, setCycleMinutes] = useState('')
  const [blockId,      setBlockId]      = useState<'new' | string>('new')
  const [tripsCount,   setTripsCount]   = useState('1')
  const [isResolving,  setIsResolving]  = useState(false)
  const resolveRef  = useRef(0)
  const formRef     = useRef<HTMLFormElement>(null)
  const mmInputRef   = useRef<HTMLInputElement>(null)
  const durationRef = useRef<HTMLInputElement>(null)

  useEffect(() => {
    function handleKey(e: KeyboardEvent) {
      if (e.key === 'Escape') onClose()
    }
    document.addEventListener('keydown', handleKey)
    return () => document.removeEventListener('keydown', handleKey)
  }, [onClose])

  const { data: intervalTypes = [] } = useQuery<IntervalType[]>({
    queryKey: ['transit', 'interval-type', 'all'],
    queryFn:  async () => {
      const r = await apiFetch('/transit/interval-type?pageSize=999')
      if (!r.ok) return []
      const j = await r.json()
      return j.data ?? []
    },
    enabled:   tripType === 'interval',
    staleTime: 60_000,
  })

  useEffect(() => {
    if (tripType === 'interval' && !intervalTypeId && intervalTypes.length > 0) {
      setIntervalTypeId(intervalTypes[0].id)
    }
  }, [tripType, intervalTypes, intervalTypeId])

  const { data: routes = [] } = useQuery<Route[]>({
    queryKey: ['transit', 'transit-route', 'by-line', lineId],
    queryFn:  async () => {
      if (!lineId) return []
      const r = await apiFetch(`/transit/transit-route?f_lineId=${lineId}&pageSize=999`)
      if (!r.ok) return []
      const j = await r.json()
      return j.data ?? []
    },
    enabled:   !!lineId && tripType === 'productive',
    staleTime: 60_000,
  })

  const { data: localities = [] } = useQuery<Locality[]>({
    queryKey: ['transit', 'transit-locality', 'all'],
    queryFn:  async () => {
      const r = await apiFetch('/transit/transit-locality?pageSize=999')
      if (!r.ok) return []
      const j = await r.json()
      return j.data ?? []
    },
    enabled:   tripType === 'deadrun',
    staleTime: 300_000,
  })

  // Reset route only on a genuine line change — a ref-tracked "previous value"
  // guard keeps this from firing destructively on React StrictMode's dev-only
  // double-invoke of the same commit, which would otherwise clobber whatever
  // the reference prefill just (synchronously) set.
  const prevLineIdRef = useRef(lineId)
  useEffect(() => {
    if (prevLineIdRef.current === lineId) return
    prevLineIdRef.current = lineId
    setRouteId('')
  }, [lineId])

  // Reset cycle when relevant inputs change
  useEffect(() => { setCycleMinutes('') }, [tripType, lineId, routeId, originId, destinationId])

  // Prefill from the reference trip (focused trip, or last productive trip before a
  // focused rest break): opposite direction of the reference (same direction if the
  // line only has one), starting right after whatever's already in that gap — an
  // existing rest break's end, or the line's per-window recovery time (intervalMinutes,
  // falling back to 5min) when the gap is empty. Skipped entirely if there's no room.
  useEffect(() => {
    if (appliedReferenceRef.current) return
    if (!reference || !referenceEligible) return
    if (tripType !== 'productive' || lineId !== referenceLineId) return
    if (routes.length === 0) return

    appliedReferenceRef.current = true

    const { block, referenceTrip } = reference
    const refDirection      = referenceTrip.trip.route.direction
    const oppositeDirection = refDirection === 'OUTBOUND' ? 'INBOUND' : refDirection === 'INBOUND' ? 'OUTBOUND' : refDirection
    const candidateRoute    = routes.find(r => r.direction === oppositeDirection) ?? routes.find(r => r.direction === refDirection)
    if (!candidateRoute) return

    const lineMetrics = plottedLines.find(l => l.lineId === lineId)?.line.metrics ?? null

    const nextBreak = [...block.blockIntervals]
      .filter(bi => bi.departureMinutes > referenceTrip.trip.arrivalMinutes)
      .sort((a, b) => a.departureMinutes - b.departureMinutes)[0]
    const nextOther = [
      ...block.blockTrips.map(bt => bt.trip.departureMinutes),
      ...block.blockDeadruns.map(dr => dr.departureMinutes),
    ].filter(dep => dep > referenceTrip.trip.arrivalMinutes).sort((a, b) => a - b)[0]

    // an existing break only counts as "the gap" if nothing else sits between it and the trip
    const startMinutes = nextBreak && (nextOther == null || nextBreak.departureMinutes < nextOther)
      ? nextBreak.arrivalMinutes + 1
      : referenceTrip.trip.arrivalMinutes + (resolveCycleWindow(lineMetrics, candidateRoute.direction, referenceTrip.trip.arrivalMinutes)?.intervalMinutes ?? 5)

    // space check only when a metrics window gives a synchronous duration — otherwise
    // let the async resolveCycle() + the submit-time overlap fallback handle it
    const window = resolveCycleWindow(lineMetrics, candidateRoute.direction, startMinutes)
    if (window && hasOverlap(block, startMinutes, startMinutes + window.minutes)) return

    setRouteId(candidateRoute.id)
    setDepHH(String(Math.floor(startMinutes / 60) % 24))
    setDepMM(String(startMinutes % 60))
    setBlockId(block.id)
  }, [routes, reference, referenceEligible, referenceLineId, tripType, lineId, plottedLines])

  async function resolveCycle() {
    if (tripType === 'interval') return
    const hh = parseInt(depHH, 10)
    if (isNaN(hh) || hh < 0) return

    const token = ++resolveRef.current
    setIsResolving(true)

    try {
      if (tripType === 'productive') {
        const route = routes.find(r => r.id === routeId)
        if (!route) return

        const metrics = await getLineMetrics(lineId)
        if (token !== resolveRef.current) return

        const mm = parseInt(depMM, 10) || 0
        const cycleMinutes = resolveCycleMinutes(metrics, route.direction, hh * 60 + mm)
        if (cycleMinutes != null) { setCycleMinutes(String(cycleMinutes)); return }

        const travelMin = await getTravelTime(route.originLocalityId, route.destinationLocalityId)
        if (token !== resolveRef.current) return
        if (travelMin != null) setCycleMinutes(String(travelMin))
      } else {
        if (!originId || !destinationId) return
        const travelMin = await getTravelTime(originId, destinationId)
        if (token !== resolveRef.current) return
        if (travelMin != null) setCycleMinutes(String(travelMin))
      }
    } finally {
      if (token === resolveRef.current) setIsResolving(false)
    }
  }

  // Also resolve when route or locality changes (if hour is already filled)
  useEffect(() => {
    const hh = parseInt(depHH, 10)
    if (!depHH || isNaN(hh)) return

    if (tripType === 'productive' && !routeId) return
    if (tripType === 'deadrun' && (!originId || !destinationId)) return

    resolveCycle()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [routeId, originId, destinationId, tripType])

  const depMin    = parseInt(depHH, 10) * 60 + parseInt(depMM, 10)
  const cycleMin  = parseInt(cycleMinutes, 10)
  const arrivalMin = (!isNaN(depMin) && !isNaN(cycleMin) && cycleMin > 0) ? depMin + cycleMin : null

  async function handleSubmit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault()

    const hh = parseInt(depHH, 10)
    const mm = parseInt(depMM, 10)
    if (isNaN(hh) || isNaN(mm) || arrivalMin == null) return

    let resolvedBlockId = blockId

    // Conflict detection: if a specific block is selected, check for overlaps
    if (resolvedBlockId !== 'new') {
      const block = plottedBlocks.find(b => b.id === resolvedBlockId)
      if (block && hasOverlap(block, depMin, arrivalMin)) {
        resolvedBlockId = 'new'
        toast.info('Viagem será adicionada em novo bloco pois conflita com outra viagem no bloco informado')
      }
    }

    const requestedCount = Math.max(1, Math.min(10, parseInt(tripsCount, 10) || 1))

    // Local mirror of the target block's contents — grows as each entry in the
    // batch is accepted, since onPendingAdd's state update won't be reflected
    // in `plottedBlocks` until the next render.
    const existingBlock = resolvedBlockId !== 'new' ? plottedBlocks.find(b => b.id === resolvedBlockId) : null
    const virtual: OverlapSource = {
      blockTrips:     existingBlock ? [...existingBlock.blockTrips]     : [],
      blockDeadruns:  existingBlock ? [...existingBlock.blockDeadruns]  : [],
      blockIntervals: existingBlock ? [...existingBlock.blockIntervals] : [],
    }

    const entries: PendingAddEntry[] = []
    // tempId of the batch's own fresh block, once the first entry creates it —
    // every subsequent entry in this batch joins that same block instead of
    // spawning one each (see page.tsx's fakeGroups grouping by `pending:<id>`).
    let batchAnchorId: string | null = null
    const nextBlockId = () =>
      resolvedBlockId !== 'new' ? resolvedBlockId : (batchAnchorId ? `pending:${batchAnchorId}` : 'new')

    if (tripType === 'productive') {
      const route = routes.find(r => r.id === routeId)
      if (!route) return
      const planLine    = plottedLines.find(l => l.lineId === lineId)
      const lineCode    = planLine?.line.code ?? ''
      const lineName    = planLine?.line.name ?? ''
      const lineMetrics = planLine?.line.metrics ?? null

      // Alternation is only allowed between the line's two official (isPrimary)
      // directions, and only when the selected route is itself one of them —
      // otherwise every generated trip reuses the selected route (no turning).
      const primaryOutbound = routes.find(r => r.isPrimary && r.direction === 'OUTBOUND')
      const primaryInbound  = routes.find(r => r.isPrimary && r.direction === 'INBOUND')
      const canAlternate    = route.isPrimary && !!primaryOutbound && !!primaryInbound
      const flip = (r: Route): Route =>
        canAlternate ? (r.id === primaryOutbound!.id ? primaryInbound! : primaryOutbound!) : r

      let curRoute  = route
      let curDep    = depMin
      let curDur    = arrivalMin - depMin // trip 1 always honors the form's own Duração field
      let curWindow = resolveCycleWindow(lineMetrics, curRoute.direction, curDep)

      for (let i = 0; i < requestedCount; i++) {
        const curArr = curDep + curDur
        if (hasOverlap(virtual, curDep, curArr)) break

        const tempId = crypto.randomUUID()
        const originLocality      = { id: curRoute.originLocalityId,      name: '' }
        const destinationLocality = { id: curRoute.destinationLocalityId, name: '' }
        entries.push({
          _kind:               'trip',
          _tempId:             tempId,
          routeId:             curRoute.id,
          direction:           curRoute.direction,
          lineId,
          lineCode,
          lineName,
          lineMetrics,
          originLocality,
          destinationLocality,
          departureMinutes:    curDep,
          arrivalMinutes:      curArr,
          blockId:             nextBlockId(),
        })
        virtual.blockTrips.push({
          id: tempId, sequence: 0,
          trip: {
            id: `${tempId}:trip`, departureMinutes: curDep, arrivalMinutes: curArr, constraints: null,
            route: { direction: curRoute.direction, line: { id: lineId, code: lineCode, name: lineName, metrics: lineMetrics }, originLocality, destinationLocality },
          },
        })
        if (resolvedBlockId === 'new' && !batchAnchorId) batchAnchorId = tempId

        if (i === requestedCount - 1) break

        // Next trip starts after this one's recovery gap, in the opposite
        // primary direction if alternating — else same route, back to back.
        const nextRoute  = flip(curRoute)
        const nextDep    = curArr + (curWindow?.intervalMinutes ?? 0)
        const nextWindow = resolveCycleWindow(lineMetrics, nextRoute.direction, nextDep)
        const nextDur    = nextWindow?.minutes
          ?? await getTravelTime(nextRoute.originLocalityId, nextRoute.destinationLocalityId)
        if (nextDur == null) break // no way to size the next trip — stop the batch here

        curRoute  = nextRoute
        curDep    = nextDep
        curDur    = nextDur
        curWindow = nextWindow
      }

      if (entries.length === 0) {
        toast.info('Não foi possível inserir: conflito com outra viagem no bloco informado')
        return
      }
    } else if (tripType === 'deadrun') {
      if (!originId || !destinationId) return
      const originLoc = localities.find(l => l.id === originId)
      const destLoc   = localities.find(l => l.id === destinationId)
      const duration  = arrivalMin - depMin

      let curDep = depMin
      for (let i = 0; i < requestedCount; i++) {
        const curArr = curDep + duration
        if (hasOverlap(virtual, curDep, curArr)) break

        const tempId = crypto.randomUUID()
        const originLocality      = { id: originId,      name: originLoc?.name ?? '' }
        const destinationLocality = { id: destinationId, name: destLoc?.name   ?? '' }
        entries.push({
          _kind: 'deadrun', _tempId: tempId,
          originLocality, destinationLocality,
          departureMinutes: curDep, arrivalMinutes: curArr,
          blockId: nextBlockId(),
        })
        virtual.blockDeadruns.push({
          id: tempId, type: 'DISPLACEMENT',
          originLocalityId: originId, destinationLocalityId: destinationId,
          originLocality, destinationLocality,
          departureMinutes: curDep, arrivalMinutes: curArr,
        })
        if (resolvedBlockId === 'new' && !batchAnchorId) batchAnchorId = tempId
        curDep = curArr
      }

      if (entries.length === 0) {
        toast.info('Não foi possível inserir: conflito com outra viagem no bloco informado')
        return
      }
    } else {
      const intervalType = intervalTypes.find(t => t.id === intervalTypeId)
      if (!intervalType) return
      const duration = arrivalMin - depMin

      let curDep = depMin
      for (let i = 0; i < requestedCount; i++) {
        const curArr = curDep + duration
        if (hasOverlap(virtual, curDep, curArr)) break

        const tempId = crypto.randomUUID()
        entries.push({
          _kind:            'break',
          _tempId:          tempId,
          intervalTypeId:   intervalType.id,
          intervalTypeCode: intervalType.code,
          intervalTypeName: intervalType.name,
          isPaid:           intervalType.isPaid,
          minMinutes:       intervalType.minMinutes,
          maxMinutes:       intervalType.maxMinutes,
          departureMinutes: curDep,
          arrivalMinutes:   curArr,
          blockId:          nextBlockId(),
        })
        virtual.blockIntervals.push({
          id: tempId, intervalTypeId: intervalType.id,
          intervalType: {
            id: intervalType.id, code: intervalType.code, name: intervalType.name,
            isPaid: intervalType.isPaid, minMinutes: intervalType.minMinutes, maxMinutes: intervalType.maxMinutes,
          },
          departureMinutes: curDep, arrivalMinutes: curArr,
        })
        if (resolvedBlockId === 'new' && !batchAnchorId) batchAnchorId = tempId
        curDep = curArr
      }

      if (entries.length === 0) {
        toast.info('Não foi possível inserir: conflito com outra viagem no bloco informado')
        return
      }
    }

    for (const entry of entries) onPendingAdd(entry)
    if (entries.length < requestedCount) {
      toast.info(`${entries.length} de ${requestedCount} viagens inseridas — conflito com outra entrada no bloco`)
    }

    onClose()
  }

  const plottedLineIds = useMemo(() => new Set(plottedLines.map(l => l.lineId)), [plottedLines])
  const eligibleBlocks = useMemo(
    () => plottedBlocks.filter(b => b.blockTrips.some(bt => plottedLineIds.has(bt.trip.route.line.id))),
    [plottedBlocks, plottedLineIds],
  )
  const sortedLocalities = useMemo(
    () => [...localities].sort((a, b) => a.name.localeCompare(b.name, 'pt')),
    [localities],
  )

  const depValid   = depHH !== '' && depMM !== '' && !isNaN(parseInt(depHH, 10)) && !isNaN(parseInt(depMM, 10))
  const cycleValid = !isNaN(cycleMin) && cycleMin > 0
  const typeReady  = tripType === 'productive' ? !!routeId
    : tripType === 'deadrun' ? (!!originId && !!destinationId)
    : !!intervalTypeId
  const canSubmit  = typeReady && depValid && cycleValid && !isResolving

  useShortcut('alt+g', () => formRef.current?.requestSubmit(), {
    desc:    'Confirmar inclusão',
    context: 'modal',
    icon:    Icons.Save,
    order:   4,
    origin:  'apps/web/src/app/transit/vehicle-plan/[id]/components/AddTripModal.tsx',
  })

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center">
      <div className="absolute inset-0 bg-black/40" onClick={onClose} />
      <form
        ref={formRef}
        onSubmit={handleSubmit}
        className="relative z-10 bg-card border border-border rounded-lg shadow-xl w-full max-w-md mx-4 p-5 space-y-4"
      >
        {/* header */}
        <div className="flex items-center justify-between">
          <h2 className="text-sm font-semibold">Adicionar viagem</h2>
          <button type="button" onClick={onClose} className="p-0.5 rounded hover:bg-accent text-muted-foreground">
            <Icons.X className="w-4 h-4" />
          </button>
        </div>

        {/* Tipo de viagem */}
        <div className="flex items-center gap-6">
          <label className="flex items-center gap-2 cursor-pointer select-none">
            <input
              type="radio"
              name="tripType"
              value="productive"
              checked={tripType === 'productive'}
              onChange={() => setTripType('productive')}
              className="accent-primary"
            />
            <span className="text-sm">Produtiva</span>
          </label>
          <label className="flex items-center gap-2 cursor-pointer select-none">
            <input
              type="radio"
              name="tripType"
              value="deadrun"
              checked={tripType === 'deadrun'}
              onChange={() => setTripType('deadrun')}
              className="accent-primary"
            />
            <span className="text-sm">Dead run <span className="text-xs text-muted-foreground">(Deslocamento)</span></span>
          </label>
          <label className="flex items-center gap-2 cursor-pointer select-none">
            <input
              type="radio"
              name="tripType"
              value="interval"
              checked={tripType === 'interval'}
              onChange={() => setTripType('interval')}
              className="accent-primary"
            />
            <span className="text-sm">Intervalo</span>
          </label>
        </div>

        {/* Productive: Linha + Sentido */}
        {tripType === 'productive' && (
          <div className="grid grid-cols-2 gap-3">
            <div className="space-y-1.5">
              <label className="text-xs font-medium text-muted-foreground">Linha</label>
              <div className="relative">
                <select value={lineId} onChange={e => setLineId(e.target.value)} autoFocus className={selectCls}>
                  {plottedLines.map(({ lineId: lid, line }) => (
                    <option key={lid} value={lid}>{line.code} — {line.name}</option>
                  ))}
                </select>
                <Icons.ChevronDown className="pointer-events-none absolute right-2 top-1/2 -translate-y-1/2 w-3.5 h-3.5 text-muted-foreground" />
              </div>
            </div>

            <div className="space-y-1.5">
              <label className="text-xs font-medium text-muted-foreground">Sentido</label>
              {routes.length === 0 && lineId ? (
                <p className="text-xs text-muted-foreground italic py-1.5">Nenhum sentido</p>
              ) : (
                <div className="relative">
                  <select value={routeId} onChange={e => setRouteId(e.target.value)} className={selectCls}>
                    <option value="">Selecione…</option>
                    {[...routes].sort((a, b) => (DIR_ORDER[a.direction] ?? 99) - (DIR_ORDER[b.direction] ?? 99)).map(r => (
                      <option key={r.id} value={r.id}>{DIR_LABELS[r.direction] ?? r.direction} — {r.name}</option>
                    ))}
                  </select>
                  <Icons.ChevronDown className="pointer-events-none absolute right-2 top-1/2 -translate-y-1/2 w-3.5 h-3.5 text-muted-foreground" />
                </div>
              )}
            </div>
          </div>
        )}

        {/* Dead run: Origem + Destino */}
        {tripType === 'deadrun' && (
          <div className="grid grid-cols-2 gap-3">
            <div className="space-y-1.5">
              <label className="text-xs font-medium text-muted-foreground">Origem</label>
              <div className="relative">
                <select value={originId} onChange={e => setOriginId(e.target.value)} className={selectCls}>
                  <option value="">Selecione…</option>
                  {sortedLocalities.map(l => (
                    <option key={l.id} value={l.id}>{l.name}</option>
                  ))}
                </select>
                <Icons.ChevronDown className="pointer-events-none absolute right-2 top-1/2 -translate-y-1/2 w-3.5 h-3.5 text-muted-foreground" />
              </div>
            </div>

            <div className="space-y-1.5">
              <label className="text-xs font-medium text-muted-foreground">Destino</label>
              <div className="relative">
                <select value={destinationId} onChange={e => setDestinationId(e.target.value)} className={selectCls}>
                  <option value="">Selecione…</option>
                  {sortedLocalities.map(l => (
                    <option key={l.id} value={l.id}>{l.name}</option>
                  ))}
                </select>
                <Icons.ChevronDown className="pointer-events-none absolute right-2 top-1/2 -translate-y-1/2 w-3.5 h-3.5 text-muted-foreground" />
              </div>
            </div>
          </div>
        )}

        {/* Intervalo: Tipo */}
        {tripType === 'interval' && (
          <div className="space-y-1.5">
            <label className="text-xs font-medium text-muted-foreground">Tipo de intervalo</label>
            {intervalTypes.length === 0 ? (
              <p className="text-xs text-muted-foreground italic py-1.5">Nenhum tipo de intervalo cadastrado</p>
            ) : (
              <div className="relative">
                <select value={intervalTypeId} onChange={e => setIntervalTypeId(e.target.value)} className={selectCls}>
                  {intervalTypes.map(t => (
                    <option key={t.id} value={t.id}>{t.code} — {t.name}</option>
                  ))}
                </select>
                <Icons.ChevronDown className="pointer-events-none absolute right-2 top-1/2 -translate-y-1/2 w-3.5 h-3.5 text-muted-foreground" />
              </div>
            )}
          </div>
        )}

        {/* Partida + Duração + Chegada + Viagens */}
        <div className="grid grid-cols-[auto_1fr_auto_auto] gap-3 items-end">
          {/* Partida */}
          <div className="space-y-1.5">
            <label className="text-xs font-medium text-muted-foreground">Partida</label>
            <div className="flex items-center gap-1">
              <input
                type="number"
                min={0} max={47}
                placeholder="HH"
                value={depHH}
                onChange={e => {
                  const raw = e.target.value
                  setDepHH(raw)
                  // Jump to MM as soon as the digit alone can't extend to a valid
                  // hour anymore (3-9), or once two digits have been typed.
                  if (raw.length >= 2 || (raw.length === 1 && parseInt(raw, 10) >= 3)) {
                    mmInputRef.current?.focus()
                    mmInputRef.current?.select()
                  }
                }}
                onBlur={resolveCycle}
                className="w-14 text-sm rounded-sm border border-input bg-input-bg px-2 py-1.5 text-center focus:outline-none focus:ring-1 focus:ring-ring"
              />
              <span className="text-muted-foreground font-semibold select-none">:</span>
              <input
                ref={mmInputRef}
                type="number"
                min={0} max={59}
                placeholder="MM"
                value={depMM}
                onChange={e => {
                  const raw = e.target.value
                  const hadTwoDigits = raw.length >= 2
                  const clamped = raw === '' ? '' : String(Math.max(0, Math.min(59, parseInt(raw, 10) || 0)))
                  setDepMM(clamped)
                  if (hadTwoDigits) {
                    durationRef.current?.focus()
                    durationRef.current?.select()
                  }
                }}
                onBlur={resolveCycle}
                className="w-14 text-sm rounded-sm border border-input bg-input-bg px-2 py-1.5 text-center focus:outline-none focus:ring-1 focus:ring-ring"
              />
            </div>
          </div>

          {/* Duração */}
          <div className="space-y-1.5">
            <label className="text-xs font-medium text-muted-foreground">
              {isResolving ? 'Calculando…' : 'Ciclo'}
            </label>
            <input
              ref={durationRef}
              type="number"
              min={1}
              placeholder="min"
              value={cycleMinutes}
              onChange={e => setCycleMinutes(e.target.value)}
              className={inputCls}
            />
          </div>

          {/* Chegada */}
          <div className="space-y-1.5">
            <label className="text-xs font-medium text-muted-foreground">Chegada</label>
            <div className="text-sm rounded-sm border border-input bg-muted/30 px-3 py-1.5 min-h-[34px] min-w-[72px] flex items-center justify-center">
              {arrivalMin != null
                ? <span className="font-mono">{fmtMinutes(arrivalMin)}</span>
                : <span className="text-xs text-muted-foreground">—</span>
              }
            </div>
          </div>

          {/* Viagens */}
          <div className="space-y-1.5">
            <label className="text-xs font-medium text-muted-foreground">Viagens</label>
            <input
              type="number"
              min={1} max={10}
              value={tripsCount}
              onChange={e => {
                const raw = e.target.value
                setTripsCount(raw === '' ? '' : String(Math.max(1, Math.min(10, parseInt(raw, 10) || 1))))
              }}
              className="block w-14 text-sm rounded-sm border border-input bg-input-bg px-2 py-1.5 text-center focus:outline-none focus:ring-1 focus:ring-ring"
            />
          </div>
        </div>

        {/* Bloco */}
        <div className="space-y-1.5">
          <label className="text-xs font-medium text-muted-foreground">Bloco</label>
          <div className="relative">
            <select value={blockId} onChange={e => setBlockId(e.target.value)} className={selectCls}>
              <option value="new">Novo bloco</option>
              {eligibleBlocks.map(b => (
                <option key={b.id} value={b.id}>Bloco {b.blockNumber}</option>
              ))}
            </select>
            <Icons.ChevronDown className="pointer-events-none absolute right-2 top-1/2 -translate-y-1/2 w-3.5 h-3.5 text-muted-foreground" />
          </div>
        </div>

        {/* actions */}
        <div className="flex justify-end gap-2 pt-1">
          <Button type="button" variant="cancel" size="sm" tabIndex={-1} onClick={onClose}>
            Cancelar
          </Button>
          <Button type="submit" size="sm" disabled={!canSubmit}>
            Adicionar
          </Button>
        </div>
      </form>
    </div>
  )
}
