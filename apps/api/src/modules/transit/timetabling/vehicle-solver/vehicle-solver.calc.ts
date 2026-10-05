import { VEHICLE_TYPES, validateBlock, type PlanningSettings, type VehicleTypeValue } from '@nyx/schemas'
import { buildAggregateFromPersisted, type BlockAggregate } from '../vehicle-plan/scoring/block-aggregate'
import { PlanScoreState, type OperatorShares } from '../vehicle-plan/scoring/plan-scoring.calc'
import type { DeadrunKind, ProposalBlock, VehicleSolverSummary } from './vehicle-solver.types'

// Vehicle solver — the model and the construction (pure, no Prisma). See
// docs/architecture/transit/solver.md.
//
// A block is decided by its trips, operator (branchId), depot and vehicle type. It is only
// ever held in its *materialized* form: the deadruns (ACCESS / RETURN / DISPLACEMENT) and
// intervals it would be persisted with — so its aggregate comes from the same builder
// recalculate() uses on persisted rows, and the proposal's score is the score the plan gets
// once applied.
//
// Hard rules (a block that breaks one is never built):
//  - each trip can follow the previous one: same place with at least the minimum layover
//    (minLayoverMinutes), or a DISPLACEMENT through the matrix in time;
//  - the depot reaches the first trip and is reached from the last one (matrix);
//  - one vehicle type accepted by every trip (requiredVehicleType, else the line's allowed);
//  - the depot serves the block's operator (TransitLocality.depot.operators);
//  - depot capacity, total and per vehicle type (counting the locked blocks);
//  - a stop of standThreshold or more (the default interval type's min — shorter is just the
//    terminal turnaround) only stays where the vehicle may stand (RouteLocality
//    .allowsVehicleStand of the arriving trip's destination or the next trip's origin);
//    anywhere else it goes back to the depot and out again, and with no time for that round
//    trip the two trips can't follow each other.

// minutes between a trip and the deadrun next to it — same as the import's normalization
export const DEADRUN_GAP = 1

export interface SolverTrip {
  id:        string
  lineId:    string
  lineCode:  string
  origin:    string
  dest:      string
  dep:       number
  arr:       number
  direction: string
  // the line as the aggregate builder reads it (extensionKm, preferred type)
  line:      { metrics: unknown; vehicleTypes: unknown }
  // hard rule: requiredVehicleType, else the line's allowed types; null = any type
  allowed:   VehicleTypeValue[] | null
  preferred: VehicleTypeValue | null
  // the vehicle may stand (interval) at this trip's origin / destination — the route's
  // RouteLocality.allowsVehicleStand there
  standAtOrigin: boolean
  standAtDest:   boolean
}

export interface SolverDepot {
  id:        string
  // branchIds allowed; empty = any operator
  operators: string[]
  capacity:  { vehicleType: VehicleTypeValue | null; max: number }[]
}

// a locked block — fixed, but it counts in the score and in the depots' capacity
export interface LockedBlock {
  depotId:     string
  branchId:    string | null
  vehicleType: VehicleTypeValue
  hasIssues:   boolean
  aggregate:   BlockAggregate
}

// the plan's current (rebuilt-part) blocks — a starting point when they keep every rule
export interface SeedBlock {
  depotId:     string
  branchId:    string | null
  vehicleType: VehicleTypeValue
  tripIds:     string[]
}

export interface VehicleSolverInput {
  // what the search optimizes — the plan's settings reweighted by the chosen direction
  settings:  PlanningSettings
  // what the proposals are reported with — the plan's own settings, the score it gets once applied
  reportSettings: PlanningSettings
  // the trips to place (all of the plan's but the locked blocks')
  trips:     SolverTrip[]
  locked:    LockedBlock[]
  seed:      SeedBlock[]
  // every trip of the plan, locked ones included (the fleet floor)
  planTrips: { departureMinutes: number; arrivalMinutes: number }[]
  matrix:    Record<string, { minutes: number; km: number }>
  depots:    SolverDepot[]
  // the Scope's operators (branchIds); none = blocks without operator
  operators: string[]
  shares:    OperatorShares
  // default interval type's range — null: no intervals are placed
  interval:  { min: number; max: number } | null
  // a stop this long or longer is an interval — only where the vehicle may stand, else it goes
  // back to the depot; shorter is the terminal turnaround
  standThreshold:  number
  // the issues check (validateBlock) — the default interval type's max
  maxStandMinutes: number | null
}

