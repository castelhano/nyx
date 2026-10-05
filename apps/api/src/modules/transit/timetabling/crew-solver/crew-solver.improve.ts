import type { CrewCalcContext, CrewCalcDuty, DutyEvaluation } from '../crew-plan/crew-scoring.calc'
import { CrewScoreAggregate, evaluateDuty, solverRank } from '../crew-plan/crew-scoring.calc'
import { BlockView, type CrewSolverInput, type SolverDuty, type SolverPiece } from './crew-solver.calc'
import { walkMeters, walkMinutes } from '../crew-plan/crew-walk'
import { mealPolicy } from '@nyx/schemas'

// Crew solver — continuous improvement (pure, no Prisma). See
// docs/proposal/plan_crew_solver_improvement_v1.md.
//
// Starts from the construction's duties and keeps changing who drives what, scoring every
// change on the incremental aggregate (the same score the screen shows). The pieces are only
// ever redistributed among duties, so coverage never changes. Moves:
//  - shift:    the relief point between two pieces that meet on the same vehicle moves to a
//              nearby relief point (one duty gets longer, the other shorter);
//  - swap:     two duties exchange their tails (A1+B2, B1+A2);
//  - transfer: a piece — or part of it, cut at a relief point — goes to another duty or becomes
//              a duty of its own; a duty left empty disappears;
//  - eliminate: a duty is dissolved in one go — each of its pieces (whole, or cut at a relief
//              point into a head and a tail) joins the duty next to it in time that takes it.
//              Doing it piece by piece would pass through a short duty (a TRIPPER, or an error
//              below the work floor) the search almost never accepts. Accepted only when it
//              improves the score (no annealing).
// Every duty a move builds follows the hard rules (buildDuty); a move that breaks one is
// dropped. Duties with an issue come first: a move never adds one and always goes through when it
// removes one; among equals, the score optimized is the raw one (CrewScoreAggregate.rawScore): a
// criterion already past its ceiling still rewards getting closer to it. Acceptance is simulated annealing: better always, worse with probability exp(Δ/T),
// T calibrated on the first worsening moves. The search runs in cycles: T cools down over a
// cycle, then the search goes back to the best duties found and starts a cooler cycle — so a
// cycle always ends improving, and "no improvement" means the cycles stopped paying off.

type Span = { startMinutes: number; endMinutes: number }

const MAX_PIECES = 3
// share of the attempts that try to eliminate a duty (the costliest move)
const ELIMINATE_SHARE = 0.1
// duties drawn to pick the one to eliminate (the least worked wins)
const ELIMINATE_DRAW = 3
// receivers tried per piece, nearest in time first
const ELIMINATE_CANDIDATES = 6
// share of worsening moves accepted at the start (calibrates the temperature)
const START_ACCEPT = 0.3
const CALIBRATION_MOVES = 300
// within a cycle the temperature ends at this fraction of the cycle's start
const END_TEMPERATURE = 0.01
// each new cycle starts at this fraction of the previous one's start
const REHEAT = 0.7
// the aggregate is rebuilt from scratch every so many accepted moves (float drift)
const RESYNC_EVERY = 20_000

interface WorkDuty {
  kind:     SolverDuty['kind']
  branchId: string | null
  pieces:   SolverPiece[]
  breaks:   Span[]
  calc:     CrewCalcDuty
  ev:       DutyEvaluation
  // position in `duties` (swap-remove)
  idx:      number
}

interface Move { removed: WorkDuty[]; added: WorkDuty[] }

const hasError = (ev: DutyEvaluation) => ev.issues.some(i => i.severity === 'error')

// small seedable PRNG (mulberry32) — a fixed seed repeats a run
function rng(seed: number): () => number {
  let a = seed >>> 0
  return () => {
    a = (a + 0x6D2B79F5) >>> 0
    let t = a
    t = Math.imul(t ^ (t >>> 15), t | 1)
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61)
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296
  }
}

