import type { CrewSettings, RangeCriterion, ReliefPoint } from '@nyx/schemas'
import { computeCrewPlan, mealStopAt, type CrewCalcBlock, type CrewCalcDuty, type CrewCalcResult } from '../crew-plan/crew-scoring.calc'
import { subtractSpans } from '../crew-plan/relief-points'
import { rangeV } from '../vehicle-plan/scoring/plan-scoring.calc'

// Crew solver — construction stage (pure, no Prisma). See docs/proposal/plan_crew_solver_v1.md.
//
// Vehicles are fixed: the solver only decides who drives what. It covers every stretch the
// vehicles need a DRIVER for (serviceSpans) that the locked duties don't already cover, with
// DRIVER duties whose pieces start/end at relief points, and places meal BREAKs explicitly.
//
// 1. Chains — per block, the uncovered service spans, joined across the vehicle's own idle
//    time (intervals) but not across depot parking or locked coverage: a driver can stay with
//    the vehicle through an interval, not through a depot stay.
// 2. Each chain is cut left to right. First choice: a whole duty on the same vehicle around
//    one of its idle gaps — STRAIGHT with the meal inside the piece when the gap fits the meal
//    type's range (at a meal stop of the arriving line), SPLIT when it's longer and fits
//    range.splitInterval (the driver leaves, two pieces on the same vehicle). Otherwise a loose piece of about half an ideal duty (so two of them pair up),
//    within continuous driving, never leaving a remainder shorter than the minimum piece and
//    never crossing the vehicle's own intervals (that idle time would count as driving).
// 3. Loose pieces are paired into STRAIGHT duties (meal between them, gap within the meal
//    type's range) or SPLIT duties (gap within range.splitInterval, when active); what's left
//    becomes a TRIPPER.
// 4. The result is evaluated by computeCrewPlan — the same score/issues the screen shows.
//
// Choices (which cut, which partner) are weighed in the plan score's own units: each criterion
// costs what it would take off the score (modifier × (1 − rangeV)). A SPLIT also costs the
// splitRatio modifier, so a STRAIGHT wins when everything else ties; crew travel is only a
// tie-break (TRAVEL_COST per minute).

type Span = { startMinutes: number; endMinutes: number }

export interface SolverBlock extends CrewCalcBlock {
  deadruns: { type: string; departureMinutes: number; arrivalMinutes: number }[]
}

// the IntervalType placed as meal break (settings.mealBreakIntervalTypeId) and its range
export interface SolverMeal { intervalTypeId: string; minMinutes: number; maxMinutes: number; isPaid: boolean }

export interface CrewSolverInput {
  blocks:        SolverBlock[]
  // kept as they are — their live DRIVER pieces are already covered
  locked:        CrewCalcDuty[]
  settings:      CrewSettings
  meal:          SolverMeal
  mealStops:     Set<string>         // `${routeId}:${localityId}` of RouteLocality.allowsMealBreak
  matrixMinutes: Map<string, number> // crew travel between relief points
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

const len = (s: Span) => s.endMinutes - s.startMinutes
const overlaps = (a: Span, b: Span) => Math.min(a.endMinutes, b.endMinutes) > Math.max(a.startMinutes, b.startMinutes)
// what the criterion takes off the plan score for this value — 0 when inactive
const penalty = (c: RangeCriterion, v: number) => (c.active ? c.modifier * (1 - rangeV(v, c)) : 0)
const TRAVEL_COST = 0.1

// lines driven in order (consecutive repeats merged) and the changes among them
type LineSeq = { first: string | null; last: string | null; changes: number }
const joinLines = (a: LineSeq, b: LineSeq): number =>
  a.changes + b.changes + (a.last && b.first && a.last !== b.first ? 1 : 0)

// per-block lookups the construction needs
export class BlockView {
  readonly cuts: number[]                 // relief point minutes, ascending, unique
  private readonly pointAt = new Map<number, ReliefPoint>()
  readonly parks: Span[]                  // depot stays (RETURN → next ACCESS)
  readonly moving: Span[]                 // trips + deadruns

