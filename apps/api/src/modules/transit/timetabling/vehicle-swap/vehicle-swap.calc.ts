import type { ReliefPoint } from '@nyx/schemas'
import { computeServiceSpans, isReliefPoint, subtractSpans } from '../crew-plan/relief-points'

// Pure "Reduzir trocas de carro" analysis (no Prisma).
//
// For each vehicle change of a DRIVER duty in the ACTIVE crew plan (leaves car X at t1,
// boards car Y at t2), the candidate swaps everything X does from t1 on with everything
// Y does from t2 on ("tail swap"): X keeps its head and receives Y's tail, so the duty
// stays on X. Each car keeps its head, depot and number; the junction between a head and
// the tail it receives is rebuilt:
// - reuse the tail's own lead-in when it is a single deadrun from where the car already is
//   (e.g. the same depot's ACCESS) — DIRECT;
// - nothing to do when the car is already where the tail starts — DIRECT;
// - otherwise a new ACCESS (car at its depot, arriving just before the tail) — DEPOT — or a
//   new DISPLACEMENT (car at a terminal, leaving right after its head, so the car waits at
//   the tail's start) — DISPLACEMENT;
// - fallback "via depot": a car at a terminal whose received tail starts with an ACCESS from
//   its own depot gets a new RETURN and keeps that ACCESS — DEPOT. Tried when the preferred
//   junction would invalidate a piece of the active plan (e.g. one starting at the pull-out).
// The head's trailing RETURN stays with the head. Depot deadruns inside a received tail are
// re-targeted to the receiving car's depot (DEPOT). Deadrun timing mirrors
// block-mutation.utils.ts (matrix baseMinutes × speedRatio, arriving 1 min before the trip).
//
// The car's own intervals after its head are shifted/trimmed around the new junction
// (dropped when nothing is left).
//
// Pieces follow the trips in every crew plan of the VehiclePlan: a piece ending by the
// head's end stays, one starting after it moves with the tail, one straddling it can't
// follow. A moving piece that started at the giver's layover (e.g. the arrival of the
// giver's previous trip) starts instead at the first point where the receiving car is at
// that same place — it only loses layover time. The triggering duty's piece on X is extended
// over a new deadrun leaving right after X's head (DISPLACEMENT or via-depot RETURN): the
// same driver stays with the car — unless the duty is busy at that time. A candidate is rejected when any piece of the active plan would become invalid;
// pieces of other plans that do are only counted (they go stale on the next recalc).

type Span = { startMinutes: number; endMinutes: number }
type DeadrunType = 'ACCESS' | 'RETURN' | 'DISPLACEMENT'

export interface SwapTrip {
  blockTripId: string; tripId: string
  departureMinutes: number; arrivalMinutes: number
  originLocalityId: string; destinationLocalityId: string
}
export interface SwapDeadrun {
  id: string; type: DeadrunType
  originLocalityId: string; destinationLocalityId: string
  departureMinutes: number; arrivalMinutes: number
}
export interface SwapInterval { id: string; departureMinutes: number; arrivalMinutes: number }

export interface SwapBlock {
  id: string; blockNumber: number; branchId: string | null; vehicleType: string; depotId: string
  trips:     SwapTrip[]
  deadruns:  SwapDeadrun[]
  intervals: SwapInterval[]
  // trip-derived relief points (origin/destination/crew-change stops, all carrying tripId)
  tripPoints: ReliefPoint[]
}

export interface SwapPiece {
  id: string; dutyId: string; crewPlanId: string; role: string; vehicleBlockId: string
  startMinutes: number; endMinutes: number; startLocalityId: string; endLocalityId: string
}

export interface MatrixEntry { minutes: number; km: number }

export type Junction = 'DIRECT' | 'DEPOT' | 'DISPLACEMENT'

// everything the apply step writes, in terms of ids that exist before the swap
export interface SwapWrite {
  moves:            { fromBlockId: string; toBlockId: string; blockTripIds: string[]; deadrunIds: string[]; intervalIds: string[] }[]
  deadrunDeletes:   string[]
  deadrunCreates:   (Omit<SwapDeadrun, 'id'> & { vehicleBlockId: string })[]
  deadrunRetargets: Omit<SwapDeadrun, 'type'>[]
  intervalUpdates:  SwapInterval[]
  intervalDeletes:  string[]
  // block change and/or start/end adjustments (see the header)
  pieceUpdates:     { pieceId: string; data: { vehicleBlockId?: string; startMinutes?: number; endMinutes?: number; endLocalityId?: string } }[]
}