export interface Rows {
  deadruns:  ProposalBlock['deadruns']
  intervals: ProposalBlock['intervals']
}

export interface WorkBlock {
  trips:       SolverTrip[]
  depotId:     string
  branchId:    string | null
  vehicleType: VehicleTypeValue
  rows:        Rows
  agg:         BlockAggregate
}

type Edge = { minutes: number; km: number }

// ── capacity ─────────────────────────────────────────────────────────────────

export class Capacity {
  private readonly total  = new Map<string, number>()
  private readonly byType = new Map<string, number>()

  constructor(private readonly depots: Map<string, SolverDepot>) {}

  fits(depotId: string, type: VehicleTypeValue): boolean {
    const depot = this.depots.get(depotId)
    if (!depot) return false
    for (const rule of depot.capacity) {
      const used = rule.vehicleType == null ? this.total.get(depotId) ?? 0
        : rule.vehicleType === type ? this.byType.get(`${depotId}:${type}`) ?? 0 : -1
      if (used >= 0 && used + 1 > rule.max) return false
    }
    return true
  }

  add(depotId: string, type: VehicleTypeValue, sign: 1 | -1 = 1): void {
    this.total.set(depotId, (this.total.get(depotId) ?? 0) + sign)
    const key = `${depotId}:${type}`
    this.byType.set(key, (this.byType.get(key) ?? 0) + sign)
  }

  remove(depotId: string, type: VehicleTypeValue): void { this.add(depotId, type, -1) }
}

// ── model ────────────────────────────────────────────────────────────────────

export class VehicleModel {
  readonly tripById:  Map<string, SolverTrip>
  readonly depotById: Map<string, SolverDepot>
  readonly matrixKm:  Record<string, number> = {}
  readonly minLayover: number
  readonly maxSpan:    number
  // operators a block may have — [null] when the Scope has none
  readonly branches:   (string | null)[]
  private readonly depotsByBranch = new Map<string | null, SolverDepot[]>()

  constructor(readonly input: VehicleSolverInput) {
    this.tripById  = new Map(input.trips.map(t => [t.id, t]))
    this.depotById = new Map(input.depots.map(d => [d.id, d]))
    for (const [key, e] of Object.entries(input.matrix)) this.matrixKm[key] = e.km
    this.minLayover = input.settings.minLayoverMinutes
    this.maxSpan    = input.settings.range.minBlockDuration.ceiling
    this.branches   = input.operators.length ? input.operators : [null]
    for (const b of this.branches) {
      this.depotsByBranch.set(b, input.depots.filter(d => !b || !d.operators.length || d.operators.includes(b)))
    }
  }

  edge(from: string, to: string): Edge | null {
    if (from === to) return { minutes: 0, km: 0 }
    return this.input.matrix[`${from}:${to}`] ?? null
  }

  depotsFor(branchId: string | null): SolverDepot[] {
    return this.depotsByBranch.get(branchId) ?? []
  }

  depotAllows(depotId: string, branchId: string | null): boolean {
    const d = this.depotById.get(depotId)
    return !!d && (!branchId || !d.operators.length || d.operators.includes(branchId))
  }

  // `cur` can be the next trip of a vehicle that just ran `prev` — through some depot when the
  // stop between them can't stay where it is (the block's depot is checked when materialized)
  canFollow(prev: SolverTrip, cur: SolverTrip): boolean {
    const stand = this.standMinutes(prev, cur)
    if (stand == null) return false
    if (stand < this.input.standThreshold || prev.standAtDest || cur.standAtOrigin) return true
    return this.input.depots.some(d => this.depotRoundTrip(prev, cur, d.id) != null)
  }

  // the stop between two trips: same place, at least the minimum layover; elsewhere, what's
  // left after the displacement — null when they can't follow each other
  private standMinutes(prev: SolverTrip, cur: SolverTrip): number | null {
    if (prev.dest === cur.origin) {
      const stop = cur.dep - prev.arr
      return stop >= this.minLayover ? stop : null
    }
    const e = this.edge(prev.dest, cur.origin)
    if (!e) return null
    const stop = cur.dep - prev.arr - DEADRUN_GAP - e.minutes
    return stop >= 0 ? stop : null
  }

