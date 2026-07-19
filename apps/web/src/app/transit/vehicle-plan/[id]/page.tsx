'use client'

import { useState, useEffect, useRef, useCallback, useMemo } from 'react'
import { useParams, useRouter } from 'next/navigation'
import { useQueryClient, useQuery } from '@tanstack/react-query'
import { Icons }             from '@/lib/icons'
import { AutoBreadcrumb }    from '@/core/AutoBreadcrumb'
import { usePageGuard }      from '@/core/usePageGuard'
import { useRecordQuery }    from '@/core/useRecordQuery'
import { useTopbarActions }  from '@/components/layout/topbar-actions-context'
import { useShortcut }       from '@/lib/keywatch'
import { apiFetch, getToken } from '@/lib/auth'
import { useConfirm }         from '@/lib/confirm-context'
import { useToast }          from '@/lib/toast-context'
import { extractError }      from '@/lib/utils'
import { GanttBoard }        from './components/GanttBoard'
import type { GanttBoardHandle } from './components/GanttBoard'
import { GanttActionBar }    from './components/GanttActionBar'
import { LinesPanel }        from './components/LinesPanel'
import { SwitchLineScheduleModal } from './components/SwitchLineScheduleModal'
import { FrequencyPanel }    from './components/FrequencyPanel'
import { TripSummaryPanel }  from './components/TripSummaryPanel'
import { GenerateModal }         from './components/GenerateModal'
import { AccessModal }           from './components/AccessModal'
import { SolverProposalDialog }  from './components/SolverProposalDialog'
import { AddTripModal }          from './components/AddTripModal'
import type { PendingAddEntry, PendingAddTrip, PendingAddDeadrun } from './components/AddTripModal'
import type { SolverScenario, SolverBaseline } from './components/SolverProposalDialog'
import { Button }            from '@/components/ui/button'
import type { VehiclePlanGanttData, TripConstraints, GanttBlock, GanttBlockTrip, GanttBlockDeadrun } from './views/vehicles.view'
import { resolveCycleWindow, computeHeadway }            from './views/vehicles.view'
import { createVehiclesActionSpec }                     from './views/vehicles.actions'
import type { ViewportSnapshot, Selection, RowHintEntry } from './engine/gantt.types'
import type { SolverParams }         from './components/GenerateModal'
import { getTravelTime }             from './travel-time'

const INITIAL_VP: ViewportSnapshot = { scrollX: 0, scrollY: 0, pixelsPerMinute: 1.2, width: 0, dayStartMinute: 0 }

function buildFakeAccessReturn(a: PendingAddTrip): GanttBlockDeadrun[] {
  const result: GanttBlockDeadrun[] = []
  if (a.access) {
    result.push({
      id:                    `${a._tempId}:access`,
      type:                  'ACCESS',
      originLocalityId:      a.access.localityId,
      destinationLocalityId: a.originLocality.id,
      originLocality:        { id: a.access.localityId, name: '' },
      destinationLocality:   a.originLocality,
      departureMinutes:      a.departureMinutes - a.access.travelMinutes - 1,
      arrivalMinutes:        a.departureMinutes - 1,
    })
  }
  if (a.return) {
    result.push({
      id:                    `${a._tempId}:return`,
      type:                  'RETURN',
      originLocalityId:      a.destinationLocality.id,
      destinationLocalityId: a.return.localityId,
      originLocality:        a.destinationLocality,
      destinationLocality:   { id: a.return.localityId, name: '' },
      departureMinutes:      a.arrivalMinutes + 1,
      arrivalMinutes:        a.arrivalMinutes + a.return.travelMinutes + 1,
    })
  }
  return result
}

// ── solver progress via SSE ───────────────────────────────────────────────────

interface SolverMessage {
  type:           string
  stage?:         number
  stageLabel?:    string
  attempt?:       number
  bestScore?:     number
  bestFleet?:     number
  elapsed?:       number
  stopReason?:    string
  totalAttempts?: number
  proposalIndex?: number
  scenario?:      SolverScenario
}

interface SolverDisplayState {
  proposalCount:     number
  fleetCount:        number | null
  score:             number | null
  totalIterations:   number
  currentLevel:      number
  currentLevelLabel: string
  bestScenario:      SolverScenario | null
}

const SOLVER_DISPLAY_RESET: SolverDisplayState = {
  proposalCount: 0, fleetCount: null, score: null, totalIterations: 0,
  currentLevel: 1, currentLevelLabel: 'FLEET', bestScenario: null,
}

function useSolverStream(planId: string, jobId: string | null, onDone: () => void) {
  const eventSourceRef = useRef<EventSource | null>(null)
  const hadProgressRef = useRef(false)
  const [state, setState] = useState<SolverDisplayState>(SOLVER_DISPLAY_RESET)

  useEffect(() => {
    if (!jobId) {
      eventSourceRef.current?.close()
      eventSourceRef.current = null
      hadProgressRef.current = false
      setState(SOLVER_DISPLAY_RESET)
      return
    }

    hadProgressRef.current = false
    const token = getToken()
    const url   = `/api/transit/vehicle-plan/${planId}/stream?jobId=${jobId}&token=${encodeURIComponent(token)}`
    const es    = new EventSource(url)

    es.onmessage = (ev) => {
      try {
        const msg = JSON.parse(ev.data) as SolverMessage

        if (msg.type === 'progress') {
          hadProgressRef.current = true
          setState(s => ({
            ...s,
            totalIterations: msg.attempt ?? s.totalIterations,
            fleetCount:      msg.bestFleet ?? s.fleetCount,
            score:           msg.bestScore ?? s.score,
          }))
        }

        if (msg.type === 'proposal') {
          const isStochastic = hadProgressRef.current
          setState(s => ({
            ...s,
            proposalCount:   msg.proposalIndex ?? s.proposalCount,
            fleetCount:      msg.scenario?.fleetCount ?? s.fleetCount,
            score:           msg.scenario?.score      ?? s.score,
            bestScenario:    msg.scenario ? { ...msg.scenario } : s.bestScenario,
            // deterministic: no progress msgs — count proposals as iterations
            totalIterations: isStochastic ? s.totalIterations : (msg.proposalIndex ?? s.proposalCount + 1),
          }))
        }

        if (msg.type === 'improvement') {
          setState(s => ({
            ...s,
            proposalCount: msg.proposalIndex ?? s.proposalCount,
            fleetCount:    msg.scenario?.fleetCount ?? s.fleetCount,
            score:         msg.scenario?.score      ?? s.score,
            bestScenario:  msg.scenario ? { ...msg.scenario } : s.bestScenario,
          }))
        }

        if (msg.type === 'done') {
          es.close()
          onDone()
        }
      } catch { /* ignore */ }
    }

    es.onerror = () => {
      es.close()
      onDone()
    }

    eventSourceRef.current = es
    return () => es.close()
  }, [planId, jobId]) // eslint-disable-line react-hooks/exhaustive-deps

  return state
}

// ── creation form (shown when id === 'new') ───────────────────────────────────

interface DayType { id: string; name: string; code: string }

function NewPlanForm() {
  const router    = useRouter()
  const { toast } = useToast()

  const [dayTypeId, setDayTypeId] = useState('')
  const [isPending, setIsPending] = useState(false)

  const { data: dayTypes = [] } = useQuery<DayType[]>({
    queryKey: ['transit', 'day-type', 'list'],
    queryFn:  async () => {
      const res = await apiFetch('/transit/day-type')
      if (!res.ok) throw new Error('Erro ao carregar tipos de dia')
      const json = await res.json()
      return json.data ?? json
    },
    staleTime: 60_000,
  })

  useEffect(() => {
    if (!dayTypeId && dayTypes.length > 0) setDayTypeId(dayTypes[0].id)
  }, [dayTypes, dayTypeId])

  async function handleCreate(e: React.FormEvent) {
    e.preventDefault()
    if (!dayTypeId) return
    setIsPending(true)
    try {
      const res = await apiFetch('/transit/vehicle-plan', {
        method: 'POST',
        body:   JSON.stringify({ dayTypeId }),
      })
      if (!res.ok) {
        const json = await res.json().catch(() => ({}))
        throw new Error(extractError(json))
      }
      const created = await res.json()
      router.push(`/transit/vehicle-plan/${created.id}`)
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Erro ao criar planejamento')
      setIsPending(false)
    }
  }

  return (
    <div className="flex flex justify-center p-8">
      <form
        onSubmit={handleCreate}
        className="w-full max-w-sm space-y-4 border border-border rounded-md p-6 bg-card"
      >
        <div>
          <h2 className="text-base font-semibold mb-2">Novo Planejamento</h2>
          <p className="text-sm text-muted-foreground mt-1">
            Selecione o tipo de dia para iniciar.
          </p>
        </div>

        <div>
          <label htmlFor="dayTypeId" className="text-sm font-medium">
            Tipo de Dia <span className="ps-1">*</span>
          </label>
          <div className="relative mt-2">
            <select
              id="dayTypeId"
              value={dayTypeId}
              onChange={e => setDayTypeId(e.target.value)}
              required
              autoFocus
              className="w-full appearance-none border border-input rounded-sm text-sm bg-input-bg px-3 py-2 pe-8 focus:outline-none focus:ring-1 focus:ring-ring disabled:opacity-60"
            >
              {dayTypes.map(dt => (
                <option key={dt.id} value={dt.id}>{dt.name}</option>
              ))}
            </select>
            <Icons.ChevronDown className="pointer-events-none absolute right-2 top-1/2 -translate-y-1/2 w-4 h-4 text-muted-foreground" />
          </div>
        </div>
        <div className="flex justify-end space-x-4">
          <Button type="submit" disabled={isPending || !dayTypeId} className="w-full" size="default">
          {isPending ? 'Criando…' : 'Criar Planejamento'}
          </Button>
          <Button type="button" className="w-full" size="default" variant='cancel' onClick={ () => router.push('/transit/vehicle-plan') }>
            Voltar
          </Button>
        </div>
      </form>
    </div>
  )
}

// ── inline description editor ─────────────────────────────────────────────────

