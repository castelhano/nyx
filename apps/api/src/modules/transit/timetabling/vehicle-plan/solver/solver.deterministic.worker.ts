import { workerData, parentPort, isMainThread } from 'worker_threads'
import type {
  SolverConfig,
  SolverTrip,
  SolverMatrixEntry,
  SolverResult,
  SolverMessage,
  WorkerCommand,
  RangeCriterionConfig,
} from './solver.types'
import { getEdge, scoreBlocks, type ScoringBlock } from './solver.scoring'

if (isMainThread) process.exit(1)

const cfg    = workerData as SolverConfig
let stopped  = false

parentPort!.on('message', (cmd: WorkerCommand) => {
  if (cmd.type === 'stop') stopped = true
})

process.on('uncaughtException', (err) => {
  console.error('[solver-deterministic] uncaughtException:', err)
  parentPort?.postMessage({ type: 'done', stopReason: 'no_improvement', totalAttempts: 0 } satisfies SolverMessage)
})

// ─── types ───────────────────────────────────────────────────────────────────

type Block = ScoringBlock & { trips: SolverTrip[]; locked: boolean }

let nextBlockId = 0

// ─── helpers ─────────────────────────────────────────────────────────────────

function insertSorted(trips: SolverTrip[], trip: SolverTrip): SolverTrip[] {
  const idx = trips.findIndex(t => t.departureMinutes > trip.departureMinutes)
  return idx === -1 ? [...trips, trip] : [...trips.slice(0, idx), trip, ...trips.slice(idx)]
}

function isFeasible(trips: SolverTrip[], matrix: Record<string, SolverMatrixEntry>): boolean {
  for (let i = 1; i < trips.length; i++) {
    const prev = trips[i - 1]
    const cur  = trips[i]
    const edge = getEdge(matrix, prev.destinationLocalityId, cur.originLocalityId)
    if (!edge) return false
    if (cur.departureMinutes < prev.arrivalMinutes + edge.minutes) return false
  }
  return true
}

function findNearestDepot(localityId: string, depots: string[], matrix: Record<string, SolverMatrixEntry>): string {
  let best:    string | null = null
  let bestMin: number = Infinity
  for (const depotId of depots) {
    const edge = getEdge(matrix, depotId, localityId)
    if (!edge) continue
    if (edge.minutes < bestMin) {
      bestMin = edge.minutes
      best    = depotId
    }
  }
  return best ?? depots[0]
}

function blockDuration(block: Block, matrix: Record<string, SolverMatrixEntry>): number {
  if (block.trips.length === 0) return 0
  const first     = block.trips[0]
  const last      = block.trips[block.trips.length - 1]
  const depotEdge = getEdge(matrix, block.depotId, first.originLocalityId) ?? { minutes: 0, km: 0 }
  return last.arrivalMinutes - (first.departureMinutes - depotEdge.minutes)
}

function scoreAll(blocks: Block[]): SolverResult {
  return scoreBlocks(blocks, cfg.matrix, cfg.config)
}

// ─── proposal tracking ────────────────────────────────────────────────────────

let proposalIndex = 0
let bestScore: number | null = null

function post(msg: SolverMessage): void {
  parentPort!.postMessage(msg)
}

function tryEmitProposal(blocks: Block[], stage: number, stageLabel: string): void {
  const result = scoreAll(blocks)
  if (bestScore === null || result.score > bestScore) {
    bestScore = result.score
    proposalIndex++
    post({ type: 'proposal', stage, stageLabel, scenario: result, proposalIndex })
  }
}

// ─── stage 1.1: line-first greedy construction ───────────────────────────────