  // RETURN after `prev` and ACCESS before `cur` through this depot — null when they don't fit
  private depotRoundTrip(prev: SolverTrip, cur: SolverTrip, depotId: string): { retArr: number; accDep: number } | null {
    const toDepot = this.edge(prev.dest, depotId), fromDepot = this.edge(depotId, cur.origin)
    if (!toDepot || !fromDepot) return null
    const retArr = prev.arr + DEADRUN_GAP + toDepot.minutes
    const accDep = cur.dep - DEADRUN_GAP - fromDepot.minutes
    return retArr <= accDep ? { retArr, accDep } : null
  }

  chainOk(trips: SolverTrip[]): boolean {
    for (let i = 1; i < trips.length; i++) if (!this.canFollow(trips[i - 1], trips[i])) return false
    return true
  }

  // vehicle types accepted by every trip, best first: the one most trips prefer, then
  // STANDARD, then the enum order; empty = no common type
  typeCandidates(trips: SolverTrip[]): VehicleTypeValue[] {
    let allowed: Set<VehicleTypeValue> | null = null
    const prefs = new Map<VehicleTypeValue, number>()
    for (const t of trips) {
      if (t.allowed) allowed = new Set(allowed ? t.allowed.filter(a => allowed!.has(a)) : t.allowed)
      if (t.preferred) prefs.set(t.preferred, (prefs.get(t.preferred) ?? 0) + 1)
      if (allowed && !allowed.size) return []
    }
    return VEHICLE_TYPES
      .filter(v => !allowed || allowed.has(v))
      .sort((a, b) => (prefs.get(b) ?? 0) - (prefs.get(a) ?? 0) || (b === 'STANDARD' ? 1 : 0) - (a === 'STANDARD' ? 1 : 0))
  }

  // the deadruns and intervals around the trips, from this depot — null when the depot can't
  // reach the first trip, be reached from the last or take a stop that can't stay where it is
  // (the chain itself must already hold)
  materialize(trips: SolverTrip[], depotId: string): Rows | null {
    const first = trips[0], last = trips[trips.length - 1]
    const access = this.edge(depotId, first.origin)
    const back   = this.edge(last.dest, depotId)
    if (!access || !back) return null

    const deadruns: Rows['deadruns'] = []
    const intervals: Rows['intervals'] = []
    const deadrun = (type: DeadrunKind, from: string, to: string, dep: number, arr: number) =>
      deadruns.push({ type, originLocalityId: from, destinationLocalityId: to, departureMinutes: dep, arrivalMinutes: arr })

    deadrun('ACCESS', depotId, first.origin, first.dep - DEADRUN_GAP - access.minutes, first.dep - DEADRUN_GAP)
    for (let i = 1; i < trips.length; i++) {
      const prev = trips[i - 1], cur = trips[i]
      const stand = this.standMinutes(prev, cur)!
      const long  = stand >= this.input.standThreshold
      if (long && !prev.standAtDest && !cur.standAtOrigin) {
        const rt = this.depotRoundTrip(prev, cur, depotId)
        if (!rt) return null
        deadrun('RETURN', prev.dest, depotId, prev.arr + DEADRUN_GAP, rt.retArr)
        deadrun('ACCESS', depotId, cur.origin, rt.accDep, cur.dep - DEADRUN_GAP)
        continue
      }
      // stands where it may: at the next trip's origin (displacing first) or, when only the
      // arrival allows it, at the arrival (displacing at the end)
      let standFrom = prev.arr, standTo = cur.dep
      if (prev.dest !== cur.origin) {
        const e = this.edge(prev.dest, cur.origin)!
        if (long && !cur.standAtOrigin) {
          standTo = cur.dep - DEADRUN_GAP - e.minutes
          deadrun('DISPLACEMENT', prev.dest, cur.origin, standTo, cur.dep - DEADRUN_GAP)
        } else {
          standFrom = prev.arr + DEADRUN_GAP + e.minutes
          deadrun('DISPLACEMENT', prev.dest, cur.origin, prev.arr + DEADRUN_GAP, standFrom)
        }
      }
      const interval = this.input.interval
      if (interval && standTo - standFrom >= interval.min) intervals.push({ departureMinutes: standFrom, arrivalMinutes: standTo })
    }
    deadrun('RETURN', last.dest, depotId, last.arr + DEADRUN_GAP, last.arr + DEADRUN_GAP + back.minutes)
    return { deadruns, intervals }
  }

