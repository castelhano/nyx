import type { CrewSettings, RangeCriterion, ReliefPoint } from '@nyx/schemas'
import { mealPolicy } from '@nyx/schemas'
import { computeCrewPlan, mealStopAt, type CrewCalcBlock, type CrewCalcDuty, type CrewCalcResult } from '../crew-plan/crew-scoring.calc'
import { depotStays, subtractSpans } from '../crew-plan/relief-points'
import { walkMeters, walkMinutes, type CrewWalk } from '../crew-plan/crew-walk'
import { rangeV } from '../vehicle-plan/scoring/plan-scoring.calc'

// Crew solver — construction stage (pure, no Prisma). See docs/architecture/transit/crew-solver.md.
//
// Vehicles are fixed: the solver only decides who drives what. It covers every stretch the
// vehicles need a DRIVER for (serviceSpans) that the locked duties don't already cover, with
// DRIVER duties whose pieces start/end at relief points, and places meal BREAKs explicitly.
//
// 1. Chains — per block, the uncovered service spans, joined across the vehicle's own idle
//    time (intervals) but not across locked coverage: a driver can stay with the vehicle
//    through an interval. A depot stay joins them only when it fits range.splitInterval, and
//    then only as a split — the driver leaves the vehicle at the depot and comes back to it.
// 2. Each chain is covered with whole duties on the same vehicle — around one of its idle gaps
//    (STRAIGHT with the meal inside the piece when the gap fits the meal type's range at a meal
//    stop of the arriving line; SPLIT when it's longer and fits range.splitInterval, the driver
//    leaves, two pieces on the same vehicle) or, when settings.mealRule takes a STRAIGHT
//    without a meal break (fractioned, or not required), a single piece whose stops meet the
//    rule (within one segment), every hard rule met. One duty if it fits, else two; else one
//    at each end near workTime.idealMin with the rest between them (the incomplete part in the
//    middle); else one and the rest loose. Loose pieces are about half an ideal duty (so two
//    of them pair up), within continuous driving, never leaving a remainder shorter than the
//    minimum piece and never crossing the vehicle's own intervals (that idle time would count
//    as driving).
// 3. Loose pieces are paired into STRAIGHT duties (meal between them, gap within the meal
//    type's range — or a worked gap: when the rule allows one without a meal break, or short)
//    or SPLIT duties (gap within range.splitInterval, when active); the cheapest wins. What's
//    left becomes a STRAIGHT of its own. The construction places no TRIPPER: a short duty is
//    an incomplete STRAIGHT, flagged (WORK_TIME) for review.
// 4. The result is evaluated by computeCrewPlan — the same score/issues the screen shows.
//
// Choices (which cut, which partner) are weighed in the plan score's own units: each criterion
// costs what it would take off the score (modifier × (1 − rangeV)). A SPLIT also costs the
// splitRatio modifier, so a STRAIGHT wins when everything else ties. Pieces at different
// places pair only within walking distance (crew-walk.ts), the walk costing range.walkDistance.

type Span = { startMinutes: number; endMinutes: number }

export interface SolverBlock extends CrewCalcBlock {
  deadruns: { type: string; departureMinutes: number; arrivalMinutes: number }[]
}

// the IntervalType placed as meal break (settings.mealBreakIntervalTypeId) and its range —
// null when settings.mealRule places no meal break (mealPolicy.breaks)
export interface SolverMeal { intervalTypeId: string; minMinutes: number; maxMinutes: number; isPaid: boolean }

export interface CrewSolverInput {
  blocks:        SolverBlock[]
  // kept as they are — their live DRIVER pieces are already covered
  locked:        CrewCalcDuty[]
  settings:      CrewSettings
  meal:          SolverMeal | null
  mealStops:     Set<string>         // `${routeId}:${localityId}` of RouteLocality.allowsMealBreak
  walk:          CrewWalk            // crew walking between relief points
}

export interface SolverPiece {
  vehicleBlockId: string
  startMinutes: number; endMinutes: number
  startLocalityId: string; endLocalityId: string
}

export interface SolverDuty {
  kind:     'STRAIGHT' | 'SPLIT' | 'TRIPPER'
  branchId: string | null
  pieces:   SolverPiece[]
  // meal BREAKs (meal.intervalTypeId) — inside a piece or between the two pieces
  breaks:   Span[]
}