export class CrewImprover {
  readonly startedAt = Date.now()
  attempts     = 0
  improvements = 0
  lastImprovementAt = this.startedAt
  // solverRank of the best duties
  bestScore:   number
  private best: WorkDuty[]
  private current: number
  // duties with an issue in the current duties
  private issues = 0
  private temperature: number | null = null
  private cycleStart = this.startedAt
  private readonly worsening: number[] = []
  private accepted = 0
  private seq = 0

  private readonly ctx:   CrewCalcContext
  private readonly views: Map<string, BlockView>
  private agg:            CrewScoreAggregate
  private readonly locked: { calc: CrewCalcDuty; ev: DutyEvaluation }[]
  private readonly duties: WorkDuty[] = []
  private readonly byBlock = new Map<string, Set<WorkDuty>>()
  private readonly random: () => number

  // cycleMs: how long one cooling cycle lasts (see the header)
  constructor(private readonly input: CrewSolverInput, initial: SolverDuty[], private readonly cycleMs: number, seed = Date.now()) {
    this.random = rng(seed)
    this.ctx = {
      settings: input.settings, blocks: new Map(input.blocks.map(b => [b.id, b])),
      walk: input.walk, mealStops: input.mealStops,
    }
    this.views = new Map(input.blocks.map(b => [b.id, new BlockView(b, input.mealStops)]))
    this.agg = new CrewScoreAggregate(this.ctx)
    this.locked = input.locked.map(calc => ({ calc, ev: evaluateDuty(calc, this.ctx) }))
    for (const l of this.locked) this.agg.add(l.calc, l.ev)
    // the construction's duties are taken as they are (they may break a soft rule the moves won't)
    for (const d of initial) {
      const w = this.make(d.kind, d.branchId, d.pieces, d.breaks)
      this.insert(w)
      this.agg.add(w.calc, w.ev)
    }
    this.current = this.agg.rawScore()
    this.issues  = this.agg.issueDutyCount
    this.bestScore = solverRank(this.current, this.issues)
    this.best = [...this.duties]
  }

  // runs moves for about `sliceMs`; the caller decides when to stop
  run(sliceMs: number): void {
    const until = Date.now() + sliceMs
    while (Date.now() < until) {
      for (let i = 0; i < 200; i++) this.attempt()
    }
  }

  bestDuties(): SolverDuty[] {
    return this.best.map(w => ({ kind: w.kind, branchId: w.branchId, pieces: w.pieces, breaks: w.breaks }))
  }

  // ── search ───────────────────────────────────────────────────────────────

  private attempt(): void {
    this.attempts++
    if (!this.duties.length) return
    // a new cycle swaps the duties — only between moves, never while one is being applied
    if (this.temperature != null && Date.now() - this.cycleStart >= this.cycleMs) this.nextCycle(Date.now())
    const r = this.random()
    const eliminating = r < ELIMINATE_SHARE
    const move = eliminating ? this.eliminate()
      : r < ELIMINATE_SHARE + 0.3 ? this.shift()
      : r < ELIMINATE_SHARE + 0.6 ? this.swap()
      : this.transfer()
    if (!move) return

    for (const w of move.removed) this.agg.remove(w.calc, w.ev)
    for (const w of move.added)   this.agg.add(w.calc, w.ev)
    const score  = this.agg.rawScore()
    const issues = this.agg.issueDutyCount
    const delta  = score - this.current

    // fewer duties with an issue always goes through, more never does; among equals an
    // elimination goes through only when it pays off (its worsenings are much larger than the
    // other moves' and would heat the annealing up into a random walk), the rest anneal
    const ok = issues !== this.issues ? issues < this.issues : eliminating ? delta >= 0 : this.accept(delta)
    if (!ok) {
      for (const w of move.added)   this.agg.remove(w.calc, w.ev)
      for (const w of move.removed) this.agg.add(w.calc, w.ev)
      return
    }
    for (const w of move.removed) this.drop(w)
    for (const w of move.added)   this.insert(w)
    this.current = score
    this.issues  = issues
    if (++this.accepted % RESYNC_EVERY === 0) this.resync()
    const rank = solverRank(this.current, this.issues)
    if (rank > this.bestScore + 1e-9) {
      this.bestScore = rank
      this.best = [...this.duties]
      this.improvements++
      this.lastImprovementAt = Date.now()
    }
  }