function buildLineFirst(freeTrips: SolverTrip[], lockedBlocks: Block[]): Block[] {
  const sorted = [...freeTrips].sort((a, b) => a.departureMinutes - b.departureMinutes)
  const blocks: Block[] = [...lockedBlocks]
  const idealMin = cfg.config.range.tripInterval.idealMin

  for (const trip of sorted) {
    let bestBlock:   Block | null = null
    let bestLayover: number = Infinity

    for (const block of blocks) {
      if (block.locked) continue

      // line-first: block must already serve the same line
      const blockLine = block.trips[0]?.lineId
      if (blockLine !== trip.lineId) continue

      if (trip.requiredVehicleType && block.vehicleType !== trip.requiredVehicleType) continue

      const last    = block.trips[block.trips.length - 1]
      const edge    = getEdge(cfg.matrix, last.destinationLocalityId, trip.originLocalityId)
      if (!edge) continue

      const layover = trip.departureMinutes - (last.arrivalMinutes + edge.minutes)
      if (layover < idealMin) continue

      if (layover < bestLayover) {
        bestLayover = layover
        bestBlock   = block
      }
    }

    if (bestBlock) {
      // trips are already in departure order since we process sorted
      bestBlock.trips = [...bestBlock.trips, trip]
    } else {
      const depotId = findNearestDepot(trip.originLocalityId, cfg.depots, cfg.matrix)
      blocks.push({
        id:          nextBlockId++,
        depotId,
        vehicleType: trip.requiredVehicleType ?? 'STANDARD',
        trips:       [trip],
        locked:      false,
      })
    }
  }

  return blocks
}

// ─── stage 1.2: zero-deadrun merge ───────────────────────────────────────────

function mergeZeroDeadrun(blocks: Block[], minBlockDuration: RangeCriterionConfig): Block[] {
  // only run if at least one block is below idealMin
  const hasShort = blocks.some(b => !b.locked && blockDuration(b, cfg.matrix) < minBlockDuration.idealMin)
  if (!hasShort) return blocks

  let current = [...blocks]
  let changed = true

  while (changed) {
    changed = false

    type Candidate = { ai: number; bi: number; gain: number }
    const candidates: Candidate[] = []

    for (let ai = 0; ai < current.length; ai++) {
      for (let bi = 0; bi < current.length; bi++) {
        if (ai === bi) continue
        const a = current[ai]
        const b = current[bi]
        if (a.locked || b.locked) continue
        if (a.vehicleType !== b.vehicleType) continue

        const aLast  = a.trips[a.trips.length - 1]
        const bFirst = b.trips[0]

        // zero-deadrun: same locality, no travel needed
        if (aLast.destinationLocalityId !== bFirst.originLocalityId) continue

        // junction layover must be non-negative
        if (bFirst.departureMinutes < aLast.arrivalMinutes) continue

        const mergedTrips = [...a.trips, ...b.trips]
        if (!isFeasible(mergedTrips, cfg.matrix)) continue

        // rank by total merged block duration (longer = better utilization gain)
        const depotEdge = getEdge(cfg.matrix, a.depotId, mergedTrips[0].originLocalityId) ?? { minutes: 0, km: 0 }
        const gain      = mergedTrips[mergedTrips.length - 1].arrivalMinutes
          - (mergedTrips[0].departureMinutes - depotEdge.minutes)

        candidates.push({ ai, bi, gain })
      }
    }

    if (candidates.length === 0) break

    // sort: highest gain first; ties broken by lineId of both blocks for determinism
    candidates.sort((x, y) => {
      if (y.gain !== x.gain) return y.gain - x.gain
      const lax = current[x.ai].trips[0].lineId
      const lay = current[y.ai].trips[0].lineId
      if (lax !== lay) return lax.localeCompare(lay)
      return current[x.bi].trips[0].lineId.localeCompare(current[y.bi].trips[0].lineId)
    })

    const { ai, bi } = candidates[0]
    const a = current[ai]
    const b = current[bi]

    const merged: Block = {
      id:          a.id,
      depotId:     a.depotId,
      vehicleType: a.vehicleType,
      trips:       [...a.trips, ...b.trips],
      locked:      false,
    }

    current = [...current.filter((_, i) => i !== ai && i !== bi), merged]
    changed = true
  }

  return current
}

// ─── stage 1.3: trip redistribution from undersized blocks ───────────────────

