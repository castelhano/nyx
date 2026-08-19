'use client'

import { Fragment, useEffect, useMemo, useRef, useState } from 'react'
import { useQuery } from '@tanstack/react-query'
import {
  ResponsiveContainer, ComposedChart, Bar, Line, XAxis, YAxis,
  Tooltip, Legend, CartesianGrid,
} from 'recharts'
import { Button }              from '@/components/ui/button'
import { Switch }               from '@/components/ui/switch'
import { Icons }                from '@/lib/icons'
import { apiFetch }             from '@/lib/auth'
import { useToast }             from '@/lib/toast-context'
import { useShortcutContext }   from '@/lib/keywatch'
import type { CycleWindow, LineMetrics } from '../views/vehicles.view'
import { getTravelTime }        from '../travel-time'
import type { PendingAddEntry, PendingAddTrip, PendingAddDeadrun, PendingAddInterval } from './AddTripModal'
import {
  buildUnifiedWindows, absorbPartialGaps, mergeByTolerance, deriveFleetBands,
  updateWindowBoundary, computeBoundaryFlags, mergeWithNext, splitWindow, closeFrequency, totalCycleMinutes,
  computeOfertaSeries, estimateGeneration, generateSchedule,
  minutesToLabel, labelToMinutes, hourToLabel, labelToHour,
  TOLERANCE_MINUTES, TOLERANCE_LABELS, DEFAULT_MANEUVER_MARGIN_MINUTES,
  type GenWindow, type Direction, type ToleranceLevel,
} from '../line-generator-logic'

const DIR_LABEL: Record<Direction, string> = { OUTBOUND: 'Ida', INBOUND: 'Volta', CIRCULAR: 'Circular' }
const DIR_ORDER: Direction[] = ['OUTBOUND', 'INBOUND', 'CIRCULAR']
const TOLERANCE_LEVELS: ToleranceLevel[] = [0, 1, 2, 3]

const TABS = [
  { key: 'janelas', label: 'Janelas' },
  { key: 'ajuste',  label: 'Ajuste' },
  { key: 'frota',   label: 'Frota' },
  { key: 'oferta',  label: 'Oferta × Demanda' },
] as const
type TabKey = (typeof TABS)[number]['key']

// ── real data shapes ─────────────────────────────────────────────────────────

interface LineRecord {
  id:      string
  code:    string
  name:    string
  metrics: {
    windows?:      Partial<Record<Direction, CycleWindow[]>>
    // metrics.demand is keyed by dayTypeCode first — see prisma schema comment
    // on TransitLine.metrics — then by direction, then by hour (string keys).
    demand?:       Record<string, Partial<Record<Direction, Record<string, number>>>>
    // inferido da conciliação bilhetagem x GPS — só .value (%) é usado aqui, o resto
    // (peakPax, peakTripId, ...) é proveniência exibida apenas no form da linha
    renewalIndex?: Partial<Record<Direction | 'overall', { value: number }>>
  } | null
}

interface RouteRecord {
  id:                     string
  direction:              Direction
  originLocalityId:       string
  destinationLocalityId:  string
  isPrimary:              boolean
  layoverPolicy:          'DEFAULT' | 'HOLD' | 'DEPOT'
  homeDepotId:            string | null
}

interface LocalityRecord {
  id:   string
  name: string
}

interface DepotRecord {
  id:   string
  name: string
  code: string
}

interface IntervalTypeRecord {
  id:         string
  code:       string
  name:       string
  isPaid:     boolean
  minMinutes: number | null
  maxMinutes: number | null
}

interface LineRoute {
  direction:              Direction
  originName:             string
  destinationName:        string
  routeId:                string
  originLocalityId:       string
  destinationLocalityId:  string
  layoverPolicy:          'DEFAULT' | 'HOLD' | 'DEPOT'
  homeDepotId:            string | null
}

interface DepotAllocation { id: string; depotId: string; count: number }

interface GeneralSettingsRecord {
  defaultLayoverPolicy: 'HOLD' | 'DEPOT'
}

interface NearestDepotResult { depotId: string; toDepotMinutes: number; fromDepotMinutes: number }

// Fase 3.4 — resolves which depot to use for a return leg at an intermediate stop
// (a gap within a block). With homeDepot set on the route, uses only that one (no
// alternative search — if it doesn't fit the gap, implicit HOLD, see the caller).
// Without homeDepot, searches the loaded depots for the one minimizing there+back,
// requiring the round trip to fit the gap and both legs to have an OSRM matrix entry.
async function resolveNearestDepot(
  homeDepotId:     string | null,
  fromLocalityId:  string,
  toLocalityId:    string,
  gapMinutes:      number,
  depots:          DepotRecord[],
): Promise<NearestDepotResult | null> {
  if (homeDepotId) {
    const toDepotMinutes   = await getTravelTime(fromLocalityId, homeDepotId)
    const fromDepotMinutes = await getTravelTime(homeDepotId, toLocalityId)
    if (toDepotMinutes != null && fromDepotMinutes != null && toDepotMinutes + fromDepotMinutes <= gapMinutes) {
      return { depotId: homeDepotId, toDepotMinutes, fromDepotMinutes }
    }
    return null
  }

  let best: NearestDepotResult | null = null
  for (const depot of depots) {
    const toDepotMinutes   = await getTravelTime(fromLocalityId, depot.id)
    const fromDepotMinutes = await getTravelTime(depot.id, toLocalityId)
    if (toDepotMinutes == null || fromDepotMinutes == null) continue
    const total = toDepotMinutes + fromDepotMinutes
    if (total > gapMinutes) continue
    if (!best || total < best.toDepotMinutes + best.fromDepotMinutes) best = { depotId: depot.id, toDepotMinutes, fromDepotMinutes }
  }
  return best
}

interface Props {
  planId:       string
  lineId:       string
  dayTypeCode:  string
  onClose:      () => void
  onPendingAdd: (entry: PendingAddEntry) => void
}