  private accept(delta: number): boolean {
    if (delta >= 0) return true
    if (this.temperature == null) {
      // calibration: only improvements go through while the typical worsening is measured
      this.worsening.push(-delta)
      if (this.worsening.length >= CALIBRATION_MOVES) {
        const mean = this.worsening.reduce((s, v) => s + v, 0) / this.worsening.length
        this.temperature = mean / -Math.log(START_ACCEPT)
      }
      return false
    }
    const progress = (Date.now() - this.cycleStart) / this.cycleMs
    const t = this.temperature * Math.pow(END_TEMPERATURE, progress)
    return this.random() < Math.exp(delta / t)
  }

  // back to the best duties, a cooler start
  private nextCycle(now: number): void {
    this.cycleStart = now
    this.temperature! *= REHEAT
    this.duties.length = 0
    this.byBlock.clear()
    for (const w of this.best) this.insert(w)
    this.resync()
  }

  private resync(): void {
    const agg = new CrewScoreAggregate(this.ctx)
    for (const l of this.locked) agg.add(l.calc, l.ev)
    for (const w of this.duties) agg.add(w.calc, w.ev)
    this.agg = agg
    this.current = agg.rawScore()
    this.issues  = agg.issueDutyCount
  }

  // ── moves ────────────────────────────────────────────────────────────────

  private pick(): WorkDuty { return this.duties[Math.floor(this.random() * this.duties.length)] }

  private pickOther(a: WorkDuty): WorkDuty | null {
    for (let k = 0; k < 8; k++) {
      const b = this.pick()
      if (b !== a && b.branchId === a.branchId) return b
    }
    return null
  }

  private randomOf<T>(items: T[]): T { return items[Math.floor(this.random() * items.length)] }

  // the relief point where two pieces meet on the same vehicle moves up to 3 points either way
  private shift(): Move | null {
    const a = this.pick()
    const p = this.randomOf(a.pieces)
    const forward = this.random() < 0.5
    let b: WorkDuty | null = null, q: SolverPiece | undefined
    for (const d of this.byBlock.get(p.vehicleBlockId) ?? []) {
      if (d === a) continue
      q = d.pieces.find(x => x.vehicleBlockId === p.vehicleBlockId && (forward ? x.startMinutes === p.endMinutes : x.endMinutes === p.startMinutes))
      if (q) { b = d; break }
    }
    if (!b || !q) return null
    const [left, right] = forward ? [p, q] : [q, p]
    const view = this.views.get(p.vehicleBlockId)!
    const minPiece = this.input.settings.minPieceMinutes
    const at = view.cuts.indexOf(left.endMinutes)
    const options = view.cuts.slice(Math.max(0, at - 3), at + 4)
      .filter(c => c !== left.endMinutes && c - left.startMinutes >= minPiece && right.endMinutes - c >= minPiece)
    if (!options.length) return null
    const cut = this.randomOf(options)
    const newLeft  = { ...left,  endMinutes: cut,   endLocalityId:   view.locality(cut) }
    const newRight = { ...right, startMinutes: cut, startLocalityId: view.locality(cut) }
    const [aNew, bNew] = forward ? [newLeft, newRight] : [newRight, newLeft]
    const a2 = this.build(a.pieces.map(x => (x === p ? aNew : x)), a.branchId)
    const b2 = a2 && this.build(b.pieces.map(x => (x === q ? bNew : x)), b.branchId)
    return a2 && b2 ? { removed: [a, b], added: [a2, b2] } : null
  }