function redistributeUnderused(blocks: Block[], minBlockDuration: RangeCriterionConfig): Block[] {
  // only run if at least one block is below floor
  const hasUnderFloor = blocks.some(b => !b.locked && blockDuration(b, cfg.matrix) < minBlockDuration.floor)
  if (!hasUnderFloor) return blocks

  let current = [...blocks]
  let improved = true

  while (improved) {
    improved = false

    // find undersized non-locked blocks, shortest first
    const undersized = current
      .filter(b => !b.locked && blockDuration(b, cfg.matrix) < minBlockDuration.floor)
      .sort((a, b) => blockDuration(a, cfg.matrix) - blockDuration(b, cfg.matrix))

    for (const smallBlock of undersized) {
      if (stopped) break

      // attempt to relocate each trip from smallBlock into any other block
      let working    = [...current]
      let allPlaced  = true

      for (const trip of [...smallBlock.trips]) {
        // find current state of smallBlock in working
        const curSmall = working.find(b => b.id === smallBlock.id)
        if (!curSmall) { allPlaced = false; break }

        // try each candidate block in index order (deterministic)
        let placed = false
        for (let i = 0; i < working.length; i++) {
          const target = working[i]
          if (target.id === smallBlock.id) continue
          if (target.locked) continue
          if (trip.requiredVehicleType && target.vehicleType !== trip.requiredVehicleType) continue

          const newTargetTrips = insertSorted(target.trips, trip)
          if (!isFeasible(newTargetTrips, cfg.matrix)) continue

          const newSmallTrips = curSmall.trips.filter(t => t.id !== trip.id)
          working = working.map(b => {
            if (b.id === smallBlock.id) return { ...b, trips: newSmallTrips }
            if (b.id === target.id)    return { ...b, trips: newTargetTrips }
            return b
          })
          placed = true
          break
        }

        if (!placed) { allPlaced = false; break }
      }

      if (allPlaced) {
        // remove the now-empty small block
        current  = working.filter(b => b.id !== smallBlock.id)
        improved = true
        break  // restart outer loop
      }
    }
  }

  return current
}

// ─── main ─────────────────────────────────────────────────────────────────────

// separate locked and free trips
const tripMap    = new Map(cfg.trips.map(t => [t.id, t]))
const lockedIds  = new Set(
  cfg.initialBlocks
    .filter(ib => ib.locked)
    .flatMap(ib => ib.tripIds),
)

const lockedBlocks: Block[] = cfg.initialBlocks
  .filter(ib => ib.locked)
  .map(ib => ({
    id:          nextBlockId++,
    depotId:     ib.depotId,
    vehicleType: ib.vehicleType,
    trips:       ib.tripIds.map(id => tripMap.get(id)).filter((t): t is SolverTrip => !!t)
                           .sort((a, b) => a.departureMinutes - b.departureMinutes),
    locked:      true,
  }))
  .filter(b => b.trips.length > 0)

const freeTrips = cfg.trips.filter(t => !lockedIds.has(t.id))

if (freeTrips.length === 0 && lockedBlocks.length === 0) {
  console.error('[solver-deterministic] no trips or blocks to process')
  post({ type: 'done', stopReason: 'no_improvement', totalAttempts: 0 })
} else {
  const mbd = cfg.config.range.minBlockDuration

  // Stage 1.1
  const s1 = buildLineFirst(freeTrips, lockedBlocks)
  if (!stopped) tryEmitProposal(s1, 1, 'Construção por linha')

  // Stage 1.2
  const s2 = stopped ? s1 : mergeZeroDeadrun(s1, mbd)
  if (!stopped) tryEmitProposal(s2, 2, 'Fusão por continuidade')

  // Stage 1.3
  const s3 = stopped ? s2 : redistributeUnderused(s2, mbd)
  if (!stopped) tryEmitProposal(s3, 3, 'Redistribuição de blocos curtos')

  post({ type: 'done', stopReason: stopped ? 'user_stopped' : 'max_time', totalAttempts: 3 })
}
