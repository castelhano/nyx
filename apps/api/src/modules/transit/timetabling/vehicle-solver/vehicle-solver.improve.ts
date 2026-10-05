import type { PlanScoreState } from '../vehicle-plan/scoring/plan-scoring.calc'
import type { Capacity, SolverTrip, VehicleModel, WorkBlock } from './vehicle-solver.calc'

// Vehicle solver — continuous improvement (pure, no Prisma). See
// docs/architecture/transit/solver.md.
//
// Starts from the construction's blocks and keeps changing them, scoring every change on the
// incremental PlanScoreState (the score the plan gets once applied). Moves:
//  - relocate: a trip goes to another block;
//  - swap:     two blocks exchange a trip;
//  - tail:     two blocks exchange everything after a point in time;
//  - merge:    two blocks become one (one vehicle less);
//  - split:    a block becomes two;
//  - depot:    a block moves to another depot of its operator;
//  - operator: a block goes to another operator (and a depot of it).
// Every block a move builds keeps the hard rules (VehicleModel.place); a move that breaks one
// is dropped. Acceptance is simulated annealing — better always, worse with probability
// exp(Δ/T), T calibrated on the first worsening moves (their median) — in cycles: T cools down over a cycle,
// then the search goes back to the best blocks found and starts a cooler cycle.

// how a typical (median) worsening move is accepted at the start — calibrates the temperature.
// Tiny on purpose: most moves touch 1/n of a per-block mean and worsening moves far outnumber
// improving ones, so anything warmer lets the search slide downhill for good (measured on a
// 3k-trip plan: 0.3 and even 1e-4 lost ground, ~1e-9 — T ≈ median ÷ 20 — climbs steadily)
const START_ACCEPT = 1e-9
const CALIBRATION_MOVES = 300
// within a cycle the temperature ends at this fraction of the cycle's start
const END_TEMPERATURE = 0.01
// each new cycle starts at this fraction of the previous one's start
const REHEAT = 0.7
// the score state is rebuilt from scratch every so many accepted moves (float drift)
const RESYNC_EVERY = 20_000
// tries to find a partner block for a swap
const PARTNER_TRIES = 8

interface Move { removed: WorkBlock[]; added: WorkBlock[] }

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

const byDep = (a: SolverTrip, b: SolverTrip) => a.dep - b.dep || a.arr - b.arr

export class VehicleImprover {
  readonly startedAt = Date.now()
  attempts     = 0
  improvements = 0
  // per move: tried, built (kept the rules), accepted — for the bench
  readonly stats: Record<string, { tried: number; built: number; accepted: number }> = {}
  lastImprovementAt = this.startedAt
  bestScore:   number
  private best: WorkBlock[]
  current: number
  temperature: number | null = null
  private cycleStart = this.startedAt
  private readonly worsening: number[] = []
  private accepted = 0

  private blocks: WorkBlock[] = []
  private readonly index = new Map<WorkBlock, number>()
  private state: PlanScoreState
  private cap:   Capacity
  private readonly random: () => number

  // cycleMs: how long one cooling cycle lasts (see the header)
  constructor(private readonly model: VehicleModel, initial: WorkBlock[], private readonly cycleMs: number, seed = Date.now()) {
    this.random = rng(seed)
    this.state = model.newScore()
    this.cap   = model.newCapacity()
    for (const b of initial) this.insert(b)
    this.current = this.bestScore = this.state.rawScore()
    this.best = [...this.blocks]
  }

  // runs moves for about `sliceMs`; the caller decides when to stop
  run(sliceMs: number): void {
    const until = Date.now() + sliceMs
    while (Date.now() < until) {
      for (let i = 0; i < 100; i++) this.attempt()
    }
  }

  bestBlocks(): WorkBlock[] { return [...this.best] }

  // ── search ───────────────────────────────────────────────────────────────

