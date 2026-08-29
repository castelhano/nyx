'use client'

import { useState, useRef, useMemo, useCallback, useEffect } from 'react'
import { apiFetch } from '@/lib/auth'
import { useConfirm } from '@/lib/confirm-context'
import { useToast } from '@/lib/toast-context'
import { extractError } from '@/lib/utils'
import { buildLineFreqIndex } from '../views/line-freq.view'
import type { PendingAddEntry, PendingAddTrip, PendingAddDeadrun, PendingAddInterval } from '../components/AddTripModal'
import type { IntervalType } from '../components/AddIntervalModal'
import type { VehiclePlanGanttData, TripConstraints, GanttBlock, GanttBlockDeadrun, GanttBlockInterval } from '../views/vehicles.view'
import { resolveCycleWindow } from '../views/vehicles.view'
import { createVehiclesActionSpec, canAddAccess, canAddReturn } from '../views/vehicles.actions'
import type { Selection, RowHintEntry } from '../engine/gantt.types'
import { getTravelTime } from '../travel-time'

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

// A BlockInterval has no FK to the trip it belongs to — the link is positional
// (nearest preceding productive trip in the block's chronological sequence).
// Mirrors apps/api/.../vehicle-plan/block-interval.utils.ts on the backend.
// See docs/proposal/vehicle-plan-block-intervals.md §2.2/§7.1.
export function findAnchoredBreakIds(block: GanttBlock, tripIds: string[]): string[] {
  if (tripIds.length === 0 || block.blockIntervals.length === 0) return []
  const tripIdSet = new Set(tripIds)
  const sortedTrips = [...block.blockTrips].sort((a, b) => a.trip.departureMinutes - b.trip.departureMinutes)

  const anchored: string[] = []
  for (const bi of block.blockIntervals) {
    let anchorTripId: string | null = null
    for (const bt of sortedTrips) {
      if (bt.trip.arrivalMinutes <= bi.departureMinutes) anchorTripId = bt.trip.id
      else break
    }
    if (anchorTripId && tripIdSet.has(anchorTripId)) anchored.push(bi.id)
  }
  return anchored
}

export type DepotModal  = { kind: 'access' | 'return'; blockTripId: string; blockId: string }
export type AddIntervalModalState = { blockTripId: string; blockId: string }
export type TripPatch   = { departureMinutes?: number; arrivalMinutes?: number; constraints?: TripConstraints | null }
export type DeadrunPatch = { departureMinutes?: number; arrivalMinutes?: number }
type IntervalPatch = { departureMinutes?: number; arrivalMinutes?: number }
type PendingMove = { blockTripIds: string[]; breakIds: string[]; deadrunIds: string[]; fromBlockId: string; toBlockId: string }
export type PendingLineSchedulePin = { lineId: string; lineScheduleId: string }

interface UseGanttEditorParams {
  id:           string
  canEdit:      boolean
  ganttData:    VehiclePlanGanttData | undefined
  refetchGantt: () => Promise<unknown>
  setIsPending: (v: boolean) => void
}