export interface CrewSolverResult {
  duties:     SolverDuty[]
  evaluation: CrewCalcResult
}

// a whole duty the construction can place, its cost (score units) and minutes worked
type Whole = { duty: SolverDuty; cost: number; work: number }
const EPS = 1e-9

const len = (s: Span) => s.endMinutes - s.startMinutes
const overlaps = (a: Span, b: Span) => Math.min(a.endMinutes, b.endMinutes) > Math.max(a.startMinutes, b.startMinutes)
// what the criterion takes off the plan score for this value — 0 when inactive
const penalty = (c: RangeCriterion, v: number) => (c.active ? c.modifier * (1 - rangeV(v, c)) : 0)

// lines driven in order (consecutive repeats merged) and the changes among them
type LineSeq = { first: string | null; last: string | null; changes: number }
const joinLines = (a: LineSeq, b: LineSeq): number =>
  a.changes + b.changes + (a.last && b.first && a.last !== b.first ? 1 : 0)

// per-block lookups the construction needs
export class BlockView {
  readonly cuts: number[]                 // relief point minutes, ascending, unique
  private readonly pointAt = new Map<number, ReliefPoint>()
  readonly parks: Span[]                  // depot stays (see depotStays)
  readonly moving: Span[]                 // trips + deadruns

  constructor(readonly block: SolverBlock, private readonly mealStops: Set<string>) {
    for (const p of block.points) if (!this.pointAt.has(p.minutes)) this.pointAt.set(p.minutes, p)
    this.cuts = [...this.pointAt.keys()].sort((a, b) => a - b)
    this.parks = depotStays([...block.trips, ...block.deadruns], block.deadruns)
    this.moving = [...block.trips, ...block.deadruns]
      .map(e => ({ startMinutes: e.departureMinutes, endMinutes: e.arrivalMinutes }))
      .sort((a, b) => a.startMinutes - b.startMinutes)
  }

  locality(minutes: number): string { return this.pointAt.get(minutes)!.localityId }

  isCut(minutes: number): boolean { return this.pointAt.has(minutes) }

  cutsIn(from: number, to: number): number[] { return this.cuts.filter(c => c >= from && c <= to) }

  // same rule the crew plan calculation flags MEAL_LOCATION with
  mealAllowed(minutes: number, localityId?: string): boolean {
    return mealStopAt(this.block, minutes, this.mealStops, localityId)
  }

  // same sequence computeCrewPlan counts lineChanges on: the trips overlapping [from, to]
  lines(from: number, to: number): LineSeq {
    const seq: string[] = []
    for (const t of this.block.trips) {
      if (t.arrivalMinutes > from && t.departureMinutes < to && seq[seq.length - 1] !== t.lineId) seq.push(t.lineId)
    }
    return { first: seq[0] ?? null, last: seq[seq.length - 1] ?? null, changes: Math.max(0, seq.length - 1) }
  }

  // the vehicle's stops inside [from, to]: total and longest (fractioned intrajornada)
  stops(from: number, to: number): { total: number; longest: number } {
    let total = 0, longest = 0
    for (const g of subtractSpans({ startMinutes: from, endMinutes: to }, this.moving)) {
      total += len(g); longest = Math.max(longest, len(g))
    }
    return { total, longest }
  }

  // minutes of [from, to] the vehicle is out of service (its intervals, depot stays) that
  // `rest` doesn't cover — a piece there would have the driver "working" a parked vehicle
  offService(from: number, to: number, rest?: Span): number {
    return subtractSpans({ startMinutes: from, endMinutes: to }, [...this.block.serviceSpans, ...(rest ? [rest] : [])])
      .reduce((s, sp) => s + len(sp), 0)
  }

  // idle stretches (no trip/deadrun) inside [from, to] that start at a relief point
  idleGaps(from: number, to: number): Span[] {
    return subtractSpans({ startMinutes: from, endMinutes: to }, this.moving).filter(g => this.pointAt.has(g.startMinutes))
  }
}

