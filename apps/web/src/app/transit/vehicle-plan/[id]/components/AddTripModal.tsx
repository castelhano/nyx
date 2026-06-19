'use client'

import { useState, useEffect } from 'react'
import { useQuery } from '@tanstack/react-query'
import { Button }   from '@/components/ui/button'
import { Icons }    from '@/lib/icons'
import { apiFetch } from '@/lib/auth'
import { useToast } from '@/lib/toast-context'
import { extractError } from '@/lib/utils'
import type { GanttBlock } from '../views/vehicles.view'

// ── module-level cache — persists across modal opens within the session ────────

interface LineMetrics {
  cycleWindows?: Array<{ from: number; to: number; cycleMinutes: number }>
}
const lineMetricsCache = new Map<string, LineMetrics | null>()
const travelTimeCache  = new Map<string, number | null>()   // key: "originId:destId"

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

async function getTravelTime(originId: string, destinationId: string): Promise<number | null> {
  const key = `${originId}:${destinationId}`
  if (travelTimeCache.has(key)) return travelTimeCache.get(key)!
  try {
    const r = await apiFetch(`/transit/travel-time-matrix?f_originId=${originId}&f_destinationId=${destinationId}&pageSize=1`)
    if (!r.ok) { travelTimeCache.set(key, null); return null }
    const j    = await r.json()
    const item = (j.data ?? [])[0]
    const min  = item != null ? Math.round(item.baseMinutes * item.speedRatio) : null
    travelTimeCache.set(key, min)
    return min
  } catch {
    travelTimeCache.set(key, null)
    return null
  }
}

// ── types ─────────────────────────────────────────────────────────────────────

interface PlanLine {
  lineId: string
  line:   { id: string; code: string; name: string }
}

interface Route {
  id:                    string
  direction:             'OUTBOUND' | 'INBOUND' | 'CIRCULAR'
  name:                  string
  originLocalityId:      string
  destinationLocalityId: string
}

interface Props {
  planId:        string
  plottedLines:  PlanLine[]
  plottedBlocks: GanttBlock[]
  onClose:       () => void
  onCreated:     () => void
}

// ── helpers ───────────────────────────────────────────────────────────────────

const DIR_LABELS: Record<string, string> = {
  OUTBOUND: 'Ida',
  INBOUND:  'Volta',
  CIRCULAR: 'Circular',
}

function fmtMinutes(m: number): string {
  const h   = Math.floor(m / 60) % 24
  const min = m % 60
  return `${String(h).padStart(2, '0')}:${String(min).padStart(2, '0')}`
}

const inputCls = [
  'w-full text-sm rounded-sm border border-input bg-input-bg px-3 py-1.5',
  'focus:outline-none focus:ring-1 focus:ring-ring disabled:opacity-50',
].join(' ')

const selectCls = [
  'w-full appearance-none text-sm rounded-sm border border-input bg-input-bg',
  'px-3 py-1.5 pe-7 focus:outline-none focus:ring-1 focus:ring-ring',
].join(' ')

// ── component ─────────────────────────────────────────────────────────────────