  // the block with everything derived — null when the depot can't serve its trips
  build(trips: SolverTrip[], branchId: string | null, depotId: string, vehicleType: VehicleTypeValue): WorkBlock | null {
    const rows = this.materialize(trips, depotId)
    if (!rows) return null
    const agg = buildAggregateFromPersisted({
      vehicleType, branchId,
      blockTrips: trips.map(t => ({
        trip: {
          departureMinutes: t.dep, arrivalMinutes: t.arr,
          route: { lineId: t.lineId, originLocalityId: t.origin, destinationLocalityId: t.dest, direction: t.direction, line: t.line },
        },
      })),
      blockDeadruns:  rows.deadruns,
      blockIntervals: rows.intervals,
    }, this.matrixKm)
    return { trips, depotId, branchId, vehicleType, rows, agg }
  }

  // The best depot × vehicle type for these trips and operator that fits the capacity: the
  // type the trips prefer most, then the depot with the least deadrun km. `depotId` limits the
  // search to that depot (a move keeps the block where it is). Doesn't touch `cap`.
  place(trips: SolverTrip[], branchId: string | null, cap: Capacity, depotId?: string): WorkBlock | null {
    const types  = this.typeCandidates(trips)
    const depots = depotId ? [this.depotById.get(depotId)!].filter(d => d && this.depotAllows(d.id, branchId)) : this.depotsFor(branchId)
    for (const type of types) {
      let best: WorkBlock | null = null
      for (const d of depots) {
        if (!cap.fits(d.id, type)) continue
        const b = this.build(trips, branchId, d.id, type)
        if (b && (!best || b.agg.deadrunKm < best.agg.deadrunKm)) best = b
      }
      if (best) return best
    }
    return null
  }

  newScore(): PlanScoreState {
    const state = new PlanScoreState(this.input.settings, this.input.planTrips, this.input.shares)
    for (const l of this.input.locked) state.add(l.aggregate)
    return state
  }

  newCapacity(): Capacity {
    const cap = new Capacity(this.depotById)
    for (const l of this.input.locked) cap.add(l.depotId, l.vehicleType)
    return cap
  }
}

// ── construction ─────────────────────────────────────────────────────────────

export class SolverError extends Error {}

const clock = (m: number) => `${String(Math.floor(m / 60) % 24).padStart(2, '0')}:${String(m % 60).padStart(2, '0')}`

// Trips by departure, each to the open chain it fits best (shortest wait, no displacement,
// same line, no narrowing of the vehicle types), else a new chain — the classic greedy for the
// fleet floor. A chain never spans beyond the block duration's ceiling and keeps a common
// vehicle type; a trip that would restrict a chain's types (or a restricted chain taking a trip
// that isn't) costs more, so the few restricted trips tend to stay among themselves instead of
// tying many vehicles to a scarce type.
function buildChains(model: VehicleModel): SolverTrip[][] {
  const chains: { trips: SolverTrip[]; types: Set<VehicleTypeValue> | null }[] = []
  const trips = [...model.input.trips].sort((a, b) => a.dep - b.dep || a.arr - b.arr)
  for (const t of trips) {
    let best: (typeof chains)[number] | null = null
    let bestCost = Infinity
    for (const c of chains) {
      const last = c.trips[c.trips.length - 1]
      if (!model.canFollow(last, t)) continue
      if (t.arr - c.trips[0].dep > model.maxSpan) continue
      if (t.allowed && c.types && !t.allowed.some(v => c.types!.has(v))) continue
      const displace = last.dest !== t.origin ? (model.edge(last.dest, t.origin)?.minutes ?? 0) + 10 : 0
      const narrows  = !!t.allowed !== !!c.types || (t.allowed && c.types && t.allowed.length !== c.types.size)
      const cost = t.dep - last.arr + displace + (last.lineId !== t.lineId ? 20 : 0) + (narrows ? 120 : 0)
      if (cost < bestCost) { best = c; bestCost = cost }
    }
    if (best) {
      best.trips.push(t)
      if (t.allowed) best.types = new Set(best.types ? t.allowed.filter(v => best.types!.has(v)) : t.allowed)
    } else {
      chains.push({ trips: [t], types: t.allowed ? new Set(t.allowed) : null })
    }
  }
  return chains.map(c => c.trips)
}