  // two duties exchange their tails at a random split of each
  private swap(): Move | null {
    const a = this.pick()
    const b = this.pickOther(a)
    if (!b) return null
    const i = Math.floor(this.random() * (a.pieces.length + 1))
    const js = [...Array(b.pieces.length + 1).keys()].sort(() => this.random() - 0.5)
    for (const j of js) {
      if ((i === 0 && j === 0) || (i === a.pieces.length && j === b.pieces.length)) continue
      const aPieces = [...a.pieces.slice(0, i), ...b.pieces.slice(j)]
      const bPieces = [...b.pieces.slice(0, j), ...a.pieces.slice(i)]
      const a2 = aPieces.length ? this.build(aPieces, a.branchId) : null
      if (aPieces.length && !a2) continue
      const b2 = bPieces.length ? this.build(bPieces, b.branchId) : null
      if (bPieces.length && !b2) continue
      return { removed: [a, b], added: [a2, b2].filter((w): w is WorkDuty => !!w) }
    }
    return null
  }

  // a piece (or its head/tail, cut at a relief point) moves to another duty or to a new one
  private transfer(): Move | null {
    const a = this.pick()
    const p = this.randomOf(a.pieces)
    const view = this.views.get(p.vehicleBlockId)!
    const minPiece = this.input.settings.minPieceMinutes

    let part: SolverPiece = p, rest: SolverPiece | null = null
    if (this.random() < 0.5) {
      const cuts = view.cutsIn(p.startMinutes + minPiece, p.endMinutes - minPiece)
      if (cuts.length) {
        const cut  = this.randomOf(cuts)
        const head = { ...p, endMinutes: cut, endLocalityId: view.locality(cut) }
        const tail = { ...p, startMinutes: cut, startLocalityId: view.locality(cut) }
        ;[part, rest] = this.random() < 0.5 ? [head, tail] : [tail, head]
      }
    }

    const aPieces = a.pieces.flatMap(x => (x !== p ? [x] : rest ? [rest] : []))
    const a2 = aPieces.length ? this.build(aPieces, a.branchId) : null
    if (aPieces.length && !a2) return null

    if (this.random() < 0.15) {
      const solo = this.build([part], view.block.branchId)
      return solo ? { removed: [a], added: [...(a2 ? [a2] : []), solo] } : null
    }
    const b = this.pickOther(a)
    if (!b || b.pieces.length >= MAX_PIECES) return null
    const b2 = this.build([...b.pieces, part], b.branchId)
    return b2 ? { removed: [a, b], added: [...(a2 ? [a2] : []), b2] } : null
  }

  // a duty dissolves: every piece finds a receiver, or nothing changes
  private eliminate(): Move | null {
    let a = this.pick()
    for (let k = 1; k < ELIMINATE_DRAW; k++) {
      const b = this.pick()
      if (b.ev.summary.workMinutes < a.ev.summary.workMinutes) a = b
    }
    if (this.duties.length < 2) return null
    const minPiece = this.input.settings.minPieceMinutes
    // receiver → its pieces so far (a receiver may take more than one part)
    const taken = new Map<WorkDuty, SolverPiece[]>()

    for (const p of a.pieces) {
      if (this.place(p, a, taken)) continue
      // whole it fits nowhere: a head and a tail, to different receivers
      const view = this.views.get(p.vehicleBlockId)!
      const cuts = view.cutsIn(p.startMinutes + minPiece, p.endMinutes - minPiece)
      let placed = false
      for (let k = 0; k < 3 && cuts.length && !placed; k++) {
        const cut  = this.randomOf(cuts)
        const head = { ...p, endMinutes: cut, endLocalityId: view.locality(cut) }
        const tail = { ...p, startMinutes: cut, startLocalityId: view.locality(cut) }
        const before = new Map(taken)
        placed = this.place(head, a, taken) && this.place(tail, a, taken)
        if (!placed) { taken.clear(); for (const [w, ps] of before) taken.set(w, ps) }
      }
      if (!placed) return null
    }

    const added: WorkDuty[] = []
    for (const [b, pieces] of taken) {
      const b2 = this.build(pieces, b.branchId)
      if (!b2) return null
      added.push(b2)
    }
    return { removed: [a, ...taken.keys()], added }
  }