  constructor(readonly block: SolverBlock, private readonly mealStops: Set<string>) {
    for (const p of block.points) if (!this.pointAt.has(p.minutes)) this.pointAt.set(p.minutes, p)
    this.cuts = [...this.pointAt.keys()].sort((a, b) => a - b)
    const deadruns = [...block.deadruns].sort((a, b) => a.departureMinutes - b.departureMinutes)
    this.parks = deadruns.filter(d => d.type === 'RETURN').flatMap(ret => {
      const access = deadruns.find(d => d.type === 'ACCESS' && d.departureMinutes >= ret.arrivalMinutes)
      return access ? [{ startMinutes: ret.arrivalMinutes, endMinutes: access.departureMinutes }] : []
    })
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
  const work     = (spans: number, breakMinutes: number) => spans - (meal.isPaid ? 0 : breakMinutes) + signs
  const splitCost = range.splitRatio.active ? range.splitRatio.modifier : 0
  // hard limits: ceilings of the active criteria only
  const maxWork   = range.workTime.active ? range.workTime.ceiling : Infinity
  const maxSpread = range.spread.active ? range.spread.ceiling : Infinity
  // loose pieces aim at half an ideal duty, so two of them make one
  const pieceTarget = Math.min(maxDrive, Math.max(minPiece, Math.round((range.workTime.idealMax - signs) / 2)))

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

    // 1. chains — each keeps its uncovered spans as segments (joined over vehicle intervals)
    const chains: (Span & { segments: Span[] })[] = []
    for (const u of uncovered) {
      const last = chains[chains.length - 1]
      const gap  = last && { startMinutes: last.endMinutes, endMinutes: u.startMinutes }
      if (gap && !v.parks.some(p => overlaps(p, gap)) && !covered.some(c => overlaps(c, gap))) {
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
      const start = cuts[0], end = cuts[cuts.length - 1]
      // segment bounds snapped to relief points: a loose piece stays inside one of them
      const segments = chain.segments
        .map(sg => v.cutsIn(sg.startMinutes, sg.endMinutes))
        .filter(c => c.length >= 2)
        .map(c => ({ startMinutes: c[0], endMinutes: c[c.length - 1] }))
      const gaps = v.idleGaps(start, end).flatMap(g => {
        const l = len(g)
        if (l >= meal.minMinutes && l <= meal.maxMinutes && v.mealAllowed(g.startMinutes)) return [{ ...g, split: false }]
        // only gaps longer than the meal become a split (a meal-sized gap where meals aren't allowed doesn't)
        if (range.splitInterval.active && l > meal.maxMinutes && l >= range.splitInterval.floor && l <= range.splitInterval.ceiling && v.isCut(g.endMinutes)) return [{ ...g, split: true }]
        return []
      })

      // 2. cut left to right
      let pos = start
      while (pos < end) {
        let best: { cut: number; gap: Span & { split: boolean }; cost: number } | null = null
        for (const g of gaps) {
          const before = g.startMinutes - pos
          if (before < minPiece || before > maxDrive) continue
          for (const cut of cuts) {
            const after = cut - g.endMinutes
            if (after < minPiece) continue
            if (after > maxDrive) break
            // a split's gap is not worked; a meal break inside the piece counts only if paid
            const w = g.split ? before + after + signs : work(cut - pos, len(g))
            if (w > maxWork || cut - pos + signs > maxSpread) break
            if (w < range.workTime.floor || !leavesValidRest(cut, end)) continue
            const cost = penalty(range.workTime, w) + penalty(range.spread, cut - pos + signs)
              + (g.split ? splitCost + penalty(range.splitInterval, len(g)) : penalty(range.mealBreak, len(g)))
              + penalty(range.lineChanges, v.lines(pos, cut).changes)
            if (!best || cost < best.cost) best = { cut, gap: g, cost }
          }
        }
        if (best) {
          const { gap, cut } = best
          duties.push(gap.split
            ? { kind: 'SPLIT', branchId: v.block.branchId, pieces: [piece(v, pos, gap.startMinutes), piece(v, gap.endMinutes, cut)], breaks: [] }
            : { kind: 'STRAIGHT', branchId: v.block.branchId, pieces: [piece(v, pos, cut)], breaks: [{ startMinutes: gap.startMinutes, endMinutes: gap.endMinutes }] })
          pos = cut
          continue
        }

        // loose piece inside the current segment (skip the vehicle's interval between segments)
        const seg = segments.find(sg => sg.endMinutes > pos)
        if (!seg) break
        if (seg.startMinutes > pos) { pos = seg.startMinutes; continue }
        const segEnd    = seg.endMinutes
        const reachable = cuts.filter(c => c > pos && c <= segEnd && c - pos <= maxDrive)
        const fit       = reachable.filter(c => leavesValidRest(c, segEnd))
        const cut = segEnd - pos <= maxDrive && segEnd - pos <= pieceTarget * 1.5 ? segEnd
          : (fit.length ? fit : reachable).reduce<number | undefined>((b, c) => (b == null || Math.abs(c - pos - pieceTarget) < Math.abs(b - pos - pieceTarget) ? c : b), undefined)
            ?? cuts.find(c => c > pos)!
        loose.push({ piece: piece(v, pos, cut), branchId: v.block.branchId, lines: v.lines(pos, cut) })
        pos = cut
      }
    }
  }

  // 3. pair loose pieces (same operator), best partner first; what's left is a tripper
  loose.sort((a, b) => a.piece.startMinutes - b.piece.startMinutes)
  const used = new Set<number>()
  for (let i = 0; i < loose.length; i++) {
    if (used.has(i)) continue
    const { piece: a, branchId, lines: linesA } = loose[i]
    const va = views.get(a.vehicleBlockId)!
    let best: { j: number; duty: SolverDuty; cost: number } | null = null

    for (let j = i + 1; j < loose.length; j++) {
      const b = loose[j].piece
      if (used.has(j) || loose[j].branchId !== branchId || b.startMinutes < a.endMinutes) continue
      const travel = a.endLocalityId === b.startLocalityId ? 0 : input.matrixMinutes.get(`${a.endLocalityId}:${b.startLocalityId}`)
      if (travel == null) continue
      const gap = b.startMinutes - a.endMinutes
      const spread = b.endMinutes - a.startMinutes + signs
      if (spread > maxSpread) continue

      const rest = gap - travel
      let duty: SolverDuty | null = null, kindCost = 0
      if (rest >= meal.minMinutes && rest <= meal.maxMinutes && va.mealAllowed(a.endMinutes, a.endLocalityId)) {
        const brk = { startMinutes: a.endMinutes, endMinutes: a.endMinutes + rest }
        duty = { kind: 'STRAIGHT', branchId, pieces: [a, b], breaks: [brk] }
        kindCost = penalty(range.mealBreak, rest)
      } else if (range.splitInterval.active && gap > meal.maxMinutes && gap >= range.splitInterval.floor && gap <= range.splitInterval.ceiling) {
        duty = { kind: 'SPLIT', branchId, pieces: [a, b], breaks: [] }
        kindCost = splitCost + penalty(range.splitInterval, gap)
      }
      if (!duty) continue

      const w = work(len(a) + len(b), duty.breaks.reduce((s, x) => s + len(x), 0))
      if (w > maxWork) continue
      const cost = penalty(range.workTime, w) + penalty(range.spread, spread) + kindCost + travel * TRAVEL_COST
        + penalty(range.vehicleChanges, a.vehicleBlockId !== b.vehicleBlockId ? 1 : 0)
        + penalty(range.lineChanges, joinLines(linesA, loose[j].lines))
      if (!best || cost < best.cost) best = { j, duty, cost }
    }

    used.add(i)
    if (best) {
      used.add(best.j)
      duties.push(best.duty)
    } else {
      duties.push({ kind: 'TRIPPER', branchId, pieces: [a], breaks: [] })
    }
  }

  // 4. evaluate with the crew plan's own calculation
  return evaluateSolverDuties(input, duties)
}

// Locked + solver duties through computeCrewPlan — the summary/score a proposal shows.
export function evaluateSolverDuties(input: CrewSolverInput, solverDuties: SolverDuty[]): CrewSolverResult {
  const { meal } = input
  const duties = [...solverDuties].sort((a, b) => a.pieces[0].startMinutes - b.pieces[0].startMinutes)
  const evaluation = computeCrewPlan({
    settings:      input.settings,
    blocks:        input.blocks,
    matrixMinutes: input.matrixMinutes,
    mealStops:     input.mealStops,
    duties: [
      ...input.locked,
      ...duties.map((d, i): CrewCalcDuty => ({
        id: `solver-${i}`, role: 'DRIVER', kind: d.kind, branchId: d.branchId,
        pieces: d.pieces.map((p, k) => ({ id: `solver-${i}-${k}`, ...p })),
        activities: d.breaks.map((b, k) => ({
          id: `solver-${i}-b${k}`, type: 'BREAK', intervalTypeId: meal.intervalTypeId, isPaidBreak: meal.isPaid, ...b,
        })),
      })),
    ],
  })
  return { duties, evaluation }
}