export interface SwapCandidate {
  key: string
  x: { blockId: string; blockNumber: number; cutMinutes: number }
  y: { blockId: string; blockNumber: number; cutMinutes: number }
  junction:              Junction
  // DRIVER vehicle changes removed across the active plan (> 0)
  gain:                  number
  duties:                { dutyId: string; before: number; after: number }[]
  deadrunMinutesDelta:   number
  deadrunKmDelta:        number
  // active plan: minutes without a driver on the two cars, after − before
  uncoveredDelta:        number
  // pieces of other crew plans left invalid
  staleElsewhere:        number
  // pre-checked in the modal: no new displacement, no new uncovered time
  recommended:           boolean
  write:                 SwapWrite
}

const JUNCTION_RANK: Record<Junction, number> = { DIRECT: 0, DEPOT: 1, DISPLACEMENT: 2 }
const worst = (a: Junction, b: Junction): Junction => (JUNCTION_RANK[a] >= JUNCTION_RANK[b] ? a : b)
const dur   = (s: { departureMinutes: number; arrivalMinutes: number }) => s.arrivalMinutes - s.departureMinutes

// ── split a block at a cut ───────────────────────────────────────────────────

interface Split {
  head: SwapTrip[]; tail: SwapTrip[]
  headDeadruns: SwapDeadrun[]   // incl. those ending by the cut and a RETURN right after the head
  leadIn:       SwapDeadrun[]   // gap deadruns that only take the car to its tail
  tailDeadruns: SwapDeadrun[]
  headIntervals: SwapInterval[]
  tailIntervals: SwapInterval[]
  // end of the head (incl. trailing RETURN); -Infinity when the car has no head
  headEnd: number
  // where/when the car is once its head is done
  state: { localityId: string; minutes: number; atDepot: boolean }
}

// where the car is after its head's last trip and the deadruns that followed it by the cut
function lastPlaceOf(head: SwapTrip[], headDeadruns: SwapDeadrun[]): string {
  const lastArr = head[head.length - 1].arrivalMinutes
  const after = headDeadruns.filter(d => d.departureMinutes >= lastArr).sort((a, b) => a.departureMinutes - b.departureMinutes)
  return after.length ? after[after.length - 1].destinationLocalityId : head[head.length - 1].destinationLocalityId
}

function splitBlock(block: SwapBlock, cut: number): Split | null {
  if (block.trips.some(t => t.departureMinutes < cut && t.arrivalMinutes > cut)) return null // mid-trip

  const head = block.trips.filter(t => t.arrivalMinutes <= cut)
  const tail = block.trips.filter(t => t.departureMinutes >= cut)
  const lastArr  = head.length ? head[head.length - 1].arrivalMinutes : -Infinity
  const firstDep = tail.length ? tail[0].departureMinutes : Infinity

  // the cut is a piece boundary, so it also splits the deadruns between the two trips around
  // it: ending by the cut → driven as part of the head (e.g. a displacement to where the car
  // waits); starting after it → the tail's lead-in. A RETURN right after the head also stays
  // with the head (the car goes home); with no tail everything left is the head's.
  const headDeadruns: SwapDeadrun[] = [], tailDeadruns: SwapDeadrun[] = [], gap: SwapDeadrun[] = []
  for (const d of block.deadruns) {
    if (d.arrivalMinutes <= cut) headDeadruns.push(d)
    else if (d.departureMinutes >= firstDep) tailDeadruns.push(d)
    else if (d.departureMinutes >= cut && d.arrivalMinutes <= firstDep) gap.push(d)
    else return null // deadrun across the cut or a trip — leave the block alone
  }
  gap.sort((a, b) => a.departureMinutes - b.departureMinutes)

  let leadIn: SwapDeadrun[] = gap
  if (tail.length === 0) {
    headDeadruns.push(...gap); leadIn = []
  } else if (head.length && gap[0]?.type === 'RETURN' && gap[0].originLocalityId === lastPlaceOf(head, headDeadruns)) {
    headDeadruns.push(gap[0]); leadIn = gap.slice(1)
  }
  headDeadruns.sort((a, b) => a.departureMinutes - b.departureMinutes)
  const lastHeadDeadrun = headDeadruns.length && headDeadruns[headDeadruns.length - 1].arrivalMinutes > lastArr
    ? headDeadruns[headDeadruns.length - 1] : null

  const headIntervals = tail.length ? block.intervals.filter(i => i.arrivalMinutes <= firstDep) : block.intervals
  const tailIntervals = tail.length ? block.intervals.filter(i => i.departureMinutes >= firstDep) : []
  if (headIntervals.length + tailIntervals.length !== block.intervals.length) return null

  const headEnd = lastHeadDeadrun ? lastHeadDeadrun.arrivalMinutes : lastArr
  const state = !head.length
    ? { localityId: block.depotId, minutes: -Infinity, atDepot: true }
    : lastHeadDeadrun
      ? { localityId: lastHeadDeadrun.destinationLocalityId, minutes: lastHeadDeadrun.arrivalMinutes, atDepot: lastHeadDeadrun.type === 'RETURN' }
      : { localityId: head[head.length - 1].destinationLocalityId, minutes: lastArr, atDepot: false }

  return { head, tail, headDeadruns, leadIn, tailDeadruns, headIntervals, tailIntervals, headEnd, state }
}