export function useGanttEditor({ id, canEdit, ganttData, refetchGantt, setIsPending }: UseGanttEditorParams) {
  const { toast } = useToast()
  const confirm    = useConfirm()

  const [selection,             setSelection]             = useState<Selection | null>(null)
  const [depotModal,            setDepotModal]            = useState<DepotModal | null>(null)
  const [addIntervalModal,      setAddIntervalModal]      = useState<AddIntervalModalState | null>(null)
  const [moveTargetBlockId,     setMoveTargetBlockId]     = useState<string | null>(null)
  const [pendingMoves,          setPendingMoves]          = useState<PendingMove[]>([])
  const [pendingChanges,        setPendingChanges]        = useState<Map<string, TripPatch>>(new Map())
  const [pendingDeadrunChanges, setPendingDeadrunChanges] = useState<Map<string, DeadrunPatch>>(new Map())
  const [pendingIntervalChanges,setPendingIntervalChanges]= useState<Map<string, IntervalPatch>>(new Map())
  const [pendingAdds,           setPendingAdds]           = useState<PendingAddEntry[]>([])
  const [pendingDeletes,        setPendingDeletes]        = useState<Set<string>>(new Set())
  const [pendingDeadrunDeletes, setPendingDeadrunDeletes] = useState<Set<string>>(new Set())
  const [pendingIntervalDeletes,setPendingIntervalDeletes]= useState<Set<string>>(new Set())
  // Empty blocks created via "Novo bloco" (q+w+n) — pure UI placeholders, keyed by
  // their own tempId rather than a trip's, so they render as an empty row before
  // anything is added into them. Never sent to apply-diff: a still-empty one on
  // Salvar simply has no pendingAdds entry referencing it and is dropped.
  const [pendingNewBlockIds,    setPendingNewBlockIds]    = useState<string[]>([])
  // Pins which LineSchedule version governs a line within this plan — set by
  // SwitchLineScheduleModal alongside the trip adds/deletes it stages, travels with
  // the rest of the diff on Salvar (see applyDiff's lineSchedulePins step) instead
  // of writing VehiclePlanLine immediately, so a Descartar never leaves the line
  // pinned to a schedule whose departures don't match what's actually persisted.
  const [pendingLineSchedulePin, setPendingLineSchedulePin] = useState<PendingLineSchedulePin | null>(null)
  const [editBarOpen,       setEditBarOpen]       = useState(false)
  const [focusedSegId,      setFocusedSegId]      = useState<string | null>(null)
  // Dedicated to Save (separate from the generic isPending, shared with the
  // solver) — the page uses isSaving to show a spinner overlay only while the
  // pending state is being persisted, without mixing with the Otimizar UI.
  const [isSaving,          setIsSaving]          = useState(false)

  // ── trip-sequence selection (shift+pagedown/pageup) — anchor + current focus
  // form a range over allTrips filtered by direction (same traversal as plain
  // pagedown), crossing blocks freely. Independent of `selection`, which only
  // forms a range within the same row/block — see discussion in docs/TODO.md.
  const [tripSeqAnchor, setTripSeqAnchor] = useState<string | null>(null)

  // Lines selection for display — checked lines are plotted immediately
  const [selectedLineIds, setSelectedLineIds] = useState<Set<string>>(new Set())

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
    if (pendingChanges.size === 0 && pendingDeadrunChanges.size === 0 && pendingIntervalChanges.size === 0 && pendingAdds.length === 0 && pendingDeletes.size === 0 && pendingDeadrunDeletes.size === 0 && pendingIntervalDeletes.size === 0 && pendingMoves.length === 0 && pendingNewBlockIds.length === 0) return plottedData

    const maxBlockNumber = plottedData.blocks.reduce((max, b) => Math.max(max, b.blockNumber), 0)
    let extraBlockCount  = 0

    let blocks = plottedData.blocks.map(b => {
      const addTrips    = pendingAdds.filter((a): a is PendingAddTrip     => a._kind === 'trip'    && a.blockId === b.id)
      const addDeadruns = pendingAdds.filter((a): a is PendingAddDeadrun  => a._kind === 'deadrun' && a.blockId === b.id)
      const addBreaks   = pendingAdds.filter((a): a is PendingAddInterval => a._kind === 'break'   && a.blockId === b.id)
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
            type:                  (a.type ?? 'DISPLACEMENT') as GanttBlockDeadrun['type'],
            originLocalityId:      a.originLocality.id,
            destinationLocalityId: a.destinationLocality.id,
            originLocality:        a.originLocality,
            destinationLocality:   a.destinationLocality,
            departureMinutes:      a.departureMinutes,
            arrivalMinutes:        a.arrivalMinutes,
          })),
          ...addTrips.flatMap(buildFakeAccessReturn),
        ],
        blockIntervals: [
          ...b.blockIntervals.filter(bi => !pendingIntervalDeletes.has(bi.id)).map(bi => {
            const patch = pendingIntervalChanges.get(bi.id)
            if (!patch) return bi
            return { ...bi, ...patch }
          }),
          ...addBreaks.map(a => ({
            id:             a._tempId,
            intervalTypeId: a.intervalTypeId,
            intervalType: {
              id:         a.intervalTypeId,
              code:       a.intervalTypeCode,
              name:       a.intervalTypeName,
              isPaid:     a.isPaid,
              minMinutes: a.minMinutes,
              maxMinutes: a.maxMinutes,
            },
            departureMinutes: a.departureMinutes,
            arrivalMinutes:   a.arrivalMinutes,
          })),
        ],
      }
    })

    // Fake blocks for pending adds targeting a new block. blockId is either 'new'
    // (spawn a fresh block, keyed by its own tempId) or `pending:<key>` (join a
    // fake block created by an earlier 'new' add, or an empty block created via
    // handleCreateEmptyBlock — picked from the Bloco select).
    const firstBlock = plottedData.blocks[0]
    const fakeGroups = new Map<string, PendingAddEntry[]>()
    for (const blockId of pendingNewBlockIds) fakeGroups.set(blockId, [])
    for (const a of pendingAdds) {
      if (a.blockId === 'new') {
        fakeGroups.set(a._tempId, [a])
      } else if (a.blockId.startsWith('pending:')) {
        fakeGroups.get(a.blockId.slice('pending:'.length))?.push(a)
      }
    }

    const fakeBlocks: GanttBlock[] = Array.from(fakeGroups.entries()).map(([key, entries]) => {
      extraBlockCount++
      const addTrips    = entries.filter((a): a is PendingAddTrip     => a._kind === 'trip')
      const addDeadruns = entries.filter((a): a is PendingAddDeadrun  => a._kind === 'deadrun')
      const addBreaks   = entries.filter((a): a is PendingAddInterval => a._kind === 'break')
      return {
        id:          `pending:${key}`,
        blockNumber: maxBlockNumber + extraBlockCount,
        vehicleType: firstBlock?.vehicleType ?? '',
        branchId:    firstBlock?.branchId    ?? null,
        branch:      firstBlock?.branch      ?? null,
        depotId:     firstBlock?.depotId     ?? '',
        depot:       firstBlock?.depot       ?? { id: '', name: '' },
        constraints: null,
        summary:     null,
        blockTrips: addTrips.map(a => ({
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
        })),
        blockDeadruns: [
          ...addDeadruns.map(a => ({
            id:                    a._tempId,
            type:                  (a.type ?? 'DISPLACEMENT') as GanttBlockDeadrun['type'],
            originLocalityId:      a.originLocality.id,
            destinationLocalityId: a.destinationLocality.id,
            originLocality:        a.originLocality,
            destinationLocality:   a.destinationLocality,
            departureMinutes:      a.departureMinutes,
            arrivalMinutes:        a.arrivalMinutes,
          })),
          ...addTrips.flatMap(buildFakeAccessReturn),
        ],
        blockIntervals: addBreaks.map(a => ({
          id:             a._tempId,
          intervalTypeId: a.intervalTypeId,
          intervalType: {
            id:         a.intervalTypeId,
            code:       a.intervalTypeCode,
            name:       a.intervalTypeName,
            isPaid:     a.isPaid,
            minMinutes: a.minMinutes,
            maxMinutes: a.maxMinutes,
          },
          departureMinutes: a.departureMinutes,
          arrivalMinutes:   a.arrivalMinutes,
        })),
      }
    })

    // Apply pending block moves. Runs over blocks + fakeBlocks together — a move's
    // toBlockId (or, after a chained re-move, fromBlockId) can point at a still-
    // pending 'pending:<tempId>' fake block, so fakeBlocks must be reachable here
    // too or a move into/out of an unsaved new block silently loses the trip.
    let allBlocks = [...blocks, ...fakeBlocks]

    if (pendingMoves.length > 0) {
      const blockMap          = new Map(allBlocks.map(b => [b.id, b]))
      const awayByBlock       = new Map<string, Set<string>>()
      const awayBreaksByBlock = new Map<string, Set<string>>()
      const awayDeadrunsByBlock = new Map<string, Set<string>>()
      for (const move of pendingMoves) {
        if (!awayByBlock.has(move.fromBlockId)) awayByBlock.set(move.fromBlockId, new Set())
        for (const id of move.blockTripIds) awayByBlock.get(move.fromBlockId)!.add(id)
        if (!awayBreaksByBlock.has(move.fromBlockId)) awayBreaksByBlock.set(move.fromBlockId, new Set())
        for (const id of move.breakIds) awayBreaksByBlock.get(move.fromBlockId)!.add(id)
        if (!awayDeadrunsByBlock.has(move.fromBlockId)) awayDeadrunsByBlock.set(move.fromBlockId, new Set())
        for (const id of move.deadrunIds) awayDeadrunsByBlock.get(move.fromBlockId)!.add(id)
      }
      allBlocks = allBlocks.map(block => {
        const awayIds      = awayByBlock.get(block.id) ?? new Set<string>()
        const awayBreakIds = awayBreaksByBlock.get(block.id) ?? new Set<string>()
        const awayDeadrunIds = awayDeadrunsByBlock.get(block.id) ?? new Set<string>()
        const movedIn = pendingMoves
          .filter(m => m.toBlockId === block.id)
          .flatMap(m => {
            const fromBlock = blockMap.get(m.fromBlockId)
            if (!fromBlock) return []
            return m.blockTripIds
              .map(id => fromBlock.blockTrips.find(bt => bt.id === id))
              .filter((bt): bt is NonNullable<typeof bt> => bt != null)
          })
        const movedInBreaks = pendingMoves
          .filter(m => m.toBlockId === block.id)
          .flatMap(m => {
            const fromBlock = blockMap.get(m.fromBlockId)
            if (!fromBlock) return []
            return m.breakIds
              .map(id => fromBlock.blockIntervals.find(bi => bi.id === id))
              .filter((bi): bi is NonNullable<typeof bi> => bi != null)
          })
        const movedInDeadruns = pendingMoves
          .filter(m => m.toBlockId === block.id)
          .flatMap(m => {
            const fromBlock = blockMap.get(m.fromBlockId)
            if (!fromBlock) return []
            return m.deadrunIds
              .map(id => fromBlock.blockDeadruns.find(dr => dr.id === id))
              .filter((dr): dr is NonNullable<typeof dr> => dr != null)
          })
        return {
          ...block,
          blockTrips:     [...block.blockTrips.filter(bt => !awayIds.has(bt.id)), ...movedIn],
          blockIntervals: [...block.blockIntervals.filter(bi => !awayBreakIds.has(bi.id)), ...movedInBreaks],
          blockDeadruns:  [...block.blockDeadruns.filter(dr => !awayDeadrunIds.has(dr.id)), ...movedInDeadruns],
        }
      })
    }

    // A block with no trips left will already be deleted by the server on Save
    // (removeTripsFromPlan deletes the VehicleBlock once blockTrips hits zero) —
    // hide it from the merged view now so it doesn't linger as a "ghost" row until then.
    // Exception: blocks freshly created via handleCreateEmptyBlock are *meant* to
    // start empty — they haven't lost trips, they never had any yet.
    const freshEmptyBlockIds = new Set(pendingNewBlockIds.map(bid => `pending:${bid}`))
    const visibleBlocks = allBlocks.filter(b => b.blockTrips.length > 0 || freshEmptyBlockIds.has(b.id))

    return { ...plottedData, blocks: visibleBlocks }
  }, [plottedData, pendingChanges, pendingDeadrunChanges, pendingIntervalChanges, pendingAdds, pendingDeletes, pendingDeadrunDeletes, pendingIntervalDeletes, pendingMoves, pendingNewBlockIds])

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
      ...block.blockTrips.map(bt     => ({ segId: bt.id,           dep: bt.trip.departureMinutes })),
      ...block.blockDeadruns.map(dr  => ({ segId: `${dr.id}:dr`,   dep: dr.departureMinutes })),
      ...block.blockIntervals.map(bi => ({ segId: `${bi.id}:bk`,   dep: bi.departureMinutes })),
    ].sort((a, b) => a.dep - b.dep))
  }, [mergedPlottedData])

  // shift+pagedown/pageup range: window [anchor, focus] over allTrips,
  // restricted to the anchor's direction — same traversal (all lines) plain
  // pagedown already does, just materialized as a set for highlighting.
  const tripSeqRangeIds = useMemo(() => {
    if (!tripSeqAnchor || !focusedSegId) return null
    const anchorIdx = allTrips.findIndex(t => t.segId === tripSeqAnchor)
    const focusIdx   = allTrips.findIndex(t => t.segId === focusedSegId)
    if (anchorIdx === -1 || focusIdx === -1) return null
    const dir = allTrips[anchorIdx].direction
    const lo = Math.min(anchorIdx, focusIdx)
    const hi = Math.max(anchorIdx, focusIdx)
    const ids = new Set<string>()
    for (let i = lo; i <= hi; i++) {
      if (allTrips[i].direction === dir) ids.add(allTrips[i].segId)
    }
    return ids
  }, [tripSeqAnchor, focusedSegId, allTrips])

  // tripSeqRangeIds trips materialized with data for headway distribution
  // (q+space): only operates over a single line — the headway concept
  // (see computeHeadway/LineFreqPanel) is per line+direction, so mixing
  // lines here would produce an operationally meaningless spacing.
  const headwayRangeInfo = useMemo(() => {
    if (!mergedPlottedData || !tripSeqRangeIds || tripSeqRangeIds.size < 3) return null
    const trips: Array<{ segId: string; tripId: string; lineId: string; blockId: string; dep: number; arr: number }> = []
    for (const block of mergedPlottedData.blocks) {
      for (const bt of block.blockTrips) {
        if (tripSeqRangeIds.has(bt.id)) {
          trips.push({
            segId:   bt.id,
            tripId:  bt.trip.id,
            lineId:  bt.trip.route.line.id,
            blockId: block.id,
            dep:     bt.trip.departureMinutes,
            arr:     bt.trip.arrivalMinutes,
          })
        }
      }
    }
    if (trips.length < 3) return null
    trips.sort((a, b) => a.dep - b.dep)
    const singleLine = new Set(trips.map(t => t.lineId)).size === 1
    return { trips, singleLine }
  }, [mergedPlottedData, tripSeqRangeIds])

  // Index for LineFreqPanel — same Gantt data, grouped by line/direction with
  // headway pre-computed in a single pass (see line-freq.view.ts). The panel
  // is read-only: it locates the focusedSegId's line/direction/position in
  // O(1) via segIndex, with no focus/selection state of its own.
  const freqIndex = useMemo(
    () => mergedPlottedData ? buildLineFreqIndex(mergedPlottedData) : null,
    [mergedPlottedData],
  )

  // Focus/selection can go stale when the data underneath changes (e.g. a pending
  // add gets discarded via alt+l) — without this, keyboard nav gets stuck since
  // most arrow shortcuts require a valid focus and no dangling selection.
  useEffect(() => {
    if (!editBarOpen) return
    const flatIds = new Set(navBlocks.flatMap(block => block.map(i => i.segId)))

    if (focusedSegId && !flatIds.has(focusedSegId)) {
      setFocusedSegId(navBlocks.find(block => block.length > 0)?.[0]?.segId ?? null)
    }

    if (tripSeqAnchor && !flatIds.has(tripSeqAnchor)) setTripSeqAnchor(null)

    if (selection) {
      const selIds = selection.type === 'trip' ? [selection.segment.id] : selection.segments.map(s => s.id)
      if (selIds.some(id => !flatIds.has(id))) setSelection(null)
    }
  }, [navBlocks, editBarOpen]) // eslint-disable-line react-hooks/exhaustive-deps

  // Reference trip for the "add trip" modal prefill: the focused trip itself, or —
  // when focus is on a rest break — the last productive trip before it in the same
  // block/vehicle (see AddTripModal's `reference` prop).
  const addTripReference = useMemo(() => {
    if (!mergedPlottedData || !focusedSegId || focusedSegId.endsWith(':dr')) return null

    if (focusedSegId.endsWith(':bk')) {
      const breakId = focusedSegId.slice(0, -3)
      for (const block of mergedPlottedData.blocks) {
        const bi = block.blockIntervals.find(bi => bi.id === breakId)
        if (!bi) continue
        const referenceTrip = block.blockTrips
          .filter(bt => bt.trip.arrivalMinutes <= bi.departureMinutes)
          .sort((a, b) => b.trip.arrivalMinutes - a.trip.arrivalMinutes)[0]
        return referenceTrip ? { block, referenceTrip } : null
      }
      return null
    }

    for (const block of mergedPlottedData.blocks) {
      const referenceTrip = block.blockTrips.find(bt => bt.id === focusedSegId)
      if (referenceTrip) return { block, referenceTrip }
    }
    return null
  }, [mergedPlottedData, focusedSegId])

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

  const pendingCount = pendingChanges.size + pendingDeadrunChanges.size + pendingIntervalChanges.size + pendingAdds.length + pendingDeletes.size + pendingDeadrunDeletes.size + pendingIntervalDeletes.size + pendingMoves.length + pendingNewBlockIds.length + (pendingLineSchedulePin ? 1 : 0)

  // Queued into pendingChanges like a time patch — mergedPlottedData already spreads
  // TripPatch onto trip, so a staged constraints value renders immediately without a
  // network call. See docs/proposal/vehicle-plan-summary-score-consolidation.md §2.5.
  function handleUpdateConstraints(tripIds: string[], patches: TripConstraints | null | TripConstraints[]) {
    if (!canEdit) return
    setPendingChanges(prev => {
      const next = new Map(prev)
      tripIds.forEach((tripId, i) => {
        const constraints = Array.isArray(patches) ? patches[i] : patches
        next.set(tripId, { ...next.get(tripId), constraints })
      })
      return next
    })
  }

  // Two passes: already-saved blocks (from ganttData — not plottedData/
  // mergedPlottedData, which are filtered to the lines currently selected for
  // display) get a new pending ACCESS/RETURN deadrun; brand-new blocks that only
  // exist as pendingAdds trips ('new'/'pending:<id>' groups — e.g. right after
  // generating a line without "incluir acesso e recolhida") get their first/last
  // PendingAddTrip patched with .access/.return directly, same shape
  // handleConfirmDepotModal already writes for a single manual pick. Nothing is
  // persisted until Salvar — same staged model as handleAdjustCycle above.
  async function handleFinalizePlan() {
    if (!canEdit || !ganttData) return

    // ── pass 1: saved blocks ──────────────────────────────────────────────────
    const alreadyPendingAccess = new Set(
      pendingAdds.filter((a): a is PendingAddDeadrun => a._kind === 'deadrun' && a.type === 'ACCESS').map(a => a.blockId),
    )
    const alreadyPendingReturn = new Set(
      pendingAdds.filter((a): a is PendingAddDeadrun => a._kind === 'deadrun' && a.type === 'RETURN').map(a => a.blockId),
    )

    type SavedCandidate = { block: typeof ganttData.blocks[0]; bt: typeof ganttData.blocks[0]['blockTrips'][0]; kind: 'ACCESS' | 'RETURN' }
    const savedCandidates: SavedCandidate[] = []
    for (const block of ganttData.blocks) {
      if (block.blockTrips.length === 0) continue
      const sorted = [...block.blockTrips].sort((a, b) => a.trip.departureMinutes - b.trip.departureMinutes)
      const first  = sorted[0]
      const last   = sorted[sorted.length - 1]
      if (canAddAccess(first, block) && !alreadyPendingAccess.has(block.id)) savedCandidates.push({ block, bt: first, kind: 'ACCESS' })
      if (canAddReturn(last, block)  && !alreadyPendingReturn.has(block.id)) savedCandidates.push({ block, bt: last,  kind: 'RETURN' })
    }

    const savedResults = await Promise.all(savedCandidates.map(async c => {
      const isAccess     = c.kind === 'ACCESS'
      const tripLocality = isAccess ? c.bt.trip.route.originLocality : c.bt.trip.route.destinationLocality
      const travelMinutes = isAccess
        ? await getTravelTime(c.block.depotId, tripLocality.id)
        : await getTravelTime(tripLocality.id, c.block.depotId)
      return { ...c, tripLocality, travelMinutes }
    }))
    const savedUsable = savedResults.filter(r => r.travelMinutes != null)
    const savedFailed = savedResults.length - savedUsable.length

    const newDeadrunEntries: PendingAddDeadrun[] = savedUsable.map(r => {
      const isAccess = r.kind === 'ACCESS'
      const depot    = { id: r.block.depotId, name: r.block.depot.name }
      const dep = isAccess ? r.bt.trip.departureMinutes - r.travelMinutes! - 1 : r.bt.trip.arrivalMinutes + 1
      const arr = isAccess ? r.bt.trip.departureMinutes - 1                    : r.bt.trip.arrivalMinutes + r.travelMinutes! + 1
      return {
        _kind: 'deadrun', _tempId: crypto.randomUUID(),
        type: r.kind, blockTripId: r.bt.id, blockId: r.block.id,
        originLocality:      isAccess ? depot : r.tripLocality,
        destinationLocality: isAccess ? r.tripLocality : depot,
        departureMinutes: dep, arrivalMinutes: arr,
      }
    })

    // ── pass 2: brand-new pending blocks — no VehicleBlock.depotId to read yet,
    // so fall back to the last existing block's depot, same as the backend does
    // when creating a block without an explicit depot (addTrip/addDeadrun/
    // addInterval in vehicle-plan.service.ts). If the plan has no saved block at
    // all, there's nothing to fall back to — those get reported as skipped.
    const lastRealBlock  = [...ganttData.blocks].sort((a, b) => b.blockNumber - a.blockNumber)[0]
    const fallbackDepotId   = lastRealBlock?.depotId
    const fallbackDepotName = lastRealBlock?.depot.name

    const pendingTripGroups = new Map<string, PendingAddTrip[]>()
    for (const a of pendingAdds) {
      if (a._kind !== 'trip') continue
      const key = a.blockId === 'new' ? a._tempId : a.blockId.startsWith('pending:') ? a.blockId.slice('pending:'.length) : null
      if (key == null) continue // trip pending-added onto an existing real block — out of scope here
      if (!pendingTripGroups.has(key)) pendingTripGroups.set(key, [])
      pendingTripGroups.get(key)!.push(a)
    }

    type PendingCandidate = { entry: PendingAddTrip; kind: 'access' | 'return' }
    const pendingCandidates: PendingCandidate[] = []
    let skippedNoDepot = 0
    for (const entries of pendingTripGroups.values()) {
      const sorted = [...entries].sort((a, b) => a.departureMinutes - b.departureMinutes)
      const first  = sorted[0]
      const last   = sorted[sorted.length - 1]
      if (!first.access) { if (!fallbackDepotId) skippedNoDepot++; else pendingCandidates.push({ entry: first, kind: 'access' }) }
      if (!last.return)  { if (!fallbackDepotId) skippedNoDepot++; else pendingCandidates.push({ entry: last,  kind: 'return' }) }
    }

    const pendingResults = await Promise.all(pendingCandidates.map(async c => {
      const isAccess = c.kind === 'access'
      const travelMinutes = isAccess
        ? await getTravelTime(fallbackDepotId!, c.entry.originLocality.id)
        : await getTravelTime(c.entry.destinationLocality.id, fallbackDepotId!)
      return { ...c, travelMinutes }
    }))
    const pendingUsable = pendingResults.filter(r => r.travelMinutes != null)
    const pendingFailed = pendingResults.length - pendingUsable.length

    const totalFailed = savedFailed + pendingFailed + skippedNoDepot

    if (newDeadrunEntries.length === 0 && pendingUsable.length === 0) {
      if (totalFailed > 0) toast.error(`Nenhuma lacuna pôde ser preparada — ${totalFailed} sem garagem ou mapeamento de viagem compatível`)
      else toast.success('Nenhuma lacuna de acesso/recolhida encontrada — plano já está completo')
      return
    }

    setPendingAdds(prev => {
      const withDeadruns = newDeadrunEntries.length > 0 ? [...prev, ...newDeadrunEntries] : prev
      if (pendingUsable.length === 0) return withDeadruns
      // Separate maps per kind — a single-trip block can need both access AND
      // return on the very same PendingAddTrip, with different travel times
      // (depot→origin vs destination→depot), so neither can short-circuit the other.
      const accessTravelByTempId = new Map(pendingUsable.filter(r => r.kind === 'access').map(r => [r.entry._tempId, r.travelMinutes!]))
      const returnTravelByTempId = new Map(pendingUsable.filter(r => r.kind === 'return').map(r => [r.entry._tempId, r.travelMinutes!]))
      return withDeadruns.map(a => {
        if (a._kind !== 'trip') return a
        let patched = a
        const accessTravel = accessTravelByTempId.get(a._tempId)
        if (accessTravel != null) patched = { ...patched, access: { localityId: fallbackDepotId!, travelMinutes: accessTravel } }
        const returnTravel = returnTravelByTempId.get(a._tempId)
        if (returnTravel != null) patched = { ...patched, return: { localityId: fallbackDepotId!, travelMinutes: returnTravel } }
        return patched
      })
    })

    const accessCount = newDeadrunEntries.filter(e => e.type === 'ACCESS').length + pendingUsable.filter(r => r.kind === 'access').length
    const returnCount = newDeadrunEntries.filter(e => e.type === 'RETURN').length + pendingUsable.filter(r => r.kind === 'return').length
    const parts = [
      accessCount > 0 ? `${accessCount} ${accessCount === 1 ? 'acesso' : 'acessos'}`       : null,
      returnCount > 0 ? `${returnCount} ${returnCount === 1 ? 'recolhida' : 'recolhidas'}` : null,
    ].filter(Boolean).join(' e ')
    toast.success(`${parts} preparados` + (fallbackDepotName && pendingUsable.length > 0 ? ` (novos blocos usando garagem ${fallbackDepotName})` : '') + ' — use Salvar para persistir'
      + (totalFailed > 0 ? ` (${totalFailed} sem garagem ou mapeamento compatível)` : ''))
  }

  function handleAdjustCycle() {
    if (!plottedData || !canEdit) return

    const overrides   = new Map<string, TripPatch>()
    const drOverrides = new Map<string, DeadrunPatch>()
    const bkOverrides = new Map<string, IntervalPatch>()
    let tripsWithWindow = 0

    // Process per block: a block = one vehicle.
    // Merge trips, deadruns and breaks into chronological order so deadruns/breaks
    // shift automatically when the preceding trip's arrival extends.
    for (const block of plottedData.blocks) {
      type TripItem    = { kind: 'trip';    dep: number; bt: typeof block.blockTrips[0] }
      type DrItem      = { kind: 'deadrun'; dep: number; dr: typeof block.blockDeadruns[0] }
      type BkItem      = { kind: 'break';   dep: number; bi: typeof block.blockIntervals[0] }
      type BlockItem   = TripItem | DrItem | BkItem

      const items: BlockItem[] = [
        ...block.blockTrips.map(bt     => ({ kind: 'trip'    as const, dep: bt.trip.departureMinutes, bt })),
        ...block.blockDeadruns.map(dr  => ({ kind: 'deadrun' as const, dep: dr.departureMinutes,      dr })),
        ...block.blockIntervals.map(bi => ({ kind: 'break'   as const, dep: bi.departureMinutes,      bi })),
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
          const cycleWindow  = resolveCycleWindow(trip.route.line.metrics, ganttData?.plan.dayType?.code ?? 'U', trip.route.direction, effectiveDep)
          const cycleMinutes = cycleWindow?.minutes ?? null
          if (cycleWindow) tripsWithWindow++
          const newArrival = cycleMinutes != null
            ? effectiveDep + cycleMinutes
            : effectiveDep + (trip.arrivalMinutes - trip.departureMinutes)

          const patch: TripPatch = {}
          if (effectiveDep !== trip.departureMinutes) patch.departureMinutes = effectiveDep
          if (newArrival   !== trip.arrivalMinutes)   patch.arrivalMinutes   = newArrival
          if (Object.keys(patch).length > 0) overrides.set(trip.id, { ...overrides.get(trip.id), ...patch })

          prevArrival = newArrival
          // If next item is another trip (no deadrun between them), enforce the route headway.
          // If next item is a deadrun, set interval=0 — the deadrun itself is the gap.
          pendingInterval = (nextItem?.kind === 'trip' && cycleWindow) ? cycleWindow.intervalMinutes : 0

        } else if (item.kind === 'deadrun') {
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
        } else {
          // Break: same treatment as deadrun — lives attached to whatever trip
          // precedes it, so it follows prevArrival and keeps its own duration.
          const { bi } = item
          const duration = bi.arrivalMinutes - bi.departureMinutes
          const newDep   = prevArrival !== -Infinity ? prevArrival : bi.departureMinutes
          const newArr   = newDep + duration

          const bpatch: IntervalPatch = {}
          if (newDep !== bi.departureMinutes) bpatch.departureMinutes = newDep
          if (newArr !== bi.arrivalMinutes)   bpatch.arrivalMinutes   = newArr
          if (Object.keys(bpatch).length > 0) bkOverrides.set(bi.id, bpatch)

          prevArrival     = newArr
          pendingInterval = 0
        }
      }
    }

    setPendingChanges(overrides)
    setPendingDeadrunChanges(drOverrides)
    setPendingIntervalChanges(bkOverrides)

    const tripCount    = overrides.size
    const deadrunCount = drOverrides.size
    const breakCount   = bkOverrides.size
    if (tripCount > 0 || deadrunCount > 0 || breakCount > 0) {
      const parts = [
        tripCount    > 0 ? `${tripCount} ${tripCount === 1 ? 'viagem' : 'viagens'}`       : null,
        deadrunCount > 0 ? `${deadrunCount} ${deadrunCount === 1 ? 'vazio' : 'vazios'}`   : null,
        breakCount   > 0 ? `${breakCount} ${breakCount === 1 ? 'intervalo' : 'intervalos'}` : null,
      ].filter(Boolean).join(' e ')
      toast.success(`${parts} ajustados — use Salvar para persistir`)
    } else if (tripsWithWindow > 0) {
      toast.success('Ciclo já está correto em todas as viagens — nenhuma alteração realizada')
    } else {
      toast.error('Nenhuma viagem com ciclo configurado encontrada')
    }
  }

  // Evenly distributes the headway of the trips in the selected range
  // (shift+pagedown/pageup), keeping the range's first and last trip fixed
  // as anchors. Doesn't touch cycle time (each trip's dep→arr duration is
  // preserved, only the whole pair shifts) — a future setting will allow
  // this function some margin to also adjust the cycle.
  //
  // A deadrun/break sitting next to the trip being moved isn't a wall — it's
  // dead time for the same vehicle, so it gets pushed along by the same
  // delta. Only another productive trip (a different service this vehicle
  // also has to keep, walked past any deadruns/breaks in between) is a hard
  // boundary.
  //
  // Accepted simplification: each trip's bounds come from its own block's
  // current neighboring trip, without accounting for that neighbor possibly
  // being another trip from the range that already moved — a rare case (two
  // trips from the same range are unlikely to be adjacent on the same
  // vehicle, since direction alternates every productive trip).
  function handleDistributeHeadway() {
    if (!canEdit || !mergedPlottedData || !headwayRangeInfo) return

    if (!headwayRangeInfo.singleLine) {
      toast.error('O intervalo selecionado mistura mais de uma linha — distribua o headway com um intervalo de uma única linha')
      return
    }

    const rangeTrips = headwayRangeInfo.trips
    const tempTripIds = new Set(pendingAdds.filter(a => a._kind === 'trip').map(a => a._tempId))
    if (rangeTrips.some(t => tempTripIds.has(t.segId))) {
      toast.error('Salve as viagens novas do intervalo antes de distribuir o headway')
      return
    }

    const n        = rangeTrips.length
    const firstDep = rangeTrips[0].dep
    const lastDep  = rangeTrips[n - 1].dep
    const idealGap = (lastDep - firstDep) / (n - 1)

    function blockTimeline(blockId: string) {
      const block = mergedPlottedData!.blocks.find(b => b.id === blockId)!
      return [
        ...block.blockTrips.map(bt     => ({ kind: 'trip' as const,    id: bt.id, dep: bt.trip.departureMinutes, arr: bt.trip.arrivalMinutes })),
        ...block.blockDeadruns.map(dr  => ({ kind: 'deadrun' as const, id: dr.id, dep: dr.departureMinutes,      arr: dr.arrivalMinutes })),
        ...block.blockIntervals.map(bi => ({ kind: 'break' as const,   id: bi.id, dep: bi.departureMinutes,     arr: bi.arrivalMinutes })),
      ].sort((a, b) => a.dep - b.dep)
    }

    const overrides      = new Map(pendingChanges)
    const drOverrides     = new Map(pendingDeadrunChanges)
    const bkOverrides     = new Map(pendingIntervalChanges)
    const tempDeadrunIds = new Set(pendingAdds.filter(a => a._kind === 'deadrun').map(a => a._tempId))
    const tempBreakIds   = new Set(pendingAdds.filter(a => a._kind === 'break').map(a => a._tempId))
    const tempDeadrunUpdates = new Map<string, { dep: number; arr: number }>()
    const tempBreakUpdates   = new Map<string, { dep: number; arr: number }>()

    // Mirrors setDr/setBk from handleTripTimingOp below — same diff-against-
    // ganttData pattern, kept local here since this call needs to batch
    // several pushes per trip instead of a single marked-item shift.
    function pushDr(drId: string, dep: number, arr: number) {
      if (tempDeadrunIds.has(drId)) { tempDeadrunUpdates.set(drId, { dep, arr }); return }
      if (drId.endsWith(':access') || drId.endsWith(':return')) return
      const orig = ganttData?.blocks.flatMap(b => b.blockDeadruns).find(dr => dr.id === drId)
      const patch: DeadrunPatch = {}
      if (!orig || dep !== orig.departureMinutes) patch.departureMinutes = dep
      if (!orig || arr !== orig.arrivalMinutes)   patch.arrivalMinutes   = arr
      if (Object.keys(patch).length) drOverrides.set(drId, patch)
      else drOverrides.delete(drId)
    }

    function pushBk(bkId: string, dep: number, arr: number) {
      if (tempBreakIds.has(bkId)) { tempBreakUpdates.set(bkId, { dep, arr }); return }
      const orig = ganttData?.blocks.flatMap(b => b.blockIntervals).find(bi => bi.id === bkId)
      const patch: IntervalPatch = {}
      if (!orig || dep !== orig.departureMinutes) patch.departureMinutes = dep
      if (!orig || arr !== orig.arrivalMinutes)   patch.arrivalMinutes   = arr
      if (Object.keys(patch).length) bkOverrides.set(bkId, patch)
      else bkOverrides.delete(bkId)
    }

    let movedCount    = 0
    let strandedCount = 0

    for (let i = 1; i < n - 1; i++) {
      const rt       = rangeTrips[i]
      const duration = rt.arr - rt.dep
      const idealDep = Math.round(firstDep + i * idealGap)

      const timeline = blockTimeline(rt.blockId)
      const ownIdx   = timeline.findIndex(it => it.kind === 'trip' && it.id === rt.segId)

      // Walk past any deadruns/breaks on each side — they're not the boundary,
      // the nearest actual trip is.
      let lo = ownIdx - 1
      while (lo >= 0 && timeline[lo].kind !== 'trip') lo--
      let hi = ownIdx + 1
      while (hi < timeline.length && timeline[hi].kind !== 'trip') hi++

      // Keeps a 1min gap against the bounding trip — can't touch (end == next's start).
      const lowerBound = lo >= 0              ? timeline[lo].arr + 1            : -Infinity
      const upperBound = hi < timeline.length ? timeline[hi].dep - duration - 1 : Infinity

      if (lowerBound > upperBound) { strandedCount++; continue }

      const newDep = Math.min(Math.max(idealDep, lowerBound), upperBound)
      if (newDep === rt.dep) continue

      const delta = newDep - rt.dep
      movedCount++
      overrides.set(rt.tripId, { ...overrides.get(rt.tripId), departureMinutes: newDep, arrivalMinutes: newDep + duration })

      const pushRange = delta > 0
        ? Array.from({ length: hi - ownIdx - 1 }, (_, k) => ownIdx + 1 + k)
        : Array.from({ length: ownIdx - lo - 1 }, (_, k) => ownIdx - 1 - k)
      for (const j of pushRange) {
        const it = timeline[j]
        if (it.kind === 'deadrun') pushDr(it.id, it.dep + delta, it.arr + delta)
        else                       pushBk(it.id, it.dep + delta, it.arr + delta)
      }
    }

    if (movedCount === 0) {
      toast.success(strandedCount > 0
        ? 'Nenhuma viagem pôde ser movida — sem espaço entre os vizinhos de bloco'
        : 'Headway já está uniforme neste intervalo — nenhuma alteração necessária')
      return
    }

    setPendingChanges(overrides)
    setPendingDeadrunChanges(drOverrides)
    setPendingIntervalChanges(bkOverrides)
    if (tempDeadrunUpdates.size > 0 || tempBreakUpdates.size > 0) {
      setPendingAdds(prev => prev.map(a => {
        if (a._kind === 'deadrun' && tempDeadrunUpdates.has(a._tempId)) {
          const u = tempDeadrunUpdates.get(a._tempId)!
          return { ...a, departureMinutes: u.dep, arrivalMinutes: u.arr }
        }
        if (a._kind === 'break' && tempBreakUpdates.has(a._tempId)) {
          const u = tempBreakUpdates.get(a._tempId)!
          return { ...a, departureMinutes: u.dep, arrivalMinutes: u.arr }
        }
        return a
      }))
    }
    toast.success('Viagens distribuídas')
  }

  const handleTripTimingOp = useCallback((
    op: 'grow' | 'shrink' | 'push' | 'pull' | 'growOnly' | 'shrinkOnly' | 'pushOnly' | 'pullOnly' | 'extendToNext',
  ) => {
    if (!canEdit || !mergedPlottedData || !focusedSegId || focusedSegId.endsWith(':dr')) return

    const isBreakFocus = focusedSegId.endsWith(':bk')
    const breakId       = isBreakFocus ? focusedSegId.slice(0, -3) : null

    let foundBlock: typeof mergedPlottedData.blocks[0] | null = null
    for (const block of mergedPlottedData.blocks) {
      const hasFocused = isBreakFocus
        ? block.blockIntervals.some(bi => bi.id === breakId)
        : block.blockTrips.some(bt => bt.id === focusedSegId)
      if (hasFocused) { foundBlock = block; break }
    }
    if (!foundBlock) return

    type TItem = { kind: 'trip';    id: string; tripId: string; dep: number; arr: number }
    type DItem = { kind: 'deadrun'; id: string; drId:  string;  dep: number; arr: number }
    type BItem = { kind: 'break';   id: string; bkId:  string;  dep: number; arr: number }
    type Item  = TItem | DItem | BItem

    const items: Item[] = [
      ...foundBlock.blockTrips.map(bt => ({
        kind: 'trip' as const, id: bt.id, tripId: bt.trip.id,
        dep: bt.trip.departureMinutes, arr: bt.trip.arrivalMinutes,
      })),
      ...foundBlock.blockDeadruns.map(dr => ({
        kind: 'deadrun' as const, id: dr.id, drId: dr.id,
        dep: dr.departureMinutes, arr: dr.arrivalMinutes,
      })),
      ...foundBlock.blockIntervals.map(bi => ({
        kind: 'break' as const, id: bi.id, bkId: bi.id,
        dep: bi.departureMinutes, arr: bi.arrivalMinutes,
      })),
    ].sort((a, b) => a.dep - b.dep)

    const markedIdx = isBreakFocus
      ? items.findIndex(i => i.kind === 'break' && i.id === breakId)
      : items.findIndex(i => i.kind === 'trip'  && i.id === focusedSegId)
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
    const nextItem    = markedIdx + 1 < items.length ? items[markedIdx + 1] : null
    const subsequent = items.slice(markedIdx + 1)

    const newTrips = new Map(pendingChanges)
    const newDrs   = new Map(pendingDeadrunChanges)
    const newBks   = new Map(pendingIntervalChanges)

    // Pending (not-yet-persisted) trips/deadruns/breaks have no counterpart in
    // ganttData to diff/patch against — they live as full objects in pendingAdds
    // instead, so timing ops write straight into that array for them.
    const tempTripIds    = new Set(pendingAdds.filter(a => a._kind === 'trip').map(a => `${a._tempId}:trip`))
    const tempDeadrunIds = new Set(pendingAdds.filter(a => a._kind === 'deadrun').map(a => a._tempId))
    const tempBreakIds   = new Set(pendingAdds.filter(a => a._kind === 'break').map(a => a._tempId))

    const tempTripUpdates    = new Map<string, { dep: number; arr: number }>()
    const tempDeadrunUpdates = new Map<string, { dep: number; arr: number }>()
    const tempBreakUpdates   = new Map<string, { dep: number; arr: number }>()

    function setTrip(tripId: string, dep: number, arr: number) {
      if (tempTripIds.has(tripId)) {
        tempTripUpdates.set(tripId.slice(0, -':trip'.length), { dep, arr })
        return
      }
      const orig = ganttData?.blocks.flatMap(b => b.blockTrips).find(bt => bt.trip.id === tripId)?.trip
      const patch: TripPatch = {}
      if (!orig || dep !== orig.departureMinutes) patch.departureMinutes = dep
      if (!orig || arr !== orig.arrivalMinutes)   patch.arrivalMinutes   = arr
      if (Object.keys(patch).length) newTrips.set(tripId, patch)
      else newTrips.delete(tripId)
    }

    function setDr(drId: string, dep: number, arr: number) {
      if (tempDeadrunIds.has(drId)) {
        tempDeadrunUpdates.set(drId, { dep, arr })
        return
      }
      // Access/return deadruns synthesized for a pending trip (buildFakeAccessReturn)
      // have no independent existence — they're recomputed from the trip's own
      // departure/arrival every render, so shifting the trip is enough.
      if (drId.endsWith(':access') || drId.endsWith(':return')) return
      const orig = ganttData?.blocks.flatMap(b => b.blockDeadruns).find(dr => dr.id === drId)
      const patch: DeadrunPatch = {}
      if (!orig || dep !== orig.departureMinutes) patch.departureMinutes = dep
      if (!orig || arr !== orig.arrivalMinutes)   patch.arrivalMinutes   = arr
      if (Object.keys(patch).length) newDrs.set(drId, patch)
      else newDrs.delete(drId)
    }

    function setBk(bkId: string, dep: number, arr: number) {
      if (tempBreakIds.has(bkId)) {
        tempBreakUpdates.set(bkId, { dep, arr })
        return
      }
      const orig = ganttData?.blocks.flatMap(b => b.blockIntervals).find(bi => bi.id === bkId)
      const patch: IntervalPatch = {}
      if (!orig || dep !== orig.departureMinutes) patch.departureMinutes = dep
      if (!orig || arr !== orig.arrivalMinutes)   patch.arrivalMinutes   = arr
      if (Object.keys(patch).length) newBks.set(bkId, patch)
      else newBks.delete(bkId)
    }

    function shiftSubsequent(delta: number) {
      for (const item of subsequent) {
        if (item.kind === 'trip')        setTrip((item as TItem).tripId, item.dep + delta, item.arr + delta)
        else if (item.kind === 'deadrun') setDr((item as DItem).drId,    item.dep + delta, item.arr + delta)
        else                              setBk((item as BItem).bkId,    item.dep + delta, item.arr + delta)
      }
    }

    // Push only the deadruns/breaks that sit between the marked trip and the next productive trip
    function pushLeadingDeadruns(delta: number) {
      for (const item of subsequent) {
        if (item.kind === 'deadrun')     setDr((item as DItem).drId, item.dep + delta, item.arr + delta)
        else if (item.kind === 'break')  setBk((item as BItem).bkId, item.dep + delta, item.arr + delta)
        else break
      }
    }

    function setMarked(dep: number, arr: number) {
      if (marked.kind === 'trip')       setTrip((marked as TItem).tripId, dep, arr)
      else if (marked.kind === 'break') setBk((marked as BItem).bkId,     dep, arr)
    }

    switch (op) {
      case 'grow': {
        setMarked(marked.dep, marked.arr + 1)
        shiftSubsequent(1)
        break
      }
      case 'shrink': {
        if (marked.arr - marked.dep <= 1) return
        if (!prevProd && itemBefore?.kind === 'deadrun')
          setDr((itemBefore as DItem).drId, itemBefore.dep - 1, itemBefore.arr - 1)
        setMarked(marked.dep, marked.arr - 1)
        shiftSubsequent(-1)
        break
      }
      case 'push': {
        setMarked(marked.dep + 1, marked.arr + 1)
        shiftSubsequent(1)
        break
      }
      case 'pull': {
        if (prevProd && marked.dep - prevProd.arr <= 1) return
        if (!prevProd && itemBefore?.kind === 'deadrun')
          setDr((itemBefore as DItem).drId, itemBefore.dep - 1, itemBefore.arr - 1)
        setMarked(marked.dep - 1, marked.arr - 1)
        shiftSubsequent(-1)
        break
      }
      case 'growOnly': {
        if (nextProd && nextProd.dep - marked.arr <= 1) return
        pushLeadingDeadruns(1)
        setMarked(marked.dep, marked.arr + 1)
        break
      }
      case 'shrinkOnly': {
        if (marked.arr - marked.dep <= 1) return
        if (prevProd && marked.dep - prevProd.arr <= 1) return
        setMarked(marked.dep, marked.arr - 1)
        break
      }
      case 'pushOnly': {
        if (nextProd && nextProd.dep - marked.arr <= 1) return
        pushLeadingDeadruns(1)
        setMarked(marked.dep + 1, marked.arr + 1)
        break
      }
      case 'pullOnly': {
        if (prevProd && marked.dep - prevProd.arr <= 1) return
        if (!prevProd && itemBefore?.kind === 'deadrun')
          setDr((itemBefore as DItem).drId, itemBefore.dep - 1, itemBefore.arr - 1)
        setMarked(marked.dep - 1, marked.arr - 1)
        break
      }
      case 'extendToNext': {
        if (marked.kind !== 'break') return
        const bi         = foundBlock.blockIntervals.find(bi => bi.id === (marked as BItem).bkId)
        const maxMinutes = bi?.intervalType.maxMinutes ?? null

        // Already over the type's cap (e.g. after the type changed) — trim back to
        // maxMinutes regardless of what's next; doesn't touch neighboring segments.
        if (maxMinutes != null && marked.arr - marked.dep > maxMinutes) {
          setBk((marked as BItem).bkId, marked.dep, marked.dep + maxMinutes)
          break
        }

        if (!nextItem) return
        const maxArr    = maxMinutes != null ? marked.dep + maxMinutes : Infinity
        const targetArr = Math.min(nextItem.dep - 1, maxArr)
        if (targetArr <= marked.arr) return
        setBk((marked as BItem).bkId, marked.dep, targetArr)
        break
      }
    }

    setPendingChanges(newTrips)
    setPendingDeadrunChanges(newDrs)
    setPendingIntervalChanges(newBks)

    if (tempTripUpdates.size > 0 || tempDeadrunUpdates.size > 0 || tempBreakUpdates.size > 0) {
      setPendingAdds(prev => prev.map(a => {
        if (a._kind === 'trip'     && tempTripUpdates.has(a._tempId)) {
          const u = tempTripUpdates.get(a._tempId)!
          return { ...a, departureMinutes: u.dep, arrivalMinutes: u.arr }
        }
        if (a._kind === 'deadrun'  && tempDeadrunUpdates.has(a._tempId)) {
          const u = tempDeadrunUpdates.get(a._tempId)!
          return { ...a, departureMinutes: u.dep, arrivalMinutes: u.arr }
        }
        if (a._kind === 'break'    && tempBreakUpdates.has(a._tempId)) {
          const u = tempBreakUpdates.get(a._tempId)!
          return { ...a, departureMinutes: u.dep, arrivalMinutes: u.arr }
        }
        return a
      }))
    }
  }, [canEdit, focusedSegId, mergedPlottedData, ganttData, pendingChanges, pendingDeadrunChanges, pendingIntervalChanges, pendingAdds])

  const handleSelectionChange = useCallback((sel: Selection | null) => {
    if (!editBarOpen) return
    setSelection(sel)
    setTripSeqAnchor(null)
    if (sel?.type === 'trip') {
      setFocusedSegId(sel.segment.id)
    }
  }, [editBarOpen])

  function handlePendingAdd(entry: PendingAddEntry) {
    if (!canEdit) return
    setPendingAdds(prev => [...prev, entry])
  }

  function handleCreateEmptyBlock() {
    if (!canEdit) return
    setPendingNewBlockIds(prev => [...prev, crypto.randomUUID()])
  }

  function clearAllPending() {
    setPendingChanges(new Map())
    setPendingDeadrunChanges(new Map())
    setPendingIntervalChanges(new Map())
    setPendingAdds([])
    setPendingDeletes(new Set())
    setPendingDeadrunDeletes(new Set())
    setPendingIntervalDeletes(new Set())
    setPendingMoves([])
    setPendingLineSchedulePin(null)
    setPendingNewBlockIds([])
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
    if (!canEdit) return
    if (pendingCount === 0) return
    const total = pendingCount
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
    if (pendingCount === 0) return
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
    if (!canEdit) return
    if (pendingCount === 0) return
    setIsPending(true)
    setIsSaving(true)
    try {
      // Deadrun/interval patches need both departureMinutes and arrivalMinutes even
      // when only one moved — fill the other in from the pristine server data.
      const deadrunUpdates = plottedData
        ? plottedData.blocks.flatMap(block =>
            block.blockDeadruns
              .filter(dr => pendingDeadrunChanges.has(dr.id))
              .map(dr => {
                const patch = pendingDeadrunChanges.get(dr.id)!
                return {
                  id:               dr.id,
                  departureMinutes: patch.departureMinutes ?? dr.departureMinutes,
                  arrivalMinutes:   patch.arrivalMinutes   ?? dr.arrivalMinutes,
                }
              }),
          )
        : []

      const intervalUpdates = plottedData
        ? plottedData.blocks.flatMap(block =>
            block.blockIntervals
              .filter(bi => pendingIntervalChanges.has(bi.id))
              .map(bi => {
                const patch = pendingIntervalChanges.get(bi.id)!
                return {
                  id:               bi.id,
                  departureMinutes: patch.departureMinutes ?? bi.departureMinutes,
                  arrivalMinutes:   patch.arrivalMinutes   ?? bi.arrivalMinutes,
                }
              }),
          )
        : []

      // Single transactional call — applies the whole diff and recalculates summary/
      // score inside one server-side transaction, or persists nothing at all on
      // failure. Replaces the old N-calls-plus-final-rescore flow. See docs/proposal/
      // vehicle-plan-summary-score-consolidation.md §2.4.
      const res = await apiFetch(`/transit/vehicle-plan/${id}/apply-diff`, {
        method:  'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          tripUpdates:     Array.from(pendingChanges.entries()).map(([tripId, patch]) => ({ id: tripId, ...patch })),
          deadrunUpdates,
          intervalUpdates,
          tripDeletes:     Array.from(pendingDeletes),
          deadrunDeletes:  Array.from(pendingDeadrunDeletes),
          intervalDeletes: Array.from(pendingIntervalDeletes),
          adds:            pendingAdds,
          moves:           pendingMoves,
          lineSchedulePins: pendingLineSchedulePin ? [pendingLineSchedulePin] : [],
        }),
      })
      if (!res.ok) {
        const j = await res.json().catch(() => ({}))
        throw new Error(extractError(j))
      }

      await refetchGantt()
      setPendingChanges(new Map())
      setPendingDeadrunChanges(new Map())
      setPendingIntervalChanges(new Map())
      setPendingAdds([])
      setPendingDeletes(new Set())
      setPendingDeadrunDeletes(new Set())
      setPendingIntervalDeletes(new Set())
      setPendingMoves([])
      setPendingLineSchedulePin(null)
      // Empty blocks never made it into `adds`, so the backend never created them —
      // drop them here too. Any that got a trip added into it already round-trips
      // as a real block through the refetch above.
      setPendingNewBlockIds([])
      // Persisted trips/breaks/deadruns get new server-generated ids, so whatever
      // was focused/selected (by temp id) no longer resolves to anything — the
      // stale-focus recovery effect (keyed off navBlocks) picks a fallback segment
      // once the refetched data lands, same as after a discard.
      toast.success('Alterações salvas')
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Erro ao salvar alterações')
    } finally {
      setIsPending(false)
      setIsSaving(false)
    }
  }

  function handleAddAccess(blockTripId: string, blockId: string) {
    if (!canEdit) return
    setDepotModal({ kind: 'access', blockTripId, blockId })
  }

  function handleAddReturn(blockTripId: string, blockId: string) {
    if (!canEdit) return
    setDepotModal({ kind: 'return', blockTripId, blockId })
  }

  function handleAddInterval(blockTripId: string, blockId: string) {
    if (!canEdit) return
    setAddIntervalModal({ blockTripId, blockId })
  }

  // Always queued as a pending add — unlike access/return, an interval has no
  // travel-time lookup to resolve, so there's nothing that requires an immediate
  // API call even for trips that already exist server-side.
  function handleConfirmAddInterval(intervalType: IntervalType) {
    if (!canEdit || !addIntervalModal || !mergedPlottedData) return
    const { blockTripId, blockId } = addIntervalModal
    setAddIntervalModal(null)

    const block = mergedPlottedData.blocks.find(b => b.id === blockId)
    const bt    = block?.blockTrips.find(bt => bt.id === blockTripId)
    if (!bt) return

    const departureMinutes = bt.trip.arrivalMinutes + 1

    // Occupies the full gap up to whatever comes next in the block (trip, deadrun
    // or existing break), capped at the interval type's max — if the gap is smaller
    // than the type's min, it's still created at the available size (flagged as
    // irregular by computeIntervalIrregularity, never blocked, see docs/proposal
    // /vehicle-plan-block-intervals.md §5.3).
    const nextStarts = [
      ...block!.blockTrips.filter(o => o.id !== bt.id).map(o => o.trip.departureMinutes),
      ...block!.blockDeadruns.map(dr => dr.departureMinutes),
      ...block!.blockIntervals.map(bi => bi.departureMinutes),
    ].filter(dep => dep > bt.trip.arrivalMinutes)
    const nextStart = nextStarts.length > 0 ? Math.min(...nextStarts) : null
    // leaves the same 1min gap before the next item as the 1min gap right after the trip
    const availableGap = nextStart != null ? nextStart - departureMinutes - 1 : null

    const duration = availableGap != null
      ? Math.max(0, intervalType.maxMinutes != null ? Math.min(availableGap, intervalType.maxMinutes) : availableGap)
      : (intervalType.minMinutes ?? 30)
    const arrivalMinutes = departureMinutes + duration

    handlePendingAdd({
      _kind:            'break',
      _tempId:          crypto.randomUUID(),
      intervalTypeId:   intervalType.id,
      intervalTypeCode: intervalType.code,
      intervalTypeName: intervalType.name,
      isPaid:           intervalType.isPaid,
      minMinutes:       intervalType.minMinutes,
      maxMinutes:       intervalType.maxMinutes,
      departureMinutes,
      arrivalMinutes,
      blockId,
    })
  }

  // Pending (unsaved) breaks aren't real persisted ids — deleting them means removing
  // the pendingAdds entry outright, not routing them through pendingIntervalDeletes
  // (which only ever gets checked against real ids and is a no-op for temp ones).
  function discardBreaks(ids: string[]) {
    if (ids.length === 0) return
    const tempBreakIds = new Set(
      pendingAdds.filter((a): a is PendingAddInterval => a._kind === 'break').map(a => a._tempId),
    )
    const tempIds = ids.filter(id => tempBreakIds.has(id))
    const realIds = ids.filter(id => !tempBreakIds.has(id))

    if (tempIds.length > 0) {
      setPendingAdds(prev => prev.filter(a => !(a._kind === 'break' && tempIds.includes(a._tempId))))
    }
    if (realIds.length > 0) {
      setPendingIntervalDeletes(prev => new Set([...prev, ...realIds]))
      setPendingIntervalChanges(prev => {
        const next = new Map(prev)
        for (const id of realIds) next.delete(id)
        return next
      })
    }
  }

  function handleConfirmMove() {
    if (!canEdit || !selection || !moveTargetBlockId || !mergedPlottedData) return

    const sourceBlockId = selection.type === 'trip' ? selection.segment.rowId : selection.rowId
    const sourceBlock   = mergedPlottedData.blocks.find(b => b.id === sourceBlockId)
    const targetBlock   = mergedPlottedData.blocks.find(b => b.id === moveTargetBlockId)
    if (!sourceBlock || !targetBlock) return

    const blockTripIds = selection.type === 'trip'
      ? (selection.segment.kind === 'trip' ? [selection.segment.id] : [])
      : selection.segments.filter(s => s.kind === 'trip').map(s => s.id)

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

    // Intervals live attached to the trip that precedes them (positional, no FK —
    // see docs/proposal/vehicle-plan-block-intervals.md §7.1). If the user explicitly
    // included the interval in the selection being moved, it travels with its anchor
    // trip; otherwise it's left behind without an anchor, so it's dropped.
    const movedTripIds = blockTripIds
      .map(btId => sourceBlock.blockTrips.find(bt => bt.id === btId)?.trip.id)
      .filter((tid): tid is string => !!tid)
    const anchoredBreakIds = findAnchoredBreakIds(sourceBlock, movedTripIds)

    // Segment ids carry a ":bk" suffix for layout-engine uniqueness — the real
    // BlockInterval id (matching findAnchoredBreakIds' output) lives in .data.id.
    const selectedBreakIds = new Set(
      selection.type === 'interval'
        ? selection.segments.filter(s => s.kind === 'break').map(s => (s.data as GanttBlockInterval).id)
        : [],
    )
    const movedBreakIds    = anchoredBreakIds.filter(id => selectedBreakIds.has(id))
    const orphanedBreakIds = anchoredBreakIds.filter(id => !selectedBreakIds.has(id))

    // Deadruns have no anchor concept (unlike breaks) — they're never implied by a
    // neighboring trip, so only ones explicitly included in the selection move; there's
    // no "orphaned" set to drop. Access/return deadruns synthesized for a pending trip
    // (buildFakeAccessReturn) have no independent existence, so they're excluded here —
    // they follow automatically once their trip's own blockId/timing moves.
    const selectedDeadrunIds = selection.type === 'interval'
      ? selection.segments
          .filter(s => s.kind === 'deadhead')
          .map(s => (s.data as GanttBlockDeadrun).id)
          .filter(id => !id.endsWith(':access') && !id.endsWith(':return'))
      : []

    // Pending (unsaved) trips/breaks/deadruns aren't real persisted ids yet — relocate
    // them by editing pendingAdds directly instead of routing them through pendingMoves,
    // which only carries real ids applyDiff's move step can act on (a temp id has no
    // BlockTrip row to find server-side).
    const tempTripIds = new Set(
      pendingAdds.filter((a): a is PendingAddTrip => a._kind === 'trip').map(a => a._tempId),
    )
    const movedRealTripIds = blockTripIds.filter(id => !tempTripIds.has(id))
    const movedTempTripIds = blockTripIds.filter(id => tempTripIds.has(id))

    const tempBreakIds = new Set(
      pendingAdds.filter((a): a is PendingAddInterval => a._kind === 'break').map(a => a._tempId),
    )
    const movedRealBreakIds = movedBreakIds.filter(id => !tempBreakIds.has(id))
    const movedTempBreakIds = movedBreakIds.filter(id => tempBreakIds.has(id))

    const tempDeadrunIds = new Set(
      pendingAdds.filter((a): a is PendingAddDeadrun => a._kind === 'deadrun').map(a => a._tempId),
    )
    const movedRealDeadrunIds = selectedDeadrunIds.filter(id => !tempDeadrunIds.has(id))
    const movedTempDeadrunIds = selectedDeadrunIds.filter(id => tempDeadrunIds.has(id))

    if (movedRealTripIds.length > 0) {
      setPendingMoves(prev => {
        const filtered = prev.filter(m => !m.blockTripIds.some(id => blockTripIds.includes(id)))
        return [...filtered, { blockTripIds: movedRealTripIds, breakIds: movedRealBreakIds, deadrunIds: movedRealDeadrunIds, fromBlockId: sourceBlockId, toBlockId: moveTargetBlockId }]
      })
    }

    if (movedTempTripIds.length > 0 || movedTempBreakIds.length > 0 || movedTempDeadrunIds.length > 0) {
      setPendingAdds(prev => prev.map(a => {
        if (a._kind === 'trip'    && movedTempTripIds.includes(a._tempId))    return { ...a, blockId: moveTargetBlockId }
        if (a._kind === 'break'   && movedTempBreakIds.includes(a._tempId))   return { ...a, blockId: moveTargetBlockId }
        if (a._kind === 'deadrun' && movedTempDeadrunIds.includes(a._tempId)) return { ...a, blockId: moveTargetBlockId }
        return a
      }))
    }

    discardBreaks(orphanedBreakIds)

    if (orphanedBreakIds.length > 0) {
      toast.info(
        orphanedBreakIds.length === 1
          ? 'Intervalo anexado excluído — não foi incluído na movimentação'
          : `${orphanedBreakIds.length} intervalos anexados excluídos — não foram incluídos na movimentação`,
      )
    }

    setSelection(null)
    setMoveTargetBlockId(null)
  }

  // Every Gantt edit — this included — is queued into pending state and only ever
  // reaches the server in the single applyDiff call fired by Salvar (handleSavePending).
  // No handler in this file makes a network call on its own anymore (solver excepted).
  // See docs/proposal/vehicle-plan-summary-score-consolidation.md §2.5.
  async function handleConfirmDepotModal(depot: { id: string; name: string }) {
    if (!canEdit || !depotModal || !mergedPlottedData) return
    const { kind, blockTripId, blockId } = depotModal
    setDepotModal(null)

    // Intercept pending trips: bundle access/return into the pending entry directly
    const pendingIdx = pendingAdds.findIndex(a => a._kind === 'trip' && a._tempId === blockTripId)
    if (pendingIdx !== -1) {
      const entry    = pendingAdds[pendingIdx] as PendingAddTrip
      const originId = kind === 'access' ? depot.id              : entry.destinationLocality.id
      const destId   = kind === 'access' ? entry.originLocality.id : depot.id
      const travelMinutes = await getTravelTime(originId, destId)
      if (travelMinutes === null) {
        toast.error('Mapeamento não localizado na matriz entre os pontos informados')
        return
      }
      setPendingAdds(prev => prev.map((a, i) => {
        if (i !== pendingIdx || a._kind !== 'trip') return a
        return kind === 'access'
          ? { ...a, access: { localityId: depot.id, travelMinutes } }
          : { ...a, return: { localityId: depot.id, travelMinutes } }
      }))
      setSelection(null)
      return
    }

    // Existing (already-saved) trip: queue a pending ACCESS/RETURN deadrun — same
    // shape a new trip's own access/return uses (buildFakeAccessReturn), applied via
    // the Save batch instead of a standalone call. Times are a client-side estimate
    // for the optimistic render only; the server re-derives them from the matrix.
    const block = mergedPlottedData.blocks.find(b => b.id === blockId)
    const bt    = block?.blockTrips.find(bt => bt.id === blockTripId)
    if (!block || !bt) return

    const originLocality      = kind === 'access' ? depot : bt.trip.route.destinationLocality
    const destinationLocality = kind === 'access' ? bt.trip.route.originLocality : depot
    const travelMinutes = await getTravelTime(
      kind === 'access' ? depot.id : bt.trip.route.destinationLocality.id,
      kind === 'access' ? bt.trip.route.originLocality.id : depot.id,
    )
    if (travelMinutes === null) {
      toast.error('Mapeamento não localizado na matriz entre os pontos informados')
      return
    }

    handlePendingAdd({
      _kind:               'deadrun',
      _tempId:             crypto.randomUUID(),
      type:                kind === 'access' ? 'ACCESS' : 'RETURN',
      blockTripId,
      originLocality,
      destinationLocality,
      departureMinutes:    kind === 'access' ? bt.trip.departureMinutes - travelMinutes - 1 : bt.trip.arrivalMinutes + 1,
      arrivalMinutes:      kind === 'access' ? bt.trip.departureMinutes - 1 : bt.trip.arrivalMinutes + 1 + travelMinutes,
      blockId,
    })
    setSelection(null)
  }

  // Pending (unsaved) trips/deadruns aren't real persisted ids — deleting them means
  // dropping the pendingAdds entry outright, mirroring discardBreaks (below) for breaks.
  function queueTripDeletes(tripIds: string[]) {
    const tempTripIds = new Map(
      pendingAdds.filter((a): a is PendingAddTrip => a._kind === 'trip').map(a => [`${a._tempId}:trip`, a._tempId]),
    )
    const tempIds = tripIds.filter(id => tempTripIds.has(id)).map(id => tempTripIds.get(id)!)
    const realIds = tripIds.filter(id => !tempTripIds.has(id))

    if (tempIds.length > 0) {
      setPendingAdds(prev => prev.filter(a => !(a._kind === 'trip' && tempIds.includes(a._tempId))))
    }
    if (realIds.length > 0) {
      setPendingDeletes(prev => new Set([...prev, ...realIds]))
      setPendingChanges(prev => {
        const next = new Map(prev)
        for (const id of realIds) next.delete(id)
        return next
      })
    }
  }

  function queueDeadrunDeletes(deadrunIds: string[]) {
    const tempDeadrunIds = new Set(
      pendingAdds.filter((a): a is PendingAddDeadrun => a._kind === 'deadrun').map(a => a._tempId),
    )
    const tempIds = deadrunIds.filter(id => tempDeadrunIds.has(id))
    const realIds = deadrunIds.filter(id => !tempDeadrunIds.has(id))

    if (tempIds.length > 0) {
      setPendingAdds(prev => prev.filter(a => !(a._kind === 'deadrun' && tempIds.includes(a._tempId))))
    }
    if (realIds.length > 0) {
      setPendingDeadrunDeletes(prev => new Set([...prev, ...realIds]))
      setPendingDeadrunChanges(prev => {
        const next = new Map(prev)
        for (const id of realIds) next.delete(id)
        return next
      })
    }
  }

  async function handleDeleteDeadruns(deadrunIds: string[], _blockId: string) {
    if (!canEdit) return
    const ok = await confirm({
      title:        deadrunIds.length === 1 ? 'Excluir vazio' : `Excluir ${deadrunIds.length} vazios`,
      description:  'Esta ação não pode ser desfeita.',
      confirmLabel: 'Excluir',
      variant:      'destructive',
    })
    if (!ok) return
    queueDeadrunDeletes(deadrunIds)
    setSelection(null)
  }

  async function handleDeleteBreaks(breakIds: string[], _blockId: string) {
    if (!canEdit) return
    const ok = await confirm({
      title:        breakIds.length === 1 ? 'Excluir intervalo' : `Excluir ${breakIds.length} intervalos`,
      description:  'Esta ação não pode ser desfeita.',
      confirmLabel: 'Excluir',
      variant:      'destructive',
    })
    if (!ok) return
    discardBreaks(breakIds)
    setSelection(null)
  }

  async function handleDeleteInterval(tripIds: string[], deadrunIds: string[], breakIds: string[], _blockId: string) {
    if (!canEdit) return
    const tripCount    = tripIds.length
    const deadrunCount = deadrunIds.length
    const breakCount   = breakIds.length
    const parts        = [
      tripCount    > 0 ? `${tripCount} ${tripCount === 1 ? 'viagem' : 'viagens'}`      : null,
      deadrunCount > 0 ? `${deadrunCount} ${deadrunCount === 1 ? 'vazio' : 'vazios'}`  : null,
      breakCount   > 0 ? `${breakCount} ${breakCount === 1 ? 'intervalo' : 'intervalos'}` : null,
    ].filter(Boolean).join(' e ')

    const ok = await confirm({
      title:        `Excluir ${parts}`,
      description:  'Esta ação não pode ser desfeita.',
      confirmLabel: 'Excluir',
      variant:      'destructive',
    })
    if (!ok) return
    queueTripDeletes(tripIds)
    queueDeadrunDeletes(deadrunIds)
    discardBreaks(breakIds)
    setSelection(null)
  }

  async function handleDeleteTrips(tripIds: string[]) {
    if (!canEdit) return
    const count = tripIds.length
    const ok = await confirm({
      title:        count === 1 ? 'Excluir viagem' : `Excluir ${count} viagens`,
      description:  'Esta ação não pode ser desfeita.',
      confirmLabel: 'Excluir',
      variant:      'destructive',
    })
    if (!ok) return
    queueTripDeletes(tripIds)
    setSelection(null)
  }

  const vehiclesActionSpec = useMemo(
    () => createVehiclesActionSpec({
      onUpdateConstraints: handleUpdateConstraints,
      onDeleteTrips:       handleDeleteTrips,
      onDeleteDeadruns:    handleDeleteDeadruns,
      onDeleteBreaks:      handleDeleteBreaks,
      onDeleteInterval:    handleDeleteInterval,
      onAddAccess:         handleAddAccess,
      onAddReturn:         handleAddReturn,
      onAddInterval:       handleAddInterval,
    }, canEdit),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [canEdit],
  )

  // onAddAccess/onAddReturn/onAddInterval/onDeleteTrips/onDeleteDeadruns/onDeleteBreaks/
  // onDeleteInterval/onUpdateConstraints and the raw handleSavePending aren't returned —
  // they're only ever reached through vehiclesActionSpec or the *WithConfirm wrappers,
  // both already exposed below (queueTripDeletes is the exception — SwitchLineScheduleModal
  // needs to stage a delete without handleDeleteTrips's own confirm dialog, since it shows
  // its own). Add the rest back if a future caller needs direct access.
  return {
    selection, setSelection,
    depotModal, setDepotModal,
    addIntervalModal, setAddIntervalModal,
    moveTargetBlockId, setMoveTargetBlockId,
    pendingAdds, pendingDeletes, pendingDeadrunDeletes, pendingIntervalDeletes,
    setPendingAdds, setPendingDeletes, setPendingDeadrunDeletes, setPendingChanges, setPendingDeadrunChanges,
    pendingNewBlockIds, handleCreateEmptyBlock,
    pendingLineSchedulePin, setPendingLineSchedulePin,
    editBarOpen, setEditBarOpen,
    focusedSegId, setFocusedSegId,
    tripSeqAnchor, setTripSeqAnchor,
    selectedLineIds, setSelectedLineIds,
    plottedData, mergedPlottedData,
    allTrips, navBlocks, tripSeqRangeIds, headwayRangeInfo, freqIndex,
    addTripReference, moveTargetBlocks, moveTargetHints,
    pendingCount, isSaving,
    stepMoveTarget,
    handleSelectionChange, handlePendingAdd, queueTripDeletes, clearAllPending, handleToggleEditBar,
    handleSavePendingWithConfirm, handleDiscardPendingWithConfirm,
    handleConfirmAddInterval, discardBreaks,
    handleConfirmMove, handleConfirmDepotModal,
    vehiclesActionSpec,
    handleAdjustCycle, handleFinalizePlan, handleDistributeHeadway, handleTripTimingOp,
  }
}