// operator, depot and type per chain: the operator furthest below its share target (when the
// Scope has shares), else the cheapest placement
function placeChains(model: VehicleModel, chains: SolverTrip[][]): WorkBlock[] {
  const cap = model.newCapacity()
  const shares = model.input.shares
  const sharedOps = model.branches.filter(b => b && (shares[b] ?? 0) > 0) as string[]
  const shareTotal = sharedOps.reduce((s, b) => s + shares[b], 0)
  const total = chains.length + model.input.locked.length
  const assigned = new Map<string | null, number>()
  for (const l of model.input.locked) assigned.set(l.branchId, (assigned.get(l.branchId) ?? 0) + 1)
  const deficit = (b: string | null) => sharedOps.length > 1 && b && shares[b]
    ? (shares[b] / shareTotal) * total - (assigned.get(b) ?? 0)
    : -Infinity

  const blocks: WorkBlock[] = []
  // the most restricted chains first (fewest vehicle types), then the longest — they have the
  // fewest options to spare
  const options = new Map(chains.map(c => [c, model.typeCandidates(c).length]))
  const queue = [...chains].sort((a, b) => options.get(a)! - options.get(b)! || b.length - a.length)
  while (queue.length) {
    const trips = queue.shift()!
    let best: WorkBlock | null = null
    for (const branch of model.branches) {
      const b = model.place(trips, branch, cap)
      if (!b) continue
      if (!best) { best = b; continue }
      const d = deficit(branch) - deficit(best.branchId)
      if (d > 0.5 || (Math.abs(d) <= 0.5 && b.agg.deadrunKm < best.agg.deadrunKm)) best = b
    }
    // the chain only held through a depot this operator can't use (a stop that must go back
    // to the depot), or the capacity ran out: try its halves
    if (!best && trips.length > 1) {
      const half = trips.length >> 1
      queue.unshift(trips.slice(0, half), trips.slice(half))
      continue
    }
    if (!best) {
      const t = trips[0]
      throw new SolverError(`Nenhuma garagem atende o carro que começa às ${clock(t.dep)} — verifique a matriz de tempos, as garagens das empresas e a capacidade`)
    }
    cap.add(best.depotId, best.vehicleType)
    assigned.set(best.branchId, (assigned.get(best.branchId) ?? 0) + 1)
    blocks.push(best)
  }
  return blocks
}

// The plan's current blocks as a starting point: each one split where a link breaks a rule
// (too short a layover, an impossible displacement, no common vehicle type), kept in its depot
// when that still holds, else placed again. Null when they don't cover every trip.
function seedBlocks(model: VehicleModel): WorkBlock[] | null {
  const { seed, trips } = model.input
  if (!seed.length) return null
  const cap = model.newCapacity()
  const covered = new Set<string>()
  const blocks: WorkBlock[] = []
  for (const s of seed) {
    const found = s.tripIds.map(id => model.tripById.get(id))
    if (found.some(t => !t)) return null
    const ordered = (found as SolverTrip[]).sort((a, b) => a.dep - b.dep)
    const runs: SolverTrip[][] = [[ordered[0]]]
    for (let i = 1; i < ordered.length; i++) {
      const run = runs[runs.length - 1]
      if (model.canFollow(run[run.length - 1], ordered[i]) && model.typeCandidates([...run, ordered[i]]).length) run.push(ordered[i])
      else runs.push([ordered[i]])
    }
    for (const run of runs) {
      const keep = model.typeCandidates(run).includes(s.vehicleType) && model.depotAllows(s.depotId, s.branchId) && cap.fits(s.depotId, s.vehicleType)
      const b = (keep ? model.build(run, s.branchId, s.depotId, s.vehicleType) : null)
        ?? model.place(run, s.branchId, cap)
        ?? model.branches.map(br => model.place(run, br, cap)).find(Boolean)
      if (!b) return null
      cap.add(b.depotId, b.vehicleType)
      for (const t of run) covered.add(t.id)
      blocks.push(b)
    }
  }
  return covered.size === trips.length ? blocks : null
}

export function rawScoreOf(model: VehicleModel, blocks: WorkBlock[]): number {
  const state = model.newScore()
  for (const b of blocks) state.add(b.agg)
  return state.rawScore()
}