  // `part` joins the nearest duty in time (same operator, no overlap, room left) whose pieces
  // still make a valid duty with it — recorded in `taken`
  private place(part: SolverPiece, from: WorkDuty, taken: Map<WorkDuty, SolverPiece[]>): boolean {
    const len  = part.endMinutes - part.startMinutes
    const work = this.input.settings.range.workTime
    const maxWork = work.active ? work.ceiling : Infinity
    const candidates: { w: WorkDuty; pieces: SolverPiece[]; gap: number }[] = []
    for (const w of this.duties) {
      if (w === from || w.branchId !== from.branchId) continue
      const pieces = taken.get(w) ?? w.pieces
      if (pieces.length >= MAX_PIECES) continue
      if (!taken.has(w) && w.ev.summary.workMinutes + len > maxWork) continue
      let gap = Infinity
      for (const q of pieces) {
        if (q.startMinutes < part.endMinutes && part.startMinutes < q.endMinutes) { gap = -1; break }
        gap = Math.min(gap, q.endMinutes <= part.startMinutes ? part.startMinutes - q.endMinutes : q.startMinutes - part.endMinutes)
      }
      if (gap >= 0) candidates.push({ w, pieces, gap })
    }
    candidates.sort((x, y) => x.gap - y.gap)
    for (const c of candidates.slice(0, ELIMINATE_CANDIDATES)) {
      const next = [...c.pieces, part]
      // a receiver never becomes a TRIPPER — that would trade one duty for a worse one
      const built = this.build(next, c.w.branchId)
      if (built && built.kind !== 'TRIPPER') {
        taken.set(c.w, next)
        return true
      }
    }
    return false
  }

  // ── duty building (hard rules) ───────────────────────────────────────────

