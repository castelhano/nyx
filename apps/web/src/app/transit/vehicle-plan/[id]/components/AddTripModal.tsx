'use client'

import { useState, useEffect, useRef, useMemo } from 'react'
import { useQuery } from '@tanstack/react-query'
import { Button }   from '@/components/ui/button'
import { Icons }    from '@/lib/icons'
import { apiFetch } from '@/lib/auth'
import { useToast } from '@/lib/toast-context'
import { useShortcutContext } from '@/lib/keywatch'
import type { GanttBlock, LineMetrics } from '../views/vehicles.view'
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

export type PendingAddEntry = PendingAddTrip | PendingAddDeadrun

interface Route {
  id:                    string
  direction:             'OUTBOUND' | 'INBOUND' | 'CIRCULAR'
  name:                  string
  originLocalityId:      string
  destinationLocalityId: string
}

interface Locality {
  id:      string
  name:    string
  isDepot: boolean
}

interface Props {
  planId:        string
  plottedLines:  PlanLine[]
  plottedBlocks: GanttBlock[]
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

function hasOverlap(block: GanttBlock, dep: number, arr: number): boolean {
  for (const bt of block.blockTrips) {
    if (dep < bt.trip.arrivalMinutes && arr > bt.trip.departureMinutes) return true
  }
  for (const d of block.blockDeadruns) {
    if (dep < d.arrivalMinutes && arr > d.departureMinutes) return true
  }
  return false
}

const selectCls = [
  'w-full appearance-none text-sm rounded-sm border border-input bg-input-bg',
  'px-3 py-1.5 pe-7 focus:outline-none focus:ring-1 focus:ring-ring',
].join(' ')

const inputCls = 'w-full text-sm rounded-sm border border-input bg-input-bg px-2 py-1.5 text-center focus:outline-none focus:ring-1 focus:ring-ring'

// ── component ─────────────────────────────────────────────────────────────────

export function AddTripModal({ plottedLines, plottedBlocks, onClose, onPendingAdd }: Props) {
  const { toast } = useToast()
  useShortcutContext('modal')

  const [tripType,     setTripType]     = useState<'productive' | 'deadrun'>('productive')
  const [lineId,       setLineId]       = useState(plottedLines[0]?.lineId ?? '')
  const [routeId,      setRouteId]      = useState('')
  const [originId,     setOriginId]     = useState('')
  const [destinationId, setDestinationId] = useState('')
  const [depHH,        setDepHH]        = useState('')
  const [depMM,        setDepMM]        = useState('')
  const [cycleMinutes, setCycleMinutes] = useState('')
  const [blockId,      setBlockId]      = useState<'new' | string>('new')
  const [isResolving,  setIsResolving]  = useState(false)
  const resolveRef = useRef(0)

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

  // Reset route when line changes
  useEffect(() => { setRouteId('') }, [lineId])

  // Reset cycle when relevant inputs change
  useEffect(() => { setCycleMinutes('') }, [tripType, lineId, routeId, originId, destinationId])

  async function resolveCycle() {
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

        if (metrics?.windows) {
          const hour       = hh % 24
          const dirWindows = metrics.windows[route.direction as 'OUTBOUND' | 'INBOUND' | 'CIRCULAR'] ?? []
          const win        = dirWindows.find(w => hour >= w.from && hour <= w.to)
          if (win) { setCycleMinutes(String(win.minutes)); return }
        }

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

  function handleSubmit(e: React.FormEvent<HTMLFormElement>) {
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

    if (tripType === 'productive') {
      const route    = routes.find(r => r.id === routeId)
      if (!route) return
      const planLine = plottedLines.find(l => l.lineId === lineId)
      onPendingAdd({
        _kind:               'trip',
        _tempId:             crypto.randomUUID(),
        routeId,
        direction:           route.direction,
        lineId,
        lineCode:            planLine?.line.code ?? '',
        lineName:            planLine?.line.name ?? '',
        lineMetrics:         planLine?.line.metrics ?? null,
        originLocality:      { id: route.originLocalityId, name: '' },
        destinationLocality: { id: route.destinationLocalityId, name: '' },
        departureMinutes:    depMin,
        arrivalMinutes:      arrivalMin,
        blockId:             resolvedBlockId,
      })
    } else {
      if (!originId || !destinationId) return
      const originLoc = localities.find(l => l.id === originId)
      const destLoc   = localities.find(l => l.id === destinationId)
      onPendingAdd({
        _kind:               'deadrun',
        _tempId:             crypto.randomUUID(),
        originLocality:      { id: originId,      name: originLoc?.name ?? '' },
        destinationLocality: { id: destinationId, name: destLoc?.name   ?? '' },
        departureMinutes:    depMin,
        arrivalMinutes:      arrivalMin,
        blockId:             resolvedBlockId,
      })
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
  const typeReady  = tripType === 'productive' ? !!routeId : (!!originId && !!destinationId)
  const canSubmit  = typeReady && depValid && cycleValid && !isResolving

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center">
      <div className="absolute inset-0 bg-black/40" onClick={onClose} />
      <form
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
        </div>

        {/* Productive: Linha + Sentido */}
        {tripType === 'productive' && (
          <div className="grid grid-cols-2 gap-3">
            <div className="space-y-1.5">
              <label className="text-xs font-medium text-muted-foreground">Linha</label>
              <div className="relative">
                <select value={lineId} onChange={e => setLineId(e.target.value)} className={selectCls}>
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

        {/* Partida + Duração + Chegada */}
        <div className="grid grid-cols-[auto_1fr_auto] gap-3 items-end">
          {/* Partida */}
          <div className="space-y-1.5">
            <label className="text-xs font-medium text-muted-foreground">Partida</label>
            <div className="flex items-center gap-1">
              <input
                type="number"
                min={0} max={47}
                placeholder="HH"
                value={depHH}
                onChange={e => setDepHH(e.target.value)}
                onBlur={resolveCycle}
                className="w-14 text-sm rounded-sm border border-input bg-input-bg px-2 py-1.5 text-center focus:outline-none focus:ring-1 focus:ring-ring"
              />
              <span className="text-muted-foreground font-semibold select-none">:</span>
              <input
                type="number"
                min={0} max={59}
                placeholder="MM"
                value={depMM}
                onChange={e => setDepMM(e.target.value)}
                className="w-14 text-sm rounded-sm border border-input bg-input-bg px-2 py-1.5 text-center focus:outline-none focus:ring-1 focus:ring-ring"
              />
            </div>
          </div>

          {/* Duração */}
          <div className="space-y-1.5">
            <label className="text-xs font-medium text-muted-foreground">
              {isResolving ? 'Calculando…' : 'Duração (min)'}
            </label>
            <input
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