function InlineDescription({
  value,
  disabled,
  onSave,
}: {
  value?:   string
  disabled?: boolean
  onSave:   (val: string) => Promise<void>
}) {
  const { toast }            = useToast()
  const [editing, setEditing] = useState(false)
  const [draft,   setDraft]   = useState('')
  const inputRef              = useRef<HTMLInputElement>(null)

  function startEdit() {
    if (disabled) return
    setDraft(value ?? '')
    setEditing(true)
    setTimeout(() => inputRef.current?.select(), 0)
  }

  async function commit() {
    setEditing(false)
    const trimmed = draft.trim()
    if (trimmed === (value ?? '').trim()) return
    try {
      await onSave(trimmed)
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Erro ao salvar descrição')
    }
  }

  if (editing) {
    return (
      <input
        ref={inputRef}
        autoFocus
        value={draft}
        onChange={e => setDraft(e.target.value)}
        onBlur={commit}
        onKeyDown={e => {
          if (e.key === 'Enter') { e.preventDefault(); inputRef.current?.blur() }
          if (e.key === 'Escape') { setEditing(false) }
        }}
        className="text-sm border-b border-border bg-transparent focus:outline-none focus:border-ring min-w-32 max-w-64"
      />
    )
  }

  return (
    <span>
      <Icons.Option className="inline w-4 h-4 me-1 text-cyan-700" />
      <span
      onDoubleClick={startEdit}
      title={disabled ? undefined : 'Duplo clique para editar'}
      className={disabled ? undefined : 'cursor-text'}
      >
      {value
        ? <span className="text-foreground  uppercase">{value}</span>
        : <span className="italic text-muted-foreground/60">Descrição</span>
      }
      </span>
    </span>    
  )
}

// ── page ──────────────────────────────────────────────────────────────────────