export function AddTripModal({ planId, plottedLines, plottedBlocks, onClose, onCreated }: Props) {
  const { toast } = useToast()

  const [lineId,      setLineId]      = useState(plottedLines[0]?.lineId ?? '')
  const [routeId,     setRouteId]     = useState('')
  const [depHH,       setDepHH]       = useState('')
  const [depMM,       setDepMM]       = useState('')
  const [blockId,     setBlockId]     = useState<'new' | string>('new')
  const [arrivalMin,  setArrivalMin]  = useState<number | null>(null)
  const [resolveErr,  setResolveErr]  = useState(false)
  const [isPending,   setIsPending]   = useState(false)
  const [isResolving, setIsResolving] = useState(false)

  const { data: routes = [] } = useQuery<Route[]>({
    queryKey: ['transit', 'transit-route', 'by-line', lineId],
    queryFn:  async () => {
      if (!lineId) return []
      const r = await apiFetch(`/transit/transit-route?f_lineId=${lineId}&pageSize=999`)
      if (!r.ok) return []
      const j = await r.json()
      return j.data ?? []
    },
    enabled:   !!lineId,
    staleTime: 60_000,
  })

  // Reset route selection when line changes
  useEffect(() => {
    setRouteId(routes[0]?.id ?? '')
  }, [routes])

  // Clear arrival whenever any input changes
  useEffect(() => {
    setArrivalMin(null)
    setResolveErr(false)
  }, [lineId, routeId, depHH, depMM])

  // Resolve arrival on demand when departure is complete
  useEffect(() => {
    const hh = parseInt(depHH, 10)
    const mm = parseInt(depMM, 10)
    if (!routeId || depHH === '' || depMM === '' || isNaN(hh) || isNaN(mm) || hh < 0 || mm < 0 || mm > 59) return

    const route = routes.find(r => r.id === routeId)
    if (!route) return

    const depMin = hh * 60 + mm
    let cancelled = false
    setIsResolving(true)

    ;(async () => {
      // 1. Try line.metrics.cycleWindows
      const metrics = await getLineMetrics(lineId)
      if (cancelled) return

      if (metrics?.cycleWindows?.length) {
        const hour = hh % 24
        const win  = metrics.cycleWindows.find(w => hour >= w.from && hour <= w.to)
        if (win) {
          setArrivalMin(depMin + win.cycleMinutes)
          setResolveErr(false)
          setIsResolving(false)
          return
        }
      }

      // 2. Fallback: TravelTimeMatrix origin → destination
      const travelMin = await getTravelTime(route.originLocalityId, route.destinationLocalityId)
      if (cancelled) return

      if (travelMin != null) {
        setArrivalMin(depMin + travelMin)
        setResolveErr(false)
        setIsResolving(false)
        return
      }

      // 3. No data available
      setArrivalMin(null)
      setResolveErr(true)
      setIsResolving(false)
    })()

    return () => { cancelled = true }
  }, [routeId, depHH, depMM, lineId, routes])

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault()

    if (routes.length === 0) return

    const hh = parseInt(depHH, 10)
    const mm = parseInt(depMM, 10)
    if (!routeId || isNaN(hh) || isNaN(mm)) return

    if (arrivalMin == null) {
      toast.error('Horário de chegada indisponível — verifique as métricas da linha ou a matriz de tempos de viagem')
      return
    }

    setIsPending(true)
    try {
      const res = await apiFetch(`/transit/vehicle-plan/${planId}/add-trip`, {
        method:  'POST',
        headers: { 'Content-Type': 'application/json' },
        body:    JSON.stringify({
          routeId,
          departureMinutes: hh * 60 + mm,
          arrivalMinutes:   arrivalMin,
          blockId:          blockId === 'new' ? undefined : blockId,
        }),
      })
      if (!res.ok) {
        const j = await res.json().catch(() => ({}))
        throw new Error(extractError(j))
      }
      onCreated()
      onClose()
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Erro ao criar viagem')
    } finally {
      setIsPending(false)
    }
  }

  // Blocks that have at least one trip from a plotted line
  const plottedLineIds  = new Set(plottedLines.map(l => l.lineId))
  const eligibleBlocks  = plottedBlocks.filter(b =>
    b.blockTrips.some(bt => plottedLineIds.has(bt.trip.route.line.id))
  )

  const depValid  = depHH !== '' && depMM !== '' && !isNaN(parseInt(depHH, 10)) && !isNaN(parseInt(depMM, 10))
  const canSubmit = !!routeId && routes.length > 0 && depValid && arrivalMin != null && !isPending && !isResolving

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center">
      <div className="absolute inset-0 bg-black/40" onClick={onClose} />
      <form
        onSubmit={handleSubmit}
        className="relative z-10 bg-card border border-border rounded-lg shadow-xl w-full max-w-sm mx-4 p-5 space-y-4"
      >
        {/* header */}
        <div className="flex items-center justify-between">
          <h2 className="text-sm font-semibold">Adicionar viagem</h2>
          <button type="button" onClick={onClose} className="p-0.5 rounded hover:bg-accent text-muted-foreground">
            <Icons.X className="w-4 h-4" />
          </button>
        </div>

        {/* Linha */}
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

        {/* Sentido */}
        <div className="space-y-1.5">
          <label className="text-xs font-medium text-muted-foreground">Sentido</label>
          {routes.length === 0 ? (
            <p className="text-xs text-muted-foreground italic py-1.5">Nenhum sentido disponível</p>
          ) : (
            <div className="relative">
              <select value={routeId} onChange={e => setRouteId(e.target.value)} className={selectCls}>
                {routes.map(r => (
                  <option key={r.id} value={r.id}>{DIR_LABELS[r.direction] ?? r.direction} — {r.name}</option>
                ))}
              </select>
              <Icons.ChevronDown className="pointer-events-none absolute right-2 top-1/2 -translate-y-1/2 w-3.5 h-3.5 text-muted-foreground" />
            </div>
          )}
        </div>

        {/* Horário de início */}
        <div className="space-y-1.5">
          <label className="text-xs font-medium text-muted-foreground">Horário de início</label>
          <div className="flex items-center gap-1.5">
            <input
              type="number"
              min={0} max={47}
              placeholder="HH"
              value={depHH}
              onChange={e => setDepHH(e.target.value)}
              className="w-16 text-sm rounded-sm border border-input bg-input-bg px-2 py-1.5 text-center focus:outline-none focus:ring-1 focus:ring-ring"
            />
            <span className="text-muted-foreground font-semibold text-base select-none">:</span>
            <input
              type="number"
              min={0} max={59}
              placeholder="MM"
              value={depMM}
              onChange={e => setDepMM(e.target.value)}
              className="w-16 text-sm rounded-sm border border-input bg-input-bg px-2 py-1.5 text-center focus:outline-none focus:ring-1 focus:ring-ring"
            />
          </div>
        </div>

        {/* Horário de chegada (auto) */}
        <div className="space-y-1.5">
          <label className="text-xs font-medium text-muted-foreground">Horário de chegada</label>
          <div className="text-sm rounded-sm border border-input bg-muted/30 px-3 py-1.5 min-h-[34px] flex items-center">
            {isResolving ? (
              <span className="text-xs text-muted-foreground italic">Calculando…</span>
            ) : resolveErr ? (
              <span className="text-xs text-destructive">Sem dados de ciclo ou matriz para este sentido</span>
            ) : arrivalMin != null ? (
              <span className="font-mono">{fmtMinutes(arrivalMin)}</span>
            ) : (
              <span className="text-xs text-muted-foreground italic">Calculado automaticamente</span>
            )}
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
          <Button type="button" variant="cancel" size="sm" onClick={onClose}>
            Cancelar
          </Button>
          <Button type="submit" size="sm" disabled={!canSubmit || routes.length === 0}>
            {isPending ? 'Adicionando…' : 'Adicionar'}
          </Button>
        </div>
      </form>
    </div>
  )
}
