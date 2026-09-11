'use client'

import { useEffect, useMemo, useRef, useState } from 'react'
import { useQueries, useQuery } from '@tanstack/react-query'
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
  computeOfertaSeries, estimateGeneration, generateRounds, assignRoundsToBlocks,
  minutesToLabel, labelToMinutes, hourToLabel, labelToHour,
  TOLERANCE_MINUTES, TOLERANCE_LABELS, DEFAULT_MANEUVER_MARGIN_MINUTES,
  type GenWindow, type Direction, type ToleranceLevel, type GeneratedBlock,
} from '../line-generator-logic'
import {
  detectDeltaGroups, resolveGroupOffsets, interleaveDeltaGroup,
  DEFAULT_MIN_TRUNK_HEADWAY_MINUTES, DEFAULT_MAX_SHIFT_FRACTION,
  type DeltaGroup, type PriorityMode, type RouteLegRef,
} from '../multiline-delta-logic'

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
  parentLineId: string | null
  metrics: {
    windows?:      Record<string, Partial<Record<Direction, CycleWindow[]>>>
    demand?:       Record<string, Partial<Record<Direction, Record<string, number>>>>
    renewalIndex?: Partial<Record<Direction | 'overall', number>>
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

interface RouteLocalityRecord {
  routeId:      string
  localityId:   string | null
  sequence:     number
  deltaMinutes: number | null
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

// ── per-line editable state (Fase 4 — one of these per selected line) ──────

interface LineGenState {
  windows:             GenWindow[]
  mergeTolerance:      ToleranceLevel
  vehicleCapacity:     number
  opStart:             number
  opEnd:               number
  renewalIndex:        number
  includeAccessReturn: boolean
  insertInterval:      boolean
  intervalTypeId:      string
  firstTripDirection:  Direction
  lastTripDirection:   Direction
  maneuverMargin:      number
  depotAllocations:    DepotAllocation[]
  depotAutoSync:       boolean
}

function seedWindowsFor(
  line: LineRecord | undefined, dayTypeCode: string, tolerance: ToleranceLevel, vehicleCapacity: number,
): GenWindow[] {
  const windowsForDay = line?.metrics?.windows?.[dayTypeCode] ?? line?.metrics?.windows?.['U']
  const base       = buildUnifiedWindows(windowsForDay?.OUTBOUND ?? [], windowsForDay?.INBOUND ?? [])
  const absorbed   = absorbPartialGaps(base)
  const toleranced = mergeByTolerance(absorbed, TOLERANCE_MINUTES[tolerance])
  const demand  = line?.metrics?.demand?.[dayTypeCode] ?? {}
  const renewal = line?.metrics?.renewalIndex?.overall ?? 0
  return deriveFleetBands(toleranced, demand, vehicleCapacity, renewal)
}

function makeInitialLineState(line: LineRecord | undefined, dayTypeCode: string): LineGenState {
  const vehicleCapacity = 80
  const mergeTolerance: ToleranceLevel = 1
  return {
    windows:             seedWindowsFor(line, dayTypeCode, mergeTolerance, vehicleCapacity),
    mergeTolerance,
    vehicleCapacity,
    opStart:             240,  // 04:00
    opEnd:               1410, // 23:30
    renewalIndex:        line?.metrics?.renewalIndex?.overall ?? 0,
    includeAccessReturn: false,
    insertInterval:      false,
    intervalTypeId:      '',
    firstTripDirection:  'OUTBOUND',
    lastTripDirection:   'INBOUND',
    maneuverMargin:      DEFAULT_MANEUVER_MARGIN_MINUTES,
    depotAllocations:    [],
    depotAutoSync:       true,
  }
}

interface Props {
  planId:               string
  lineIds:              string[]
  dayTypeCode:          string
  // trips already persisted for these lines in this plan — Gerar replaces them, but
  // only on the server once the user saves (staged in pendingDeletes until then).
  existingTripIds:      string[]
  hasPendingChanges:    boolean
  onClose:              () => void
  onPendingAdd:         (entry: PendingAddEntry) => void
  onPendingDeleteTrips: (tripIds: string[]) => void
}

export function LineScheduleGeneratorModal({
  planId, lineIds, dayTypeCode, existingTripIds, hasPendingChanges, onClose, onPendingAdd, onPendingDeleteTrips,
}: Props) {
  useShortcutContext('line_gen_md')
  const { toast } = useToast()
  const isMultiline = lineIds.length > 1

  const lineQueries = useQueries({
    queries: lineIds.map(lineId => ({
      queryKey: ['transit', 'transit-line', lineId],
      queryFn:  async (): Promise<LineRecord> => {
        const res = await apiFetch(`/transit/transit-line/${lineId}`)
        if (!res.ok) throw new Error('Erro ao carregar linha')
        return res.json()
      },
    })),
  })
  const linesById = useMemo(() => {
    const m = new Map<string, LineRecord>()
    lineQueries.forEach((q, i) => { if (q.data) m.set(lineIds[i], q.data) })
    return m
  }, [lineQueries, lineIds])
  const lineLoading = lineQueries.some(q => q.isLoading)
  const lineError   = lineQueries.some(q => q.error)

  const routesQueries = useQueries({
    queries: lineIds.map(lineId => ({
      queryKey: ['transit', 'transit-route', 'by-line', lineId],
      queryFn:  async (): Promise<RouteRecord[]> => {
        const res = await apiFetch(`/transit/transit-route?f_lineId=${lineId}&pageSize=999`)
        if (!res.ok) return []
        const json = await res.json()
        return json.data ?? []
      },
    })),
  })
  const routesByLineId = useMemo(() => {
    const m = new Map<string, RouteRecord[]>()
    routesQueries.forEach((q, i) => m.set(lineIds[i], q.data ?? []))
    return m
  }, [routesQueries, lineIds])

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

  // One route per direction per line (1 to 3) — prefers the isPrimary route when a
  // direction has more than one, same convention the line's extensionKm relies on.
  const localityNameById = useMemo(() => new Map(localities.map(l => [l.id, l.name])), [localities])
  const lineRoutesByLineId = useMemo(() => {
    const m = new Map<string, LineRoute[]>()
    for (const lineId of lineIds) {
      const byDirection = new Map<Direction, RouteRecord>()
      for (const r of routesByLineId.get(lineId) ?? []) {
        const existing = byDirection.get(r.direction)
        if (!existing || (r.isPrimary && !existing.isPrimary)) byDirection.set(r.direction, r)
      }
      m.set(lineId, DIR_ORDER.filter(d => byDirection.has(d)).map(d => {
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
      }))
    }
    return m
  }, [lineIds, routesByLineId, localityNameById])

  const routeByDirectionByLineId = useMemo(() => {
    const m = new Map<string, Map<Direction, LineRoute>>()
    for (const lineId of lineIds) m.set(lineId, new Map((lineRoutesByLineId.get(lineId) ?? []).map(r => [r.direction, r])))
    return m
  }, [lineIds, lineRoutesByLineId])

  // ── 4.1/4.5 — delta detection (only fetched/computed when 2+ lines) ───────

  const allRouteIds = useMemo(
    () => (isMultiline ? [...routesByLineId.values()].flat().map(r => r.id) : []),
    [isMultiline, routesByLineId],
  )
  const routeLocalityQueries = useQueries({
    queries: allRouteIds.map(routeId => ({
      queryKey: ['transit', 'route-locality', 'by-route', routeId],
      queryFn:  async (): Promise<RouteLocalityRecord[]> => {
        // routeId has no `filter: true` in route-locality.schema.ts (it's the breadcrumb
        // contextField instead) — the bare, unprefixed query param is what BaseService's
        // contextFilters picks up; `f_routeId=` is silently ignored and returns everything.
        const res = await apiFetch(`/transit/route-locality?routeId=${routeId}&pageSize=999`)
        if (!res.ok) return []
        const json = await res.json()
        return json.data ?? []
      },
    })),
  })
  const routeLocalitiesByRouteId = useMemo(() => {
    const m = new Map<string, RouteLegRef[]>()
    routeLocalityQueries.forEach((q, i) => {
      m.set(allRouteIds[i], (q.data ?? []).map(rl => ({ localityId: rl.localityId, sequence: rl.sequence, deltaMinutes: rl.deltaMinutes })))
    })
    return m
  }, [routeLocalityQueries, allRouteIds])

  // per line, per direction — the ordered leg list used by 4.1/4.2
  const legsByLineDirection = useMemo(() => {
    const m = new Map<string, Partial<Record<Direction, RouteLegRef[]>>>()
    for (const lineId of lineIds) {
      const perDir: Partial<Record<Direction, RouteLegRef[]>> = {}
      for (const r of lineRoutesByLineId.get(lineId) ?? []) {
        const legs = routeLocalitiesByRouteId.get(r.routeId)
        if (legs) perDir[r.direction] = legs
      }
      m.set(lineId, perDir)
    }
    return m
  }, [lineIds, lineRoutesByLineId, routeLocalitiesByRouteId])

  const detectedDeltaGroups = useMemo(
    () => isMultiline ? detectDeltaGroups(legsByLineDirection) : [],
    [isMultiline, legsByLineDirection],
  )

  // ── Fase 4 multiline settings ───────────────────────────────────────────

  const [priorityMode, setPriorityMode] = useState<PriorityMode>('base')
  const [principalLineId, setPrincipalLineId] = useState<string | null>(null)
  const [minTrunkHeadwayMinutes, setMinTrunkHeadwayMinutes] = useState(DEFAULT_MIN_TRUNK_HEADWAY_MINUTES)
  const [maxShiftFraction, setMaxShiftFraction] = useState(DEFAULT_MAX_SHIFT_FRACTION)
  // user override of the auto-detected delta locality, per direction — seeded lazily,
  // only touched when the user actually picks a different candidate
  const [deltaOverride, setDeltaOverride] = useState<Partial<Record<Direction, string>>>({})

  const activeDeltaGroups = useMemo<DeltaGroup[]>(
    () => detectedDeltaGroups.map(g => ({ ...g, deltaLocalityId: deltaOverride[g.direction] ?? g.deltaLocalityId })),
    [detectedDeltaGroups, deltaOverride],
  )

  // candidate localities for the override select — real stops shared by every
  // member of that direction's group, so any pick still makes a valid delta
  const deltaCandidatesByDirection = useMemo(() => {
    const m = new Map<Direction, string[]>()
    for (const group of detectedDeltaGroups) {
      const stopSets = group.lineIds.map(lineId => new Set(
        (legsByLineDirection.get(lineId)?.[group.direction] ?? [])
          .filter(l => l.localityId != null)
          .map(l => l.localityId as string),
      ))
      const [first, ...rest] = stopSets
      const shared = first ? [...first].filter(id => rest.every(s => s.has(id))) : []
      m.set(group.direction, shared)
    }
    return m
  }, [detectedDeltaGroups, legsByLineDirection])

  // ── per-line editable state — seeded once from server data as it arrives ──

  const [lineStates, setLineStates] = useState<Record<string, LineGenState>>({})
  const seededRef = useRef<Set<string>>(new Set())
  const directionsSeededRef = useRef<Set<string>>(new Set())

  useEffect(() => {
    let changed = false
    const next = { ...lineStates }
    for (const lineId of lineIds) {
      const line = linesById.get(lineId)
      if (!line || seededRef.current.has(lineId)) continue
      seededRef.current.add(lineId)
      next[lineId] = makeInitialLineState(line, dayTypeCode)
      changed = true
    }
    // eslint-disable-next-line react-hooks/set-state-in-effect -- seeds each new line's state once, as its query arrives
    if (changed) setLineStates(next)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [linesById, lineIds, dayTypeCode])

  useEffect(() => {
    let changed = false
    const next = { ...lineStates }
    for (const lineId of lineIds) {
      const routes = lineRoutesByLineId.get(lineId) ?? []
      const st = next[lineId]
      if (routes.length === 0 || !st || directionsSeededRef.current.has(lineId)) continue
      directionsSeededRef.current.add(lineId)
      const has = (d: Direction) => routes.some(r => r.direction === d)
      next[lineId] = {
        ...st,
        firstTripDirection: has('OUTBOUND') ? 'OUTBOUND' : 'CIRCULAR',
        lastTripDirection:  has('INBOUND')  ? 'INBOUND'  : 'CIRCULAR',
      }
      changed = true
    }
    // eslint-disable-next-line react-hooks/set-state-in-effect -- seeds each line's trip directions once, as its routes arrive
    if (changed) setLineStates(next)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [lineRoutesByLineId, lineIds])

  useEffect(() => {
    // Seeds the default interval type once intervalTypes finishes loading, for
    // every line that still has none set.
    if (intervalTypes.length === 0) return
    // eslint-disable-next-line react-hooks/set-state-in-effect -- seeds the default interval type once, as it arrives
    setLineStates(prev => {
      let changed = false
      const next = { ...prev }
      for (const lineId of lineIds) {
        const st = next[lineId]
        if (st && !st.intervalTypeId) { next[lineId] = { ...st, intervalTypeId: intervalTypes[0].id }; changed = true }
      }
      return changed ? next : prev
    })
  }, [intervalTypes, lineIds])

  // Seeds each line's single default depot row with its own peak fleet, and keeps it
  // following that line's peakFleet afterward — same rule as the single-line version,
  // just applied per line. Stops the moment a line's allocation is touched manually.
  useEffect(() => {
    if (depots.length === 0) return
    // eslint-disable-next-line react-hooks/set-state-in-effect -- follows each line's peakFleet until touched manually
    setLineStates(prev => {
      let changed = false
      const next = { ...prev }
      for (const lineId of lineIds) {
        const st = next[lineId]
        if (!st || !st.depotAutoSync) continue
        const peakFleet = st.windows.reduce((m, w) => Math.max(m, w.fleetCount), 0)
        const currentRow = st.depotAllocations[0]
        // Only writes when the value actually differs — otherwise this would create a
        // new (but equal) array every run, which keeps `lineStates` (an effect dep,
        // needed so a later window edit re-triggers this) changing identity forever.
        if (st.depotAllocations.length <= 1 && (!currentRow || currentRow.count !== peakFleet)) {
          next[lineId] = {
            ...st,
            depotAllocations: [{
              id: currentRow?.id ?? crypto.randomUUID(),
              depotId: currentRow?.depotId ?? depots[0].id,
              count: peakFleet,
            }],
          }
          changed = true
        }
      }
      return changed ? next : prev
    })
  }, [depots, lineIds, lineStates])

  const [activeTab, setActiveTab] = useState<TabKey>('janelas')
  // Which line's Ajuste/Frota/Oferta×Demanda tab content is shown — those tabs edit
  // one line at a time even in multiline mode, picked via the small pill selector.
  const [activeLineId, setActiveLineId] = useState(lineIds[0])
  const [openLineId,   setOpenLineId]   = useState(lineIds[0]) // accordion — which line's Janelas section is expanded
  const [activeDir,    setActiveDir]    = useState<Direction>('OUTBOUND')
  const [isGenerating, setIsGenerating] = useState(false)
  const [attemptedGenerate, setAttemptedGenerate] = useState(false)

  useEffect(() => {
    function onKey(e: KeyboardEvent) { if (e.key === 'Escape') onClose() }
    document.addEventListener('keydown', onKey)
    return () => document.removeEventListener('keydown', onKey)
  }, [onClose])

  function updateLineState(lineId: string, patch: Partial<LineGenState> | ((st: LineGenState) => Partial<LineGenState>)) {
    setLineStates(prev => {
      const st = prev[lineId]
      if (!st) return prev
      const p = typeof patch === 'function' ? patch(st) : patch
      return { ...prev, [lineId]: { ...st, ...p } }
    })
  }

  const activeState = lineStates[activeLineId]

  const peakFleet = useMemo(() => (activeState?.windows ?? []).reduce((m, w) => Math.max(m, w.fleetCount), 0), [activeState])
  const depotSum  = useMemo(() => (activeState?.depotAllocations ?? []).reduce((s, d) => s + d.count, 0), [activeState])

  const intervalInvalid = !!activeState?.insertInterval && !activeState?.intervalTypeId
  const depotMismatch   = !!activeState?.includeAccessReturn && depotSum !== peakFleet

  const ofertaSeries = useMemo(
    () => activeState
      ? computeOfertaSeries(activeState.windows, activeState.vehicleCapacity, activeState.renewalIndex, activeState.opStart, activeState.opEnd)
      : {},
    [activeState],
  )
  const preview = useMemo(
    () => activeState ? estimateGeneration(activeState.windows, activeState.opStart, activeState.opEnd) : { trips: 0, peakFleet: 0 },
    [activeState],
  )
  const demandByDirActive = useMemo(
    () => linesById.get(activeLineId)?.metrics?.demand?.[dayTypeCode] ?? {},
    [linesById, activeLineId, dayTypeCode],
  )
  const chartData = useMemo(() => Array.from({ length: 24 }, (_, hour) => ({
    hour:    hourToLabel(hour),
    oferta:  ofertaSeries[activeDir]?.[hour] ?? 0,
    demanda: demandByDirActive[activeDir]?.[String(hour)] ?? 0,
  })), [ofertaSeries, activeDir, demandByDirActive])

  // ── window-editing helpers, parametrized by which line's accordion is open ─

  function updateWindow(lineId: string, index: number, patch: Partial<GenWindow>) {
    updateLineState(lineId, st => ({ windows: st.windows.map((r, i) => i === index ? { ...r, ...patch } : r) }))
  }
  function updateBoundary(lineId: string, index: number, field: 'from' | 'to', value: number) {
    updateLineState(lineId, st => ({ windows: updateWindowBoundary(st.windows, index, field, value) }))
  }
  function removeWindow(lineId: string, index: number) {
    updateLineState(lineId, st => {
      if (st.windows.length <= 1) return {}
      const result = st.windows.filter((_, i) => i !== index)
      if (index === 0) result[0] = { ...result[0], from: 0 }
      else if (index === st.windows.length - 1) result[result.length - 1] = { ...result[result.length - 1], to: 24 }
      return { windows: result }
    })
  }
  function doMerge(lineId: string, index: number) {
    updateLineState(lineId, st => ({ windows: mergeWithNext(st.windows, index) }))
  }
  function doSplit(lineId: string, index: number) {
    updateLineState(lineId, st => ({ windows: splitWindow(st.windows, index) }))
  }
  function doCloseFrequency(lineId: string, index: number) {
    updateLineState(lineId, st => ({ windows: closeFrequency(st.windows, index) }))
  }
  function doCloseFrequencyAll(lineId: string) {
    updateLineState(lineId, st => {
      let acc = st.windows
      for (let i = 0; i < acc.length; i++) acc = closeFrequency(acc, i)
      return { windows: acc }
    })
  }
  function changeTolerance(lineId: string, level: ToleranceLevel) {
    updateLineState(lineId, st => ({ mergeTolerance: level, windows: seedWindowsFor(linesById.get(lineId), dayTypeCode, level, st.vehicleCapacity) }))
  }
  function resetWindows(lineId: string) {
    updateLineState(lineId, st => ({ windows: seedWindowsFor(linesById.get(lineId), dayTypeCode, st.mergeTolerance, st.vehicleCapacity) }))
  }
  function addBlankWindow(lineId: string) {
    updateLineState(lineId, st => {
      if (st.windows.length === 0) {
        return {
          windows: [{
            id: crypto.randomUUID(), from: 0, to: 24,
            outboundMinutes: 60, outboundKnown: true, outboundInterval: 1,
            inboundMinutes:  60, inboundKnown:  true, inboundInterval:  1,
            fleetCount: 1,
          }],
        }
      }
      return { windows: splitWindow(st.windows, st.windows.length - 1) }
    })
  }
  function addDepotRow(lineId: string) {
    updateLineState(lineId, st => {
      const used = new Set(st.depotAllocations.map(d => d.depotId))
      const next = depots.find(d => !used.has(d.id)) ?? depots[0]
      if (!next) return {}
      return { depotAutoSync: false, depotAllocations: [...st.depotAllocations, { id: crypto.randomUUID(), depotId: next.id, count: 0 }] }
    })
  }
  function removeDepotRow(lineId: string, id: string) {
    updateLineState(lineId, st => st.depotAllocations.length > 1
      ? { depotAutoSync: false, depotAllocations: st.depotAllocations.filter(d => d.id !== id) }
      : {})
  }
  function updateDepotRow(lineId: string, id: string, patch: Partial<DepotAllocation>) {
    updateLineState(lineId, st => ({ depotAutoSync: false, depotAllocations: st.depotAllocations.map(d => d.id === id ? { ...d, ...patch } : d) }))
  }

  async function handleGenerate() {
    if (isGenerating) return
    if (hasPendingChanges) {
      toast.error('Salve ou descarte as alterações pendentes do Gantt antes de gerar novamente')
      return
    }

    setAttemptedGenerate(true)

    for (const lineId of lineIds) {
      const st = lineStates[lineId]
      const line = linesById.get(lineId)
      if (!st || st.windows.length === 0) {
        toast.error(`${line?.code ?? lineId}: nenhuma janela de geração configurada`)
        return
      }
      if (st.insertInterval && !st.intervalTypeId) {
        setActiveTab('ajuste'); setActiveLineId(lineId)
        return
      }
      const lineDepotSum = st.depotAllocations.reduce((s, d) => s + d.count, 0)
      const linePeakFleet = st.windows.reduce((m, w) => Math.max(m, w.fleetCount), 0)
      if (st.includeAccessReturn && lineDepotSum !== linePeakFleet) {
        setActiveTab('frota'); setActiveLineId(lineId)
        return
      }
    }

    if (isMultiline && priorityMode === 'delta' && !principalLineId) {
      toast.error('Selecione uma linha Principal (direcionamento por Delta exige uma)')
      return
    }

    const routeInfo = new Map<string, { anchorRoute: LineRoute; pairedRoute: LineRoute | null }>()
    for (const lineId of lineIds) {
      const st = lineStates[lineId]!
      const routeByDir = routeByDirectionByLineId.get(lineId)!
      const pairedDirection: Direction | null =
        st.firstTripDirection === 'CIRCULAR' ? null : st.firstTripDirection === 'OUTBOUND' ? 'INBOUND' : 'OUTBOUND'
      const anchorRoute = routeByDir.get(st.firstTripDirection)
      const pairedRoute = pairedDirection ? routeByDir.get(pairedDirection) : null
      if (!anchorRoute || (pairedDirection && !pairedRoute)) {
        toast.error(`${linesById.get(lineId)?.code ?? lineId}: sentido selecionado não possui rota cadastrada`)
        return
      }
      routeInfo.set(lineId, { anchorRoute, pairedRoute: pairedRoute ?? null })
    }

    // Fase 3, unchanged: each line generates its own rounds independently first.
    const perLineRounds = new Map<string, ReturnType<typeof generateRounds>['rounds']>()
    const perLineWarnings = new Map<string, string[]>()
    for (const lineId of lineIds) {
      const st = lineStates[lineId]!
      const { rounds, warnings } = generateRounds(st.windows, st.opStart, st.opEnd, st.firstTripDirection, st.lastTripDirection)
      if (rounds.length === 0) {
        toast.error(`${linesById.get(lineId)?.code ?? lineId}: nenhuma viagem gerada — revise as janelas e o horário de operação`)
        return
      }
      perLineRounds.set(lineId, rounds)
      perLineWarnings.set(lineId, warnings)
    }

    // Fase 4.3 — entrelaçamento no delta, uma passada por sentido em que o grupo se aplica.
    if (isMultiline) {
      for (const group of activeDeltaGroups) {
        const participants = group.lineIds.filter(id => lineIds.includes(id))
        if (participants.length < 2) continue

        const offsets = await resolveGroupOffsets(
          { ...group, lineIds: participants },
          legsByLineDirection,
          (lineId, direction) => routeByDirectionByLineId.get(lineId)?.get(direction)?.originLocalityId ?? null,
          getTravelTime,
        )
        if (offsets.size < 2) continue

        const subset = new Map([...perLineRounds].filter(([id]) => offsets.has(id)))
        const interleaved = interleaveDeltaGroup({
          perLineRounds:         subset,
          crossingOffsetMinutes: offsets,
          direction:              group.direction,
          minTrunkHeadwayMinutes,
          maxShiftFraction,
          mode:                   priorityMode,
          principalLineId:        priorityMode === 'delta' ? (principalLineId ?? undefined) : undefined,
        })
        for (const [lineId, rounds] of interleaved) perLineRounds.set(lineId, rounds)
      }
    }

    const perLineBlocks = new Map<string, GeneratedBlock[]>()
    for (const lineId of lineIds) {
      const st = lineStates[lineId]!
      const blocks = assignRoundsToBlocks(perLineRounds.get(lineId)!, st.maneuverMargin)
      if (blocks.length === 0) {
        toast.error(`${linesById.get(lineId)?.code ?? lineId}: nenhuma viagem gerada — revise as janelas e o horário de operação`)
        return
      }
      perLineBlocks.set(lineId, blocks)
    }

    setIsGenerating(true)
    try {
      if (existingTripIds.length > 0) onPendingDeleteTrips(existingTripIds)

      let generatedTrips = 0
      const generalWarnings = new Set<string>()
      let noDepotWarned = false

      for (const lineId of lineIds) {
        const line   = linesById.get(lineId)
        const st     = lineStates[lineId]!
        const blocks = perLineBlocks.get(lineId)!
        const { anchorRoute, pairedRoute } = routeInfo.get(lineId)!
        const routeFor    = (dir: Direction) => (dir === st.firstTripDirection ? anchorRoute : pairedRoute!)
        const localityRef = (id: string) => ({ id, name: localityNameById.get(id) ?? '?' })
        const selectedIntervalType = intervalTypes.find(it => it.id === st.intervalTypeId) ?? null

        for (const w of (perLineWarnings.get(lineId) ?? []).filter(w => !w.startsWith('Última viagem ('))) {
          generalWarnings.add(`${line?.code ?? lineId}: ${w}`)
        }

        // depotPool is never empty here when includeAccessReturn is on — the
        // pre-generate validation above already blocks that case.
        const depotPool = st.depotAllocations.flatMap(d => Array(Math.max(0, d.count)).fill(d.depotId)) as string[]

        function maybeInsertBreak(gapStart: number, gapEnd: number, blockAnchorId: string) {
          if (!st.insertInterval || !selectedIntervalType) return
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

        // Validation log — best-effort, one per line.
        apiFetch(`/transit/vehicle-plan/${planId}/lines/${lineId}/log-generation`, {
          method: 'POST',
          body:   JSON.stringify({
            dayTypeCode,
            output: {
              lineId, lineCode: line?.code, lineName: line?.name, dayTypeCode,
              params: {
                opStart: st.opStart, opEnd: st.opEnd, firstTripDirection: st.firstTripDirection,
                lastTripDirection: st.lastTripDirection, maneuverMargin: st.maneuverMargin, mergeTolerance: st.mergeTolerance,
                multiline: isMultiline ? { priorityMode, principalLineId, minTrunkHeadwayMinutes, maxShiftFraction } : null,
              },
              windows: st.windows,
              blocks: blocks.map(b => ({ id: b.id, rounds: b.rounds.map(r => ({ legs: r.legs, readyAgainMinutes: r.readyAgainMinutes })) })),
              summary: {
                blockCount: blocks.length,
                totalTrips: blocks.reduce((s, b) => s + b.rounds.reduce((s2, r) => s2 + r.legs.length, 0), 0),
                peakFleet:  st.windows.reduce((m, w) => Math.max(m, w.fleetCount), 0),
              },
              warnings: perLineWarnings.get(lineId) ?? [],
            },
          }),
        }).catch(() => {})

        for (let blockIndex = 0; blockIndex < blocks.length; blockIndex++) {
          const block        = blocks[blockIndex]
          const allLegs       = block.rounds.flatMap(r => r.legs)
          const blockDepotId  = st.includeAccessReturn && depotPool.length > 0 ? depotPool[blockIndex % depotPool.length] : null
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

          // Fase 3.4 — HOLD/DEPOT for gaps within the block.
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
      }

      const blockCount = [...perLineBlocks.values()].reduce((s, b) => s + b.length, 0)
      toast.success(`${generatedTrips} viagens geradas em ${blockCount} blocos — revise e clique em Salvar para persistir`)
      generalWarnings.forEach(w => toast.warning(w))
      onClose()
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Erro ao gerar quadro de horários')
    } finally {
      setIsGenerating(false)
    }
  }

  const isLoading = lineLoading && linesById.size === 0
  const allLoaded = lineIds.every(id => linesById.has(id))

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center">
      <div className="absolute inset-0 bg-black/40" onClick={onClose} />
      <div className="relative z-10 bg-card border border-border rounded-lg shadow-xl w-full max-w-5xl mx-4 h-[85vh] flex flex-col">

        {/* header */}
        <div className="flex items-center justify-between px-6 py-4 border-b border-border shrink-0">
          <div>
            <h2 className="text-base font-semibold">Gerar Proposta de Atendimento</h2>
            <p className="text-xs text-muted-foreground mt-0.5">
              {allLoaded
                ? (isMultiline
                    ? <>{lineIds.length} linhas · Tipo de dia: {dayTypeCode}</>
                    : <><span className="font-mono font-medium">{linesById.get(lineIds[0])?.code}</span> — {linesById.get(lineIds[0])?.name} · Tipo de dia: {dayTypeCode}</>)
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

            {/* per-line pill selector — Ajuste/Frota/Oferta edit one line at a time */}
            {isMultiline && activeTab !== 'janelas' && (
              <div className="flex items-center gap-1.5 px-6 pt-3 shrink-0">
                {lineIds.map(lineId => (
                  <button
                    key={lineId}
                    type="button"
                    onClick={() => setActiveLineId(lineId)}
                    className={`px-2.5 py-1 rounded-full text-xs font-medium transition-colors ${
                      lineId === activeLineId ? 'bg-ring text-white' : 'bg-muted text-muted-foreground hover:text-foreground'
                    }`}
                  >
                    {linesById.get(lineId)?.code ?? '…'}
                  </button>
                ))}
              </div>
            )}

            {/* body */}
            <div className="flex-1 overflow-y-auto px-6 py-5 space-y-6">

              {activeTab === 'janelas' && (
                <>
                  {isMultiline && (
                    <section className="space-y-3 border border-border rounded-md p-3 bg-muted/20">
                      <h3 className="text-xs font-medium text-muted-foreground uppercase tracking-wider">Multilinha</h3>

                      <div className="flex flex-wrap items-center gap-4">
                        <label className="flex items-center gap-2 text-sm">
                          Direcionamento
                          <select
                            value={priorityMode}
                            onChange={e => setPriorityMode(e.target.value as PriorityMode)}
                            className="appearance-none rounded-sm border border-input bg-input-bg px-2 py-1 text-sm focus:outline-none focus:ring-1 focus:ring-ring"
                          >
                            <option value="base">Base (padrão)</option>
                            <option value="delta">Delta</option>
                          </select>
                        </label>
                        <label className="flex items-center gap-1.5 text-sm">
                          <input
                            type="number" min={0}
                            value={minTrunkHeadwayMinutes}
                            onChange={e => setMinTrunkHeadwayMinutes(Math.max(0, Number(e.target.value) || 0))}
                            className="w-14 rounded-sm border border-input bg-input-bg px-2 py-1 focus:outline-none focus:ring-1 focus:ring-ring"
                          />
                          <span title="Intervalo mínimo desejado entre partidas de linhas diferentes no ponto de delta">
                            min. no tronco
                          </span>
                        </label>
                        <label className="flex items-center gap-1.5 text-sm">
                          <input
                            type="number" min={1} max={100}
                            value={Math.round(maxShiftFraction * 100)}
                            onChange={e => setMaxShiftFraction(Math.max(0, Math.min(100, Number(e.target.value) || 0)) / 100)}
                            className="w-14 rounded-sm border border-input bg-input-bg px-2 py-1 focus:outline-none focus:ring-1 focus:ring-ring"
                          />
                          <span title="Teto de deslocamento por viagem, como % do headway próprio da linha (padrão: metade)">
                            % teto de deslocamento
                          </span>
                        </label>
                      </div>

                      {detectedDeltaGroups.length === 0 ? (
                        <p className="text-xs text-muted-foreground">
                          Nenhum ponto de delta detectado entre as linhas selecionadas — elas serão geradas
                          independentemente, sem intercalação.
                        </p>
                      ) : (
                        <div className="space-y-1.5">
                          {detectedDeltaGroups.map(group => {
                            const candidates = deltaCandidatesByDirection.get(group.direction) ?? []
                            const current = deltaOverride[group.direction] ?? group.deltaLocalityId
                            return (
                              <div key={group.direction} className="flex items-center gap-2 text-sm">
                                <span className="w-16 text-muted-foreground">{DIR_LABEL[group.direction]}</span>
                                <span className="text-xs text-muted-foreground">delta:</span>
                                <select
                                  value={current}
                                  onChange={e => setDeltaOverride(prev => ({ ...prev, [group.direction]: e.target.value }))}
                                  className="appearance-none rounded-sm border border-input bg-input-bg px-2 py-1 text-xs focus:outline-none focus:ring-1 focus:ring-ring"
                                >
                                  {(candidates.includes(current) ? candidates : [current, ...candidates]).map(id => (
                                    <option key={id} value={id}>{localityNameById.get(id) ?? id}</option>
                                  ))}
                                </select>
                                <span className="text-xs text-muted-foreground">
                                  ({group.lineIds.map(id => linesById.get(id)?.code ?? id).join(', ')})
                                </span>
                              </div>
                            )
                          })}
                        </div>
                      )}

                      {priorityMode === 'delta' && (
                        <p className="text-xs text-muted-foreground">
                          Marque a linha Principal no header de cada linha abaixo — as demais se ajustam a ela.
                        </p>
                      )}
                    </section>
                  )}

                  {lineIds.map(lineId => {
                    const line = linesById.get(lineId)
                    const st   = lineStates[lineId]
                    const isOpen = !isMultiline || openLineId === lineId
                    if (!st) return null

                    const janelasBody = (
                      <>
                        {/* operation window */}
                        <section className="space-y-2">
                          <div className="flex items-center gap-4">
                            <label className="flex items-center gap-2 text-sm">
                              Início
                              <input
                                type="time"
                                value={minutesToLabel(st.opStart)}
                                onChange={e => updateLineState(lineId, { opStart: labelToMinutes(e.target.value) })}
                                className="rounded-sm border border-input bg-input-bg px-2 py-1 text-sm focus:outline-none focus:ring-1 focus:ring-ring"
                              />
                              <select
                                value={st.firstTripDirection}
                                onChange={e => updateLineState(lineId, { firstTripDirection: e.target.value as Direction })}
                                title="Sentido da primeira viagem do dia"
                                className="w-24 appearance-none rounded-sm border border-input bg-input-bg px-2 py-1 text-sm focus:outline-none focus:ring-1 focus:ring-ring"
                              >
                                {((lineRoutesByLineId.get(lineId) ?? []).length > 0 ? (lineRoutesByLineId.get(lineId) ?? []).map(r => r.direction) : DIR_ORDER).map(d => (
                                  <option key={d} value={d}>{DIR_LABEL[d]}</option>
                                ))}
                              </select>
                            </label>
                            <label className="flex items-center gap-2 text-sm">
                              Fim
                              <input
                                type="time"
                                value={minutesToLabel(st.opEnd)}
                                onChange={e => updateLineState(lineId, { opEnd: labelToMinutes(e.target.value) })}
                                className="rounded-sm border border-input bg-input-bg px-2 py-1 text-sm focus:outline-none focus:ring-1 focus:ring-ring"
                              />
                              <select
                                value={st.lastTripDirection}
                                onChange={e => updateLineState(lineId, { lastTripDirection: e.target.value as Direction })}
                                title="Sentido da última viagem do dia"
                                className="w-24 appearance-none rounded-sm border border-input bg-input-bg px-2 py-1 text-sm focus:outline-none focus:ring-1 focus:ring-ring"
                              >
                                {((lineRoutesByLineId.get(lineId) ?? []).length > 0 ? (lineRoutesByLineId.get(lineId) ?? []).map(r => r.direction) : DIR_ORDER).map(d => (
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
                                    onClick={() => changeTolerance(lineId, level)}
                                    title={`${TOLERANCE_LABELS[level]} tolerância — mescla janelas em sequência com ciclo total até ${TOLERANCE_MINUTES[level]}' de diferença`}
                                    className="p-0.5 -m-0.5"
                                  >
                                    <span className={`block w-2.5 h-2.5 rounded-full border transition-colors ${
                                      level === st.mergeTolerance ? 'bg-ring border-ring' : 'border-muted-foreground/40'
                                    }`} />
                                  </button>
                                ))}
                              </div>
                              <span className="text-xs text-muted-foreground">
                                {TOLERANCE_LABELS[st.mergeTolerance]} tolerância · {TOLERANCE_MINUTES[st.mergeTolerance]}&apos;
                              </span>
                            </div>
                            <div className="flex items-center gap-3">
                              <button
                                type="button"
                                onClick={() => addBlankWindow(lineId)}
                                className="flex items-center gap-1 text-xs text-muted-foreground hover:text-foreground"
                              >
                                <Icons.Plus className="w-3 h-3" /> Adicionar janela
                              </button>
                              <button
                                type="button"
                                title="Arredonda a frequência de todas as janelas"
                                onClick={() => doCloseFrequencyAll(lineId)}
                                className="flex items-center gap-1 text-xs text-muted-foreground hover:text-foreground"
                              >
                                <Icons.Sparkles className="w-3 h-3" /> Arredondar todas
                              </button>
                              <button
                                type="button"
                                onClick={() => resetWindows(lineId)}
                                className="flex items-center gap-1 text-xs text-muted-foreground hover:text-foreground"
                              >
                                <Icons.RefreshCw className="w-3 h-3" /> Restaurar do ciclo
                              </button>
                            </div>
                          </div>
                          {st.windows.length === 0 ? (
                            <div className="border border-dashed border-border rounded-md p-6 text-center text-sm text-muted-foreground">
                              Nenhuma janela de ciclo cadastrada para esta linha — cadastre em Linha → Métricas, ou
                              adicione uma janela manualmente.
                            </div>
                          ) : (
                            <div className="border border-border rounded-md overflow-hidden">
                              <table className="w-full text-sm">
                                <thead className="bg-muted/40 text-muted-foreground text-xs">
                                  <tr>
                                    <th className="px-2 py-2 text-left font-medium">#</th>
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
                                  {st.windows.map((w, i) => {
                                    const flags = isOpen ? computeBoundaryFlags(st.windows)[i] : { fromMismatch: false, toMismatch: false }
                                    const cycleTotal = totalCycleMinutes(w)
                                    const freqMin    = w.fleetCount > 0 ? cycleTotal / w.fleetCount : 0
                                    return (
                                      <tr key={w.id} className="hover:bg-muted/20">
                                        <td className="px-2 py-2 text-muted-foreground">{i + 1}</td>
                                        <td className="px-2 py-2">
                                          {i === 0 && !flags.fromMismatch ? (
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
                                              onChange={e => updateBoundary(lineId, i, 'from', labelToHour(e.target.value))}
                                              title={flags.fromMismatch ? 'Possível lacuna ou sobreposição com a faixa anterior' : undefined}
                                              className={`w-24 rounded-sm border px-1.5 py-1 focus:outline-none focus:ring-1 focus:ring-ring ${
                                                flags.fromMismatch ? 'border-amber-500/60 bg-amber-500/10' : 'border-input bg-input-bg'
                                              }`}
                                            />
                                          )}
                                        </td>
                                        <td className="px-2 py-2">
                                          {i === st.windows.length - 1 && !flags.toMismatch ? (
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
                                              onChange={e => updateBoundary(lineId, i, 'to', labelToHour(e.target.value))}
                                              title={flags.toMismatch ? 'Possível lacuna ou sobreposição com a próxima faixa' : undefined}
                                              className={`w-24 rounded-sm border px-1.5 py-1 focus:outline-none focus:ring-1 focus:ring-ring ${
                                                flags.toMismatch ? 'border-amber-500/60 bg-amber-500/10' : 'border-input bg-input-bg'
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
                                              onChange={e => updateWindow(lineId, i, { outboundMinutes: Number(e.target.value) || 0, outboundKnown: true })}
                                              className="w-14 bg-transparent px-1.5 py-1 text-right focus:outline-none"
                                            />
                                            <span className="text-muted-foreground px-0.5 select-none">+</span>
                                            <input
                                              type="number" min={1} title="Intervalo de parada (min)"
                                              value={w.outboundInterval}
                                              onChange={e => updateWindow(lineId, i, { outboundInterval: Number(e.target.value) || 0, outboundKnown: true })}
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
                                              onChange={e => updateWindow(lineId, i, { inboundMinutes: Number(e.target.value) || 0, inboundKnown: true })}
                                              className="w-14 bg-transparent px-1.5 py-1 text-right focus:outline-none"
                                            />
                                            <span className="text-muted-foreground px-0.5 select-none">+</span>
                                            <input
                                              type="number" min={1} title="Intervalo de parada (min)"
                                              value={w.inboundInterval}
                                              onChange={e => updateWindow(lineId, i, { inboundInterval: Number(e.target.value) || 0, inboundKnown: true })}
                                              className="w-12 bg-transparent px-1.5 py-1 text-right focus:outline-none border-l border-input"
                                            />
                                          </div>
                                        </td>
                                        <td className="px-2 py-2">
                                          <input
                                            type="number" min={1}
                                            value={w.fleetCount}
                                            onChange={e => updateWindow(lineId, i, { fleetCount: Math.max(1, Number(e.target.value) || 1) })}
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
                                              onClick={() => doCloseFrequency(lineId, i)}
                                              className="p-1 rounded hover:bg-accent text-muted-foreground hover:text-foreground"
                                            >
                                              <Icons.Sparkles className="w-4 h-4" />
                                            </button>
                                            <button
                                              type="button" title="Dividir faixa"
                                              onClick={() => doSplit(lineId, i)}
                                              className="p-1 rounded hover:bg-accent text-muted-foreground hover:text-foreground"
                                            >
                                              <Icons.Scissors className="w-4 h-4" />
                                            </button>
                                            <button
                                              type="button" title="Unir com a próxima"
                                              disabled={i === st.windows.length - 1}
                                              onClick={() => doMerge(lineId, i)}
                                              className="p-1 rounded hover:bg-accent text-muted-foreground hover:text-foreground disabled:opacity-30 disabled:pointer-events-none"
                                            >
                                              <Icons.ArrowRightLeft className="w-4 h-4" />
                                            </button>
                                            <button
                                              type="button" title="Remover faixa"
                                              disabled={st.windows.length === 1}
                                              onClick={() => removeWindow(lineId, i)}
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
                    )

                    if (!isMultiline) return <div key={lineId} className="space-y-3">{janelasBody}</div>

                    return (
                      <section key={lineId} className="border border-border rounded-md overflow-hidden">
                        {/* div, not button — the Principal Switch inside is itself a <button>,
                            and a <button> can't nest another interactive control */}
                        <div
                          role="button"
                          tabIndex={0}
                          onClick={() => setOpenLineId(prev => prev === lineId ? '' : lineId)}
                          onKeyDown={e => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); setOpenLineId(prev => prev === lineId ? '' : lineId) } }}
                          className="w-full flex items-center justify-between gap-3 px-3 py-2.5 bg-muted/30 hover:bg-muted/50 transition-colors cursor-pointer"
                        >
                          <span className="flex items-center gap-2 text-sm font-medium">
                            <Icons.ChevronDown className={`w-4 h-4 text-muted-foreground transition-transform ${isOpen ? '' : '-rotate-90'}`} />
                            <span className="font-mono">{line?.code}</span> — {line?.name}
                          </span>
                          <span
                            className="flex items-center gap-2"
                            onClick={e => e.stopPropagation()}
                          >
                            {priorityMode === 'delta' && (
                              <label className="flex items-center gap-1.5 text-xs text-muted-foreground">
                                Principal
                                <Switch
                                  checked={principalLineId === lineId}
                                  onToggle={() => setPrincipalLineId(prev => prev === lineId ? null : lineId)}
                                />
                              </label>
                            )}
                          </span>
                        </div>
                        {isOpen && <div className="p-3 space-y-4">{janelasBody}</div>}
                      </section>
                    )
                  })}
                </>
              )}

              {activeTab === 'ajuste' && activeState && (
                <div className="grid grid-cols-[6rem_1fr_14rem] gap-x-4 gap-y-4 items-center max-w-3xl">

                  {/* row: intervalo — control column holds the switch */}
                  <Switch checked={activeState.insertInterval} onToggle={() => updateLineState(activeLineId, st => ({ insertInterval: !st.insertInterval }))} />
                  <span
                    className="text-sm cursor-pointer select-none"
                    onClick={() => updateLineState(activeLineId, st => ({ insertInterval: !st.insertInterval }))}
                  >
                    Inserir intervalo de descanso
                  </span>
                  <select
                    value={activeState.intervalTypeId}
                    onChange={e => updateLineState(activeLineId, { intervalTypeId: e.target.value })}
                    disabled={!activeState.insertInterval || intervalTypesLoading}
                    className="w-full appearance-none text-sm rounded-sm border border-input bg-input-bg px-2 py-1.5 focus:outline-none focus:ring-1 focus:ring-ring disabled:opacity-40"
                  >
                    {intervalTypesLoading && <option>Carregando…</option>}
                    {intervalTypes.map(it => (
                      <option key={it.id} value={it.id}>{it.name} ({it.code}) — {it.isPaid ? 'pago' : 'não pago'}</option>
                    ))}
                  </select>

                  {attemptedGenerate && intervalInvalid && (
                    <>
                      <span />
                      <span />
                      <span className="text-xs text-destructive -mt-2">Selecione um tipo de intervalo antes de gerar</span>
                    </>
                  )}

                  {/* row: acesso e recolhida */}
                  <Switch checked={activeState.includeAccessReturn} onToggle={() => updateLineState(activeLineId, st => ({ includeAccessReturn: !st.includeAccessReturn }))} />
                  <span
                    className="text-sm cursor-pointer select-none"
                    onClick={() => updateLineState(activeLineId, st => ({ includeAccessReturn: !st.includeAccessReturn }))}
                  >
                    Incluir acesso e recolhida
                  </span>
                  <span />

                  {/* row: maneuver margin — used only by block assignment (Fase 3),
                      no effect on this screen's aggregate preview */}
                  <div className="flex items-center gap-1.5">
                    <input
                      type="number" min={0}
                      value={activeState.maneuverMargin}
                      onChange={e => updateLineState(activeLineId, { maneuverMargin: Math.max(0, Number(e.target.value) || 0) })}
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

                  {/* row: índice de renovação — a single line-level figure (mid-route
                      turnover from bilhetagem x GPS conciliation), applied equally to
                      both directions. Control column holds the input, same alignment
                      as the switches above. */}
                  <div className="flex items-center gap-1.5">
                    <input
                      type="number" min={0}
                      value={activeState.renewalIndex}
                      onChange={e => updateLineState(activeLineId, { renewalIndex: Number(e.target.value) || 0 })}
                      className="w-20 rounded-sm border border-input bg-input-bg px-2 py-1 text-sm focus:outline-none focus:ring-1 focus:ring-ring"
                    />
                    <span className="text-sm text-muted-foreground">%</span>
                  </div>
                  <span className="text-sm">Índice de renovação</span>
                  <span />
                </div>
              )}

              {activeTab === 'frota' && activeState && (
                <div className="grid grid-cols-2 gap-8">

                  {/* left: capacidade e futuras configurações da frota — same
                      control-column width as the Ajuste tab, for the same reason:
                      future fields here follow the same [controle][rótulo] row shape */}
                  <section className="space-y-3">
                    <div className="grid grid-cols-[6rem_1fr] gap-x-4 gap-y-3 items-center">
                      <input
                        type="number" min={1}
                        value={activeState.vehicleCapacity}
                        onChange={e => updateLineState(activeLineId, { vehicleCapacity: Number(e.target.value) || 0 })}
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
                        {activeState.depotAllocations.map(d => (
                          <div key={d.id} className="flex items-center gap-1.5">
                            <select
                              value={d.depotId}
                              onChange={e => updateDepotRow(activeLineId, d.id, { depotId: e.target.value })}
                              className="flex-1 appearance-none text-sm rounded-sm border border-input bg-input-bg px-2 py-1 focus:outline-none focus:ring-1 focus:ring-ring"
                            >
                              {depots.map(dep => <option key={dep.id} value={dep.id}>{dep.name}</option>)}
                            </select>
                            <input
                              type="number" min={0}
                              value={d.count}
                              onChange={e => updateDepotRow(activeLineId, d.id, { count: Number(e.target.value) || 0 })}
                              className="w-16 text-sm rounded-sm border border-input bg-input-bg px-2 py-1 focus:outline-none focus:ring-1 focus:ring-ring"
                            />
                            <button
                              type="button"
                              disabled={activeState.depotAllocations.length === 1}
                              onClick={() => removeDepotRow(activeLineId, d.id)}
                              className="p-1 rounded hover:bg-destructive/10 text-muted-foreground hover:text-destructive disabled:opacity-30 disabled:pointer-events-none"
                            >
                              <Icons.Trash2 className="w-3.5 h-3.5" />
                            </button>
                          </div>
                        ))}
                        <button
                          type="button"
                          onClick={() => addDepotRow(activeLineId)}
                          disabled={activeState.depotAllocations.length >= depots.length}
                          className="flex items-center gap-1 text-xs text-muted-foreground hover:text-foreground disabled:opacity-30 disabled:pointer-events-none"
                        >
                          <Icons.Plus className="w-3 h-3" /> Adicionar depósito
                        </button>
                      </div>
                    )}

                    <div className={`text-xs ${
                      attemptedGenerate && depotMismatch ? 'text-destructive' : depotMismatch ? 'text-amber-600 dark:text-amber-400' : 'text-muted-foreground'
                    }`}
                    >
                      {depotSum} / {peakFleet} veículos alocados (pico da frota)
                      {activeState.includeAccessReturn && (
                        <span className="ml-1">— obrigatório (acesso/recolhida ligado na aba Ajuste)</span>
                      )}
                    </div>
                    {attemptedGenerate && depotMismatch && (
                      <p className="text-xs text-destructive">
                        Distribua toda a frota do pico entre as garagens antes de gerar
                      </p>
                    )}
                  </section>
                </div>
              )}

              {activeTab === 'oferta' && activeState && (
                <section className="space-y-2">
                  <div className="flex items-center justify-between">
                    <h3 className="text-xs font-medium text-muted-foreground uppercase tracking-wider">
                      Oferta × Demanda{' '}
                      <span className="normal-case font-normal">
                        (renovação: {activeState.renewalIndex}%)
                      </span>
                    </h3>
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
                {activeState && activeState.windows.length > 0 && (
                  <span>
                    Prévia ({linesById.get(activeLineId)?.code}): <strong className="text-foreground">~{preview.trips}</strong> viagens para{' '}
                    <strong className="text-foreground">{preview.peakFleet}</strong> veículos (estimativa —
                    a geração real pode variar)
                  </span>
                )}
              </div>
              <div className="flex gap-2">
                <Button type="button" variant="cancel" size="sm" tabIndex={-1} onClick={onClose}>
                  Cancelar
                </Button>
                <Button type="button" size="sm" onClick={handleGenerate} disabled={isGenerating || lineIds.some(id => (lineStates[id]?.windows.length ?? 0) === 0)}>
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