  // The duty those pieces make, or null when it breaks a hard rule:
  //  - pieces in time order, no overlap; consecutive pieces on the same vehicle merge;
  //    at most MAX_PIECES;
  //  - between pieces at different places, the driver walks — within settings.maxWalkMeters and a
  //    gap that fits the walk (unknown distance → no duty);
  //  - at most one long interval: the meal (STRAIGHT — a rest within the meal type's range, at a
  //    meal stop of the line that arrives; only when settings.mealRule places meal breaks
  //    form) or the split gap (SPLIT, within range.splitInterval); the other gaps are worked —
  //    shorter than the meal, or any length when the rule takes a STRAIGHT without a meal break;
  //  - no long interval between pieces: a meal inside a piece, where the vehicle stands idle
  //    (STRAIGHT); else, working at least range.workTime.floor, a STRAIGHT without a meal break
  //    when the rule takes one (its stops checked by the evaluation); else a TRIPPER — which
  //    can't work beyond range.workTime.floor;
  //  - no error from the crew plan's own evaluation (ceilings, travel, branch, …) — a warning
  //    (e.g. a short piece) is allowed, the search then weighs it ahead of the score.
  private build(raw: SolverPiece[], branchId: string | null): WorkDuty | null {
    const sorted = [...raw].sort((x, y) => x.startMinutes - y.startMinutes)
    const pieces: SolverPiece[] = []
    for (const p of sorted) {
      const last = pieces[pieces.length - 1]
      if (last && p.startMinutes < last.endMinutes) return null
      if (last && last.vehicleBlockId === p.vehicleBlockId && last.endMinutes === p.startMinutes) {
        pieces[pieces.length - 1] = { ...last, endMinutes: p.endMinutes, endLocalityId: p.endLocalityId }
      } else {
        pieces.push(p)
      }
    }
    if (pieces.length > MAX_PIECES) return null

    const { meal, settings, walk } = this.input
    const split = settings.range.splitInterval
    const policy = mealPolicy(settings.mealRule)
    const plainPossible = !policy.required || policy.fractioned
    let kind: SolverDuty['kind'] = 'TRIPPER'
    let breaks: Span[] = []
    for (let i = 1; i < pieces.length; i++) {
      const prev = pieces[i - 1], next = pieces[i]
      const gap    = next.startMinutes - prev.endMinutes
      const meters = walkMeters(walk, prev.endLocalityId, next.startLocalityId)
      if (meters == null || meters > settings.maxWalkMeters) return null
      const travel = walkMinutes(meters)
      if (gap < travel) return null
      const rest = gap - travel
      const isMeal  = !!meal && rest >= meal.minMinutes && rest <= meal.maxMinutes && this.views.get(prev.vehicleBlockId)!.mealAllowed(prev.endMinutes, prev.endLocalityId)
      const isSplit = split.active && gap > (meal?.maxMinutes ?? 0) && gap >= split.floor && gap <= split.ceiling
      if ((isMeal || isSplit) && kind !== 'TRIPPER') return null
      if (isMeal) {
        kind = 'STRAIGHT'
        breaks = [{ startMinutes: prev.endMinutes, endMinutes: prev.endMinutes + rest }]
      } else if (isSplit) {
        kind = 'SPLIT'
      } else if (meal && rest >= meal.minMinutes && !plainPossible) {
        // a meal-sized gap that can't be the meal, with nothing but a meal accepted
        return null
      }
    }

    if (kind === 'TRIPPER' && meal) {
      // meal inside a piece, where the vehicle stands idle — the most balanced one
      const first = pieces[0].startMinutes, last = pieces[pieces.length - 1].endMinutes
      let best: Span | null = null, balance = -1
      for (const p of pieces) {
        const view = this.views.get(p.vehicleBlockId)!
        for (const g of view.idleGaps(p.startMinutes, p.endMinutes)) {
          const len = g.endMinutes - g.startMinutes
          if (len < meal.minMinutes || len > meal.maxMinutes || !view.mealAllowed(g.startMinutes)) continue
          const b = Math.min(g.startMinutes - first, last - g.endMinutes)
          if (b > balance) { balance = b; best = g }
        }
      }
      if (best) { kind = 'STRAIGHT'; breaks = [best] }
    }

    // no meal: a STRAIGHT without a meal break when long enough and the rule takes one
    if (kind === 'TRIPPER' && plainPossible) {
      const straight = this.make('STRAIGHT', branchId, pieces, [])
      if (straight.ev.summary.workMinutes >= settings.range.workTime.floor) {
        return hasError(straight.ev) || straight.ev.isStale ? null : straight
      }
    }

    const w = this.make(kind, branchId, pieces, breaks)
    if (hasError(w.ev) || w.ev.isStale) return null
    if (kind === 'TRIPPER' && settings.range.workTime.active && w.ev.summary.workMinutes > settings.range.workTime.floor) return null
    return w
  }

  private make(kind: SolverDuty['kind'], branchId: string | null, pieces: SolverPiece[], breaks: Span[]): WorkDuty {
    const id = `w${this.seq++}`
    const { meal } = this.input
    const calc: CrewCalcDuty = {
      id, role: 'DRIVER', kind, branchId,
      pieces: pieces.map((p, k) => ({ id: `${id}-${k}`, ...p })),
      activities: breaks.map((b, k) => ({ id: `${id}-b${k}`, type: 'BREAK', intervalTypeId: meal!.intervalTypeId, isPaidBreak: meal!.isPaid, ...b })),
    }
    return { kind, branchId, pieces, breaks, calc, ev: evaluateDuty(calc, this.ctx), idx: -1 }
  }

  private insert(w: WorkDuty): void {
    w.idx = this.duties.length
    this.duties.push(w)
    for (const p of w.pieces) {
      if (!this.byBlock.has(p.vehicleBlockId)) this.byBlock.set(p.vehicleBlockId, new Set())
      this.byBlock.get(p.vehicleBlockId)!.add(w)
    }
  }

  private drop(w: WorkDuty): void {
    const last = this.duties.pop()!
    if (last !== w) { this.duties[w.idx] = last; last.idx = w.idx }
    for (const p of w.pieces) this.byBlock.get(p.vehicleBlockId)?.delete(w)
  }
}