// The first proposal: the greedy construction, or the plan as it is when that scores better
export function constructBlocks(model: VehicleModel): WorkBlock[] {
  if (!model.input.trips.length) return []
  const built = placeChains(model, buildChains(model))
  const seed  = seedBlocks(model)
  return seed && rawScoreOf(model, seed) > rawScoreOf(model, built) ? seed : built
}

// ── output ───────────────────────────────────────────────────────────────────

// the line a block runs the most trips of (ties: the one it runs first)
function mainLineCode(b: WorkBlock): string {
  const counts = new Map<string, number>()
  for (const t of b.trips) counts.set(t.lineCode, (counts.get(t.lineCode) ?? 0) + 1)
  let best = b.trips[0].lineCode
  for (const [code, n] of counts) if (n > counts.get(best)!) best = code
  return best
}

// in numbering order: by main line (codes compared numerically — 105 < 1050 < A14), then start
export function toProposalBlocks(blocks: WorkBlock[]): ProposalBlock[] {
  const line = new Map(blocks.map(b => [b, mainLineCode(b)]))
  return [...blocks]
    .sort((a, b) => line.get(a)!.localeCompare(line.get(b)!, 'pt-BR', { numeric: true }) || a.trips[0].dep - b.trips[0].dep)
    .map(b => ({
      depotId: b.depotId, branchId: b.branchId, vehicleType: b.vehicleType,
      tripIds: b.trips.map(t => t.id), deadruns: b.rows.deadruns, intervals: b.rows.intervals,
    }))
}

export function blockHasIssues(model: VehicleModel, b: WorkBlock): boolean {
  return validateBlock({
    depotId: b.depotId, branchId: b.branchId,
    trips: b.trips.map(t => ({ departureMinutes: t.dep, arrivalMinutes: t.arr, originLocalityId: t.origin, destinationLocalityId: t.dest })),
    deadruns: b.rows.deadruns, intervals: b.rows.intervals,
    maxStandMinutes: model.input.maxStandMinutes,
  }).length > 0
}

type SummaryBlock = { depotId: string; branchId: string | null; vehicleType: VehicleTypeValue; aggregate: BlockAggregate; hasIssues: boolean }

export function summarizeBlocks(
  settings: PlanningSettings, planTrips: VehicleSolverInput['planTrips'], shares: OperatorShares, blocks: SummaryBlock[],
): VehicleSolverSummary {
  const state = new PlanScoreState(settings, planTrips, shares)
  const byBranch = new Map<string | null, { fleet: number; km: number }>()
  const byDepot  = new Map<string, { depotId: string; vehicleType: VehicleTypeValue; fleet: number }>()
  let issueBlocks = 0
  for (const b of blocks) {
    state.add(b.aggregate)
    const br = byBranch.get(b.branchId) ?? { fleet: 0, km: 0 }
    br.fleet++
    br.km += b.aggregate.productiveKm + b.aggregate.deadrunKm
    byBranch.set(b.branchId, br)
    const key = `${b.depotId}:${b.vehicleType}`
    const dp = byDepot.get(key) ?? { depotId: b.depotId, vehicleType: b.vehicleType, fleet: 0 }
    dp.fleet++
    byDepot.set(key, dp)
    if (b.hasIssues) issueBlocks++
  }
  const r = state.result()
  const round = (n: number) => Math.round(n * 100) / 100
  const criteria = state.criteria().map(c => ({ key: c.key, weight: c.weight, value: Math.round(c.value * 1e4) / 1e4 }))
  return {
    score: r.score, fleetCount: r.fleetCount,
    deadrunKm: round(r.deadrunKm), productiveKm: round(r.productiveKm), totalKm: round(r.totalKm),
    issueBlocks,
    byBranch: [...byBranch.entries()].map(([branchId, v]) => ({ branchId, fleet: v.fleet, km: round(v.km) })),
    byDepot:  [...byDepot.values()],
    criteria,
  }
}

// a proposal: the rebuilt blocks next to the locked ones
export function summarizeProposal(model: VehicleModel, blocks: WorkBlock[]): VehicleSolverSummary {
  const { reportSettings, planTrips, shares, locked } = model.input
  return summarizeBlocks(reportSettings, planTrips, shares, [
    ...locked,
    ...blocks.map(b => ({ depotId: b.depotId, branchId: b.branchId, vehicleType: b.vehicleType, aggregate: b.agg, hasIssues: blockHasIssues(model, b) })),
  ])
}