export default function VehiclePlanPage() {
  const { id }      = useParams<{ id: string }>()
  const router      = useRouter()
  const queryClient = useQueryClient()
  const { toast }   = useToast()
  const confirm     = useConfirm()

  const isNew = id === 'new'

  type DepotModal  = { kind: 'access' | 'return'; blockTripId: string; blockId: string }
  type TripPatch   = { departureMinutes?: number; arrivalMinutes?: number }
  type DeadrunPatch = { departureMinutes?: number; arrivalMinutes?: number }
  type PendingMove = { blockTripIds: string[]; fromBlockId: string; toBlockId: string }

  const [selection,             setSelection]             = useState<Selection | null>(null)
  const [depotModal,            setDepotModal]            = useState<DepotModal | null>(null)
  const [moveTargetBlockId,     setMoveTargetBlockId]     = useState<string | null>(null)
  const [pendingMoves,          setPendingMoves]          = useState<PendingMove[]>([])
  const [pendingChanges,        setPendingChanges]        = useState<Map<string, TripPatch>>(new Map())
  const [pendingDeadrunChanges, setPendingDeadrunChanges] = useState<Map<string, DeadrunPatch>>(new Map())
  const [pendingAdds,           setPendingAdds]           = useState<PendingAddEntry[]>([])
  const [pendingDeletes,        setPendingDeletes]        = useState<Set<string>>(new Set())
  const [pendingDeadrunDeletes, setPendingDeadrunDeletes] = useState<Set<string>>(new Set())
  const [isPending,             setIsPending]             = useState(false)
  const [activeJobId,       setActiveJobId]       = useState<string | null>(null)
  const [isSolverDone,      setIsSolverDone]      = useState(false)
  const [linesPanelOpen,    setLinesPanelOpen]    = useState(false)
  const [freqPanelOpen,     setFreqPanelOpen]     = useState(false)
  const [ganttVp,           setGanttVp]           = useState<ViewportSnapshot>(INITIAL_VP)
  const [generateModalOpen, setGenerateModalOpen] = useState(false)
  const [versionsModalOpen, setVersionsModalOpen] = useState(false)
  const [detailsOpen,       setDetailsOpen]       = useState(false)
  const [baselineSnapshot,  setBaselineSnapshot]  = useState<SolverBaseline | null>(null)
  const [editBarOpen,       setEditBarOpen]       = useState(false)
  const [addTripOpen,       setAddTripOpen]       = useState(false)
  const [focusedSegId,      setFocusedSegId]      = useState<string | null>(null)

  const ganttBoardRef       = useRef<GanttBoardHandle>(null)
  const shiftAnchorRef      = useRef<string | null>(null)
  const groupAnchorSegIdRef = useRef<string | null>(null)

  // Lines selection for display — checked lines are plotted immediately
  const [selectedLineIds, setSelectedLineIds] = useState<Set<string>>(new Set())

  // ── data ────────────────────────────────────────────────────────────────────

  const { data: record, error: recordError } = useRecordQuery(
    ['transit', 'vehicle-plan', id],
    `/transit/vehicle-plan/${id}`,
    { enabled: !isNew, staleTime: 30_000 },
  )

  const { guardNode, canUpdate } = usePageGuard(
    'transit', 'vehicle-plan', isNew, recordError ?? undefined,
  )

  const { data: ganttData, refetch: refetchGantt } = useQuery<VehiclePlanGanttData>({
    queryKey: ['transit', 'vehicle-plan', id, 'gantt'],
    queryFn:  async () => {
      const res = await apiFetch(`/transit/vehicle-plan/${id}/gantt-data`)
      if (!res.ok) throw new Error('Falha ao carregar dados do Gantt')
      return res.json() as Promise<VehiclePlanGanttData>
    },
    enabled:   !isNew,
    staleTime: 10_000,
  })

  // Filtered data: only blocks that have at least one productive trip from a selected line
  const plottedData = useMemo<VehiclePlanGanttData | null>(() => {
    if (!ganttData) return null
    if (selectedLineIds.size === 0) return { ...ganttData, blocks: [] }
    return {
      ...ganttData,
      blocks: ganttData.blocks.filter(b =>
        b.blockTrips.some(bt => selectedLineIds.has(bt.trip.route.line.id))
      ),
    }
  }, [ganttData, selectedLineIds])

  // Merges pending local overrides and additions into the plotted data before rendering
  const mergedPlottedData = useMemo<VehiclePlanGanttData | null>(() => {
    if (!plottedData) return null
    if (pendingChanges.size === 0 && pendingDeadrunChanges.size === 0 && pendingAdds.length === 0 && pendingDeletes.size === 0 && pendingDeadrunDeletes.size === 0 && pendingMoves.length === 0) return plottedData

    const maxBlockNumber = plottedData.blocks.reduce((max, b) => Math.max(max, b.blockNumber), 0)
    let extraBlockCount  = 0

    let blocks = plottedData.blocks.map(b => {
      const addTrips    = pendingAdds.filter((a): a is PendingAddTrip    => a._kind === 'trip'    && a.blockId === b.id)
      const addDeadruns = pendingAdds.filter((a): a is PendingAddDeadrun => a._kind === 'deadrun' && a.blockId === b.id)
      return {
        ...b,
        blockTrips: [
          ...b.blockTrips.filter(bt => !pendingDeletes.has(bt.trip.id)).map(bt => {
            const patch = pendingChanges.get(bt.trip.id)
            if (!patch) return bt
            return { ...bt, trip: { ...bt.trip, ...patch } }
          }),
          ...addTrips.map(a => ({
            id:       a._tempId,
            sequence: 99,
            trip: {
              id:               `${a._tempId}:trip`,
              departureMinutes: a.departureMinutes,
              arrivalMinutes:   a.arrivalMinutes,
              constraints:      null,
              route: {
                direction:           a.direction,
                line:                { id: a.lineId, code: a.lineCode, name: a.lineName, metrics: a.lineMetrics },
                originLocality:      a.originLocality,
                destinationLocality: a.destinationLocality,
              },
            },
          })),
        ],
        blockDeadruns: [
          ...b.blockDeadruns.filter(dr => !pendingDeadrunDeletes.has(dr.id)).map(dr => {
            const patch = pendingDeadrunChanges.get(dr.id)
            if (!patch) return dr
            return { ...dr, ...patch }
          }),
          ...addDeadruns.map(a => ({
            id:                    a._tempId,
            type:                  'DISPLACEMENT' as const,
            originLocalityId:      a.originLocality.id,
            destinationLocalityId: a.destinationLocality.id,
            originLocality:        a.originLocality,
            destinationLocality:   a.destinationLocality,
            departureMinutes:      a.departureMinutes,
            arrivalMinutes:        a.arrivalMinutes,
          })),
          ...addTrips.flatMap(buildFakeAccessReturn),
        ],
      }
    })

    // Fake blocks for pending adds targeting a new block
    const firstBlock  = plottedData.blocks[0]
    const fakeBlocks: GanttBlock[] = pendingAdds
      .filter(a => a.blockId === 'new')
      .map(a => {
        extraBlockCount++
        return {
          id:          `pending:${a._tempId}`,
          blockNumber: maxBlockNumber + extraBlockCount,
          vehicleType: firstBlock?.vehicleType ?? '',
          branchId:    firstBlock?.branchId    ?? null,
          branch:      firstBlock?.branch      ?? null,
          depotId:     firstBlock?.depotId     ?? '',
          depot:       firstBlock?.depot       ?? { id: '', name: '' },
          constraints: null,
          summary:     null,
          blockTrips: a._kind === 'trip' ? [{
            id:       a._tempId,
            sequence: 0,
            trip: {
              id:               `${a._tempId}:trip`,
              departureMinutes: a.departureMinutes,
              arrivalMinutes:   a.arrivalMinutes,
              constraints:      null,
              route: {
                direction:           a.direction,
                line:                { id: a.lineId, code: a.lineCode, name: a.lineName, metrics: a.lineMetrics },
                originLocality:      a.originLocality,
                destinationLocality: a.destinationLocality,
              },
            },
          }] : [],
          blockDeadruns: a._kind === 'deadrun' ? [{
            id:                    a._tempId,
            type:                  'DISPLACEMENT' as const,
            originLocalityId:      a.originLocality.id,
            destinationLocalityId: a.destinationLocality.id,
            originLocality:        a.originLocality,
            destinationLocality:   a.destinationLocality,
            departureMinutes:      a.departureMinutes,
            arrivalMinutes:        a.arrivalMinutes,
          }] : buildFakeAccessReturn(a as PendingAddTrip),
        }
      })

    // Apply pending block moves
    if (pendingMoves.length > 0) {
      const blockMap     = new Map(blocks.map(b => [b.id, b]))
      const awayByBlock  = new Map<string, Set<string>>()
      for (const move of pendingMoves) {
        if (!awayByBlock.has(move.fromBlockId)) awayByBlock.set(move.fromBlockId, new Set())
        for (const id of move.blockTripIds) awayByBlock.get(move.fromBlockId)!.add(id)
      }
      blocks = blocks.map(block => {
        const awayIds = awayByBlock.get(block.id) ?? new Set<string>()
        const movedIn = pendingMoves
          .filter(m => m.toBlockId === block.id)
          .flatMap(m => {
            const fromBlock = blockMap.get(m.fromBlockId)
            if (!fromBlock) return []
            return m.blockTripIds
              .map(id => fromBlock.blockTrips.find(bt => bt.id === id))
              .filter((bt): bt is NonNullable<typeof bt> => bt != null)
          })
        return {
          ...block,
          blockTrips: [...block.blockTrips.filter(bt => !awayIds.has(bt.id)), ...movedIn],
        }
      })
    }

    return { ...plottedData, blocks: [...blocks, ...fakeBlocks] }
  }, [plottedData, pendingChanges, pendingDeadrunChanges, pendingAdds, pendingDeletes, pendingDeadrunDeletes, pendingMoves])

  // Sorted productive trips across all blocks — used by PageDown/PageUp same-direction nav
  const allTrips = useMemo(() => {
    if (!mergedPlottedData) return [] as Array<{ segId: string; dep: number; direction: string }>
    return mergedPlottedData.blocks.flatMap(block =>
      block.blockTrips.map(bt => ({
        segId:     bt.id,
        dep:       bt.trip.departureMinutes,
        direction: bt.trip.route.direction,
      }))
    ).sort((a, b) => a.dep - b.dep)
  }, [mergedPlottedData])

  // Flat per-block item lists for keyboard navigation (trips + deadruns by dep)
  const navBlocks = useMemo(() => {
    if (!mergedPlottedData) return [] as Array<Array<{ segId: string; dep: number }>>
    return mergedPlottedData.blocks.map(block => [
      ...block.blockTrips.map(bt   => ({ segId: bt.id,           dep: bt.trip.departureMinutes })),
      ...block.blockDeadruns.map(dr => ({ segId: `${dr.id}:dr`,  dep: dr.departureMinutes })),
    ].sort((a, b) => a.dep - b.dep))
  }, [mergedPlottedData])

  // Full block order + source block index, used to navigate move targets
  // relative to the source block's own position (skipping the source itself).
  const moveTargetBlocks = useMemo(() => {
    if (!mergedPlottedData || !selection) return null
    const sourceId     = selection.type === 'trip' ? selection.segment.rowId : selection.rowId
    const allBlockIds  = mergedPlottedData.blocks.map(b => b.id)
    const sourceIndex  = allBlockIds.indexOf(sourceId)
    if (sourceIndex === -1) return null
    return { allBlockIds, sourceIndex }
  }, [mergedPlottedData, selection])

  // Step the move-target cursor by ±1, skipping over the source block and
  // clamping (not wrapping) at the array boundaries.
  function stepMoveTarget(prev: string | null, dir: 1 | -1): string | null {
    if (!moveTargetBlocks) return prev
    const { allBlockIds, sourceIndex } = moveTargetBlocks
    const curIdx = prev ? allBlockIds.indexOf(prev) : sourceIndex
    let next = curIdx + dir
    if (next === sourceIndex) next += dir
    if (next < 0 || next >= allBlockIds.length) return prev
    return allBlockIds[next]
  }

  // Reset move target whenever selection changes
  useEffect(() => { setMoveTargetBlockId(null) }, [selection])

  // Shortcut hints shown alongside the move-target row highlight
  const moveTargetHints = useMemo<RowHintEntry[]>(() => (
    moveTargetBlockId ? [{ keys: ['Q', 'M'], label: 'Mover' }] : []
  ), [moveTargetBlockId])

  // ── solver ──────────────────────────────────────────────────────────────────

  const onSolverDone = useCallback(() => {
    setIsSolverDone(true)
    setIsPending(false)
  }, [])

  const solverProgress = useSolverStream(id, activeJobId, onSolverDone)

  async function handleGenerate(params: SolverParams) {
    setGenerateModalOpen(false)
    if (!canUpdate) return

    const savedSummary = (record as any)?.summary as Record<string, number> | null | undefined
    if (savedSummary?.fleetCount != null) {
      setBaselineSnapshot({
        fleetCount:   savedSummary.fleetCount,
        score:        savedSummary.score        ?? 0,
        deadrunKm:    savedSummary.deadrunKm    ?? 0,
        productiveKm: savedSummary.productiveKm ?? 0,
        totalKm:      savedSummary.totalKm      ?? 0,
      })
    } else if (ganttData) {
      setBaselineSnapshot({
        fleetCount:   ganttData.blocks.length,
        score:        0,
        deadrunKm:    ganttData.blocks.reduce((sum, b) => sum + (b.summary?.deadrunKm ?? 0), 0),
        productiveKm: 0,
        totalKm:      0,
      })
    }

    if (activeJobId) {
      try {
        await apiFetch(`/transit/vehicle-plan/${id}/stop`, {
          method: 'POST',
          body:   JSON.stringify({ jobId: activeJobId }),
        })
      } catch { /* ignore */ }
      setActiveJobId(null)
    }
    setIsSolverDone(false)
    setIsPending(true)
    const jobId = crypto.randomUUID()
    try {
      const res = await apiFetch(`/transit/vehicle-plan/${id}/generate`, {
        method: 'POST',
        body:   JSON.stringify({ jobId, params }),
      })
      if (!res.ok) {
        const json = await res.json().catch(() => ({}))
        throw new Error(extractError(json))
      }
      setActiveJobId(jobId)
      setIsPending(false)
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Erro ao iniciar geração')
      setIsPending(false)
    }
  }

  async function handleClearMetrics() {
    try {
      const res = await apiFetch(`/transit/vehicle-plan/${id}`, {
        method: 'PATCH',
        body:   JSON.stringify({ metrics: null }),
      })
      if (!res.ok) {
        const json = await res.json().catch(() => ({}))
        throw new Error(extractError(json))
      }
      await queryClient.invalidateQueries({ queryKey: ['transit', 'vehicle-plan', id] })
      toast.success('Configuração personalizada removida')
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Erro ao limpar configuração')
    }
  }

  async function handleStop() {
    if (!activeJobId) return
    try {
      await apiFetch(`/transit/vehicle-plan/${id}/stop`, {
        method: 'POST',
        body:   JSON.stringify({ jobId: activeJobId }),
      })
    } catch { /* ignore */ }
  }

  async function handleAssumeBest() {
    if (!activeJobId) return
    setIsPending(true)
    try {
      const res = await apiFetch(`/transit/vehicle-plan/${id}/assume`, {
        method: 'POST',
        body:   JSON.stringify({ jobId: activeJobId }),
      })
      if (!res.ok) {
        const json = await res.json().catch(() => ({}))
        throw new Error(extractError(json))
      }
      setActiveJobId(null)
      setIsSolverDone(false)
      setDetailsOpen(false)
      toast.success('Melhor solução assumida')
      await queryClient.invalidateQueries({ queryKey: ['transit', 'vehicle-plan', id] })
      await refetchGantt()
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Erro ao assumir solução')
    } finally {
      setIsPending(false)
    }
  }

  async function handleDiscard() {
    if (!activeJobId) return
    try {
      await apiFetch(`/transit/vehicle-plan/${id}/stop`, {
        method: 'POST',
        body:   JSON.stringify({ jobId: activeJobId }),
      })
    } catch { /* ignore */ }
    setActiveJobId(null)
    setIsSolverDone(false)
    setDetailsOpen(false)
  }

  async function handleDelete() {
    if (!canUpdate) return
    const ok = await confirm({
      title:       'Excluir planejamento',
      description: 'Esta ação não pode ser desfeita. Todos os blocos gerados serão removidos.',
      confirmLabel: 'Excluir',
      variant:     'destructive',
    })
    if (!ok) return
    setIsPending(true)
    try {
      const res = await apiFetch(`/transit/vehicle-plan/${id}`, { method: 'DELETE' })
      if (!res.ok) {
        const json = await res.json().catch(() => ({}))
        throw new Error(extractError(json))
      }
      router.push('/transit/vehicle-plan')
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Erro ao excluir')
      setIsPending(false)
    }
  }

  async function handleActivate(force: boolean = false) {
    if (typeof force !== 'boolean') force = false
    if (!canUpdate) return
    setIsPending(true)
    try {
      const res  = await apiFetch(`/transit/vehicle-plan/${id}/activate`, {
        method:  'POST',
        headers: { 'Content-Type': 'application/json' },
        body:    JSON.stringify({ force }),
      })

      if (!res.ok) {
        const json = await res.json().catch(() => ({}))
        throw new Error(extractError(json))
      }

      const json = await res.json().catch(() => null)

      if (json?.conflict) {
        const label = json.conflict.description || json.conflict.id || 'outro planejamento'
        const ok = await confirm({
          title:        'Substituir planejamento ativo',
          description:  `"${label}" está ativo e será desativado. Deseja continuar?`,
          confirmLabel: 'Continuar',
          variant:      'safeConfirm',
        })
        if (ok) await handleActivate(true)
        return
      }

      toast.success('Planejamento ativado')
      await queryClient.invalidateQueries({ queryKey: ['transit', 'vehicle-plan', id] })
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Erro ao ativar')
    } finally {
      setIsPending(false)
    }
  }

  async function handleUpdateConstraints(tripIds: string[], patches: TripConstraints | null | TripConstraints[]) {
    try {
      await Promise.all(
        tripIds.map((tripId, i) => {
          const constraints = Array.isArray(patches) ? patches[i] : patches
          return apiFetch(`/transit/transit-trip/${tripId}`, {
            method: 'PATCH',
            body:   JSON.stringify({ constraints }),
          })
        })
      )
      queryClient.setQueryData(
        ['transit', 'vehicle-plan', id, 'gantt'],
        (old: VehiclePlanGanttData | undefined) => {
          if (!old) return old
          return {
            ...old,
            blocks: old.blocks.map(b => ({
              ...b,
              blockTrips: b.blockTrips.map(bt => {
                const idx = tripIds.indexOf(bt.trip.id)
                if (idx === -1) return bt
                const constraints = Array.isArray(patches) ? patches[idx] : patches
                return { ...bt, trip: { ...bt.trip, constraints } }
              }),
            })),
          }
        },
      )
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Erro ao atualizar restrições')
    }
  }

  function handleAdjustCycle() {
    if (!plottedData) return

    const overrides   = new Map<string, TripPatch>()
    const drOverrides = new Map<string, DeadrunPatch>()
    let tripsWithWindow = 0

    // Process per block: a block = one vehicle.
    // Merge trips and deadruns into chronological order so deadruns shift automatically
    // when the preceding trip's arrival extends.
    for (const block of plottedData.blocks) {
      type TripItem    = { kind: 'trip';    dep: number; bt: typeof block.blockTrips[0] }
      type DrItem      = { kind: 'deadrun'; dep: number; dr: typeof block.blockDeadruns[0] }
      type BlockItem   = TripItem | DrItem

      const items: BlockItem[] = [
        ...block.blockTrips.map(bt   => ({ kind: 'trip'    as const, dep: bt.trip.departureMinutes, bt })),
        ...block.blockDeadruns.map(dr => ({ kind: 'deadrun' as const, dep: dr.departureMinutes,      dr })),
      ].sort((a, b) => a.dep - b.dep)

      let prevArrival     = -Infinity
      let pendingInterval = 0  // interval to apply before the next trip (0 after a deadrun)

      for (let i = 0; i < items.length; i++) {
        const item     = items[i]
        const nextItem = items[i + 1]

        if (item.kind === 'trip') {
          const { trip } = item.bt

          const minDep      = prevArrival === -Infinity ? -Infinity : prevArrival + pendingInterval
          const effectiveDep = Math.max(
            overrides.get(trip.id)?.departureMinutes ?? trip.departureMinutes,
            minDep,
          )
          const cycleWindow = resolveCycleWindow(trip.route.line.metrics, trip.route.direction, effectiveDep)
          if (cycleWindow) tripsWithWindow++
          const newArrival = cycleWindow
            ? effectiveDep + cycleWindow.minutes
            : effectiveDep + (trip.arrivalMinutes - trip.departureMinutes)

          const patch: TripPatch = {}
          if (effectiveDep !== trip.departureMinutes) patch.departureMinutes = effectiveDep
          if (newArrival   !== trip.arrivalMinutes)   patch.arrivalMinutes   = newArrival
          if (Object.keys(patch).length > 0) overrides.set(trip.id, { ...overrides.get(trip.id), ...patch })

          prevArrival = newArrival
          // If next item is another trip (no deadrun between them), enforce the route headway.
          // If next item is a deadrun, set interval=0 — the deadrun itself is the gap.
          pendingInterval = (nextItem?.kind === 'trip' && cycleWindow) ? cycleWindow.intervalMinutes : 0

        } else {
          // Deadrun: always anchor to prevArrival (follows preceding trip in both directions),
          // preserving the original travel duration. Skip only when there is no preceding item.
          const { dr } = item
          const duration = dr.arrivalMinutes - dr.departureMinutes
          const newDep   = prevArrival !== -Infinity ? prevArrival : dr.departureMinutes
          const newArr   = newDep + duration

          const dpatch: DeadrunPatch = {}
          if (newDep !== dr.departureMinutes) dpatch.departureMinutes = newDep
          if (newArr !== dr.arrivalMinutes)   dpatch.arrivalMinutes   = newArr
          if (Object.keys(dpatch).length > 0) drOverrides.set(dr.id, dpatch)

          prevArrival     = newArr
          pendingInterval = 0  // next trip starts right after deadrun, no extra interval
        }
      }
    }

    setPendingChanges(overrides)
    setPendingDeadrunChanges(drOverrides)

    const tripCount    = overrides.size
    const deadrunCount = drOverrides.size
    if (tripCount > 0 || deadrunCount > 0) {
      const parts = [
        tripCount    > 0 ? `${tripCount} ${tripCount === 1 ? 'viagem' : 'viagens'}`     : null,
        deadrunCount > 0 ? `${deadrunCount} ${deadrunCount === 1 ? 'vazio' : 'vazios'}` : null,
      ].filter(Boolean).join(' e ')
      toast.success(`${parts} ajustados — use Salvar para persistir`)
    } else if (tripsWithWindow > 0) {
      toast.success('Ciclo já está correto em todas as viagens — nenhuma alteração realizada')
    } else {
      toast.error('Nenhuma viagem com ciclo configurado encontrada')
    }
  }

  // ── trip timing keyboard ops (edit bar, single-trip focus) ─────────────────

  const handleTripTimingOp = useCallback((
    op: 'grow' | 'shrink' | 'push' | 'pull' | 'growOnly' | 'shrinkOnly' | 'pushOnly' | 'pullOnly',
  ) => {
    if (!mergedPlottedData || !focusedSegId || focusedSegId.endsWith(':dr')) return

    let foundBlock: typeof mergedPlottedData.blocks[0]              | null = null
    let foundBt:    typeof mergedPlottedData.blocks[0]['blockTrips'][0] | null = null
    for (const block of mergedPlottedData.blocks) {
      const bt = block.blockTrips.find(bt => bt.id === focusedSegId)
      if (bt) { foundBlock = block; foundBt = bt; break }
    }
    if (!foundBlock || !foundBt) return

    // Skip pending-add trips (not in ganttData — can't patch via pendingChanges map)
    const isTempTrip = !ganttData?.blocks.some(b =>
      b.blockTrips.some(bt => bt.trip.id === foundBt!.trip.id)
    )
    if (isTempTrip) return

    type TItem = { kind: 'trip';    id: string; tripId: string; dep: number; arr: number }
    type DItem = { kind: 'deadrun'; id: string; drId:  string;  dep: number; arr: number }
    type Item  = TItem | DItem

    const items: Item[] = [
      ...foundBlock.blockTrips.map(bt => ({
        kind: 'trip' as const, id: bt.id, tripId: bt.trip.id,
        dep: bt.trip.departureMinutes, arr: bt.trip.arrivalMinutes,
      })),
      ...foundBlock.blockDeadruns.map(dr => ({
        kind: 'deadrun' as const, id: dr.id, drId: dr.id,
        dep: dr.departureMinutes, arr: dr.arrivalMinutes,
      })),
    ].sort((a, b) => a.dep - b.dep)

    const markedIdx = items.findIndex(i => i.kind === 'trip' && i.id === focusedSegId)
    if (markedIdx === -1) return
    const marked = items[markedIdx]

    let prevProd: Item | null = null
    for (let i = markedIdx - 1; i >= 0; i--) {
      if (items[i].kind === 'trip') { prevProd = items[i]; break }
    }
    let nextProd: Item | null = null
    for (let i = markedIdx + 1; i < items.length; i++) {
      if (items[i].kind === 'trip') { nextProd = items[i]; break }
    }

    const itemBefore = markedIdx > 0 ? items[markedIdx - 1] : null
    const subsequent = items.slice(markedIdx + 1)

    const newTrips = new Map(pendingChanges)
    const newDrs   = new Map(pendingDeadrunChanges)

    function setTrip(tripId: string, dep: number, arr: number) {
      const orig = ganttData?.blocks.flatMap(b => b.blockTrips).find(bt => bt.trip.id === tripId)?.trip
      const patch: TripPatch = {}
      if (!orig || dep !== orig.departureMinutes) patch.departureMinutes = dep
      if (!orig || arr !== orig.arrivalMinutes)   patch.arrivalMinutes   = arr
      if (Object.keys(patch).length) newTrips.set(tripId, patch)
      else newTrips.delete(tripId)
    }

    function setDr(drId: string, dep: number, arr: number) {
      const orig = ganttData?.blocks.flatMap(b => b.blockDeadruns).find(dr => dr.id === drId)
      const patch: DeadrunPatch = {}
      if (!orig || dep !== orig.departureMinutes) patch.departureMinutes = dep
      if (!orig || arr !== orig.arrivalMinutes)   patch.arrivalMinutes   = arr
      if (Object.keys(patch).length) newDrs.set(drId, patch)
      else newDrs.delete(drId)
    }

    function shiftSubsequent(delta: number) {
      for (const item of subsequent) {
        if (item.kind === 'trip') setTrip((item as TItem).tripId, item.dep + delta, item.arr + delta)
        else                      setDr((item as DItem).drId,    item.dep + delta, item.arr + delta)
      }
    }

    // Push only deadruns that sit between the marked trip and the next productive trip
    function pushLeadingDeadruns(delta: number) {
      for (const item of subsequent) {
        if (item.kind === 'deadrun') setDr((item as DItem).drId, item.dep + delta, item.arr + delta)
        else break
      }
    }

    const tripId = foundBt.trip.id

    switch (op) {
      case 'grow': {
        setTrip(tripId, marked.dep, marked.arr + 1)
        shiftSubsequent(1)
        break
      }
      case 'shrink': {
        if (marked.arr - marked.dep <= 1) return
        if (!prevProd && itemBefore?.kind === 'deadrun')
          setDr((itemBefore as DItem).drId, itemBefore.dep - 1, itemBefore.arr - 1)
        setTrip(tripId, marked.dep, marked.arr - 1)
        shiftSubsequent(-1)
        break
      }
      case 'push': {
        setTrip(tripId, marked.dep + 1, marked.arr + 1)
        shiftSubsequent(1)
        break
      }
      case 'pull': {
        if (prevProd && marked.dep - prevProd.arr <= 1) return
        if (!prevProd && itemBefore?.kind === 'deadrun')
          setDr((itemBefore as DItem).drId, itemBefore.dep - 1, itemBefore.arr - 1)
        setTrip(tripId, marked.dep - 1, marked.arr - 1)
        shiftSubsequent(-1)
        break
      }
      case 'growOnly': {
        if (nextProd && nextProd.dep - marked.arr <= 1) return
        pushLeadingDeadruns(1)
        setTrip(tripId, marked.dep, marked.arr + 1)
        break
      }
      case 'shrinkOnly': {
        if (marked.arr - marked.dep <= 1) return
        if (prevProd && marked.dep - prevProd.arr <= 1) return
        setTrip(tripId, marked.dep, marked.arr - 1)
        break
      }
      case 'pushOnly': {
        if (nextProd && nextProd.dep - marked.arr <= 1) return
        pushLeadingDeadruns(1)
        setTrip(tripId, marked.dep + 1, marked.arr + 1)
        break
      }
      case 'pullOnly': {
        if (prevProd && marked.dep - prevProd.arr <= 1) return
        if (!prevProd && itemBefore?.kind === 'deadrun')
          setDr((itemBefore as DItem).drId, itemBefore.dep - 1, itemBefore.arr - 1)
        setTrip(tripId, marked.dep - 1, marked.arr - 1)
        break
      }
    }

    setPendingChanges(newTrips)
    setPendingDeadrunChanges(newDrs)
  }, [focusedSegId, mergedPlottedData, ganttData, pendingChanges, pendingDeadrunChanges])

  function handleSelectionChange(sel: Selection | null) {
    setSelection(sel)
    if (editBarOpen && sel?.type === 'trip') {
      setFocusedSegId(sel.segment.id)
    }
  }

  function handlePendingAdd(entry: PendingAddEntry) {
    setPendingAdds(prev => [...prev, entry])
  }

  function clearAllPending() {
    setPendingChanges(new Map())
    setPendingDeadrunChanges(new Map())
    setPendingAdds([])
    setPendingDeletes(new Set())
    setPendingDeadrunDeletes(new Set())
    setPendingMoves([])
  }

  async function handleToggleEditBar() {
    if (editBarOpen && pendingCount > 0) {
      const ok = await confirm({
        title:        'Fechar modo de edição',
        description:  'Existem alterações pendentes que serão descartadas.',
        confirmLabel: 'Fechar e descartar',
        variant:      'destructive',
      })
      if (!ok) return
      clearAllPending()
      setSelection(null)
      setFocusedSegId(null)
      setEditBarOpen(false)
    } else if (!editBarOpen && selectedLineIds.size === 0) {
      return
    } else {
      setEditBarOpen(v => !v)
    }
  }

  async function handleSavePendingWithConfirm() {
    if (pendingChanges.size === 0 && pendingDeadrunChanges.size === 0 && pendingAdds.length === 0 && pendingDeletes.size === 0 && pendingDeadrunDeletes.size === 0 && pendingMoves.length === 0) return
    const total = pendingChanges.size + pendingDeadrunChanges.size + pendingAdds.length + pendingDeletes.size + pendingDeadrunDeletes.size + pendingMoves.length
    const ok = await confirm({
      title:        'Salvar alterações',
      description:  `Confirmar o salvamento de ${total} alteração(ões) pendente(s)?`,
      confirmLabel: 'Salvar',
      variant:      'safeConfirm',
    })
    if (!ok) return
    await handleSavePending()
  }

  async function handleDiscardPendingWithConfirm() {
    if (pendingChanges.size === 0 && pendingDeadrunChanges.size === 0 && pendingAdds.length === 0 && pendingDeletes.size === 0 && pendingDeadrunDeletes.size === 0 && pendingMoves.length === 0) return
    const ok = await confirm({
      title:        'Descartar alterações',
      description:  'Todas as alterações pendentes serão removidas.',
      confirmLabel: 'Descartar',
      variant:      'destructive',
    })
    if (!ok) return
    clearAllPending()
  }

  async function handleSavePending() {
    if (pendingChanges.size === 0 && pendingDeadrunChanges.size === 0 && pendingAdds.length === 0 && pendingDeletes.size === 0 && pendingDeadrunDeletes.size === 0 && pendingMoves.length === 0) return
    setIsPending(true)
    try {
      // Save trip patches
      await Promise.all(
        Array.from(pendingChanges.entries()).map(([tripId, patch]) =>
          apiFetch(`/transit/transit-trip/${tripId}`, {
            method: 'PATCH',
            body:   JSON.stringify(patch),
          }),
        ),
      )

      // Save deadrun patches grouped by block (endpoint requires block ownership)
      if (pendingDeadrunChanges.size > 0 && plottedData) {
        await Promise.all(
          plottedData.blocks.flatMap(block => {
            const updates = block.blockDeadruns
              .filter(dr => pendingDeadrunChanges.has(dr.id))
              .map(dr => {
                const patch = pendingDeadrunChanges.get(dr.id)!
                return {
                  id:               dr.id,
                  departureMinutes: patch.departureMinutes ?? dr.departureMinutes,
                  arrivalMinutes:   patch.arrivalMinutes   ?? dr.arrivalMinutes,
                }
              })
            if (updates.length === 0) return []
            return [apiFetch(`/transit/vehicle-block/${block.id}/deadruns`, {
              method: 'PATCH',
              body:   JSON.stringify({ updates }),
            })]
          }),
        )
      }

      // Delete pending-deleted trips
      if (pendingDeletes.size > 0) {
        await Promise.all(
          Array.from(pendingDeletes).map(tripId =>
            apiFetch(`/transit/transit-trip/${tripId}`, { method: 'DELETE' })
          ),
        )
      }

      // Delete pending-deleted deadruns grouped by block
      if (pendingDeadrunDeletes.size > 0 && plottedData) {
        await Promise.all(
          plottedData.blocks.flatMap(block => {
            const ids = block.blockDeadruns
              .filter(dr => pendingDeadrunDeletes.has(dr.id))
              .map(dr => dr.id)
            if (ids.length === 0) return []
            return [apiFetch(`/transit/vehicle-block/${block.id}/deadruns`, {
              method:  'DELETE',
              headers: { 'Content-Type': 'application/json' },
              body:    JSON.stringify({ ids }),
            })]
          }),
        )
      }

      // Persist pending adds
      for (const entry of pendingAdds) {
        const resolvedBlockId = entry.blockId === 'new' ? undefined : entry.blockId
        if (entry._kind === 'trip') {
          const res = await apiFetch(`/transit/vehicle-plan/${id}/add-trip`, {
            method:  'POST',
            headers: { 'Content-Type': 'application/json' },
            body:    JSON.stringify({
              routeId:                entry.routeId,
              departureMinutes:       entry.departureMinutes,
              arrivalMinutes:         entry.arrivalMinutes,
              blockId:                resolvedBlockId,
              ...(entry.access && { accessDepotLocalityId: entry.access.localityId }),
              ...(entry.return && { returnDepotLocalityId: entry.return.localityId }),
            }),
          })
          if (!res.ok) {
            const j = await res.json().catch(() => ({}))
            throw new Error(extractError(j))
          }
        } else {
          const res = await apiFetch(`/transit/vehicle-plan/${id}/add-deadrun`, {
            method:  'POST',
            headers: { 'Content-Type': 'application/json' },
            body:    JSON.stringify({
              originLocalityId:      entry.originLocality.id,
              destinationLocalityId: entry.destinationLocality.id,
              departureMinutes:      entry.departureMinutes,
              arrivalMinutes:        entry.arrivalMinutes,
              blockId:               resolvedBlockId,
            }),
          })
          if (!res.ok) {
            const j = await res.json().catch(() => ({}))
            throw new Error(extractError(j))
          }
        }
      }

      // Persist pending moves
      for (const move of pendingMoves) {
        const res = await apiFetch(`/transit/vehicle-block/${move.fromBlockId}/move-trip`, {
          method: 'PATCH',
          body:   JSON.stringify({ blockTripIds: move.blockTripIds, targetBlockId: move.toBlockId }),
        })
        if (!res.ok) {
          const j = await res.json().catch(() => ({}))
          throw new Error(extractError(j))
        }
      }

      await refetchGantt()
      setPendingChanges(new Map())
      setPendingDeadrunChanges(new Map())
      setPendingAdds([])
      setPendingDeletes(new Set())
      setPendingDeadrunDeletes(new Set())
      setPendingMoves([])
      toast.success('Alterações salvas')
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Erro ao salvar alterações')
    } finally {
      setIsPending(false)
    }
  }

  function handleAddAccess(blockTripId: string, blockId: string) {
    setDepotModal({ kind: 'access', blockTripId, blockId })
  }

  function handleAddReturn(blockTripId: string, blockId: string) {
    setDepotModal({ kind: 'return', blockTripId, blockId })
  }

  function handleConfirmMove() {
    if (!selection || !moveTargetBlockId || !mergedPlottedData) return

    const sourceBlockId = selection.type === 'trip' ? selection.segment.rowId : selection.rowId
    const sourceBlock   = mergedPlottedData.blocks.find(b => b.id === sourceBlockId)
    const targetBlock   = mergedPlottedData.blocks.find(b => b.id === moveTargetBlockId)
    if (!sourceBlock || !targetBlock) return

    const blockTripIds = selection.type === 'trip'
      ? (selection.segment.isDeadhead ? [] : [selection.segment.id])
      : selection.segments.filter(s => !s.isDeadhead).map(s => s.id)

    if (blockTripIds.length === 0) return

    const movedTrips = blockTripIds.map(btId => {
      const bt = sourceBlock.blockTrips.find(bt => bt.id === btId)
      if (!bt) return null
      return { dep: bt.trip.departureMinutes, arr: bt.trip.arrivalMinutes }
    }).filter((t): t is { dep: number; arr: number } => t != null)

    const targetTrips = targetBlock.blockTrips.map(bt => ({
      dep: bt.trip.departureMinutes,
      arr: bt.trip.arrivalMinutes,
    }))

    for (const moved of movedTrips) {
      for (const existing of targetTrips) {
        if (moved.dep < existing.arr && moved.arr > existing.dep) {
          toast.error('Conflito: sobreposição de horários no bloco de destino')
          return
        }
      }
    }

    setPendingMoves(prev => {
      const filtered = prev.filter(m => !m.blockTripIds.some(id => blockTripIds.includes(id)))
      return [...filtered, { blockTripIds, fromBlockId: sourceBlockId, toBlockId: moveTargetBlockId }]
    })

    setSelection(null)
    setMoveTargetBlockId(null)
  }

  async function handleConfirmDepotModal(depotLocalityId: string) {
    if (!depotModal) return
    const { kind, blockTripId, blockId } = depotModal
    setDepotModal(null)

    // Intercept pending trips: bundle access/return into the pending entry
    const pendingIdx = pendingAdds.findIndex(a => a._kind === 'trip' && a._tempId === blockTripId)
    if (pendingIdx !== -1) {
      const entry    = pendingAdds[pendingIdx] as PendingAddTrip
      const originId = kind === 'access' ? depotLocalityId         : entry.destinationLocality.id
      const destId   = kind === 'access' ? entry.originLocality.id : depotLocalityId
      const travelMinutes = await getTravelTime(originId, destId)
      if (travelMinutes === null) {
        toast.error('Mapeamento não localizado na matriz entre os pontos informados')
        return
      }
      setPendingAdds(prev => prev.map((a, i) => {
        if (i !== pendingIdx || a._kind !== 'trip') return a
        return kind === 'access'
          ? { ...a, access: { localityId: depotLocalityId, travelMinutes } }
          : { ...a, return: { localityId: depotLocalityId, travelMinutes } }
      }))
      setSelection(null)
      return
    }

    try {
      const res = await apiFetch(`/transit/vehicle-block/${blockId}/${kind}`, {
        method: 'POST',
        body:   JSON.stringify({ blockTripId, depotLocalityId }),
      })
      if (!res.ok) {
        const json = await res.json().catch(() => ({}))
        throw new Error(extractError(json))
      }
      setSelection(null)
      await refetchGantt()
    } catch (err) {
      const label = kind === 'access' ? 'acesso' : 'recolhida'
      toast.error(err instanceof Error ? err.message : `Erro ao adicionar ${label}`)
    }
  }

  async function handleDeleteDeadruns(deadrunIds: string[], blockId: string) {
    const ok = await confirm({
      title:        deadrunIds.length === 1 ? 'Excluir vazio' : `Excluir ${deadrunIds.length} vazios`,
      description:  'Esta ação não pode ser desfeita.',
      confirmLabel: 'Excluir',
      variant:      'destructive',
    })
    if (!ok) return
    try {
      const res = await apiFetch(`/transit/vehicle-block/${blockId}/deadruns`, {
        method:  'DELETE',
        headers: { 'Content-Type': 'application/json' },
        body:    JSON.stringify({ ids: deadrunIds }),
      })
      if (!res.ok) {
        const json = await res.json().catch(() => ({}))
        throw new Error(extractError(json))
      }
      setSelection(null)
      await refetchGantt()
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Erro ao excluir vazio')
    }
  }

  async function handleDeleteInterval(tripIds: string[], deadrunIds: string[], blockId: string) {
    const tripCount    = tripIds.length
    const deadrunCount = deadrunIds.length
    const parts        = [
      tripCount    > 0 ? `${tripCount} ${tripCount === 1 ? 'viagem' : 'viagens'}`  : null,
      deadrunCount > 0 ? `${deadrunCount} ${deadrunCount === 1 ? 'vazio' : 'vazios'}` : null,
    ].filter(Boolean).join(' e ')

    const ok = await confirm({
      title:        `Excluir ${parts}`,
      description:  'Esta ação não pode ser desfeita.',
      confirmLabel: 'Excluir',
      variant:      'destructive',
    })
    if (!ok) return
    try {
      await Promise.all([
        ...tripIds.map(async (tripId) => {
          const res = await apiFetch(`/transit/transit-trip/${tripId}`, { method: 'DELETE' })
          if (!res.ok) { const j = await res.json().catch(() => ({})); throw new Error(extractError(j)) }
        }),
        ...(deadrunIds.length > 0 ? [
          apiFetch(`/transit/vehicle-block/${blockId}/deadruns`, {
            method:  'DELETE',
            headers: { 'Content-Type': 'application/json' },
            body:    JSON.stringify({ ids: deadrunIds }),
          }).then(async (res) => {
            if (!res.ok) { const j = await res.json().catch(() => ({})); throw new Error(extractError(j)) }
          }),
        ] : []),
      ])
      setSelection(null)
      await refetchGantt()
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Erro ao excluir seleção')
    }
  }

  async function handleDeleteTrips(tripIds: string[]) {
    const count = tripIds.length
    const ok = await confirm({
      title:        count === 1 ? 'Excluir viagem' : `Excluir ${count} viagens`,
      description:  'Esta ação não pode ser desfeita.',
      confirmLabel: 'Excluir',
      variant:      'destructive',
    })
    if (!ok) return
    try {
      await Promise.all(
        tripIds.map(async (tripId) => {
          const res = await apiFetch(`/transit/transit-trip/${tripId}`, { method: 'DELETE' })
          if (!res.ok) {
            const json = await res.json().catch(() => ({}))
            throw new Error(extractError(json))
          }
        })
      )
      setSelection(null)
      await refetchGantt()
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Erro ao excluir viagens')
    }
  }

  const vehiclesActionSpec = useMemo(
    () => createVehiclesActionSpec({
      onUpdateConstraints: handleUpdateConstraints,
      onDeleteTrips:       handleDeleteTrips,
      onDeleteDeadruns:    handleDeleteDeadruns,
      onDeleteInterval:    handleDeleteInterval,
      onAddAccess:         handleAddAccess,
      onAddReturn:         handleAddReturn,
    }),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [],
  )

  // ── topbar ───────────────────────────────────────────────────────────────────

  const status           = record?.status as string | undefined
  const planLines        = ganttData?.plan?.lines ?? []
  const hasCustomMetrics = !!( (record as Record<string, unknown> | undefined)?.metrics )
  const fleetDelta       = baselineSnapshot != null && solverProgress.bestScenario != null
    ? solverProgress.bestScenario.fleetCount - baselineSnapshot.fleetCount
    : null
  const pendingCount     = pendingChanges.size + pendingDeadrunChanges.size + pendingAdds.length + pendingDeletes.size + pendingDeadrunDeletes.size + pendingMoves.length

  useTopbarActions([
    // toggle barra de edição — sempre visível, alinhado à esquerda
    ...(!isNew ? [{
      label:    'Barra Edição',
      icon:     Icons.SlidersHorizontal,
      size:     'icon' as const,
      onClick:  () => handleToggleEditBar(),
      disabled: !editBarOpen && selectedLineIds.size === 0,
      variant:  (editBarOpen ? 'default' : 'ghost') as 'default' | 'ghost',
      keybind:  'F9',
      position: 'start' as const,
    }] : []),

    // ── modo edição ────────────────────────────────────────────────────────────
    ...(editBarOpen ? [
      {
        label:    'Viagem',
        icon:     Icons.Plus,
        size:     'sm' as const,
        variant:  'ghost' as const,
        onClick:  () => setAddTripOpen(true),
      },
      { label: '', separator: true },
      {
        label:    'Ajustar Ciclo',
        icon:     Icons.Timer,
        size:     'sm' as const,
        onClick:  handleAdjustCycle,
        disabled: isPending,
        variant:  'ghost' as const,
      },
      { label: '', separator: true },
      {
        label:    pendingCount > 0 ? `Salvar (${pendingCount})` : 'Salvar',
        icon:     Icons.Save,
        size:     'sm' as const,
        onClick:  handleSavePendingWithConfirm,
        disabled: isPending || pendingCount === 0,
        keybind:  'Alt+G',
      },
      {
        label:    'Limpar',
        icon:     Icons.Undo2,
        size:     'sm' as const,
        onClick:  handleDiscardPendingWithConfirm,
        disabled: isPending || pendingCount === 0,
        variant:  'destructive' as const,
        keybind:  'Alt+L',
      },
    ] : [
    // ── modo normal ────────────────────────────────────────────────────────────
      // lines panel toggle
      ...(!isNew ? [{
        label:   'Linhas',
        icon:    Icons.List,
        onClick: () => setLinesPanelOpen(v => !v),
        menu: [
          { label: 'Versões', icon: Icons.GitBranch, onClick: () => {
            if (selectedLineIds.size === 0) { toast.error('Selecione ao menos uma linha em "Linhas" primeiro'); return }
            setVersionsModalOpen(true)
          } },
        ],
      }] : []),
      // parar: only while stream is open
      ...(activeJobId && !isSolverDone ? [{
        label:    'Parar',
        icon:     Icons.Square,
        onClick:  handleStop,
        disabled: isPending,
      }] : []),
      // generate
      ...((!activeJobId || isSolverDone) && canUpdate && status === 'DRAFT' ? [{
        label:    isPending ? 'Gerando…' : 'Gerar',
        icon:     Icons.Play,
        onClick:  () => setGenerateModalOpen(true),
        disabled: isPending,
      }] : []),
      // activate
      ...(!activeJobId && canUpdate && status === 'DRAFT' ? [{
        label:    isPending ? 'Ativando…' : 'Ativar',
        icon:     Icons.CheckCircle,
        onClick:  handleActivate,
        disabled: isPending,
        overflow: true,
      }] : []),
      // delete
      ...(!activeJobId && canUpdate && status === 'DRAFT' ? [{
        label:    'Excluir',
        icon:     Icons.Trash2,
        onClick:  handleDelete,
        disabled: isPending,
        variant:  'destructive' as const,
        overflow: true,
      }] : []),
    ]),
  ], [isPending, activeJobId, isSolverDone, canUpdate, status, isNew, selectedLineIds.size, editBarOpen, pendingCount])

  // ── keyboard nav focus ────────────────────────────────────────────────────

  useEffect(() => {
    if (!editBarOpen) {
      setFocusedSegId(null)
      setSelection(null)
      shiftAnchorRef.current = null
      return
    }
    const first = navBlocks[0]
    if (first?.length) setFocusedSegId(first[0].segId)
  }, [editBarOpen]) // eslint-disable-line react-hooks/exhaustive-deps

  // ── shortcuts ─────────────────────────────────────────────────────────────

  useShortcut('alt+v', () => {
    if (editBarOpen && pendingCount > 0) {
      confirm({
        title:        'Sair do modo de edição',
        description:  'Existem alterações pendentes que serão descartadas ao sair.',
        confirmLabel: 'Sair e descartar',
        variant:      'destructive',
      }).then(ok => {
        if (!ok) return
        clearAllPending()
        router.push('/transit/vehicle-plan')
      })
    } else {
      router.push('/transit/vehicle-plan')
    }
  }, {
    desc:    'Voltar',
    icon:    Icons.ArrowLeft,
    origin:  'apps/web/src/app/transit/vehicle-plan/[id]/page',
    context: 'all',
  })

  useShortcut('ctrl+;', () => setFreqPanelOpen(v => !v), {
    desc:   'Frequência de atendimento',
    icon:   Icons.BarChart2,
    origin: 'apps/web/src/app/transit/vehicle-plan/[id]/page',
  })

  useShortcut('alt+g', () => handleSavePendingWithConfirm(), {
    desc:    'Salvar alterações pendentes',
    icon:    Icons.Save,
    origin:  'apps/web/src/app/transit/vehicle-plan/[id]/page',
    enabled: editBarOpen,
  })

  useShortcut('alt+l', () => handleDiscardPendingWithConfirm(), {
    desc:    'Reverte alterações pendentes',
    icon:    Icons.Undo2,
    origin:  'apps/web/src/app/transit/vehicle-plan/[id]/page',
    enabled: editBarOpen,
  })

  useShortcut('f9', () => handleToggleEditBar(), {
    desc:    'Exibir/ocultar barra de edição',
    icon:    Icons.SlidersHorizontal,
    origin:  'apps/web/src/app/transit/vehicle-plan/[id]/page',
    enabled: !isNew,
  })

  useShortcut('contextmenu', () => {
    if (!focusedSegId) return
    const segs = ganttBoardRef.current?.getSegments() ?? []
    const seg  = segs.find(s => s.id === focusedSegId)
    if (!seg) return
    const rows = ganttBoardRef.current?.getRows() ?? []
    handleSelectionChange(vehiclesActionSpec.resolveSelection(seg, selection, { allSegments: segs, allRows: rows }))
  }, { enabled: editBarOpen && !selection && !!focusedSegId, display: false })

  useShortcut('←', () => {
    if (!focusedSegId) return
    setSelection(null); shiftAnchorRef.current = null
    for (const block of navBlocks) {
      const idx = block.findIndex(i => i.segId === focusedSegId)
      if (idx > 0) { setFocusedSegId(block[idx - 1].segId); break }
      if (idx === 0) break
    }
  }, { enabled: editBarOpen && !selection, display: false })

  useShortcut('→', () => {
    if (!focusedSegId) return
    setSelection(null); shiftAnchorRef.current = null
    for (const block of navBlocks) {
      const idx = block.findIndex(i => i.segId === focusedSegId)
      if (idx !== -1 && idx < block.length - 1) { setFocusedSegId(block[idx + 1].segId); break }
      if (idx === block.length - 1) break
    }
  }, { enabled: editBarOpen && !selection, display: false })

  useShortcut('↑', () => {
    if (!focusedSegId) return
    setSelection(null); shiftAnchorRef.current = null
    for (let bi = 1; bi < navBlocks.length; bi++) {
      const idx = navBlocks[bi].findIndex(i => i.segId === focusedSegId)
      if (idx === -1) continue
      const curDep = navBlocks[bi][idx].dep
      const prev   = navBlocks[bi - 1]
      if (!prev.length) break
      const nearest = prev.reduce((best, item) =>
        Math.abs(item.dep - curDep) < Math.abs(best.dep - curDep) ? item : best
      )
      setFocusedSegId(nearest.segId)
      break
    }
  }, { enabled: editBarOpen && !selection, display: false })

  useShortcut('↓', () => {
    if (!focusedSegId) return
    setSelection(null); shiftAnchorRef.current = null
    for (let bi = 0; bi < navBlocks.length - 1; bi++) {
      const idx = navBlocks[bi].findIndex(i => i.segId === focusedSegId)
      if (idx === -1) continue
      const curDep = navBlocks[bi][idx].dep
      const next   = navBlocks[bi + 1]
      if (!next.length) break
      const nearest = next.reduce((best, item) =>
        Math.abs(item.dep - curDep) < Math.abs(best.dep - curDep) ? item : best
      )
      setFocusedSegId(nearest.segId)
      break
    }
  }, { enabled: editBarOpen && !selection, display: false })

  useShortcut('shift+←', () => {
    if (!focusedSegId) return
    if (!shiftAnchorRef.current) shiftAnchorRef.current = focusedSegId

    let nextFocus = focusedSegId
    for (const block of navBlocks) {
      const idx = block.findIndex(i => i.segId === focusedSegId)
      if (idx > 0)   { nextFocus = block[idx - 1].segId; break }
      if (idx === 0) break
    }
    setFocusedSegId(nextFocus)

    const segs   = ganttBoardRef.current?.getSegments() ?? []
    const anchor = segs.find(s => s.id === shiftAnchorRef.current!)
    const target = segs.find(s => s.id === nextFocus)
    if (!anchor || !target) return
    if (anchor.id === target.id) {
      setSelection({ type: 'trip', segment: anchor })
    } else if (anchor.rowId === target.rowId) {
      const rowId     = anchor.rowId
      const spanStart = Math.min(anchor.startMinute, target.startMinute)
      const spanEnd   = Math.max(anchor.endMinute,   target.endMinute)
      setSelection({
        type:     'interval',
        rowId,
        from:     anchor,
        to:       target,
        segments: segs.filter(s => s.rowId === rowId && s.endMinute > spanStart && s.startMinute < spanEnd),
      })
    }
  }, { enabled: editBarOpen, display: false })

  useShortcut('shift+→', () => {
    if (!focusedSegId) return
    if (!shiftAnchorRef.current) shiftAnchorRef.current = focusedSegId

    let nextFocus = focusedSegId
    for (const block of navBlocks) {
      const idx = block.findIndex(i => i.segId === focusedSegId)
      if (idx !== -1 && idx < block.length - 1) { nextFocus = block[idx + 1].segId; break }
      if (idx === block.length - 1)              break
    }
    setFocusedSegId(nextFocus)

    const segs   = ganttBoardRef.current?.getSegments() ?? []
    const anchor = segs.find(s => s.id === shiftAnchorRef.current!)
    const target = segs.find(s => s.id === nextFocus)
    if (!anchor || !target) return
    if (anchor.id === target.id) {
      setSelection({ type: 'trip', segment: anchor })
    } else if (anchor.rowId === target.rowId) {
      const rowId     = anchor.rowId
      const spanStart = Math.min(anchor.startMinute, target.startMinute)
      const spanEnd   = Math.max(anchor.endMinute,   target.endMinute)
      setSelection({
        type:     'interval',
        rowId,
        from:     anchor,
        to:       target,
        segments: segs.filter(s => s.rowId === rowId && s.endMinute > spanStart && s.startMinute < spanEnd),
      })
    }
  }, { enabled: editBarOpen, display: false })

  // ── move-target navigation (Up/Down with active selection) ──────────────────

  const selectionHasTrips = selection
    ? (selection.type === 'trip'
        ? !selection.segment.isDeadhead
        : selection.segments.some(s => !s.isDeadhead))
    : false

  useShortcut('↑', () => {
    if (!moveTargetBlocks) return
    setMoveTargetBlockId(prev => stepMoveTarget(prev, -1))
  }, { enabled: editBarOpen && selectionHasTrips, display: false })

  useShortcut('↓', () => {
    if (!moveTargetBlocks) return
    setMoveTargetBlockId(prev => stepMoveTarget(prev, 1))
  }, { enabled: editBarOpen && selectionHasTrips, display: false })

  useShortcut('q+m', () => handleConfirmMove(), {
    desc:    'Mover viagens para bloco alvo',
    icon:    Icons.ArrowRightLeft,
    origin:  'apps/web/src/app/transit/vehicle-plan/[id]/page',
    enabled: editBarOpen && selectionHasTrips && !!moveTargetBlockId,
  })

  useShortcut('pagedown', () => {
    if (!focusedSegId || focusedSegId.endsWith(':dr')) return
    const curIdx = allTrips.findIndex(t => t.segId === focusedSegId)
    if (curIdx === -1) return
    const dir = allTrips[curIdx].direction
    for (let i = curIdx + 1; i < allTrips.length; i++) {
      if (allTrips[i].direction === dir) { setFocusedSegId(allTrips[i].segId); break }
    }
  }, {
    desc:    'Próxima viagem mesmo sentido',
    icon:    Icons.ArrowDown,
    origin:  'apps/web/src/app/transit/vehicle-plan/[id]/page',
    enabled: editBarOpen && !selection,
  })

  useShortcut('pageup', () => {
    if (!focusedSegId || focusedSegId.endsWith(':dr')) return
    const curIdx = allTrips.findIndex(t => t.segId === focusedSegId)
    if (curIdx === -1) return
    const dir = allTrips[curIdx].direction
    for (let i = curIdx - 1; i >= 0; i--) {
      if (allTrips[i].direction === dir) { setFocusedSegId(allTrips[i].segId); break }
    }
  }, {
    desc:    'Viagem anterior mesmo sentido',
    icon:    Icons.ArrowUp,
    origin:  'apps/web/src/app/transit/vehicle-plan/[id]/page',
    enabled: editBarOpen && !selection,
  })

  useShortcut('home', () => {
    const first = navBlocks[0]?.[0]
    if (first) { setFocusedSegId(first.segId); setSelection(null); shiftAnchorRef.current = null }
  }, { enabled: editBarOpen && !selection, display: false })

  useShortcut('end', () => {
    const lastBlock = navBlocks[navBlocks.length - 1]
    const last = lastBlock?.[lastBlock.length - 1]
    if (last) { setFocusedSegId(last.segId); setSelection(null); shiftAnchorRef.current = null }
  }, { enabled: editBarOpen && !selection, display: false })

  useShortcut('shift+home', () => {
    if (!focusedSegId || focusedSegId.endsWith(':dr')) return
    const curIdx = allTrips.findIndex(t => t.segId === focusedSegId)
    if (curIdx === -1) return
    const dir = allTrips[curIdx].direction
    const first = allTrips.find(t => t.direction === dir)
    if (first) setFocusedSegId(first.segId)
  }, { enabled: editBarOpen && !selection, display: false })

  useShortcut('shift+end', () => {
    if (!focusedSegId || focusedSegId.endsWith(':dr')) return
    const curIdx = allTrips.findIndex(t => t.segId === focusedSegId)
    if (curIdx === -1) return
    const dir = allTrips[curIdx].direction
    for (let i = allTrips.length - 1; i >= 0; i--) {
      if (allTrips[i].direction === dir) { setFocusedSegId(allTrips[i].segId); break }
    }
  }, { enabled: editBarOpen && !selection, display: false })

  // ── trip timing shortcuts (edit bar, single-trip focus) ──────────────────
  const isTripFocused = editBarOpen && !!focusedSegId && !focusedSegId.endsWith(':dr')

  useShortcut('+',              () => handleTripTimingOp('grow'),      { enabled: isTripFocused, display: false })
  useShortcut('-',              () => handleTripTimingOp('shrink'),    { enabled: isTripFocused, display: false })
  useShortcut(' ',              () => handleTripTimingOp('push'),      { enabled: isTripFocused, display: false, preventDefault: true })
  useShortcut('backspace',      () => handleTripTimingOp('pull'),      { enabled: isTripFocused, display: false, preventDefault: true })
  useShortcut('shift++',        () => handleTripTimingOp('growOnly'),  { enabled: isTripFocused, display: false })
  useShortcut('shift+-',        () => handleTripTimingOp('shrinkOnly'),{ enabled: isTripFocused, display: false })
  useShortcut('shift+ ',        () => handleTripTimingOp('pushOnly'),  { enabled: isTripFocused, display: false, preventDefault: true })
  useShortcut('shift+backspace',() => handleTripTimingOp('pullOnly'),  { enabled: isTripFocused, display: false, preventDefault: true })

  useShortcut('delete', () => {
    if (!mergedPlottedData) return

    // Build list of segment references: prefer active selection, fall back to focusedSegId
    type SegRef = { id: string; isDeadhead: boolean }
    let segRefs: SegRef[] = []
    if (selection) {
      const segs = selection.type === 'trip' ? [selection.segment] : selection.segments
      segRefs = segs.map(s => ({ id: s.id, isDeadhead: s.isDeadhead }))
    } else if (focusedSegId) {
      segRefs = [{ id: focusedSegId, isDeadhead: focusedSegId.endsWith(':dr') }]
    }
    if (segRefs.length === 0) return

    const tripIds:    string[] = []
    const tempIds:    string[] = []
    const deadrunIds: string[] = []

    for (const { id, isDeadhead } of segRefs) {
      if (isDeadhead) {
        deadrunIds.push(id.replace(/:dr$/, ''))
      } else {
        for (const block of mergedPlottedData.blocks) {
          const bt = block.blockTrips.find(bt => bt.id === id)
          if (bt) {
            const isTemp = pendingAdds.some(a => a._kind === 'trip' && a._tempId === bt.id)
            if (isTemp) tempIds.push(bt.id)
            else        tripIds.push(bt.trip.id)
            break
          }
        }
      }
    }

    // Compute next focus before applying state
    let nextFocusId: string | null = null
    if (focusedSegId) {
      const deletedSegIds  = new Set(segRefs.map(r => r.id))
      const newTripDels    = new Set([...pendingDeletes,         ...tripIds])
      const newDrDels      = new Set([...pendingDeadrunDeletes,  ...deadrunIds])
      for (const t of tempIds) deletedSegIds.add(t)  // pending-add blockTrip IDs

      let foundBlock: typeof mergedPlottedData.blocks[0] | null = null
      let focusedDep = 0
      for (const block of mergedPlottedData.blocks) {
        const bt = block.blockTrips.find(bt => bt.id === focusedSegId)
        if (bt) { foundBlock = block; focusedDep = bt.trip.departureMinutes; break }
        const dr = block.blockDeadruns.find(dr => `${dr.id}:dr` === focusedSegId)
        if (dr) { foundBlock = block; focusedDep = dr.departureMinutes; break }
      }

      if (foundBlock) {
        const remaining = [
          ...foundBlock.blockTrips
            .filter(bt => !deletedSegIds.has(bt.id) && !newTripDels.has(bt.trip.id))
            .map(bt => ({ id: bt.id, dep: bt.trip.departureMinutes })),
          ...foundBlock.blockDeadruns
            .filter(dr => !deletedSegIds.has(`${dr.id}:dr`) && !newDrDels.has(dr.id))
            .map(dr => ({ id: `${dr.id}:dr`, dep: dr.departureMinutes })),
        ]

        if (remaining.length > 0) {
          nextFocusId = remaining.reduce((best, cur) =>
            Math.abs(cur.dep - focusedDep) < Math.abs(best.dep - focusedDep) ? cur : best
          ).id
        } else {
          const allOther = mergedPlottedData.blocks
            .filter(b => b !== foundBlock)
            .flatMap(b => b.blockTrips
              .filter(bt => !newTripDels.has(bt.trip.id))
              .map(bt => ({ id: bt.id, dep: bt.trip.departureMinutes }))
            )
          if (allOther.length > 0) {
            nextFocusId = allOther.reduce((best, cur) =>
              Math.abs(cur.dep - focusedDep) < Math.abs(best.dep - focusedDep) ? cur : best
            ).id
          }
        }
      }
    }

    if (tempIds.length > 0)
      setPendingAdds(prev => prev.filter(a => !tempIds.includes(a._tempId)))

    if (tripIds.length > 0) {
      setPendingDeletes(prev => new Set([...prev, ...tripIds]))
      setPendingChanges(prev => {
        const next = new Map(prev)
        for (const tid of tripIds) next.delete(tid)
        return next
      })
    }

    if (deadrunIds.length > 0) {
      setPendingDeadrunDeletes(prev => new Set([...prev, ...deadrunIds]))
      setPendingDeadrunChanges(prev => {
        const next = new Map(prev)
        for (const did of deadrunIds) next.delete(did)
        return next
      })
    }

    setFocusedSegId(nextFocusId)
    setSelection(null)
  }, {
    origin:  'apps/web/src/app/transit/vehicle-plan/[id]/page',
    enabled: editBarOpen && (!!selection || !!focusedSegId),
    display: false,
    preventDefault: true,
  })

  // ── trip summary panel ────────────────────────────────────────────────────
  // Tracks the segment whose data the panel shows: the single selected/focused
  // segment, or — once a group (interval) selection starts — the segment that
  // was selected right before it grew into a group, kept fixed while it grows.
  if (!selection) {
    groupAnchorSegIdRef.current = null
  } else if (selection.type === 'trip') {
    groupAnchorSegIdRef.current = selection.segment.id
  } else if (!groupAnchorSegIdRef.current) {
    groupAnchorSegIdRef.current = selection.from.id
  }

  const summarySegId = selection ? groupAnchorSegIdRef.current : focusedSegId

  let summaryTrip:    GanttBlockTrip    | null = null
  let summaryDeadrun: GanttBlockDeadrun | null = null
  if (summarySegId && mergedPlottedData) {
    if (summarySegId.endsWith(':dr')) {
      const drId = summarySegId.slice(0, -3)
      for (const block of mergedPlottedData.blocks) {
        const dr = block.blockDeadruns.find(dr => dr.id === drId)
        if (dr) { summaryDeadrun = dr; break }
      }
    } else {
      for (const block of mergedPlottedData.blocks) {
        const bt = block.blockTrips.find(bt => bt.id === summarySegId)
        if (bt) { summaryTrip = bt; break }
      }
    }
  }
  const summaryHeadway = summaryTrip && mergedPlottedData
    ? computeHeadway(summaryTrip, mergedPlottedData.blocks)
    : null

  // ── render ─────────────────────────────────────────────────────────────────

  if (guardNode) return guardNode

  if (isNew) {
    return (
      <div className="flex flex-col h-full overflow-hidden">
        <div className="px-6 pt-4 pb-2 shrink-0">
          <AutoBreadcrumb domain="transit" resource="vehicle-plan" id={id} />
        </div>
        <NewPlanForm />
      </div>
    )
  }

  const recordName = record ? String(record.status ?? '') : undefined

  return (
    <div className="flex flex-col h-full overflow-hidden">
      {generateModalOpen && (
        <GenerateModal
          hasCustomMetrics={hasCustomMetrics}
          onConfirm={handleGenerate}
          onClearMetrics={handleClearMetrics}
          onClose={() => setGenerateModalOpen(false)}
        />
      )}

      {versionsModalOpen && ganttData?.plan?.dayType && (
        <SwitchLineScheduleModal
          planId={id}
          dayTypeId={ganttData.plan.dayType.id}
          lines={planLines.filter(l => selectedLineIds.has(l.lineId))}
          hasPendingChanges={pendingCount > 0}
          onApplied={() => refetchGantt()}
          onClose={() => setVersionsModalOpen(false)}
        />
      )}

      {depotModal && (
        <AccessModal
          title={depotModal.kind === 'access' ? 'Adicionar Acesso' : 'Adicionar Recolhida'}
          onConfirm={handleConfirmDepotModal}
          onClose={() => setDepotModal(null)}
        />
      )}

      {addTripOpen && plottedData && selectedLineIds.size > 0 && (
        <AddTripModal
          planId={id}
          plottedLines={plottedData.plan.lines.filter(l => selectedLineIds.has(l.lineId))}
          plottedBlocks={plottedData.blocks}
          onClose={() => setAddTripOpen(false)}
          onPendingAdd={handlePendingAdd}
        />
      )}

      {detailsOpen && (
        <SolverProposalDialog
          baseline={baselineSnapshot}
          proposal={solverProgress.bestScenario}
          proposalCount={solverProgress.proposalCount}
          isPending={isPending}
          canDiscard={isSolverDone || solverProgress.bestScenario != null}
          onClose={() => setDetailsOpen(false)}
          onAssume={handleAssumeBest}
          onDiscard={handleDiscard}
        />
      )}

      <div className="px-6 pt-4 pb-2 shrink-0 flex items-start justify-between gap-4">
        <div className="space-y-1 min-w-0 flex-1">
          <AutoBreadcrumb domain="transit" resource="vehicle-plan" id={id} recordName={recordName} />

          {/* summary bar */}
          {record && (
            <div className="flex items-center gap-4 text-sm text-muted-foreground">
              <InlineDescription
                value={(record as Record<string, unknown>).description as string | undefined}
                disabled={!canUpdate}
                onSave={async (val) => {
                  const res = await apiFetch(`/transit/vehicle-plan/${id}`, {
                    method: 'PATCH',
                    body:   JSON.stringify({ description: val }),
                  })
                  if (!res.ok) {
                    const json = await res.json().catch(() => ({}))
                    throw new Error(extractError(json))
                  }
                  await queryClient.invalidateQueries({ queryKey: ['transit', 'vehicle-plan', id] })
                }}
              />
              <span>
                Status:{' '}
                <span className={status === 'ACTIVE' ? 'text-green-600 font-medium' : 'font-medium'}>
                  {status === 'ACTIVE' ? 'Ativo' : 'Rascunho'}
                </span>
              </span>
              {ganttData?.plan?.dayType && (
                <span>Tipo: <span className="font-medium">{ganttData.plan.dayType.code}</span></span>
              )}
              {ganttData?.plan?.lines != null && (
                <span>{ganttData.plan.lines.length} {ganttData.plan.lines.length === 1 ? 'linha' : 'linhas'}</span>
              )}
              {ganttData?.blocks != null && (
                <span>{ganttData.blocks.length} {ganttData.blocks.length === 1 ? 'bloco' : 'blocos'}</span>
              )}
              {ganttData?.blocks != null && (
                <span>
                  {ganttData.blocks.reduce((sum, b) => sum + b.blockTrips.length, 0)} viagens produtivas
                </span>
              )}
              {activeJobId && (
                <span className="flex items-center gap-1.5 font-mono text-xs tabular-nums">
                  <span className={`px-1.5 py-0.5 rounded font-semibold ${
                    isSolverDone
                      ? 'bg-muted text-muted-foreground'
                      : 'bg-blue-100 text-blue-700 dark:bg-blue-900/40 dark:text-blue-300'
                  }`}>
                    LVL {solverProgress.currentLevel} {solverProgress.currentLevelLabel}
                  </span>
                  <span className="text-muted-foreground">—</span>
                  <span className={!isSolverDone ? 'text-blue-600 animate-pulse' : 'text-muted-foreground'}>
                    {solverProgress.totalIterations.toLocaleString('pt-BR')}
                  </span>
                  <span className="bg-muted rounded px-1 py-0.5 text-muted-foreground">
                    [{solverProgress.proposalCount}]
                  </span>
                  {fleetDelta != null && (
                    <span className={`rounded px-1 py-0.5 ${
                      fleetDelta < 0
                        ? 'bg-green-100 text-green-700 dark:bg-green-900/40 dark:text-green-400'
                        : fleetDelta > 0
                          ? 'bg-red-100 text-red-700 dark:bg-red-900/40 dark:text-red-400'
                          : 'bg-muted text-muted-foreground'
                    }`}>
                      [{fleetDelta > 0 ? '+' : ''}{fleetDelta}]
                    </span>
                  )}
                  <button
                    onClick={() => setDetailsOpen(true)}
                    className="rounded px-1 py-0.5 bg-muted text-muted-foreground hover:text-foreground hover:bg-muted/80 transition-colors"
                  >
                    [Detalhes]
                  </button>
                </span>
              )}
            </div>
          )}
        </div>

        {editBarOpen && (summaryTrip || summaryDeadrun) && (
          <TripSummaryPanel trip={summaryTrip} deadrun={summaryDeadrun} headway={summaryHeadway} />
        )}
      </div>

      {/* gantt + lines panel */}
      <div className="flex flex-1 min-h-0 border-t overflow-hidden">
        <div className="flex-1 min-w-0 flex flex-col min-h-0">
          <div className="flex-1 min-h-0 relative">
            {mergedPlottedData ? (
              mergedPlottedData.blocks.length > 0 ? (
                <GanttBoard
                  ref={ganttBoardRef}
                  data={mergedPlottedData}
                  onViewportChange={setGanttVp}
                  selection={selection}
                  onSelectionChange={handleSelectionChange}
                  actionSpec={vehiclesActionSpec}
                  onBlockUpdate={() => refetchGantt()}
                  focusedSegId={editBarOpen ? focusedSegId : null}
                  moveTargetBlockId={editBarOpen ? moveTargetBlockId : null}
                  moveTargetHints={moveTargetHints}
                />
              ) : (
                <div className="flex items-center justify-center h-full text-muted-foreground text-sm">
                  {selectedLineIds.size === 0
                    ? 'Selecione linhas no painel lateral para visualizar'
                    : 'Nenhum bloco para as linhas selecionadas'}
                </div>
              )
            ) : (
              <div className="flex items-center justify-center h-full text-muted-foreground text-sm">
                Carregando…
              </div>
            )}

            {selection && mergedPlottedData && (
              <GanttActionBar
                selection={selection}
                actions={vehiclesActionSpec.getActions(selection, mergedPlottedData, () => setSelection(null))}
                onDismiss={() => setSelection(null)}
              />
            )}
          </div>

          {freqPanelOpen && plottedData && (
            <FrequencyPanel data={mergedPlottedData ?? plottedData} vp={ganttVp} />
          )}
        </div>

        {linesPanelOpen && (
          <LinesPanel
            planLines={ganttData?.plan?.lines ?? []}
            selectedLineIds={selectedLineIds}
            onSelectionChange={setSelectedLineIds}
            onClose={() => setLinesPanelOpen(false)}
          />
        )}
      </div>
    </div>
  )
}