  private attempt(): void {
    this.attempts++
    if (!this.blocks.length) return
    // a new cycle swaps the blocks — only between moves, never while one is being applied
    if (this.temperature != null && Date.now() - this.cycleStart >= this.cycleMs) this.nextCycle(Date.now())

    const r = this.random()
    const kind = r < 0.28 ? 'relocate' : r < 0.43 ? 'swap' : r < 0.63 ? 'tail' : r < 0.80 ? 'merge' : r < 0.88 ? 'split' : r < 0.94 ? 'depot' : 'operator'
    const stat = this.stats[kind] ??= { tried: 0, built: 0, accepted: 0 }
    stat.tried++
    const move = this[kind]()
    if (!move) return
    stat.built++

    // the move already holds its capacity (stage); the score decides whether it stays
    for (const b of move.removed) this.state.remove(b.agg)
    for (const b of move.added)   this.state.add(b.agg)
    const score = this.state.rawScore()
    const delta = score - this.current

    if (!this.accept(delta)) {
      for (const b of move.added)   this.state.remove(b.agg)
      for (const b of move.removed) this.state.add(b.agg)
      this.unstage(move)
      return
    }
    stat.accepted++
    for (const b of move.removed) this.drop(b)
    for (const b of move.added)   this.push(b)
    this.current = score
    if (++this.accepted % RESYNC_EVERY === 0) this.resync()
    if (this.current > this.bestScore + 1e-12) {
      this.bestScore = this.current
      this.best = [...this.blocks]
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
        // the median: a typical move touches 1/n of the per-block means, a rare one the fleet
        // or the shares — the mean would set T by the rare ones and the search would wander
        const median = [...this.worsening].sort((x, y) => x - y)[this.worsening.length >> 1]
        this.temperature = median / -Math.log(START_ACCEPT)
      }
      return false
    }
    const progress = (Date.now() - this.cycleStart) / this.cycleMs
    const t = this.temperature * Math.pow(END_TEMPERATURE, progress)
    return this.random() < Math.exp(delta / t)
  }

  // back to the best blocks, a cooler start
  private nextCycle(now: number): void {
    this.cycleStart = now
    this.temperature! *= REHEAT
    const best = this.best
    this.blocks = []
    this.index.clear()
    this.cap = this.model.newCapacity()
    for (const b of best) {
      this.push(b)
      this.cap.add(b.depotId, b.vehicleType)
    }
    this.resync()
  }

  private resync(): void {
    this.state = this.model.newScore()
    for (const b of this.blocks) this.state.add(b.agg)
    this.current = this.state.rawScore()
  }

  // ── bookkeeping ──────────────────────────────────────────────────────────

  private insert(b: WorkBlock): void {
    this.push(b)
    this.state.add(b.agg)
    this.cap.add(b.depotId, b.vehicleType)
  }

  private push(b: WorkBlock): void {
    this.index.set(b, this.blocks.length)
    this.blocks.push(b)
  }

  // swap-remove
  private drop(b: WorkBlock): void {
    const i = this.index.get(b)!
    const last = this.blocks.pop()!
    if (last !== b) {
      this.blocks[i] = last
      this.index.set(last, i)
    }
    this.index.delete(b)
  }

  // A move's new blocks, placed one by one with the removed blocks' capacity released — on
  // success the capacity stays taken (unstage gives it back); null when one can't be placed.
  // Each wanted block: its trips, operator and — when the move keeps it in place — depot.
  private stage(removed: WorkBlock[], wanted: { trips: SolverTrip[]; branchId: string | null; depotId?: string }[]): Move | null {
    for (const b of removed) this.cap.remove(b.depotId, b.vehicleType)
    const added: WorkBlock[] = []
    for (const w of wanted) {
      const b = (w.depotId && this.model.place(w.trips, w.branchId, this.cap, w.depotId)) || this.model.place(w.trips, w.branchId, this.cap)
      if (!b) {
        this.unstage({ removed, added })
        return null
      }
      this.cap.add(b.depotId, b.vehicleType)
      added.push(b)
    }
    return { removed, added }
  }

  private unstage(move: Move): void {
    for (const b of move.added)   this.cap.remove(b.depotId, b.vehicleType)
    for (const b of move.removed) this.cap.add(b.depotId, b.vehicleType)
  }

  // ── moves ────────────────────────────────────────────────────────────────

  private pick(): WorkBlock { return this.blocks[Math.floor(this.random() * this.blocks.length)] }
  private int(n: number): number { return Math.floor(this.random() * n) }

  // a partner block whose time span overlaps [from, to] — a few random tries
  private partner(a: WorkBlock, from: number, to: number): WorkBlock | null {
    for (let k = 0; k < PARTNER_TRIES; k++) {
      const b = this.pick()
      if (b !== a && b.trips[0].dep <= to && b.trips[b.trips.length - 1].arr >= from) return b
    }
    return null
  }

  // the first block (from a random one on) other than `a` that passes `ok` — the cheap local
  // checks, so the costly build only runs on a move that holds
  private scan(a: WorkBlock, ok: (b: WorkBlock) => boolean): WorkBlock | null {
    const n = this.blocks.length
    const from = this.int(n)
    for (let k = 0; k < n; k++) {
      const b = this.blocks[(from + k) % n]
      if (b !== a && ok(b)) return b
    }
    return null
  }

  // `t` fits between its neighbors in time in these trips
  private fits(trips: SolverTrip[], t: SolverTrip): boolean {
    let lo = 0, hi = trips.length
    while (lo < hi) { const mid = (lo + hi) >> 1; if (trips[mid].dep <= t.dep) lo = mid + 1; else hi = mid }
    const prev = trips[lo - 1], next = trips[lo]
    return (!prev || this.model.canFollow(prev, t)) && (!next || this.model.canFollow(t, next))
  }

  private without(trips: SolverTrip[], t: SolverTrip): SolverTrip[] { return trips.filter(x => x !== t) }

  private relocate(): Move | null {
    const a = this.pick()
    const t = a.trips[this.int(a.trips.length)]
    const na = this.without(a.trips, t)
    if (na.length && !this.model.chainOk(na)) return null
    const b = this.scan(a, b => b.trips[0].dep - 600 <= t.dep && b.trips[b.trips.length - 1].arr + 600 >= t.arr && this.fits(b.trips, t))
    if (!b) return null
    const nb = [...b.trips, t].sort(byDep)
    return this.stage([a, b], [
      ...(na.length ? [{ trips: na, branchId: a.branchId, depotId: a.depotId }] : []),
      { trips: nb, branchId: b.branchId, depotId: b.depotId },
    ])
  }

  private swap(): Move | null {
    const a = this.pick()
    const ta = a.trips[this.int(a.trips.length)]
    const b = this.partner(a, ta.dep - 60, ta.arr + 60)
    if (!b) return null
    // the partner's trip closest in time
    let tb = b.trips[0]
    for (const t of b.trips) if (Math.abs(t.dep - ta.dep) < Math.abs(tb.dep - ta.dep)) tb = t
    const na = [...this.without(a.trips, ta), tb].sort(byDep)
    const nb = [...this.without(b.trips, tb), ta].sort(byDep)
    if (!this.model.chainOk(na) || !this.model.chainOk(nb)) return null
    return this.stage([a, b], [
      { trips: na, branchId: a.branchId, depotId: a.depotId },
      { trips: nb, branchId: b.branchId, depotId: b.depotId },
    ])
  }

  // a1..ai + bj+1.. and b1..bj + ai+1.. — cut both where a's trip i ends; only the two new
  // links need checking
  private tail(): Move | null {
    const a = this.pick()
    if (a.trips.length < 2) return null
    const i = this.int(a.trips.length - 1)
    const cut = a.trips[i].arr
    const lastBefore = (b: WorkBlock) => {
      let j = -1
      while (j + 1 < b.trips.length && b.trips[j + 1].dep <= cut) j++
      return j
    }
    const b = this.scan(a, b => {
      if (b.trips[0].dep > cut + 600 || b.trips[b.trips.length - 1].arr < cut - 600) return false
      const j = lastBefore(b)
      if (j + 1 < b.trips.length && !this.model.canFollow(a.trips[i], b.trips[j + 1])) return false
      if (j >= 0 && !this.model.canFollow(b.trips[j], a.trips[i + 1])) return false
      return j + 1 < b.trips.length || j >= 0
    })
    if (!b) return null
    const j = lastBefore(b)
    const na = [...a.trips.slice(0, i + 1), ...b.trips.slice(j + 1)]
    const nb = [...b.trips.slice(0, j + 1), ...a.trips.slice(i + 1)]
    if (na.length && nb.length && (na[na.length - 1].arr - na[0].dep > this.model.maxSpan || nb[nb.length - 1].arr - nb[0].dep > this.model.maxSpan)) return null
    return this.stage([a, b], [
      { trips: na, branchId: a.branchId, depotId: a.depotId },
      ...(nb.length ? [{ trips: nb, branchId: b.branchId, depotId: b.depotId }] : []),
    ])
  }

  // two blocks one after the other in time become one vehicle
  private merge(): Move | null {
    const a = this.pick()
    const first = a.trips[0], last = a.trips[a.trips.length - 1]
    const b = this.scan(a, b => {
      const bf = b.trips[0], bl = b.trips[b.trips.length - 1]
      if (bf.dep >= last.arr) return bl.arr - first.dep <= this.model.maxSpan && this.model.canFollow(last, bf)
      if (bl.arr <= first.dep) return last.arr - bf.dep <= this.model.maxSpan && this.model.canFollow(bl, first)
      return false
    })
    if (!b) return null
    const trips = [...a.trips, ...b.trips].sort(byDep)
    // the bigger block's operator and depot
    const keep = a.trips.length >= b.trips.length ? a : b
    return this.stage([a, b], [{ trips, branchId: keep.branchId, depotId: keep.depotId }])
  }

  private split(): Move | null {
    const a = this.pick()
    if (a.trips.length < 2) return null
    const i = 1 + this.int(a.trips.length - 1)
    return this.stage([a], [
      { trips: a.trips.slice(0, i), branchId: a.branchId, depotId: a.depotId },
      { trips: a.trips.slice(i),    branchId: a.branchId },
    ])
  }

  private depot(): Move | null {
    const a = this.pick()
    const options = this.model.depotsFor(a.branchId).filter(d => d.id !== a.depotId)
    if (!options.length) return null
    const d = options[this.int(options.length)]
    return this.stage([a], [{ trips: a.trips, branchId: a.branchId, depotId: d.id }])
  }

  private operator(): Move | null {
    const branches = this.model.branches
    if (branches.length < 2) return null
    const a = this.pick()
    const others = branches.filter(b => b !== a.branchId)
    const branchId = others[this.int(others.length)]
    return this.stage([a], [{ trips: a.trips, branchId, depotId: a.depotId }])
  }
}