// ── rebuild one car: its head + the tail it receives ─────────────────────────

interface Rebuilt {
  trips:     SwapTrip[]
  deadruns:  Omit<SwapDeadrun, 'id'>[]
  intervals: SwapInterval[]
  junction:  Junction
  keptLeadIn:  SwapDeadrun[]
  created:     Omit<SwapDeadrun, 'id'>[]
  retargets:   Omit<SwapDeadrun, 'type'>[]
  retargetedFrom: SwapDeadrun[]
  intervalUpdates: SwapInterval[]
  dropped:     string[] // head intervals no longer fitting
}

function rebuild(
  car: SwapBlock, own: Split, received: Split, giver: SwapBlock,
  matrix: (from: string, to: string) => MatrixEntry | undefined,
  viaDepot: boolean,
): Rebuilt | null {
  let junction: Junction = 'DIRECT'
  const keptLeadIn: SwapDeadrun[] = [], created: Omit<SwapDeadrun, 'id'>[] = []

  if (received.tail.length) {
    const first = received.tail[0]
    const { state } = own
    const lead  = received.leadIn
    const pullOut = lead.length === 1 && lead[0].type === 'ACCESS' && lead[0].originLocalityId === car.depotId
      && lead[0].destinationLocalityId === first.originLocalityId ? lead[0] : null
    if (lead.length === 1 && lead[0].originLocalityId === state.localityId
      && lead[0].destinationLocalityId === first.originLocalityId && lead[0].departureMinutes >= state.minutes) {
      keptLeadIn.push(lead[0])
    } else if (viaDepot) {
      if (state.atDepot || !pullOut) return null
      const m = matrix(state.localityId, car.depotId)
      if (!m) return null
      const departureMinutes = state.minutes + 1
      if (departureMinutes + m.minutes > pullOut.departureMinutes) return null
      created.push({ type: 'RETURN', originLocalityId: state.localityId, destinationLocalityId: car.depotId, departureMinutes, arrivalMinutes: departureMinutes + m.minutes })
      keptLeadIn.push(pullOut)
      junction = 'DEPOT'
    } else if (state.localityId !== first.originLocalityId) {
      const m = matrix(state.localityId, first.originLocalityId)
      if (!m) return null
      const type: DeadrunType = state.atDepot ? 'ACCESS' : 'DISPLACEMENT'
      const departureMinutes = state.atDepot ? first.departureMinutes - m.minutes - 1 : state.minutes + 1
      const arrivalMinutes   = departureMinutes + m.minutes
      if (departureMinutes < state.minutes || arrivalMinutes > first.departureMinutes) return null
      created.push({ type, originLocalityId: state.localityId, destinationLocalityId: first.originLocalityId, departureMinutes, arrivalMinutes })
      junction = state.atDepot ? 'DEPOT' : 'DISPLACEMENT'
    } else if (state.minutes > first.departureMinutes) {
      return null
    }
  }

  // depot deadruns inside the received tail go to this car's depot
  const retargets: Omit<SwapDeadrun, 'type'>[] = [], retargetedFrom: SwapDeadrun[] = []
  const tailDeadruns: Omit<SwapDeadrun, 'id'>[] = []
  for (const d of received.tailDeadruns) {
    if (giver.depotId !== car.depotId && d.type === 'RETURN' && d.destinationLocalityId === giver.depotId) {
      const m = matrix(d.originLocalityId, car.depotId)
      if (!m) return null
      const next = { ...d, destinationLocalityId: car.depotId, arrivalMinutes: d.departureMinutes + m.minutes }
      retargets.push(next); retargetedFrom.push(d); tailDeadruns.push(next)
    } else if (giver.depotId !== car.depotId && d.type === 'ACCESS' && d.originLocalityId === giver.depotId) {
      const m = matrix(car.depotId, d.destinationLocalityId)
      if (!m) return null
      const next = { ...d, originLocalityId: car.depotId, departureMinutes: d.arrivalMinutes - m.minutes }
      retargets.push(next); retargetedFrom.push(d); tailDeadruns.push(next)
    } else {
      tailDeadruns.push(d)
    }
  }
  if (retargets.length) junction = worst(junction, 'DEPOT')

  const trips    = [...own.head, ...received.tail]
  const deadruns = [...own.headDeadruns, ...keptLeadIn, ...created, ...tailDeadruns]

  // the car's own intervals after its head give way to the junction and the received tail:
  // the deadrun leaving right after the head, or any event covering an interval's start,
  // pushes the start later; any other event inside it cuts its end
  const busy = [...keptLeadIn, ...created, ...tailDeadruns, ...received.tail].sort((a, b) => a.departureMinutes - b.departureMinutes)
  const leavesAfterHead = (e: { departureMinutes: number }) => created.some(c => c === e && c.type !== 'ACCESS')
  const intervalUpdates: SwapInterval[] = [], dropped: string[] = []
  const intervals: SwapInterval[] = []
  for (const i of own.headIntervals) {
    let { departureMinutes, arrivalMinutes } = i
    for (const e of busy) {
      if (e.departureMinutes >= arrivalMinutes || e.arrivalMinutes <= departureMinutes) continue
      if (e.departureMinutes <= departureMinutes || leavesAfterHead(e)) departureMinutes = e.arrivalMinutes
      else arrivalMinutes = e.departureMinutes
    }
    if (arrivalMinutes <= departureMinutes) { dropped.push(i.id); continue }
    const next = { id: i.id, departureMinutes, arrivalMinutes }
    if (departureMinutes !== i.departureMinutes || arrivalMinutes !== i.arrivalMinutes) intervalUpdates.push(next)
    intervals.push(next)
  }
  intervals.push(...received.tailIntervals)

  // moving events never overlap
  const events = [...trips, ...deadruns].sort((a, b) => a.departureMinutes - b.departureMinutes)
  for (let k = 1; k < events.length; k++) if (events[k].departureMinutes < events[k - 1].arrivalMinutes) return null

  return { trips, deadruns, intervals, junction, keptLeadIn, created, retargets, retargetedFrom, intervalUpdates, dropped }
}