export function solveCrewPlan(input: CrewSolverInput): CrewSolverResult {
  const { settings, meal } = input
  const range    = settings.range
  const signs    = settings.signOnMinutes + settings.signOffMinutes
  const maxDrive = settings.maxContinuousDrivingMinutes
  const minPiece = settings.minPieceMinutes
  const work     = (spans: number, breakMinutes: number) => spans - (meal?.isPaid ? 0 : breakMinutes) + signs
  const mealFits = (l: number) => !!meal && l >= meal.minMinutes && l <= meal.maxMinutes
  // a split interval is longer than any meal
  const splitFits = (l: number) => range.splitInterval.active && l > (meal?.maxMinutes ?? 0) && l >= range.splitInterval.floor && l <= range.splitInterval.ceiling
  // a STRAIGHT without a meal break: when the rule takes the fractioned form (stops meet it) or
  // takes none at all
  const rule = settings.mealRule
  const policy = mealPolicy(rule)
  const plainOk = (st: { total: number; longest: number }) => !policy.required
    || (policy.fractioned && st.total >= rule.fractionedMinTotal && st.longest >= rule.fractionedMinLongest)
  const plainPossible = !policy.required || policy.fractioned
  const splitCost = range.splitRatio.active ? range.splitRatio.modifier : 0
  // hard limits: ceilings of the active criteria only
  const maxWork   = range.workTime.active ? range.workTime.ceiling : Infinity
  const maxSpread = range.spread.active ? range.spread.ceiling : Infinity
  const maxIdle   = range.idleTime.active ? range.idleTime.ceiling : Infinity
  // loose pieces aim at half an ideal duty, so two of them make one
  const pieceTarget = Math.min(maxDrive, Math.max(minPiece, Math.round((range.workTime.idealMax - signs) / 2)))
  // how far a duty at a chain's end is from workTime.idealMin — reaching it comes first
  const idealMinDev = (w: number) => (w >= range.workTime.idealMin ? w - range.workTime.idealMin : (range.workTime.idealMin - w) * 1000)

  const views = new Map(input.blocks.map(b => [b.id, new BlockView(b, input.mealStops)]))
  const lockedCover = new Map<string, Span[]>()
  for (const d of input.locked) {
    if (d.role !== 'DRIVER') continue
    for (const p of d.pieces) if (p.vehicleBlockId) lockedCover.set(p.vehicleBlockId, [...(lockedCover.get(p.vehicleBlockId) ?? []), p])
  }

  const duties: SolverDuty[] = []
  const loose: { piece: SolverPiece; branchId: string | null; lines: LineSeq }[] = []
  const piece = (v: BlockView, from: number, to: number): SolverPiece => ({
    vehicleBlockId: v.block.id, startMinutes: from, endMinutes: to,
    startLocalityId: v.locality(from), endLocalityId: v.locality(to),
  })
  // a cut is acceptable when it leaves nothing, or at least a minimum piece, behind
  const leavesValidRest = (cut: number, end: number) => cut === end || end - cut >= minPiece

  for (const v of views.values()) {
    const covered = lockedCover.get(v.block.id) ?? []
    const uncovered = v.block.serviceSpans.flatMap(s => subtractSpans(s, covered))

    // 1. chains — each keeps its uncovered spans as segments (joined over vehicle intervals, and
    //    over a depot stay that fits a split)
    const chains: (Span & { segments: Span[] })[] = []
    for (const u of uncovered) {
      const last = chains[chains.length - 1]
      const gap  = last && { startMinutes: last.endMinutes, endMinutes: u.startMinutes }
      if (gap && (!v.parks.some(p => overlaps(p, gap)) || splitFits(len(gap))) && !covered.some(c => overlaps(c, gap))) {
        last.endMinutes = u.endMinutes
        last.segments.push({ ...u })
      } else {
        chains.push({ ...u, segments: [{ ...u }] })
      }
    }

    for (const chain of chains) {
      // snap inward to relief points
      const cuts = v.cutsIn(chain.startMinutes, chain.endMinutes)
      if (cuts.length < 2) continue
      // segment bounds snapped to relief points: a loose piece stays inside one of them
      const segments = chain.segments
        .map(sg => v.cutsIn(sg.startMinutes, sg.endMinutes))
        .filter(c => c.length >= 2)
        .map(c => ({ startMinutes: c[0], endMinutes: c[c.length - 1] }))
      const gaps = v.idleGaps(cuts[0], cuts[cuts.length - 1]).flatMap(g => {
        const l = len(g)
        // a depot stay is never a meal inside the piece — only a split
        if (mealFits(l) && v.mealAllowed(g.startMinutes) && !v.parks.some(p => overlaps(p, g))) return [{ ...g, split: false }]
        // only gaps longer than the meal become a split (a meal-sized gap where meals aren't allowed doesn't)
        if (splitFits(l) && v.isCut(g.endMinutes)) return [{ ...g, split: true }]
        return []
      })

      // the cheapest whole duty covering exactly [from, to] on this vehicle, within every hard
      // rule — around one of its idle gaps (STRAIGHT with the meal inside the piece, or SPLIT)
      // or a single piece meeting the rule without a meal break; null when there's none
      const memo = new Map<string, Whole | null>()
      const dutyAt = (from: number, to: number): Whole | null => {
        const key = `${from}:${to}`
        if (memo.has(key)) return memo.get(key)!
        // assigned inside `keep` — typed wide so the return isn't narrowed away
        let best = null as Whole | null
        const keep = (duty: SolverDuty, w: number, cost: number) => { if (!best || cost < best.cost) best = { duty, cost, work: w } }
        const spread   = to - from + signs
        const lineCost = penalty(range.lineChanges, v.lines(from, to).changes)
        if (spread <= maxSpread) {
          for (const g of gaps) {
            const before = g.startMinutes - from, after = to - g.endMinutes
            if (before < minPiece || before > maxDrive || after < minPiece || after > maxDrive) continue
            // a split: the driver leaves and comes back to the vehicle — on foot if it moved
            // (no deadrun recorded); the pieces themselves stay in service
            if (g.split) {
              const meters = walkMeters(input.walk, v.locality(g.startMinutes), v.locality(g.endMinutes))
              if (meters == null || meters > settings.maxWalkMeters || len(g) < walkMinutes(meters)) continue
              if (v.offService(from, g.startMinutes) || v.offService(g.endMinutes, to)) continue
            } else if (v.offService(from, to, g)) continue
            // a split's gap is not worked; a meal break inside the piece counts only if paid
            const w = g.split ? before + after + signs : work(to - from, len(g))
            if (w > maxWork || w < range.workTime.floor) continue
            keep(
              g.split
                ? { kind: 'SPLIT', branchId: v.block.branchId, pieces: [piece(v, from, g.startMinutes), piece(v, g.endMinutes, to)], breaks: [] }
                : { kind: 'STRAIGHT', branchId: v.block.branchId, pieces: [piece(v, from, to)], breaks: [{ startMinutes: g.startMinutes, endMinutes: g.endMinutes }] },
              w,
              penalty(range.workTime, w) + penalty(range.spread, spread) + lineCost
                + (g.split ? splitCost + penalty(range.splitInterval, len(g)) : penalty(range.mealBreak, len(g))),
            )
          }
          // a single piece: inside one segment — the vehicle's own intervals aren't work
          if (plainPossible && to - from <= maxDrive && spread <= maxWork && spread >= range.workTime.floor
            && segments.some(sg => sg.startMinutes <= from && to <= sg.endMinutes) && plainOk(v.stops(from, to))) {
            keep({ kind: 'STRAIGHT', branchId: v.block.branchId, pieces: [piece(v, from, to)], breaks: [] }, spread,
              penalty(range.workTime, spread) + penalty(range.spread, spread) + lineCost)
          }
        }
        memo.set(key, best)
        return best
      }

      // where one duty can hand over to the next inside (from, to): at a relief point, or across
      // one of the vehicle's intervals between segments
      const bounds = (from: number, to: number): [number, number][] => [
        ...cuts.filter(c => c > from && c < to).map((c): [number, number] => [c, c]),
        ...segments.slice(1)
          .map((sg, i): [number, number] => [segments[i].endMinutes, sg.startMinutes])
          .filter(([a, b]) => a < b && a > from && b < to),
      ]

      // loose pieces of about half an ideal duty, inside the segments (skipping the vehicle's
      // intervals between them), within continuous driving, never leaving a remainder shorter
      // than the minimum piece
      const loosen = (from: number, to: number) => {
        let pos = from
        while (pos < to) {
          const seg = segments.find(sg => sg.endMinutes > pos && sg.startMinutes < to)
          if (!seg) break
          if (seg.startMinutes > pos) { pos = seg.startMinutes; continue }
          const segEnd    = Math.min(seg.endMinutes, to)
          const reachable = cuts.filter(c => c > pos && c <= segEnd && c - pos <= maxDrive)
          const fit       = reachable.filter(c => leavesValidRest(c, segEnd))
          const cut = segEnd - pos <= maxDrive && segEnd - pos <= pieceTarget * 1.5 ? segEnd
            : (fit.length ? fit : reachable).reduce<number | undefined>((b, c) => (b == null || Math.abs(c - pos - pieceTarget) < Math.abs(b - pos - pieceTarget) ? c : b), undefined)
              ?? cuts.find(c => c > pos)!
          loose.push({ piece: piece(v, pos, cut), branchId: v.block.branchId, lines: v.lines(pos, cut) })
          pos = cut
        }
      }

      // 2. cover [from, to] with whole duties, in this order:
      //    a. one duty;
      //    b. two — the cheapest pair, the more balanced among equals;
      //    c. one at each end, as close above workTime.idealMin as they get, and what's between
      //       covered the same way (usually a loose piece — the incomplete one stays in the middle,
      //       where it pairs up best);
      //    d. one, the cheapest (longest among equals), and the rest loose — after it, else before;
      //    e. loose pieces only.
      const cover = (from: number, to: number): void => {
        const one = dutyAt(from, to)
        if (one) { duties.push(one.duty); return }

        const bs = bounds(from, to)
        let two = null as { a: Whole; b: Whole; cost: number; skew: number } | null
        for (const [x, y] of bs) {
          const a = dutyAt(from, x), b = a && dutyAt(y, to)
          if (!a || !b) continue
          const cost = a.cost + b.cost, skew = Math.abs(a.work - b.work)
          if (!two || cost < two.cost - EPS || (cost < two.cost + EPS && skew < two.skew)) two = { a, b, cost, skew }
        }
        if (two) { duties.push(two.a.duty, two.b.duty); return }

        const lefts  = bs.flatMap(([x, y]) => { const d = dutyAt(from, x); return d ? [{ d, next: y }] : [] })
        const rights = bs.flatMap(([x, y]) => { const d = dutyAt(y, to); return d ? [{ d, prev: x }] : [] })
        let ends = null as { l: (typeof lefts)[number]; r: (typeof rights)[number]; dev: number } | null
        for (const l of lefts) {
          for (const r of rights) {
            if (r.prev - l.next < minPiece) continue
            const dev = idealMinDev(l.d.work) + idealMinDev(r.d.work)
            if (!ends || dev < ends.dev) ends = { l, r, dev }
          }
        }
        if (ends) {
          duties.push(ends.l.d.duty, ends.r.d.duty)
          cover(ends.l.next, ends.r.prev)
          return
        }

        let single = null as { d: Whole; rest: [number, number] } | null
        for (const [x, y] of bs) {
          const options: [Whole | null, [number, number]][] = [[dutyAt(from, x), [y, to]], [dutyAt(y, to), [from, x]]]
          for (const [d, rest] of options) {
            if (!d || rest[1] - rest[0] < minPiece) continue
            if (!single || d.cost < single.d.cost - EPS || (d.cost < single.d.cost + EPS && d.work > single.d.work)) single = { d, rest }
          }
        }
        if (single) {
          duties.push(single.d.duty)
          loosen(...single.rest)
          return
        }
        loosen(from, to)
      }
      cover(cuts[0], cuts[cuts.length - 1])
    }
  }

  // 3. pair loose pieces (same operator), best partner first; what's left stays a STRAIGHT of
  //    its own — incomplete, flagged by the evaluation for review
  loose.sort((a, b) => a.piece.startMinutes - b.piece.startMinutes)
  const used = new Set<number>()
  for (let i = 0; i < loose.length; i++) {
    if (used.has(i)) continue
    const { piece: a, branchId, lines: linesA } = loose[i]
    const va = views.get(a.vehicleBlockId)!
    // assigned inside `consider` — typed wide so the checks after the loop aren't narrowed away
    let best = null as { j: number; duty: SolverDuty; cost: number } | null

    for (let j = i + 1; j < loose.length; j++) {
      const b = loose[j].piece
      if (used.has(j) || loose[j].branchId !== branchId || b.startMinutes < a.endMinutes) continue
      const meters = walkMeters(input.walk, a.endLocalityId, b.startLocalityId)
      if (meters == null || meters > settings.maxWalkMeters) continue
      const travel = walkMinutes(meters)
      const gap = b.startMinutes - a.endMinutes
      const spread = b.endMinutes - a.startMinutes + signs
      if (spread > maxSpread) continue

      const rest = gap - travel
      if (rest < 0) continue
      const shared = penalty(range.spread, spread) + penalty(range.walkDistance, meters)
        + penalty(range.vehicleChanges, a.vehicleBlockId !== b.vehicleBlockId ? 1 : 0)
        + penalty(range.lineChanges, joinLines(linesA, loose[j].lines))
      const consider = (duty: SolverDuty, w: number, kindCost: number) => {
        if (w > maxWork) return
        const cost = penalty(range.workTime, w) + shared + kindCost
        if (!best || cost < best.cost) best = { j, duty, cost }
      }
      // meal between the pieces (the walk after it is worked)
      if (mealFits(rest) && va.mealAllowed(a.endMinutes, a.endLocalityId)) {
        const brk = { startMinutes: a.endMinutes, endMinutes: a.endMinutes + rest }
        consider({ kind: 'STRAIGHT', branchId, pieces: [a, b], breaks: [brk] }, work(len(a) + len(b), rest) + travel, penalty(range.mealBreak, rest) + penalty(range.idleTime, travel))
      }
      // split: the gap is off the clock — a gap that fits the split interval is always one, never
      // worked (same as the improvement's classification)
      if (splitFits(gap)) {
        consider({ kind: 'SPLIT', branchId, pieces: [a, b], breaks: [] }, work(len(a) + len(b), 0), splitCost + penalty(range.splitInterval, gap))
        continue
      }
      // no meal break: the gap is worked (paid idle, never beyond its ceiling) — a STRAIGHT, when
      // short (incomplete) or when the rule takes one without a meal break and the stops meet it
      if (gap > maxIdle) continue
      const idleCost = penalty(range.idleTime, gap)
      const w = work(len(a) + len(b) + gap, 0)
      if (w < range.workTime.floor) {
        consider({ kind: 'STRAIGHT', branchId, pieces: [a, b], breaks: [] }, w, idleCost)
      } else if (plainPossible) {
        const sa = views.get(a.vehicleBlockId)!.stops(a.startMinutes, a.endMinutes)
        const sb = views.get(b.vehicleBlockId)!.stops(b.startMinutes, b.endMinutes)
        const st = { total: sa.total + sb.total + gap, longest: Math.max(sa.longest, sb.longest, gap) }
        if (plainOk(st)) consider({ kind: 'STRAIGHT', branchId, pieces: [a, b], breaks: [] }, w, idleCost)
      }
    }

    used.add(i)
    if (best) {
      used.add(best.j)
      duties.push(best.duty)
    } else {
      duties.push({ kind: 'STRAIGHT', branchId, pieces: [a], breaks: [] })
    }
  }

  // 4. evaluate with the crew plan's own calculation
  return evaluateSolverDuties(input, duties)
}

// Locked + solver duties through computeCrewPlan — the summary/score a proposal shows.
export function evaluateSolverDuties(input: CrewSolverInput, solverDuties: SolverDuty[]): CrewSolverResult {
  const meal = input.meal
  const duties = [...solverDuties].sort((a, b) => a.pieces[0].startMinutes - b.pieces[0].startMinutes)
  const evaluation = computeCrewPlan({
    settings:      input.settings,
    blocks:        input.blocks,
    walk:          input.walk,
    mealStops:     input.mealStops,
    duties: [
      ...input.locked,
      ...duties.map((d, i): CrewCalcDuty => ({
        id: `solver-${i}`, role: 'DRIVER', kind: d.kind, branchId: d.branchId,
        pieces: d.pieces.map((p, k) => ({ id: `solver-${i}-${k}`, ...p })),
        activities: d.breaks.map((b, k) => ({
          id: `solver-${i}-b${k}`, type: 'BREAK', intervalTypeId: meal!.intervalTypeId, isPaidBreak: meal!.isPaid, ...b,
        })),
      })),
    ],
  })
  return { duties, evaluation }
}