export function LineScheduleGeneratorModal({ planId, lineId, dayTypeCode, onClose, onPendingAdd }: Props) {
  useShortcutContext('modal')
  const { toast } = useToast()

  const { data: line, isLoading: lineLoading, error: lineError } = useQuery<LineRecord>({
    queryKey: ['transit', 'transit-line', lineId],
    queryFn:  async () => {
      const res = await apiFetch(`/transit/transit-line/${lineId}`)
      if (!res.ok) throw new Error('Erro ao carregar linha')
      return res.json()
    },
  })

  const { data: routes = [] } = useQuery<RouteRecord[]>({
    queryKey: ['transit', 'transit-route', 'by-line', lineId],
    queryFn:  async () => {
      const res = await apiFetch(`/transit/transit-route?f_lineId=${lineId}&pageSize=999`)
      if (!res.ok) return []
      const json = await res.json()
      return json.data ?? []
    },
  })

  const { data: localities = [] } = useQuery<LocalityRecord[]>({
    queryKey: ['transit', 'transit-locality', 'all'],
    queryFn:  async () => {
      const res = await apiFetch('/transit/transit-locality?pageSize=999')
      if (!res.ok) return []
      const json = await res.json()
      return json.data ?? []
    },
    staleTime: 300_000,
  })

  const { data: depots = [], isLoading: depotsLoading } = useQuery<DepotRecord[]>({
    queryKey: ['transit', 'transit-locality', 'depots'],
    queryFn:  async () => {
      const res = await apiFetch('/transit/transit-locality?f_isDepot=true&pageSize=100')
      if (!res.ok) return []
      const json = await res.json()
      return json.data ?? []
    },
    staleTime: 60_000,
  })

  const { data: intervalTypes = [], isLoading: intervalTypesLoading } = useQuery<IntervalTypeRecord[]>({
    queryKey: ['transit', 'interval-type', 'all'],
    queryFn:  async () => {
      const res = await apiFetch('/transit/interval-type?pageSize=999')
      if (!res.ok) return []
      const json = await res.json()
      return json.data ?? []
    },
    staleTime: 60_000,
  })

  const { data: generalSettings } = useQuery<GeneralSettingsRecord>({
    queryKey: ['transit', 'settings', 'general'],
    queryFn:  async () => {
      const res = await apiFetch('/transit/settings/general')
      if (!res.ok) return { defaultLayoverPolicy: 'HOLD' as const }
      return res.json()
    },
    staleTime: 300_000,
  })

  // One route per direction the line actually operates (1 to 3) — prefers the
  // isPrimary route when a direction has more than one, same convention the
  // line's extensionKm already relies on (see route.schema.ts comment).
  const localityNameById = useMemo(() => new Map(localities.map(l => [l.id, l.name])), [localities])
  const lineRoutes = useMemo<LineRoute[]>(() => {
    const byDirection = new Map<Direction, RouteRecord>()
    for (const r of routes) {
      const existing = byDirection.get(r.direction)
      if (!existing || (r.isPrimary && !existing.isPrimary)) byDirection.set(r.direction, r)
    }
    return DIR_ORDER.filter(d => byDirection.has(d)).map(d => {
      const r = byDirection.get(d)!
      return {
        direction:             d,
        originName:            localityNameById.get(r.originLocalityId)      ?? '?',
        destinationName:       localityNameById.get(r.destinationLocalityId) ?? '?',
        routeId:               r.id,
        originLocalityId:      r.originLocalityId,
        destinationLocalityId: r.destinationLocalityId,
        layoverPolicy:         r.layoverPolicy,
        homeDepotId:           r.homeDepotId,
      }
    })
  }, [routes, localityNameById])

  const routeByDirection = useMemo(() => new Map(lineRoutes.map(r => [r.direction, r])), [lineRoutes])

  const demandByDir = line?.metrics?.demand?.[dayTypeCode] ?? {}

  // ── local editable state — seeded once from server data as it arrives ──────

  const [activeTab, setActiveTab] = useState<TabKey>('janelas')
  const [windows,   setWindows]   = useState<GenWindow[]>([])
  const [mergeTolerance, setMergeTolerance] = useState<ToleranceLevel>(1) // Baixa by default
  const windowsSeededRef = useRef(false)

  function seedWindows(l: LineRecord | undefined, tolerance: ToleranceLevel): GenWindow[] {
    const base       = buildUnifiedWindows(l?.metrics?.windows?.OUTBOUND ?? [], l?.metrics?.windows?.INBOUND ?? [])
    const absorbed   = absorbPartialGaps(base)
    const toleranced = mergeByTolerance(absorbed, TOLERANCE_MINUTES[tolerance])
    const demand     = l?.metrics?.demand?.[dayTypeCode] ?? {}
    const renewal    = {
      OUTBOUND: l?.metrics?.renewalIndex?.OUTBOUND?.value ?? 0,
      INBOUND:  l?.metrics?.renewalIndex?.INBOUND?.value  ?? 0,
    }
    return deriveFleetBands(toleranced, demand, vehicleCapacity, renewal)
  }

  useEffect(() => {
    if (!line || windowsSeededRef.current) return
    windowsSeededRef.current = true
    setWindows(seedWindows(line, mergeTolerance))
  }, [line]) // eslint-disable-line react-hooks/exhaustive-deps

  function changeTolerance(level: ToleranceLevel) {
    setMergeTolerance(level)
    setWindows(seedWindows(line, level))
  }

  const [opStart,             setOpStart]             = useState(240)  // 04:00
  const [opEnd,               setOpEnd]               = useState(1410) // 23:30
  const [vehicleCapacity,     setVehicleCapacity]      = useState(80)
  const [renewalIndex,        setRenewalIndex]         = useState<Partial<Record<Direction, number>>>({})
  const renewalSeededRef = useRef(false)

  useEffect(() => {
    if (!line || renewalSeededRef.current) return
    renewalSeededRef.current = true
    const stats = line.metrics?.renewalIndex ?? {}
    setRenewalIndex({
      OUTBOUND: stats.OUTBOUND?.value ?? 0,
      INBOUND:  stats.INBOUND?.value  ?? 0,
      CIRCULAR: stats.CIRCULAR?.value ?? 0,
    })
  }, [line])

  const [includeAccessReturn, setIncludeAccessReturn]  = useState(false)
  const [insertInterval,      setInsertInterval]       = useState(true)
  const [intervalTypeId,      setIntervalTypeId]       = useState('')

  // Direction considered for the first/last trip of the day — defaults to Outbound
  // (or Circular in its absence) for the start, Inbound (or Circular) for the end.
  const [firstTripDirection, setFirstTripDirection] = useState<Direction>('OUTBOUND')
  const [lastTripDirection,  setLastTripDirection]  = useState<Direction>('INBOUND')
  const tripDirectionsSeededRef = useRef(false)

  useEffect(() => {
    if (lineRoutes.length === 0 || tripDirectionsSeededRef.current) return
    tripDirectionsSeededRef.current = true
    const has = (d: Direction) => lineRoutes.some(r => r.direction === d)
    setFirstTripDirection(has('OUTBOUND') ? 'OUTBOUND' : 'CIRCULAR')
    setLastTripDirection(has('INBOUND') ? 'INBOUND' : 'CIRCULAR')
  }, [lineRoutes])

  // Maneuver margin: how much to "tighten" an open block's previous trip before
  // deciding to open a new block (used only by block assignment, Fase 3 — no effect on the preview).
  const [maneuverMargin, setManeuverMargin] = useState(DEFAULT_MANEUVER_MARGIN_MINUTES)

  useEffect(() => {
    if (!intervalTypeId && intervalTypes.length > 0) setIntervalTypeId(intervalTypes[0].id)
  }, [intervalTypes, intervalTypeId])

  const [depotAllocations, setDepotAllocations] = useState<DepotAllocation[]>([])
  const depotsSeededRef = useRef(false)

  useEffect(() => {
    if (depots.length === 0 || depotsSeededRef.current) return
    depotsSeededRef.current = true
    setDepotAllocations([{ id: crypto.randomUUID(), depotId: depots[0].id, count: 0 }])
  }, [depots])

  const [activeDir,    setActiveDir]    = useState<Direction>('OUTBOUND')
  const [isGenerating, setIsGenerating] = useState(false)

  useEffect(() => {
    function onKey(e: KeyboardEvent) { if (e.key === 'Escape') onClose() }
    document.addEventListener('keydown', onKey)
    return () => document.removeEventListener('keydown', onKey)
  }, [onClose])

  const boundaryFlags = useMemo(() => computeBoundaryFlags(windows), [windows])
  const peakFleet = useMemo(() => windows.reduce((m, w) => Math.max(m, w.fleetCount), 0), [windows])
  const depotSum  = useMemo(() => depotAllocations.reduce((s, d) => s + d.count, 0), [depotAllocations])

  // Seed the (initially empty) first depot row with the whole peak fleet once
  // it's known — keeps the single-depot case a zero-effort default.
  useEffect(() => {
    setDepotAllocations(prev => (prev.length === 1 && prev[0].count === 0 && peakFleet > 0)
      ? [{ ...prev[0], count: peakFleet }]
      : prev)
  }, [peakFleet])

  const ofertaSeries = useMemo(
    () => computeOfertaSeries(windows, vehicleCapacity, renewalIndex, opStart, opEnd),
    [windows, vehicleCapacity, renewalIndex, opStart, opEnd],
  )

  // Aggregate preview, recomputed on every edit — a cheap sanity-check before
  // actually generating (the real algorithm, triggered by handleGenerate, is
  // much more expensive due to network calls for access/return and HOLD/DEPOT).
  const preview = useMemo(() => estimateGeneration(windows, opStart, opEnd), [windows, opStart, opEnd])

  const chartData = useMemo(() => Array.from({ length: 24 }, (_, hour) => ({
    hour:    hourToLabel(hour),
    oferta:  ofertaSeries[activeDir]?.[hour] ?? 0,
    demanda: demandByDir[activeDir]?.[String(hour)] ?? 0,
  })), [ofertaSeries, activeDir, demandByDir])

  function updateWindow(index: number, patch: Partial<GenWindow>) {
    setWindows(rows => rows.map((r, i) => i === index ? { ...r, ...patch } : r))
  }
  function updateBoundary(index: number, field: 'from' | 'to', value: number) {
    setWindows(rows => updateWindowBoundary(rows, index, field, value))
  }
  function removeWindow(index: number) {
    // may open a gap between the rows that become adjacent — surfaced via
    // computeBoundaryFlags rather than guessed shut here
    setWindows(rows => rows.length > 1 ? rows.filter((_, i) => i !== index) : rows)
  }
  function doMerge(index: number) {
    setWindows(rows => mergeWithNext(rows, index))
  }
  function doSplit(index: number) {
    setWindows(rows => splitWindow(rows, index))
  }
  function doCloseFrequency(index: number) {
    setWindows(rows => closeFrequency(rows, index))
  }
  function doCloseFrequencyAll() {
    setWindows(rows => {
      let acc = rows
      for (let i = 0; i < acc.length; i++) acc = closeFrequency(acc, i)
      return acc
    })
  }
  function resetWindows() {
    setWindows(seedWindows(line, mergeTolerance))
  }
  function addBlankWindow() {
    setWindows(rows => {
      if (rows.length === 0) {
        return [{
          id: crypto.randomUUID(), from: 0, to: 24,
          outboundMinutes: 60, outboundKnown: true, outboundInterval: 1,
          inboundMinutes:  60, inboundKnown:  true, inboundInterval:  1,
          fleetCount: 1,
        }]
      }
      // splits the last row in two rather than appending — appending would
      // either duplicate the 0–24 span or leave the day boundary broken
      return splitWindow(rows, rows.length - 1)
    })
  }
  function addDepotRow() {
    const used = new Set(depotAllocations.map(d => d.depotId))
    const next = depots.find(d => !used.has(d.id)) ?? depots[0]
    if (!next) return
    setDepotAllocations(prev => [...prev, { id: crypto.randomUUID(), depotId: next.id, count: 0 }])
  }
  function removeDepotRow(id: string) {
    setDepotAllocations(prev => prev.length > 1 ? prev.filter(d => d.id !== id) : prev)
  }
  function updateDepotRow(id: string, patch: Partial<DepotAllocation>) {
    setDepotAllocations(prev => prev.map(d => d.id === id ? { ...d, ...patch } : d))
  }

  async function handleGenerate() {
    if (windows.length === 0 || isGenerating) return

    const pairedDirection: Direction | null =
      firstTripDirection === 'CIRCULAR' ? null : firstTripDirection === 'OUTBOUND' ? 'INBOUND' : 'OUTBOUND'
    const anchorRoute = routeByDirection.get(firstTripDirection)
    const pairedRoute = pairedDirection ? routeByDirection.get(pairedDirection) : null
    if (!anchorRoute || (pairedDirection && !pairedRoute)) {
      toast.error('Sentido selecionado não possui rota cadastrada para esta linha')
      return
    }

    const { blocks, warnings } = generateSchedule(
      windows, opStart, opEnd, firstTripDirection, lastTripDirection, maneuverMargin,
    )
    if (blocks.length === 0) {
      toast.error('Nenhuma viagem gerada — revise as janelas e o horário de operação')
      return
    }

    // Validation log — while the algorithm is still being tuned, records the
    // generated plan (windows, blocks/trips, warnings) into a queryable Job at
    // core/job. Best-effort: shouldn't block generation if the call fails.
    // See docs/proposal/vehicle-plan-fleet-window-redesign.md.
    apiFetch(`/transit/vehicle-plan/${planId}/lines/${lineId}/log-generation`, {
      method: 'POST',
      body:   JSON.stringify({
        dayTypeCode,
        output: {
          lineId, lineCode: line?.code, lineName: line?.name, dayTypeCode,
          params: { opStart, opEnd, firstTripDirection, lastTripDirection, maneuverMargin, mergeTolerance },
          windows,
          blocks: blocks.map(b => ({
            id:     b.id,
            rounds: b.rounds.map(r => ({ legs: r.legs, readyAgainMinutes: r.readyAgainMinutes })),
          })),
          summary: {
            blockCount: blocks.length,
            totalTrips: blocks.reduce((s, b) => s + b.rounds.reduce((s2, r) => s2 + r.legs.length, 0), 0),
            peakFleet:  windows.reduce((m, w) => Math.max(m, w.fleetCount), 0),
          },
          warnings,
        },
      }),
    }).catch(() => {})

    setIsGenerating(true)
    try {
      const routeFor    = (dir: Direction) => (dir === firstTripDirection ? anchorRoute! : pairedRoute!)
      const localityRef = (id: string) => ({ id, name: localityNameById.get(id) ?? '?' })
      const selectedIntervalType = intervalTypes.find(it => it.id === intervalTypeId) ?? null

      const depotPool = depotAllocations.flatMap(d => Array(Math.max(0, d.count)).fill(d.depotId)) as string[]
      if (includeAccessReturn && depotPool.length === 0) {
        toast.warning('Nenhuma garagem alocada — acesso/recolhida não inseridos (aba Frota)')
      }

      function maybeInsertBreak(gapStart: number, gapEnd: number, blockAnchorId: string) {
        if (!insertInterval || !selectedIntervalType) return
        const gap = gapEnd - gapStart
        const min = selectedIntervalType.minMinutes ?? 0
        const max = selectedIntervalType.maxMinutes ?? Infinity
        if (gap < min || gap > max) return
        const entry: PendingAddInterval = {
          _kind:            'break',
          _tempId:          crypto.randomUUID(),
          intervalTypeId:   selectedIntervalType.id,
          intervalTypeCode: selectedIntervalType.code,
          intervalTypeName: selectedIntervalType.name,
          isPaid:           selectedIntervalType.isPaid,
          minMinutes:       selectedIntervalType.minMinutes,
          maxMinutes:       selectedIntervalType.maxMinutes,
          departureMinutes: Math.round(gapStart),
          arrivalMinutes:   Math.round(gapEnd),
          blockId:          `pending:${blockAnchorId}`,
        }
        onPendingAdd(entry)
      }

      const generalWarnings = new Set(warnings)
      let noDepotWarned  = false
      let generatedTrips = 0

      for (let blockIndex = 0; blockIndex < blocks.length; blockIndex++) {
        const block        = blocks[blockIndex]
        const allLegs       = block.rounds.flatMap(r => r.legs)
        const blockDepotId  = includeAccessReturn && depotPool.length > 0 ? depotPool[blockIndex % depotPool.length] : null
        let anchorTempId: string | null = null

        for (let i = 0; i < allLegs.length; i++) {
          const leg    = allLegs[i]
          const route  = routeFor(leg.direction)
          const tempId = crypto.randomUUID()

          const entry: PendingAddTrip = {
            _kind:               'trip',
            _tempId:             tempId,
            routeId:             route.routeId,
            direction:           leg.direction,
            lineId,
            lineCode:            line?.code ?? '',
            lineName:            line?.name ?? '',
            lineMetrics:         (line?.metrics as LineMetrics | null) ?? null,
            originLocality:      localityRef(route.originLocalityId),
            destinationLocality: localityRef(route.destinationLocalityId),
            departureMinutes:    Math.round(leg.departureMinutes),
            arrivalMinutes:      Math.round(leg.arrivalMinutes),
            blockId:             anchorTempId ? `pending:${anchorTempId}` : 'new',
          }

          if (i === 0 && blockDepotId) {
            const t = await getTravelTime(blockDepotId, route.originLocalityId)
            if (t != null) entry.access = { localityId: blockDepotId, travelMinutes: t }
            else if (!noDepotWarned) {
              noDepotWarned = true
              generalWarnings.add('Tempo de viagem até a garagem não mapeado na matriz — acesso/recolhida não inseridos em alguns blocos')
            }
          }
          if (i === allLegs.length - 1 && blockDepotId) {
            const t = await getTravelTime(route.destinationLocalityId, blockDepotId)
            if (t != null) entry.return = { localityId: blockDepotId, travelMinutes: t }
          }

          onPendingAdd(entry)
          generatedTrips++
          if (i === 0) anchorTempId = tempId
        }

        // Fase 3.4 — HOLD/DEPOT for gaps within the block (between consecutive
        // rounds), resolved only now that the whole block has been assembled.
        if (anchorTempId) {
          for (let r = 0; r < block.rounds.length - 1; r++) {
            const prevRound = block.rounds[r]
            const nextRound = block.rounds[r + 1]
            const gapStart  = prevRound.readyAgainMinutes
            const gapEnd    = nextRound.legs[0].departureMinutes
            if (gapEnd <= gapStart) continue

            const lastLeg   = prevRound.legs[prevRound.legs.length - 1]
            const fromRoute = routeFor(lastLeg.direction)
            const effectivePolicy = fromRoute.layoverPolicy === 'DEFAULT'
              ? (generalSettings?.defaultLayoverPolicy ?? 'HOLD')
              : fromRoute.layoverPolicy

            if (effectivePolicy !== 'DEPOT') {
              maybeInsertBreak(gapStart, gapEnd, anchorTempId)
              continue
            }

            const fromLocalityId = fromRoute.destinationLocalityId
            const toLocalityId   = routeFor(nextRound.legs[0].direction).originLocalityId
            const resolved = await resolveNearestDepot(fromRoute.homeDepotId, fromLocalityId, toLocalityId, gapEnd - gapStart, depots)

            if (!resolved) {
              if (!noDepotWarned) {
                noDepotWarned = true
                generalWarnings.add('Sem garagem disponível para recolhida em parada intermediária — mantido aguardando no ponto')
              }
              maybeInsertBreak(gapStart, gapEnd, anchorTempId)
              continue
            }

            const toDepotLeg: PendingAddDeadrun = {
              _kind: 'deadrun', _tempId: crypto.randomUUID(),
              originLocality:      localityRef(fromLocalityId),
              destinationLocality: localityRef(resolved.depotId),
              departureMinutes:    Math.round(gapStart),
              arrivalMinutes:      Math.round(gapStart + resolved.toDepotMinutes),
              blockId:             `pending:${anchorTempId}`,
            }
            const fromDepotLeg: PendingAddDeadrun = {
              _kind: 'deadrun', _tempId: crypto.randomUUID(),
              originLocality:      localityRef(resolved.depotId),
              destinationLocality: localityRef(toLocalityId),
              departureMinutes:    Math.round(gapEnd - resolved.fromDepotMinutes),
              arrivalMinutes:      Math.round(gapEnd),
              blockId:             `pending:${anchorTempId}`,
            }
            onPendingAdd(toDepotLeg)
            onPendingAdd(fromDepotLeg)
          }
        }
      }

      toast.success(`${generatedTrips} viagens geradas em ${blocks.length} blocos — revise e clique em Salvar para persistir`)
      generalWarnings.forEach(w => toast.warning(w))
      onClose()
    } finally {
      setIsGenerating(false)
    }
  }

  const depotMismatch = includeAccessReturn && depotSum !== peakFleet
  const isLoading     = lineLoading && !line

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center">
      <div className="absolute inset-0 bg-black/40" onClick={onClose} />
      <div className="relative z-10 bg-card border border-border rounded-lg shadow-xl w-full max-w-5xl mx-4 h-[85vh] flex flex-col">

        {/* header */}
        <div className="flex items-center justify-between px-6 py-4 border-b border-border shrink-0">
          <div>
            <h2 className="text-base font-semibold">Gerar Proposta de Atendimento</h2>
            <p className="text-xs text-muted-foreground mt-0.5">
              {line
                ? <><span className="font-mono font-medium">{line.code}</span> — {line.name} · Tipo de dia: {dayTypeCode}</>
                : 'Carregando…'}
            </p>
          </div>
          <button onClick={onClose} className="p-1 rounded hover:bg-accent text-muted-foreground hover:text-foreground">
            <Icons.X className="w-4 h-4" />
          </button>
        </div>

        {lineError ? (
          <div className="flex-1 flex items-center justify-center p-10 text-sm text-destructive">
            Erro ao carregar dados da linha
          </div>
        ) : isLoading ? (
          <div className="flex-1 flex items-center justify-center p-10 text-sm text-muted-foreground">
            Carregando dados da linha…
          </div>
        ) : (
          <>
            {/* tabs */}
            <div className="flex items-center gap-1 px-6 border-b border-border shrink-0">
              {TABS.map(tab => (
                <button
                  key={tab.key}
                  type="button"
                  onClick={() => setActiveTab(tab.key)}
                  className={`px-3 py-2.5 text-sm font-medium border-b-2 -mb-px transition-colors ${
                    activeTab === tab.key
                      ? 'border-ring text-foreground'
                      : 'border-transparent text-muted-foreground hover:text-foreground'
                  }`}
                >
                  {tab.label}
                </button>
              ))}
            </div>

            {/* body */}
            <div className="flex-1 overflow-y-auto px-6 py-5 space-y-6">

              {activeTab === 'janelas' && (
                <>
                  {/* operation window */}
                  <section className="space-y-2">
                    <div className="flex items-center gap-4">
                      <label className="flex items-center gap-2 text-sm">
                        Início
                        <input
                          type="time"
                          value={minutesToLabel(opStart)}
                          onChange={e => setOpStart(labelToMinutes(e.target.value))}
                          className="rounded-sm border border-input bg-input-bg px-2 py-1 text-sm focus:outline-none focus:ring-1 focus:ring-ring"
                        />
                        <select
                          value={firstTripDirection}
                          onChange={e => setFirstTripDirection(e.target.value as Direction)}
                          title="Sentido da primeira viagem do dia"
                          className="w-24 appearance-none rounded-sm border border-input bg-input-bg px-2 py-1 text-sm focus:outline-none focus:ring-1 focus:ring-ring"
                        >
                          {(lineRoutes.length > 0 ? lineRoutes.map(r => r.direction) : DIR_ORDER).map(d => (
                            <option key={d} value={d}>{DIR_LABEL[d]}</option>
                          ))}
                        </select>
                      </label>
                      <label className="flex items-center gap-2 text-sm">
                        Fim
                        <input
                          type="time"
                          value={minutesToLabel(opEnd)}
                          onChange={e => setOpEnd(labelToMinutes(e.target.value))}
                          className="rounded-sm border border-input bg-input-bg px-2 py-1 text-sm focus:outline-none focus:ring-1 focus:ring-ring"
                        />
                        <select
                          value={lastTripDirection}
                          onChange={e => setLastTripDirection(e.target.value as Direction)}
                          title="Sentido da última viagem do dia"
                          className="w-24 appearance-none rounded-sm border border-input bg-input-bg px-2 py-1 text-sm focus:outline-none focus:ring-1 focus:ring-ring"
                        >
                          {(lineRoutes.length > 0 ? lineRoutes.map(r => r.direction) : DIR_ORDER).map(d => (
                            <option key={d} value={d}>{DIR_LABEL[d]}</option>
                          ))}
                        </select>
                      </label>
                    </div>
                  </section>

                  {/* generation windows */}
                  <section className="space-y-2">
                    <div className="flex items-center justify-between">
                      <div className="flex items-center gap-2">
                        <div className="flex items-center gap-1.5">
                          {TOLERANCE_LEVELS.map(level => (
                            <button
                              key={level}
                              type="button"
                              onClick={() => changeTolerance(level)}
                              title={`${TOLERANCE_LABELS[level]} tolerância — mescla janelas em sequência com ciclo total até ${TOLERANCE_MINUTES[level]}' de diferença`}
                              className="p-0.5 -m-0.5"
                            >
                              <span className={`block w-2.5 h-2.5 rounded-full border transition-colors ${
                                level === mergeTolerance ? 'bg-ring border-ring' : 'border-muted-foreground/40'
                              }`} />
                            </button>
                          ))}
                        </div>
                        <span className="text-xs text-muted-foreground">
                          {TOLERANCE_LABELS[mergeTolerance]} tolerância · {TOLERANCE_MINUTES[mergeTolerance]}&apos;
                        </span>
                      </div>
                      <div className="flex items-center gap-3">
                        <button
                          type="button"
                          onClick={addBlankWindow}
                          className="flex items-center gap-1 text-xs text-muted-foreground hover:text-foreground"
                        >
                          <Icons.Plus className="w-3 h-3" /> Adicionar janela
                        </button>
                        <button
                          type="button"
                          title="Arredonda a frequência de todas as janelas"
                          onClick={doCloseFrequencyAll}
                          className="flex items-center gap-1 text-xs text-muted-foreground hover:text-foreground"
                        >
                          <Icons.Sparkles className="w-3 h-3" /> Arredondar todas
                        </button>
                        <button
                          type="button"
                          onClick={resetWindows}
                          className="flex items-center gap-1 text-xs text-muted-foreground hover:text-foreground"
                        >
                          <Icons.RefreshCw className="w-3 h-3" /> Restaurar do ciclo
                        </button>
                      </div>
                    </div>
                    {windows.length === 0 ? (
                      <div className="border border-dashed border-border rounded-md p-6 text-center text-sm text-muted-foreground">
                        Nenhuma janela de ciclo cadastrada para esta linha — cadastre em Linha → Métricas, ou
                        adicione uma janela manualmente.
                      </div>
                    ) : (
                      <div className="border border-border rounded-md overflow-hidden">
                        <table className="w-full text-sm">
                          <thead className="bg-muted/40 text-muted-foreground text-xs">
                            <tr>
                              <th className="px-2 py-2 text-left font-medium">De</th>
                              <th className="px-2 py-2 text-left font-medium">Até</th>
                              <th className="px-2 py-2 text-left font-medium">Ciclo + Intervalo (Ida)</th>
                              <th className="px-2 py-2 text-left font-medium">Ciclo + Intervalo (Volta)</th>
                              <th className="px-2 py-2 text-left font-medium">Frota</th>
                              <th className="px-2 py-2 text-left font-medium">Frequência</th>
                              <th className="px-2 py-2 text-right font-medium">Ações</th>
                            </tr>
                          </thead>
                          <tbody className="divide-y divide-border">
                            {windows.map((w, i) => {
                              const cycleTotal = totalCycleMinutes(w)
                              const freqMin    = w.fleetCount > 0 ? cycleTotal / w.fleetCount : 0
                              return (
                                <tr key={w.id} className="hover:bg-muted/20">
                                  <td className="px-2 py-2">
                                    {i === 0 && !boundaryFlags[i].fromMismatch ? (
                                      <div
                                        title="Início do dia — fixo"
                                        className="w-24 rounded-sm border border-input bg-muted/30 px-1.5 py-1 text-muted-foreground"
                                      >
                                        00:00
                                      </div>
                                    ) : (
                                      <input
                                        type="time"
                                        value={hourToLabel(w.from)}
                                        onChange={e => updateBoundary(i, 'from', labelToHour(e.target.value))}
                                        title={boundaryFlags[i].fromMismatch ? 'Possível lacuna ou sobreposição com a faixa anterior' : undefined}
                                        className={`w-24 rounded-sm border px-1.5 py-1 focus:outline-none focus:ring-1 focus:ring-ring ${
                                          boundaryFlags[i].fromMismatch ? 'border-amber-500/60 bg-amber-500/10' : 'border-input bg-input-bg'
                                        }`}
                                      />
                                    )}
                                  </td>
                                  <td className="px-2 py-2">
                                    {i === windows.length - 1 && !boundaryFlags[i].toMismatch ? (
                                      <div
                                        title="Fim do dia — fixo"
                                        className="w-24 rounded-sm border border-input bg-muted/30 px-1.5 py-1 text-muted-foreground"
                                      >
                                        24:00
                                      </div>
                                    ) : (
                                      <input
                                        type="time"
                                        value={hourToLabel(w.to)}
                                        onChange={e => updateBoundary(i, 'to', labelToHour(e.target.value))}
                                        title={boundaryFlags[i].toMismatch ? 'Possível lacuna ou sobreposição com a próxima faixa' : undefined}
                                        className={`w-24 rounded-sm border px-1.5 py-1 focus:outline-none focus:ring-1 focus:ring-ring ${
                                          boundaryFlags[i].toMismatch ? 'border-amber-500/60 bg-amber-500/10' : 'border-input bg-input-bg'
                                        }`}
                                      />
                                    )}
                                  </td>
                                  <td className="px-2 py-2">
                                    <div
                                      className={`inline-flex items-center rounded-sm border focus-within:ring-1 focus-within:ring-ring ${
                                        w.outboundKnown ? 'border-input bg-input-bg' : 'border-amber-500/60 bg-amber-500/10'
                                      }`}
                                      title={w.outboundKnown ? undefined : 'Sem janela de ciclo registrada para a ida nesta faixa — defina manualmente'}
                                    >
                                      <input
                                        type="number" min={1} title="Ciclo (min)"
                                        value={w.outboundMinutes}
                                        onChange={e => updateWindow(i, { outboundMinutes: Number(e.target.value) || 0, outboundKnown: true })}
                                        className="w-14 bg-transparent px-1.5 py-1 text-right focus:outline-none"
                                      />
                                      <span className="text-muted-foreground px-0.5 select-none">+</span>
                                      <input
                                        type="number" min={1} title="Intervalo de parada (min)"
                                        value={w.outboundInterval}
                                        onChange={e => updateWindow(i, { outboundInterval: Number(e.target.value) || 0, outboundKnown: true })}
                                        className="w-12 bg-transparent px-1.5 py-1 text-right focus:outline-none border-l border-input"
                                      />
                                    </div>
                                  </td>
                                  <td className="px-2 py-2">
                                    <div
                                      className={`inline-flex items-center rounded-sm border focus-within:ring-1 focus-within:ring-ring ${
                                        w.inboundKnown ? 'border-input bg-input-bg' : 'border-amber-500/60 bg-amber-500/10'
                                      }`}
                                      title={w.inboundKnown ? undefined : 'Sem janela de ciclo registrada para a volta nesta faixa — defina manualmente'}
                                    >
                                      <input
                                        type="number" min={1} title="Ciclo (min)"
                                        value={w.inboundMinutes}
                                        onChange={e => updateWindow(i, { inboundMinutes: Number(e.target.value) || 0, inboundKnown: true })}
                                        className="w-14 bg-transparent px-1.5 py-1 text-right focus:outline-none"
                                      />
                                      <span className="text-muted-foreground px-0.5 select-none">+</span>
                                      <input
                                        type="number" min={1} title="Intervalo de parada (min)"
                                        value={w.inboundInterval}
                                        onChange={e => updateWindow(i, { inboundInterval: Number(e.target.value) || 0, inboundKnown: true })}
                                        className="w-12 bg-transparent px-1.5 py-1 text-right focus:outline-none border-l border-input"
                                      />
                                    </div>
                                  </td>
                                  <td className="px-2 py-2">
                                    <input
                                      type="number" min={1}
                                      value={w.fleetCount}
                                      onChange={e => updateWindow(i, { fleetCount: Math.max(1, Number(e.target.value) || 1) })}
                                      className="w-14 rounded-sm border border-input bg-input-bg px-1.5 py-1 focus:outline-none focus:ring-1 focus:ring-ring"
                                    />
                                  </td>
                                  <td className="px-2 py-2 whitespace-nowrap text-muted-foreground">
                                    {freqMin.toFixed(1)} min / {cycleTotal}&apos;
                                  </td>
                                  <td className="px-2 py-2">
                                    <div className="flex items-center justify-end gap-1">
                                      <button
                                        type="button" title="Arredondar frequência"
                                        onClick={() => doCloseFrequency(i)}
                                        className="p-1 rounded hover:bg-accent text-muted-foreground hover:text-foreground"
                                      >
                                        <Icons.Sparkles className="w-4 h-4" />
                                      </button>
                                      <button
                                        type="button" title="Dividir faixa"
                                        onClick={() => doSplit(i)}
                                        className="p-1 rounded hover:bg-accent text-muted-foreground hover:text-foreground"
                                      >
                                        <Icons.Scissors className="w-4 h-4" />
                                      </button>
                                      <button
                                        type="button" title="Unir com a próxima"
                                        disabled={i === windows.length - 1}
                                        onClick={() => doMerge(i)}
                                        className="p-1 rounded hover:bg-accent text-muted-foreground hover:text-foreground disabled:opacity-30 disabled:pointer-events-none"
                                      >
                                        <Icons.ArrowRightLeft className="w-4 h-4" />
                                      </button>
                                      <button
                                        type="button" title="Remover faixa"
                                        disabled={windows.length === 1}
                                        onClick={() => removeWindow(i)}
                                        className="p-1 rounded hover:bg-destructive/10 text-muted-foreground hover:text-destructive disabled:opacity-30 disabled:pointer-events-none"
                                      >
                                        <Icons.Trash2 className="w-4 h-4" />
                                      </button>
                                    </div>
                                  </td>
                                </tr>
                              )
                            })}
                          </tbody>
                        </table>
                      </div>
                    )}
                  </section>
                </>
              )}

              {activeTab === 'ajuste' && (
                <div className="grid grid-cols-[6rem_1fr_14rem] gap-x-4 gap-y-4 items-center max-w-3xl">

                  {/* row: intervalo — control column holds the switch */}
                  <Switch checked={insertInterval} onToggle={() => setInsertInterval(v => !v)} />
                  <span
                    className="text-sm cursor-pointer select-none"
                    onClick={() => setInsertInterval(v => !v)}
                  >
                    Inserir intervalo de descanso
                  </span>
                  <select
                    value={intervalTypeId}
                    onChange={e => setIntervalTypeId(e.target.value)}
                    disabled={!insertInterval || intervalTypesLoading}
                    className="w-full appearance-none text-sm rounded-sm border border-input bg-input-bg px-2 py-1.5 focus:outline-none focus:ring-1 focus:ring-ring disabled:opacity-40"
                  >
                    {intervalTypesLoading && <option>Carregando…</option>}
                    {intervalTypes.map(it => (
                      <option key={it.id} value={it.id}>{it.name} ({it.code}) — {it.isPaid ? 'pago' : 'não pago'}</option>
                    ))}
                  </select>

                  {/* row: acesso e recolhida */}
                  <Switch checked={includeAccessReturn} onToggle={() => setIncludeAccessReturn(v => !v)} />
                  <span
                    className="text-sm cursor-pointer select-none"
                    onClick={() => setIncludeAccessReturn(v => !v)}
                  >
                    Incluir acesso e recolhida
                  </span>
                  <span />

                  {/* row: maneuver margin — used only by block assignment (Fase 3),
                      no effect on this screen's aggregate preview */}
                  <div className="flex items-center gap-1.5">
                    <input
                      type="number" min={0}
                      value={maneuverMargin}
                      onChange={e => setManeuverMargin(Math.max(0, Number(e.target.value) || 0))}
                      className="w-14 rounded-sm border border-input bg-input-bg px-2 py-1 text-sm focus:outline-none focus:ring-1 focus:ring-ring"
                    />
                    <span className="text-sm text-muted-foreground">min</span>
                  </div>
                  <span
                    className="text-sm"
                    title="Ao encaixar uma viagem, o quanto 'apertar' a viagem anterior de um bloco aberto antes de abrir um novo bloco"
                  >
                    Margem de manobra
                  </span>
                  <span />

                  {/* rows: índice de renovação — one per route the line actually has (1 to 3
                      directions), driven by lineRoutes rather than a fixed OUTBOUND/INBOUND pair.
                      Control column holds the input, same alignment as the switches above. */}
                  {lineRoutes.length === 0 && (
                    <>
                      <span />
                      <span className="text-sm text-muted-foreground col-span-2">
                        Nenhum sentido cadastrado para esta linha (cadastre rotas em Linha → Rotas)
                      </span>
                    </>
                  )}
                  {lineRoutes.map(route => (
                    <Fragment key={route.direction}>
                      <div className="flex items-center gap-1.5">
                        <input
                          type="number" min={0}
                          value={renewalIndex[route.direction] ?? 0}
                          onChange={e => setRenewalIndex(r => ({ ...r, [route.direction]: Number(e.target.value) || 0 }))}
                          className="w-20 rounded-sm border border-input bg-input-bg px-2 py-1 text-sm focus:outline-none focus:ring-1 focus:ring-ring"
                        />
                        <span className="text-sm text-muted-foreground">%</span>
                      </div>
                      <span className="text-sm">
                        Índice de renovação {DIR_LABEL[route.direction]}{' '}
                        <span className="text-muted-foreground">({route.originName} x {route.destinationName})</span>
                      </span>
                      <span />
                    </Fragment>
                  ))}
                </div>
              )}

              {activeTab === 'frota' && (
                <div className="grid grid-cols-2 gap-8">

                  {/* left: capacidade e futuras configurações da frota — same
                      control-column width as the Ajuste tab, for the same reason:
                      future fields here follow the same [controle][rótulo] row shape */}
                  <section className="space-y-3">
                    <div className="grid grid-cols-[6rem_1fr] gap-x-4 gap-y-3 items-center">
                      <input
                        type="number" min={1}
                        value={vehicleCapacity}
                        onChange={e => setVehicleCapacity(Number(e.target.value) || 0)}
                        className="w-14 rounded-sm border border-input bg-input-bg px-2 py-1 text-sm focus:outline-none focus:ring-1 focus:ring-ring"
                      />
                      <span className="text-sm">Capacidade por veículo</span>
                    </div>
                  </section>

                  {/* right: frota por garagem */}
                  <section className="space-y-2">
                    <h4 className="text-xs font-medium text-muted-foreground uppercase tracking-wider">
                      Frota por Garagem
                    </h4>

                    {depots.length === 0 && !depotsLoading ? (
                      <p className="text-xs text-muted-foreground">Nenhuma garagem cadastrada</p>
                    ) : (
                      <div className="space-y-1.5">
                        {depotAllocations.map(d => (
                          <div key={d.id} className="flex items-center gap-1.5">
                            <select
                              value={d.depotId}
                              onChange={e => updateDepotRow(d.id, { depotId: e.target.value })}
                              className="flex-1 appearance-none text-sm rounded-sm border border-input bg-input-bg px-2 py-1 focus:outline-none focus:ring-1 focus:ring-ring"
                            >
                              {depots.map(dep => <option key={dep.id} value={dep.id}>{dep.name}</option>)}
                            </select>
                            <input
                              type="number" min={0}
                              value={d.count}
                              onChange={e => updateDepotRow(d.id, { count: Number(e.target.value) || 0 })}
                              className="w-16 text-sm rounded-sm border border-input bg-input-bg px-2 py-1 focus:outline-none focus:ring-1 focus:ring-ring"
                            />
                            <button
                              type="button"
                              disabled={depotAllocations.length === 1}
                              onClick={() => removeDepotRow(d.id)}
                              className="p-1 rounded hover:bg-destructive/10 text-muted-foreground hover:text-destructive disabled:opacity-30 disabled:pointer-events-none"
                            >
                              <Icons.Trash2 className="w-3.5 h-3.5" />
                            </button>
                          </div>
                        ))}
                        <button
                          type="button"
                          onClick={addDepotRow}
                          disabled={depotAllocations.length >= depots.length}
                          className="flex items-center gap-1 text-xs text-muted-foreground hover:text-foreground disabled:opacity-30 disabled:pointer-events-none"
                        >
                          <Icons.Plus className="w-3 h-3" /> Adicionar depósito
                        </button>
                      </div>
                    )}

                    <div className={`text-xs ${depotMismatch ? 'text-amber-600 dark:text-amber-400' : 'text-muted-foreground'}`}>
                      {depotSum} / {peakFleet} veículos alocados (pico da frota)
                      {includeAccessReturn && (
                        <span className="ml-1">— obrigatório (acesso/recolhida ligado na aba Ajuste)</span>
                      )}
                    </div>
                  </section>
                </div>
              )}

              {activeTab === 'oferta' && (
                <section className="space-y-2">
                  <div className="flex items-center justify-between">
                    <h3 className="text-xs font-medium text-muted-foreground uppercase tracking-wider">Oferta × Demanda</h3>
                    <div className="flex gap-1">
                      {(['OUTBOUND', 'INBOUND'] as Direction[]).map(dir => (
                        <button
                          key={dir}
                          type="button"
                          onClick={() => setActiveDir(dir)}
                          className={`px-3 py-1 rounded-full text-xs font-medium transition-colors ${
                            dir === activeDir ? 'bg-ring text-white' : 'bg-muted text-muted-foreground hover:text-foreground'
                          }`}
                        >
                          {DIR_LABEL[dir]}
                        </button>
                      ))}
                    </div>
                  </div>

                  <style>{`
                    .line-gen-chart { --series-oferta: #2a78d6; --series-demanda: #eb6834; }
                    .dark .line-gen-chart { --series-oferta: #3987e5; --series-demanda: #d95926; }
                  `}</style>
                  <div className="line-gen-chart border border-border rounded-md p-2" style={{ height: 320 }}>
                    <ResponsiveContainer width="100%" height="100%">
                      <ComposedChart data={chartData} margin={{ top: 8, right: 12, bottom: 4, left: 0 }}>
                        <CartesianGrid strokeDasharray="3 3" stroke="hsl(var(--border))" vertical={false} />
                        <XAxis
                          dataKey="hour"
                          tick={{ fontSize: 10, fill: 'hsl(var(--muted-foreground))' }}
                          axisLine={false}
                          tickLine={false}
                          interval={1}
                        />
                        <YAxis
                          tick={{ fontSize: 11, fill: 'hsl(var(--muted-foreground))' }}
                          axisLine={false}
                          tickLine={false}
                          width={44}
                          label={{ value: 'pax/h', angle: -90, position: 'insideLeft', fontSize: 10, fill: 'hsl(var(--muted-foreground))' }}
                        />
                        <Tooltip
                          contentStyle={{
                            background:   'hsl(var(--card))',
                            border:       '1px solid hsl(var(--border))',
                            borderRadius: '6px',
                            fontSize:     12,
                          }}
                        />
                        <Legend wrapperStyle={{ fontSize: 11 }} />
                        <Bar
                          dataKey="oferta" name="Oferta" fill="var(--series-oferta)"
                          radius={[4, 4, 0, 0]} maxBarSize={20}
                        />
                        <Line
                          dataKey="demanda" name="Demanda" stroke="var(--series-demanda)"
                          strokeWidth={2} dot={{ r: 4, fill: 'var(--series-demanda)' }}
                          activeDot={{ r: 5 }}
                        />
                      </ComposedChart>
                    </ResponsiveContainer>
                  </div>
                </section>
              )}
            </div>

            {/* footer */}
            <div className="flex items-center justify-between px-6 py-4 border-t border-border shrink-0">
              <div className="text-xs text-muted-foreground">
                {windows.length > 0 && (
                  <span>
                    Prévia: <strong className="text-foreground">~{preview.trips}</strong> viagens para{' '}
                    <strong className="text-foreground">{preview.peakFleet}</strong> veículos (estimativa —
                    a geração real pode variar por conta de margem de manobra e HOLD/DEPOT)
                  </span>
                )}
              </div>
              <div className="flex gap-2">
                <Button type="button" variant="cancel" size="sm" tabIndex={-1} onClick={onClose}>
                  Cancelar
                </Button>
                <Button type="button" size="sm" onClick={handleGenerate} disabled={windows.length === 0 || isGenerating}>
                  {isGenerating ? 'Gerando…' : 'Gerar'}
                </Button>
              </div>
            </div>
          </>
        )}
      </div>
    </div>
  )
}