// ── helpers on a (virtual) block ─────────────────────────────────────────────

interface BlockShape {
  tripIds:   Set<string>
  trips:     { departureMinutes: number; arrivalMinutes: number }[]
  deadruns:  Omit<SwapDeadrun, 'id'>[]
  intervals: { departureMinutes: number; arrivalMinutes: number }[]
}

function windowOf(b: BlockShape): Span | null {
  const all = [...b.trips, ...b.deadruns, ...b.intervals]
  if (!all.length) return null
  return { startMinutes: Math.min(...all.map(e => e.departureMinutes)), endMinutes: Math.max(...all.map(e => e.arrivalMinutes)) }
}

function pointsOf(b: BlockShape, tripPoints: ReliefPoint[]): ReliefPoint[] {
  return [
    ...tripPoints.filter(p => p.tripId && b.tripIds.has(p.tripId)),
    ...b.deadruns.flatMap(d => [
      { localityId: d.originLocalityId,      minutes: d.departureMinutes, kind: 'DEADRUN_ORIGIN' as const },
      { localityId: d.destinationLocalityId, minutes: d.arrivalMinutes,   kind: 'DEADRUN_DESTINATION' as const },
    ]),
  ]
}

function pieceFits(p: SwapPiece, window: Span | null, points: ReliefPoint[]): boolean {
  return !!window && p.startMinutes >= window.startMinutes && p.endMinutes <= window.endMinutes
    && isReliefPoint(points, p.startLocalityId, p.startMinutes) && isReliefPoint(points, p.endLocalityId, p.endMinutes)
}

function uncoveredMinutes(b: BlockShape, drivers: Span[]): number {
  const window = windowOf(b)
  if (!window) return 0
  return computeServiceSpans(window, [...b.trips, ...b.deadruns], b.deadruns, b.intervals)
    .reduce((sum, span) => sum + subtractSpans(span, drivers).reduce((s, u) => s + u.endMinutes - u.startMinutes, 0), 0)
}

const vehicleChanges = (pieces: { startMinutes: number; blockId: string }[]) =>
  [...pieces].sort((a, b) => a.startMinutes - b.startMinutes)
    .reduce((n, p, i, arr) => n + (i > 0 && arr[i - 1].blockId !== p.blockId ? 1 : 0), 0)

// ── analysis ────────────────────────────────────────────────────────────────

export function analyzeVehicleSwaps(input: {
  blocks:       SwapBlock[]
  pieces:       SwapPiece[] // live pieces of every crew plan of the VehiclePlan
  activePlanId: string
  // activities of the active plan's duties (a piece is only extended over free time)
  activities:   { dutyId: string; startMinutes: number; endMinutes: number }[]
  matrix:       (from: string, to: string) => MatrixEntry | undefined
}): SwapCandidate[] {
  const { matrix, activePlanId } = input
  const blocks = new Map(input.blocks.map(b => [b.id, b]))
  const piecesByBlock = new Map<string, SwapPiece[]>()
  const activeByDuty  = new Map<string, SwapPiece[]>()
  for (const p of input.pieces) {
    piecesByBlock.set(p.vehicleBlockId, [...(piecesByBlock.get(p.vehicleBlockId) ?? []), p])
    if (p.crewPlanId === activePlanId && p.role === 'DRIVER') activeByDuty.set(p.dutyId, [...(activeByDuty.get(p.dutyId) ?? []), p])
  }

  const activitiesByDuty = new Map<string, { startMinutes: number; endMinutes: number }[]>()
  for (const a of input.activities) activitiesByDuty.set(a.dutyId, [...(activitiesByDuty.get(a.dutyId) ?? []), a])

  const deadrunKm = (d: { originLocalityId: string; destinationLocalityId: string }) => matrix(d.originLocalityId, d.destinationLocalityId)?.km ?? 0

  // tries the preferred junctions first, then the via-depot fallback on either car
  const evaluate = (x: SwapBlock, trigger: SwapPiece, y: SwapBlock, cutY: number): SwapCandidate | null => {
    const cutX = trigger.endMinutes
    const sx = splitBlock(x, cutX), sy = splitBlock(y, cutY)
    if (!sx || !sy || !sx.head.length || !sy.tail.length) return null
    if (!sy.head.length && !sx.tail.length) return null // Y would be left without trips
    for (const [depotX, depotY] of [[false, false], [true, false], [false, true], [true, true]]) {
      const nx = rebuild(x, sx, sy, y, matrix, depotX), ny = rebuild(y, sy, sx, x, matrix, depotY)
      const c = nx && ny ? evaluateWith(x, trigger, sx, nx, y, cutY, sy, ny) : null
      if (c) return c
    }
    return null
  }

  const evaluateWith = (
    x: SwapBlock, trigger: SwapPiece, sx: Split, nx: Rebuilt,
    y: SwapBlock, cutY: number, sy: Split, ny: Rebuilt,
  ): SwapCandidate | null => {
    const cutX = trigger.endMinutes
    const shapeX: BlockShape = { tripIds: new Set(nx.trips.map(t => t.tripId)), trips: nx.trips, deadruns: nx.deadruns, intervals: nx.intervals }
    const shapeY: BlockShape = { tripIds: new Set(ny.trips.map(t => t.tripId)), trips: ny.trips, deadruns: ny.deadruns, intervals: ny.intervals }
    const tripPoints = [...x.tripPoints, ...y.tripPoints]
    const after = {
      [x.id]: { shape: shapeX, window: windowOf(shapeX), points: pointsOf(shapeX, tripPoints) },
      [y.id]: { shape: shapeY, window: windowOf(shapeY), points: pointsOf(shapeY, tripPoints) },
    }

    // pieces follow the trips: stay when ending by the head's end, move when starting after it
    const moved = new Map<string, { blockId: string; startMinutes: number; endMinutes: number }>()
    let staleElsewhere = 0
    for (const [car, other, split] of [[x, y, sx], [y, x, sy]] as const) {
      for (const p of piecesByBlock.get(car.id) ?? []) {
        const target = p.endMinutes <= split.headEnd ? car.id : p.startMinutes >= split.headEnd ? other.id : null
        let startMinutes = p.startMinutes
        if (target === other.id && !isReliefPoint(after[target].points, p.startLocalityId, p.startMinutes)) {
          const alt = after[target].points
            .filter(pt => pt.localityId === p.startLocalityId && pt.minutes > p.startMinutes && pt.minutes < p.endMinutes)
            .reduce<number | null>((min, pt) => (min == null || pt.minutes < min ? pt.minutes : min), null)
          if (alt != null) startMinutes = alt
        }
        const ok = target != null && pieceFits({ ...p, startMinutes }, after[target].window, after[target].points)
        if (!ok) {
          if (p.crewPlanId === activePlanId) return null
          staleElsewhere++
        }
        if (target) moved.set(p.id, { blockId: target, startMinutes, endMinutes: p.endMinutes })
      }
    }

    // the triggering driver takes X over the new deadrun right after its head, when free
    const followUp = nx.created.find(d => d.type !== 'ACCESS' && d.departureMinutes === sx.state.minutes + 1)
    let extension: { endMinutes: number; endLocalityId: string } | null = null
    if (followUp && trigger.endMinutes === sx.state.minutes && trigger.endLocalityId === followUp.originLocalityId) {
      const busyDuty = [...(activeByDuty.get(trigger.dutyId) ?? []).filter(p => p.id !== trigger.id), ...(activitiesByDuty.get(trigger.dutyId) ?? [])]
        .some(e => e.startMinutes < followUp.arrivalMinutes && e.endMinutes > trigger.endMinutes)
      if (!busyDuty) {
        extension = { endMinutes: followUp.arrivalMinutes, endLocalityId: followUp.destinationLocalityId }
        moved.set(trigger.id, { blockId: x.id, startMinutes: trigger.startMinutes, endMinutes: extension.endMinutes })
      }
    }

    const pieceUpdates: SwapWrite['pieceUpdates'] = []
    for (const p of input.pieces) {
      const m = moved.get(p.id)
      if (!m) continue
      const data: SwapWrite['pieceUpdates'][number]['data'] = {}
      if (m.blockId !== p.vehicleBlockId) data.vehicleBlockId = m.blockId
      if (m.startMinutes !== p.startMinutes) data.startMinutes = m.startMinutes
      if (p.id === trigger.id && extension) Object.assign(data, extension)
      if (Object.keys(data).length) pieceUpdates.push({ pieceId: p.id, data })
    }
    const blockAfter = (p: SwapPiece) => moved.get(p.id)?.blockId ?? p.vehicleBlockId

    // gain: DRIVER vehicle changes of the active plan's affected duties
    const dutyIds = new Set((piecesByBlock.get(x.id) ?? []).concat(piecesByBlock.get(y.id) ?? [])
      .filter(p => p.crewPlanId === activePlanId && p.role === 'DRIVER').map(p => p.dutyId))
    const duties = [...dutyIds].map(dutyId => {
      const ps = activeByDuty.get(dutyId) ?? []
      return {
        dutyId,
        before: vehicleChanges(ps.map(p => ({ startMinutes: p.startMinutes, blockId: p.vehicleBlockId }))),
        after:  vehicleChanges(ps.map(p => ({ startMinutes: p.startMinutes, blockId: blockAfter(p) }))),
      }
    })
    const gain = duties.reduce((s, d) => s + d.before - d.after, 0)
    if (gain <= 0) return null

    // active plan coverage on the two cars, before vs after
    const driverSpans = (blockId: string, remapped: boolean): Span[] => input.pieces
      .filter(p => p.crewPlanId === activePlanId && p.role === 'DRIVER' && (remapped ? blockAfter(p) : p.vehicleBlockId) === blockId)
      .map(p => (remapped ? { startMinutes: moved.get(p.id)?.startMinutes ?? p.startMinutes, endMinutes: moved.get(p.id)?.endMinutes ?? p.endMinutes } : p))
    const shapeOf = (b: SwapBlock): BlockShape => ({ tripIds: new Set(b.trips.map(t => t.tripId)), trips: b.trips, deadruns: b.deadruns, intervals: b.intervals })
    const uncoveredBefore = uncoveredMinutes(shapeOf(x), driverSpans(x.id, false)) + uncoveredMinutes(shapeOf(y), driverSpans(y.id, false))
    const uncoveredAfter  = uncoveredMinutes(shapeX, driverSpans(x.id, true)) + uncoveredMinutes(shapeY, driverSpans(y.id, true))

    const removed = [...sx.leadIn, ...sy.leadIn].filter(d => !nx.keptLeadIn.includes(d) && !ny.keptLeadIn.includes(d))
    const added   = [...nx.created, ...ny.created]
    const retargetedFrom = [...nx.retargetedFrom, ...ny.retargetedFrom], retargets = [...nx.retargets, ...ny.retargets]
    const deadrunMinutesDelta = [...added, ...retargets].reduce((s, d) => s + dur(d), 0) - [...removed, ...retargetedFrom].reduce((s, d) => s + dur(d), 0)
    const deadrunKmDelta = [...added, ...retargets].reduce((s, d) => s + deadrunKm(d), 0)
      - [...removed, ...retargetedFrom].reduce((s, d) => s + deadrunKm(d), 0)

    const junction = worst(nx.junction, ny.junction)
    const uncoveredDelta = uncoveredAfter - uncoveredBefore
    return {
      key: `${x.id}@${cutX}:${y.id}@${cutY}`,
      x: { blockId: x.id, blockNumber: x.blockNumber, cutMinutes: cutX },
      y: { blockId: y.id, blockNumber: y.blockNumber, cutMinutes: cutY },
      junction, gain, duties: duties.filter(d => d.before !== d.after),
      deadrunMinutesDelta, deadrunKmDelta: Math.round(deadrunKmDelta * 10) / 10,
      uncoveredDelta, staleElsewhere,
      recommended: junction !== 'DISPLACEMENT' && uncoveredDelta <= 0,
      write: {
        moves: [
          { fromBlockId: x.id, toBlockId: y.id, blockTripIds: sx.tail.map(t => t.blockTripId), deadrunIds: [...sx.tailDeadruns, ...ny.keptLeadIn].map(d => d.id), intervalIds: sx.tailIntervals.map(i => i.id) },
          { fromBlockId: y.id, toBlockId: x.id, blockTripIds: sy.tail.map(t => t.blockTripId), deadrunIds: [...sy.tailDeadruns, ...nx.keptLeadIn].map(d => d.id), intervalIds: sy.tailIntervals.map(i => i.id) },
        ].filter(m => m.blockTripIds.length),
        deadrunDeletes:   removed.map(d => d.id),
        deadrunCreates:   [...nx.created.map(d => ({ ...d, vehicleBlockId: x.id })), ...ny.created.map(d => ({ ...d, vehicleBlockId: y.id }))],
        deadrunRetargets: retargets,
        intervalUpdates:  [...nx.intervalUpdates, ...ny.intervalUpdates],
        intervalDeletes:  [...nx.dropped, ...ny.dropped],
        pieceUpdates,
      },
    }
  }

  // one candidate per vehicle change of a DRIVER duty (same operator, same vehicle type)
  const seen = new Set<string>()
  const candidates: SwapCandidate[] = []
  for (const ps of activeByDuty.values()) {
    const sorted = [...ps].sort((a, b) => a.startMinutes - b.startMinutes)
    for (let i = 1; i < sorted.length; i++) {
      const p = sorted[i - 1], q = sorted[i]
      const x = blocks.get(p.vehicleBlockId), y = blocks.get(q.vehicleBlockId)
      if (!x || !y || x.id === y.id || x.branchId !== y.branchId || x.vehicleType !== y.vehicleType) continue
      const key = `${x.id}@${p.endMinutes}:${y.id}@${q.startMinutes}`
      if (seen.has(key)) continue
      seen.add(key)
      const c = evaluate(x, p, y, q.startMinutes)
      if (c) candidates.push(c)
    }
  }

  // independent set: each car in at most one swap, best first — any subset of it can be
  // applied as-is (every candidate was evaluated against the current state)
  candidates.sort((a, b) => b.gain - a.gain || a.uncoveredDelta - b.uncoveredDelta
    || JUNCTION_RANK[a.junction] - JUNCTION_RANK[b.junction] || a.deadrunKmDelta - b.deadrunKmDelta)
  const used = new Set<string>()
  return candidates.filter(c => {
    if (used.has(c.x.blockId) || used.has(c.y.blockId)) return false
    used.add(c.x.blockId); used.add(c.y.blockId)
    return true
  })
}
