// Pure helpers for the per-line schedule generator (see
// docs/proposal/vehicle-plan-line-schedule-generator.md). Prototyped against
// mock data in apps/web/src/app/playground/ before landing here unchanged —
// only the imports changed to point at real app types.

import type { CycleWindow, LineMetrics } from './views/vehicles.view'
import { resolveCycleWindow } from './views/vehicles.view'

export type Direction = 'OUTBOUND' | 'INBOUND' | 'CIRCULAR'

export interface GenWindow {
  id:                string
  from:              number // decimal hour
  to:                number
  outboundMinutes:   number // ida cycle (travel) time within this band
  outboundKnown:     boolean // false when no registered cycle window covers this band for ida — outboundMinutes is a 0 placeholder, not real data
  outboundInterval:  number // stop/turnback time at the destination end, before starting volta
  inboundMinutes:    number // volta cycle (travel) time within this band
  inboundKnown:      boolean // same as outboundKnown, for volta
  inboundInterval:   number // stop/turnback time back at the origin end, before starting the next ida
  fleetCount:        number // vehicles operating in this band (shared across both directions)
}

/** Full round-trip duration for a window: both travel legs plus both
 *  end-of-line stop/turnback intervals. This is what frequency is derived
 *  from (`totalCycleMinutes(w) / fleetCount`), so any change to either
 *  interval field affects frequency exactly like a change to a cycle field. */
export function totalCycleMinutes(w: GenWindow): number {
  return w.outboundMinutes + w.outboundInterval + w.inboundMinutes + w.inboundInterval
}

// ── time formatting ──────────────────────────────────────────────────────────

export function hourToLabel(hour: number): string {
  const hh = Math.floor(hour)
  const mm = Math.round((hour - hh) * 60)
  return `${String(hh).padStart(2, '0')}:${String(mm).padStart(2, '0')}`
}

export function labelToHour(label: string): number {
  const [hh, mm] = label.split(':').map(Number)
  return (hh || 0) + (mm || 0) / 60
}

export function minutesToLabel(minutes: number): string {
  const hh = Math.floor(minutes / 60) % 24
  const mm = minutes % 60
  return `${String(hh).padStart(2, '0')}:${String(mm).padStart(2, '0')}`
}

export function labelToMinutes(label: string): number {
  const [hh, mm] = label.split(':').map(Number)
  return (hh || 0) * 60 + (mm || 0)
}

// ── generation window seeding + editing ──────────────────────────────────────

const SLOT_STEP = 0.5 // half-hour resolution, same granularity TransitLine.metrics.windows registers at

// Mirrors resolveCycleWindow (vehicles.view.ts) exactly: `to` is inclusive —
// it marks the last half-hour slot included, not an exclusive upper bound.
// Using the same slot-quantized, inclusive check here is what makes two
// windows like [0,4.5] and [5,5.5] read as contiguous (no slot falls between
// 4.5 and 5.0) instead of implying a fabricated gap.
function resolveSlotWindow(windows: CycleWindow[], slot: number): CycleWindow | null {
  return windows.find(w => slot >= w.from && slot <= w.to) ?? null
}

/** Unifies two independent per-direction cycle-window timelines (ida/volta can
 *  be registered at different granularities, and can have genuine gaps where
 *  no window is registered at all) into one merged timeline. Scans the day at
 *  the same half-hour resolution windows are registered at, resolving each
 *  slot exactly like resolveCycleWindow does — including each window's own
 *  registered `intervalMinutes` (stop/turnback time), seeded straight into
 *  outboundInterval/inboundInterval instead of defaulting to 0 — then
 *  coalesces consecutive slots whose (ida, volta) pair doesn't change into a
 *  single row. A slot with no covering window on one side becomes
 *  `*Known: false` — a real gap in the source data, not something to
 *  silently fabricate a number for. */
export function buildUnifiedWindows(outbound: CycleWindow[], inbound: CycleWindow[]): GenWindow[] {
  const rows: GenWindow[] = []

  for (let slot = 0; slot < 24; slot += SLOT_STEP) {
    const obWindow = resolveSlotWindow(outbound, slot)
    const ibWindow = resolveSlotWindow(inbound,  slot)
    const obMinutes  = obWindow?.minutes ?? 0
    const obInterval = obWindow?.intervalMinutes ?? 0
    const ibMinutes  = ibWindow?.minutes ?? 0
    const ibInterval = ibWindow?.intervalMinutes ?? 0
    const last = rows[rows.length - 1]

    if (last
      && last.outboundKnown === (obWindow != null) && last.outboundMinutes === obMinutes && last.outboundInterval === obInterval
      && last.inboundKnown  === (ibWindow != null) && last.inboundMinutes  === ibMinutes  && last.inboundInterval  === ibInterval
    ) {
      last.to = slot + SLOT_STEP
      continue
    }

    // Placeholder only — deriveFleetBands() rebuilds bands (and fleet) from real
    // demand right after seeding finishes (see the pipeline in the modal's
    // seedWindows()). Bands can still change shape after this (gap
    // absorption, tolerance merge), so sizing fleet here would be premature.
    rows.push({
      id: crypto.randomUUID(), from: slot, to: slot + SLOT_STEP,
      outboundMinutes: obMinutes, outboundKnown: obWindow != null, outboundInterval: obInterval,
      inboundMinutes:  ibMinutes, inboundKnown:  ibWindow != null, inboundInterval:  ibInterval,
      fleetCount: 1,
    })
  }
  return rows
}

/** Absorbs rows where exactly one side has no registered data into whichever
 *  fully-known neighbor already shares the same value on the side that *is*
 *  known — the missing side simply inherits the neighbor's real value instead
 *  of staying a fabricated placeholder. When both neighbors qualify, the one
 *  with the larger total cycle wins (same "never assume a shorter cycle"
 *  principle as mergeWithNext/closeFrequency). Rows with both sides unknown,
 *  or with no qualifying neighbor, are left untouched — nothing to infer
 *  from in either case. */
export function absorbPartialGaps(rows: GenWindow[]): GenWindow[] {
  let result = rows
  let mergedSomething = true

  while (mergedSomething) {
    mergedSomething = false

    for (let i = 0; i < result.length; i++) {
      const row = result[i]
      const onlyOutboundUnknown = !row.outboundKnown && row.inboundKnown
      const onlyInboundUnknown  =  row.outboundKnown && !row.inboundKnown
      if (!onlyOutboundUnknown && !onlyInboundUnknown) continue

      const prev = i > 0 ? result[i - 1] : undefined
      const next = i < result.length - 1 ? result[i + 1] : undefined

      const qualifies = (c: GenWindow | undefined): c is GenWindow => {
        if (!c || !c.outboundKnown || !c.inboundKnown) return false
        return onlyOutboundUnknown ? c.inboundMinutes === row.inboundMinutes : c.outboundMinutes === row.outboundMinutes
      }

      const prevOk = qualifies(prev)
      const nextOk = qualifies(next)
      if (!prevOk && !nextOk) continue

      const target = prevOk && nextOk
        ? (totalCycleMinutes(prev!) >= totalCycleMinutes(next!) ? prev! : next!)
        : (prevOk ? prev! : next!)
      const targetIsPrev = target === prev

      const merged: GenWindow = {
        ...target,
        from: Math.min(target.from, row.from),
        to:   Math.max(target.to,   row.to),
      }

      const lo = targetIsPrev ? i - 1 : i
      const hi = targetIsPrev ? i : i + 1
      result = [...result.slice(0, lo), merged, ...result.slice(hi + 1)]
      mergedSomething = true
      break
    }
  }

  return result
}

export type ToleranceLevel = 0 | 1 | 2 | 3 // Nenhuma, Baixa, Média, Alta

export const TOLERANCE_MINUTES: Record<ToleranceLevel, number> = { 0: 0, 1: 3, 2: 5, 3: 8 }
export const TOLERANCE_LABELS:  Record<ToleranceLevel, string> = { 0: 'Nenhuma', 1: 'Baixa', 2: 'Média', 3: 'Alta' }

// Block assignment (Fase 3): when trying to fit a trip into an already-open block, how much
// to "tighten" that block's previous trip before giving up and opening a new block.
export const DEFAULT_MANEUVER_MARGIN_MINUTES = 3

function rideCycleMinutes(w: GenWindow): number {
  return w.outboundMinutes + w.inboundMinutes
}

/** Groups consecutive, fully-known rows whose ride cycle (ida+volta only —
 *  stop/turnback intervals don't count) stays within `toleranceMinutes` of
 *  every other member already in the group: a row joins only if the group's
 *  resulting max−min ride-cycle span (including the row) would still fit
 *  within the tolerance. Comparing against a single frozen "anchor" (e.g.
 *  whichever row started the group) isn't enough — pulling one more row into
 *  an earlier group can change which row starts the *next* group, which can
 *  make a larger tolerance produce *more* groups than a smaller one for the
 *  same input. Bounding by the whole group's span avoids that: a group valid
 *  at a given tolerance stays valid at any larger tolerance, so raising the
 *  tolerance never increases the group count. It also still rules out the
 *  creep a running "furthest point reached so far" comparison would allow —
 *  a chain of small steps can't drift the group past the stated tolerance
 *  either. The group's final value is the member with the largest ride
 *  cycle, taken whole (never mixes ida from one row with volta from
 *  another). Rows with any unknown side never start or join a group — a
 *  tolerance match against a 0 placeholder isn't a real match. */
export function mergeByTolerance(rows: GenWindow[], toleranceMinutes: number): GenWindow[] {
  if (toleranceMinutes <= 0) return rows

  const merged: GenWindow[] = []
  let groupMin = NaN
  let groupMax = NaN

  for (const row of rows) {
    const bothKnown     = row.outboundKnown && row.inboundKnown
    const last          = merged[merged.length - 1]
    const lastBothKnown = !!last && last.outboundKnown && last.inboundKnown
    const rideCycle      = rideCycleMinutes(row)
    const nextMin         = Math.min(groupMin, rideCycle)
    const nextMax         = Math.max(groupMax, rideCycle)

    if (bothKnown && lastBothKnown && nextMax - nextMin <= toleranceMinutes) {
      if (rideCycle > rideCycleMinutes(last)) {
        merged[merged.length - 1] = { ...row, from: last.from, to: row.to }
      } else {
        last.to = row.to
      }
      groupMin = nextMin
      groupMax = nextMax
      continue
    }

    merged.push({ ...row })
    if (bothKnown) { groupMin = rideCycle; groupMax = rideCycle }
  }

  return merged
}

// Target occupancy fleet sizing assumes: don't run a vehicle any fuller than
// this, on average, during the hour.
const TARGET_OCCUPANCY = 0.8

// See docs/proposal/vehicle-plan-fleet-window-redesign.md — a fleet band shorter
// than this never survives on its own unless it's an actual peak (higher than its
// same-cycle neighbors); a brief dip gets absorbed into the sturdier neighbor
// instead of fragmenting the day into one window per noisy hour of demand.
const DEFAULT_STABILIZATION_MINUTES = 60

/** Vehicles needed to carry one hour's peak demand (worse of ida/volta — a vehicle
 *  serves both directions in sequence, so it has to cover whichever leg is
 *  heavier) without exceeding TARGET_OCCUPANCY on average, at the given cycle
 *  duration. Each leg's capacity is further inflated by that direction's
 *  renewalIndex (mid-route turnover measured from bilhetagem x GPS conciliation,
 *  see TransitLine.metrics) — a leg with heavy turnover carries more total riders
 *  per trip than its seat count alone would suggest, so it needs fewer vehicles
 *  to match the same demand. `hasAnyDemand` gates the old flat cycle/15
 *  heuristic: it only applies when the LINE has no demand curve at all to size
 *  from (still common — most lines don't have demand imported yet); an hour with
 *  zero/missing demand on a line that otherwise has a curve is real signal (e.g.
 *  a genuinely quiet overnight hour), not missing data — it sizes to the floor
 *  of 1 vehicle, not the flat guess. */
function fleetNeededForHour(
  hour:            number,
  cycleTotal:      number,
  demand:          Partial<Record<Direction, Record<string, number>>>,
  vehicleCapacity: number,
  renewalIndex:    Partial<Record<Direction, number>>,
  hasAnyDemand:    boolean,
): number {
  if (cycleTotal <= 0) return 1
  if (!hasAnyDemand) return Math.max(1, Math.round(cycleTotal / 15))

  const tripsPerHourNeeded = Math.max(...(['OUTBOUND', 'INBOUND'] as Direction[]).map(dir => {
    const v = demand[dir]?.[String(hour)] ?? 0
    const capacityPerTrip = vehicleCapacity * TARGET_OCCUPANCY * (1 + (renewalIndex[dir] ?? 0) / 100)
    return capacityPerTrip > 0 ? v / capacityPerTrip : 0
  }))
  if (tripsPerHourNeeded <= 0) return 1

  return Math.max(1, Math.ceil(tripsPerHourNeeded * cycleTotal / 60))
}

function findCycleRow(rows: GenWindow[], slot: number): GenWindow | undefined {
  return rows.find(w => slot >= w.from && slot < w.to) ?? rows.find(w => slot >= w.from && slot <= w.to)
}

interface FleetSlot { from: number; to: number; cycleRowId: string; fleet: number; row: GenWindow }

function coalesceFleetSlots(slots: FleetSlot[]): FleetSlot[] {
  const rows: FleetSlot[] = []
  for (const s of slots) {
    const last = rows[rows.length - 1]
    if (last && last.cycleRowId === s.cycleRowId && last.fleet === s.fleet) last.to = s.to
    else rows.push({ ...s })
  }
  return rows
}

/** Hysteresis: a band shorter than `stabilizationMinutes` only survives as-is if
 *  it's a real peak (fleet higher than its same-cycle neighbors — brief peaks are
 *  never smoothed away). A brief dip gets absorbed into the sturdier neighbor —
 *  never the other way around, never silently shrinking coverage — and never
 *  crosses a real cycle boundary (only merges neighbors sharing the same
 *  `cycleRowId`, since a fleet band can never mix two different cycles). */
function applyFleetHysteresis(bands: FleetSlot[], stabilizationMinutes: number): FleetSlot[] {
  let result = bands.map(b => ({ ...b }))
  let changed = true
  while (changed) {
    changed = false
    for (let i = 0; i < result.length; i++) {
      const band = result[i]
      const durationMinutes = (band.to - band.from) * 60
      if (durationMinutes >= stabilizationMinutes) continue

      const prev = result[i - 1]
      const next = result[i + 1]
      const prevOk = !!prev && prev.cycleRowId === band.cycleRowId && prev.fleet >= band.fleet
      const nextOk = !!next && next.cycleRowId === band.cycleRowId && next.fleet >= band.fleet
      if (!prevOk && !nextOk) continue // no compatible neighbor to absorb into — keep it (it's a peak, or isolated by the cycle boundary)

      const target = prevOk && nextOk ? (prev!.fleet >= next!.fleet ? prev! : next!) : (prevOk ? prev! : next!)
      target.from = Math.min(target.from, band.from)
      target.to   = Math.max(target.to,   band.to)
      result = result.filter(b => b !== band)
      changed = true
      break
    }
  }
  return coalesceFleetSlots(result)
}

/** Replaces the old estimateFleetCounts: decides the SHAPE of the fleet windows
 *  from demand, not from cycle — see
 *  docs/proposal/vehicle-plan-fleet-window-redesign.md. `cycleRows` is the
 *  already-closed cycle timeline (buildUnifiedWindows → absorbPartialGaps →
 *  mergeByTolerance) and only acts as a constraint here: a fleet band always
 *  stays contained within a single cycle row, never crosses a cycle change —
 *  only demand decides WHERE to cut within an otherwise-stable cycle stretch. */
export function deriveFleetBands(
  cycleRows:            GenWindow[],
  demand:               Partial<Record<Direction, Record<string, number>>>,
  vehicleCapacity:      number,
  renewalIndex:         Partial<Record<Direction, number>> = {},
  stabilizationMinutes: number = DEFAULT_STABILIZATION_MINUTES,
): GenWindow[] {
  if (cycleRows.length === 0) return cycleRows
  const hasAnyDemand = Object.keys(demand.OUTBOUND ?? {}).length > 0 || Object.keys(demand.INBOUND ?? {}).length > 0

  const slots: FleetSlot[] = []
  for (let slot = 0; slot < 24; slot += SLOT_STEP) {
    const row = findCycleRow(cycleRows, slot)
    if (!row) continue
    const cycleTotal = totalCycleMinutes(row)
    const fleet = fleetNeededForHour(Math.floor(slot), cycleTotal, demand, vehicleCapacity, renewalIndex, hasAnyDemand)
    slots.push({ from: slot, to: slot + SLOT_STEP, cycleRowId: row.id, fleet, row })
  }

  const smoothed = applyFleetHysteresis(coalesceFleetSlots(slots), stabilizationMinutes)

  return smoothed.map(b => ({
    id:               crypto.randomUUID(),
    from:             b.from,
    to:               b.to,
    outboundMinutes:  b.row.outboundMinutes,
    outboundKnown:    b.row.outboundKnown,
    outboundInterval: b.row.outboundInterval,
    inboundMinutes:   b.row.inboundMinutes,
    inboundKnown:     b.row.inboundKnown,
    inboundInterval:  b.row.inboundInterval,
    fleetCount:       b.fleet,
  }))
}

/** Updates a single row's `from` or `to`, pushing the touching boundary of
 *  its immediate neighbor to match (increasing this row's `to` past the next
 *  row's `from` moves the next row's `from` forward too — that's the only
 *  way two adjacent rows share an edge). Rejected (no-op) whenever it would
 *  invert a row — this row's own `to` going below its own `from` (or vice
 *  versa for `from`), or the push inverting the neighbor it touches. That's
 *  a merge, not a boundary drag — callers should use mergeWithNext /
 *  splitWindow for that instead of dragging a whole window out of
 *  existence. Only ever touches the edited row and its one neighbor; never
 *  cascades further than that. */
export function updateWindowBoundary(
  rows:     GenWindow[],
  index:    number,
  field:    'from' | 'to',
  rawValue: number,
): GenWindow[] {
  const row = rows[index]
  if (!row) return rows

  if (field === 'to') {
    if (rawValue < row.from) return rows
    const next = rows[index + 1]
    if (next && rawValue > next.to) return rows
    const result = rows.map(r => ({ ...r }))
    result[index] = { ...row, to: rawValue }
    if (next) result[index + 1] = { ...next, from: rawValue }
    return result
  } else {
    if (rawValue > row.to) return rows
    const prev = rows[index - 1]
    if (prev && rawValue < prev.from) return rows
    const result = rows.map(r => ({ ...r }))
    result[index] = { ...row, from: rawValue }
    if (prev) result[index - 1] = { ...prev, to: rawValue }
    return result
  }
}

/** Per-row flags for whether its `from`/`to` cleanly touches its neighbor
 *  (or, for the first/last row, the fixed day boundary at 0/24). Deleting a
 *  window can open a gap between what's now-adjacent rows — rather than
 *  guessing how to close it, the UI surfaces it here so the planner can fix
 *  it deliberately (drag a boundary, or re-split/merge). */
export interface BoundaryFlags { fromMismatch: boolean; toMismatch: boolean }

export function computeBoundaryFlags(rows: GenWindow[]): BoundaryFlags[] {
  return rows.map((row, i) => {
    const prev = rows[i - 1]
    const next = rows[i + 1]
    return {
      fromMismatch: i === 0               ? row.from !== 0  : row.from !== prev.to,
      toMismatch:   i === rows.length - 1 ? row.to   !== 24 : row.to   !== next.from,
    }
  })
}

/** Merge a row with the next one. Default cycle times become the max of the
 *  two (never silently shrink a window's assumed duration); fleet count takes
 *  the larger of the two for the same reason (merging into a bigger window
 *  should never silently drop coverage down to the smaller one's fleet) —
 *  both stay user-editable after the merge. A side is only "known" in the
 *  merged row if it was known on at least one of the two — max() already
 *  picks the real value over a 0 placeholder in that case. */
export function mergeWithNext(rows: GenWindow[], index: number): GenWindow[] {
  if (index < 0 || index >= rows.length - 1) return rows
  const a = rows[index]
  const b = rows[index + 1]
  const merged: GenWindow = {
    id:               crypto.randomUUID(),
    from:             a.from,
    to:               b.to,
    outboundMinutes:  Math.max(a.outboundMinutes,  b.outboundMinutes),
    outboundKnown:    a.outboundKnown || b.outboundKnown,
    outboundInterval: Math.max(a.outboundInterval, b.outboundInterval),
    inboundMinutes:   Math.max(a.inboundMinutes,   b.inboundMinutes),
    inboundKnown:     a.inboundKnown || b.inboundKnown,
    inboundInterval:  Math.max(a.inboundInterval,  b.inboundInterval),
    fleetCount:       Math.max(a.fleetCount, b.fleetCount),
  }
  return [...rows.slice(0, index), merged, ...rows.slice(index + 2)]
}

/** Split a row at its midpoint (snapped to the half-hour). Both halves start
 *  out identical to the original row — same cycle times, same fleet — and are
 *  independently editable afterward. */
export function splitWindow(rows: GenWindow[], index: number): GenWindow[] {
  const row = rows[index]
  if (!row) return rows
  const mid = Math.round(((row.from + row.to) / 2) * 2) / 2
  if (mid <= row.from || mid >= row.to) return rows
  const first:  GenWindow = { ...row, id: crypto.randomUUID(), to: mid }
  const second: GenWindow = { ...row, id: crypto.randomUUID(), from: mid }
  return [...rows.slice(0, index), first, second, ...rows.slice(index + 1)]
}

/** "Closes" the frequency: if the round trip doesn't divide evenly by the
 *  fleet count (a fractional/broken frequency), pads `inboundInterval` with
 *  whatever's missing to reach the next multiple — always adding time to the
 *  volta turnback interval, never shortening anything and never touching the
 *  travel-time cycle fields, so the frequency becomes a clean whole-minute
 *  figure. No-op if it's already closed. */
export function closeFrequency(rows: GenWindow[], index: number): GenWindow[] {
  const row = rows[index]
  if (!row || row.fleetCount <= 0) return rows
  const total     = totalCycleMinutes(row)
  const remainder = total % row.fleetCount
  if (remainder === 0) return rows
  const toAdd = row.fleetCount - remainder
  return rows.map((r, i) => i === index ? { ...r, inboundInterval: r.inboundInterval + toAdd } : r)
}

// ── oferta × demanda ──────────────────────────────────────────────────────────

function windowCoveringHour(rows: GenWindow[], hour: number): GenWindow | undefined {
  return rows.find(w => hour >= w.from && hour < w.to)
}

// Fraction of [hour*60, hour*60+60) that falls inside [opStart, opEnd) — used to
// weight an hour's bar by how much of it is actually operated, instead of an
// all-or-nothing test on the hour's midpoint (which zeroed out, e.g., the 04h
// bar entirely for a 04:50 start even though 10' of it are operated). Any
// nonzero overlap is floored to 30' — this is a rate approximation, not a
// count of discrete trips, so a sliver of overlap (a handful of minutes)
// shouldn't read as a sliver of a bar.
function hourCoverage(hour: number, opStartMinutes: number, opEndMinutes: number): number {
  const hourStart = hour * 60
  const hourEnd   = hourStart + 60
  const overlap   = Math.max(0, Math.min(hourEnd, opEndMinutes) - Math.max(hourStart, opStartMinutes))
  return overlap > 0 ? Math.max(overlap, 30) / 60 : 0
}

/** oferta(hour) = (round trips/hour for one direction) × capacity per trip,
 *  weighted by the fraction of that hour actually within [opStart, opEnd).
 *  One vehicle produces exactly one outbound + one inbound departure per full
 *  cycle, so trips/hour is the same figure for both directions — only the
 *  renewal index (and therefore capacity per trip) differs between them. */
export function computeOfertaSeries(
  rows:             GenWindow[],
  vehicleCapacity:  number,
  renewalIndex:     Partial<Record<Direction, number>>,
  opStartMinutes:   number,
  opEndMinutes:     number,
): Partial<Record<Direction, Record<number, number>>> {
  const result: Partial<Record<Direction, Record<number, number>>> = { OUTBOUND: {}, INBOUND: {} }

  for (let hour = 0; hour < 24; hour++) {
    const coverage = hourCoverage(hour, opStartMinutes, opEndMinutes)
    const w        = windowCoveringHour(rows, hour + 0.5)

    for (const dir of ['OUTBOUND', 'INBOUND'] as Direction[]) {
      if (coverage <= 0 || !w) { result[dir]![hour] = 0; continue }
      const cycleTotal      = totalCycleMinutes(w)
      const tripsPerHour    = cycleTotal > 0 ? (w.fleetCount * 60) / cycleTotal : 0
      const capacityPerTrip = vehicleCapacity * (1 + (renewalIndex[dir] ?? 0) / 100)
      result[dir]![hour]    = Math.round(tripsPerHour * capacityPerTrip * coverage)
    }
  }

  return result
}

/** Rough estimate for the modal's live preview footer — deliberately not the
 *  real scheduling algorithm (see generateSchedule below): cheap enough to
 *  recompute on every window edit, good enough to sanity-check a
 *  configuration before actually generating. */
export function estimateGeneration(
  rows:           GenWindow[],
  opStartMinutes: number,
  opEndMinutes:   number,
): { trips: number; peakFleet: number } {
  let trips     = 0
  let peakFleet = 0

  for (const w of rows) {
    peakFleet = Math.max(peakFleet, w.fleetCount)
    const bandStart   = Math.max(w.from * 60, opStartMinutes)
    const bandEnd     = Math.min(w.to   * 60, opEndMinutes)
    const bandMinutes = Math.max(0, bandEnd - bandStart)
    const cycleTotal  = totalCycleMinutes(w)
    if (cycleTotal <= 0) continue
    const roundTrips = (bandMinutes / cycleTotal) * w.fleetCount
    trips += roundTrips * 2 // ida + volta
  }
  return { trips: Math.round(trips), peakFleet }
}

// ── real generation (Stage 1 — schedule grid) ───────────────────────────────────
//
// Three-step pipeline, kept as separate exported functions so each is
// independently testable: generateRounds (frequency + trip structure,
// steps 1–2) → assignRoundsToBlocks (block assignment, step 3).
// HOLD/DEPOT resolution (step 4) is deliberately NOT here — it needs live
// locality/depot/travel-time data this file has no access to (pure, no
// fetch), so it's resolved by the modal after calling generateSchedule().

export interface GeneratedLeg {
  direction:        Direction
  departureMinutes: number
  arrivalMinutes:   number
}

/** One full round-trip: either 2 legs (anchor direction + its pair — the
 *  common OUTBOUND/INBOUND case) or 1 leg (CIRCULAR-only lines, which have no
 *  separate return leg to pair against). `readyAgainMinutes` is when the
 *  vehicle that just did this round could depart on another one — the last
 *  leg's arrival plus its own trailing turnback interval — used to decide
 *  block placement in assignRoundsToBlocks. */
export interface GeneratedRound {
  id:                string
  legs:              GeneratedLeg[]
  readyAgainMinutes: number
}

export interface GeneratedBlock {
  id:     string
  rounds: GeneratedRound[]
}

// Half-open on `to` (unlike resolveSlotWindow's inclusive-both-ends, built for
// half-hour-slot seeding) — a continuous minute-by-minute cursor needs an
// unambiguous single owner for the exact instant a band boundary falls on.
function windowAtMinutes(rows: GenWindow[], minutes: number): GenWindow | undefined {
  const slot = minutes / 60
  return rows.find(w => slot >= w.from && slot < w.to) ?? rows.find(w => slot >= w.from && slot <= w.to)
}

/** Builds one round (anchor leg + derived paired leg, or the lone anchor leg
 *  for circular-only lines) departing at `anchorDep` within `band`. Factored
 *  out of generateRounds so the periodic sweep and the end-of-day closing
 *  round (see below) build rounds identically. */
function buildRound(
  rows:               GenWindow[],
  band:               GenWindow,
  anchorDep:          number,
  firstTripDirection: Direction,
  pairedDirection:    Direction | null,
): GeneratedRound {
  const anchorArr = anchorDep + (firstTripDirection === 'INBOUND' ? band.inboundMinutes : band.outboundMinutes)
  const legs: GeneratedLeg[] = [{ direction: firstTripDirection, departureMinutes: anchorDep, arrivalMinutes: anchorArr }]

  let readyAgainMinutes: number
  if (pairedDirection) {
    const anchorTurnback = firstTripDirection === 'INBOUND' ? band.inboundInterval : band.outboundInterval
    const pairedDep   = anchorArr + anchorTurnback
    const pairedBand  = windowAtMinutes(rows, pairedDep) ?? band
    const pairedMinutes  = pairedDirection === 'INBOUND' ? pairedBand.inboundMinutes  : pairedBand.outboundMinutes
    const pairedTurnback = pairedDirection === 'INBOUND' ? pairedBand.inboundInterval : pairedBand.outboundInterval
    const pairedArr = pairedDep + pairedMinutes
    legs.push({ direction: pairedDirection, departureMinutes: pairedDep, arrivalMinutes: pairedArr })
    readyAgainMinutes = pairedArr + pairedTurnback
  } else {
    const anchorTurnback = band.outboundInterval // circular-only lines reuse the outbound fields (see GenWindow)
    readyAgainMinutes = anchorArr + anchorTurnback
  }

  return { id: crypto.randomUUID(), legs, readyAgainMinutes }
}

/** Steps 1–2: generates the sequence of "rounds" (a full conceptual trip —
 *  outbound followed by inbound, or a single direction for circular lines)
 *  across the operating hours. Departures are placed by a continuous rate
 *  accumulator instead of a fixed per-round step: as time advances, progress
 *  toward the next departure accrues at `fleetCount / totalCycleMinutes`
 *  (rounds per minute) of whichever window covers that instant, and a
 *  departure fires the moment accumulated progress reaches 1 — carrying any
 *  leftover across a window boundary instead of resetting it there. A
 *  window's own frequency only ever governs the portion of time actually
 *  spent inside it, so a narrow high-frequency window can never be skipped
 *  by a coarser step inherited from the window before it, and a frequency
 *  change takes effect exactly at the boundary with no separate smoothing
 *  pass needed. `firstTripDirection` anchors which direction is generated in
 *  the periodic step — the round's other direction is always derived
 *  (anchor leg's arrival + turnback), never generated independently, because
 *  in continuous operation with N vehicles the return headway is
 *  automatically equal to the outbound one. `lastTripDirection` doesn't
 *  participate in the calculation (the final round's direction already
 *  follows from the anchor/derived pair) — it's only used to warn when it
 *  diverges from what's configured. */
export function generateRounds(
  rows:               GenWindow[],
  opStartMinutes:     number,
  opEndMinutes:       number,
  firstTripDirection: Direction,
  lastTripDirection:  Direction,
): { rounds: GeneratedRound[]; warnings: string[] } {
  const warnings: string[] = []
  if (rows.length === 0 || opEndMinutes <= opStartMinutes) return { rounds: [], warnings }

  const pairedDirection: Direction | null =
    firstTripDirection === 'CIRCULAR' ? null : firstTripDirection === 'OUTBOUND' ? 'INBOUND' : 'OUTBOUND'

  const rounds: GeneratedRound[] = []
  const warnedBands = new Set<string>()
  let cursor = opStartMinutes

  while (cursor <= opEndMinutes) {
    const band = windowAtMinutes(rows, cursor)
    if (!band) {
      warnings.push(`Sem janela configurada para o horário ${minutesToLabel(Math.round(cursor))}`)
      cursor += 30
      continue
    }

    const cycleTotal = totalCycleMinutes(band)
    const rate        = band.fleetCount > 0 && cycleTotal > 0 ? band.fleetCount / cycleTotal : 0
    if (rate <= 0) { cursor += 30; continue }

    const anchorKnown = firstTripDirection === 'INBOUND' ? band.inboundKnown : band.outboundKnown
    if (!anchorKnown && !warnedBands.has(band.id)) {
      warnedBands.add(band.id)
      warnings.push(`Ciclo não confirmado na faixa ${hourToLabel(band.from)}–${hourToLabel(band.to)} — revise antes de gerar`)
    }

    rounds.push(buildRound(rows, band, cursor, firstTripDirection, pairedDirection))

    // Sweep forward from this departure, accumulating rate × time across
    // however many window boundaries it takes to reach one full round of
    // progress — never a single blind jump sized off this window's rate
    // alone. Walked by array index (not by re-looking-up the point in time)
    // so the boundary exactly at a window's `to` always advances to the next
    // row instead of re-matching the same row a point-lookup's inclusive
    // fallback would return there — index strictly increases every
    // iteration, so this can never loop forever.
    let remaining  = 1
    let segStart   = cursor
    let idx        = rows.indexOf(band)
    let nextCursor: number | null = null

    while (idx < rows.length) {
      const segBand        = rows[idx]
      const segCycleTotal  = totalCycleMinutes(segBand)
      const segRate        = segBand.fleetCount > 0 && segCycleTotal > 0 ? segBand.fleetCount / segCycleTotal : 0
      const segEnd          = segBand.to * 60

      if (segRate <= 0) {
        segStart = segEnd
        idx++
        continue
      }

      const capacity = (segEnd - segStart) * segRate
      if (capacity >= remaining) {
        nextCursor = segStart + remaining / segRate
        break
      }

      remaining -= capacity
      segStart    = segEnd
      idx++
    }

    // Whatever cuts the sweep short here — fleet too thin to finish another
    // full round before day's end, or simply no more window data — the loop
    // just stops. Nothing is fabricated at this point; the closing pass
    // below is what's responsible for making the last trip land on
    // opEndMinutes, by retiming what was already generated instead of
    // inventing a new round.
    if (nextCursor == null) break
    cursor = nextCursor
  }

  // Closing pass: the last trip of the day is always pulled to land exactly
  // on opEndMinutes (delayed or advanced, whichever it takes), same as an
  // operator manually nudging the printed schedule. Rather than concentrate
  // that whole shift into a single, conspicuously different final headway,
  // it's spread across every round that shares the last round's cycle
  // window (buildRound uses real window data throughout, so crossing into a
  // *different* window's frequency is never blended — only rounds within
  // the same still-open window get retimed together, evenly spaced between
  // the window's first natural departure and the new target for the last
  // one).
  if (rounds.length > 0) {
    const lastRound = rounds[rounds.length - 1]
    const lastLegIndex = lastRound.legs.findIndex(l => l.direction === lastTripDirection)

    if (lastLegIndex !== -1) {
      const actualDep = lastRound.legs[lastLegIndex].departureMinutes
      const delta = opEndMinutes - actualDep

      if (Math.abs(delta) > 0.5) {
        const lastAnchorBand = windowAtMinutes(rows, lastRound.legs[0].departureMinutes)
        let suffixStart = rounds.length - 1
        if (lastAnchorBand) {
          while (suffixStart > 0) {
            const prevBand = windowAtMinutes(rows, rounds[suffixStart - 1].legs[0].departureMinutes)
            if (!prevBand || prevBand.id !== lastAnchorBand.id) break
            suffixStart--
          }
        }

        const k               = rounds.length - suffixStart
        const firstAnchorDep  = rounds[suffixStart].legs[0].departureMinutes
        const targetAnchorDep = lastRound.legs[0].departureMinutes + delta
        // Only a chronological-order guard against whatever round precedes the
        // suffix in the array (a different window/vehicle slot entirely, so its
        // readyAgainMinutes has no bearing here — departure order is all that
        // matters for assignRoundsToBlocks downstream).
        const floorGuard      = suffixStart > 0 ? rounds[suffixStart - 1].legs[0].departureMinutes : -Infinity

        if (targetAnchorDep >= floorGuard && (k === 1 || targetAnchorDep >= firstAnchorDep)) {
          for (let i = 0; i < k; i++) {
            const newAnchorDep = k === 1 ? targetAnchorDep : firstAnchorDep + (i / (k - 1)) * (targetAnchorDep - firstAnchorDep)
            const band = windowAtMinutes(rows, newAnchorDep) ?? lastAnchorBand
            if (!band) continue

            const anchorKnown = firstTripDirection === 'INBOUND' ? band.inboundKnown : band.outboundKnown
            if (!anchorKnown && !warnedBands.has(band.id)) {
              warnedBands.add(band.id)
              warnings.push(`Ciclo não confirmado na faixa ${hourToLabel(band.from)}–${hourToLabel(band.to)} — revise antes de gerar`)
            }

            rounds[suffixStart + i] = buildRound(rows, band, newAnchorDep, firstTripDirection, pairedDirection)
          }
          warnings.push(
            `Última viagem (${DIR_LABEL_INTERNAL[lastTripDirection]}) ${delta > 0 ? 'atrasada' : 'adiantada'} em `
            + `${Math.round(Math.abs(delta))}min para bater com o fim do horário configurado (${minutesToLabel(Math.round(opEndMinutes))})`
            + (k > 1 ? ` — frequência redistribuída entre as últimas ${k} viagens dessa faixa` : ''),
          )
        } else {
          warnings.push(
            `Não foi possível ajustar a última viagem ao horário de fim configurado (${minutesToLabel(Math.round(opEndMinutes))}) `
            + `sem sobrepor a viagem anterior — aumente a frota nas janelas finais (aba Janelas) para reduzir esse intervalo`,
          )
        }
      }
    }
  }

  const lastRoundFinal = rounds[rounds.length - 1]
  const lastLegDirection = lastRoundFinal?.legs[lastRoundFinal.legs.length - 1]?.direction
  if (lastLegDirection && lastLegDirection !== lastTripDirection) {
    warnings.push(
      `A última viagem gerada é de ${DIR_LABEL_INTERNAL[lastLegDirection]}, não ${DIR_LABEL_INTERNAL[lastTripDirection]} como configurado`,
    )
  }

  return { rounds, warnings }
}

const DIR_LABEL_INTERNAL: Record<Direction, string> = { OUTBOUND: 'Ida', INBOUND: 'Volta', CIRCULAR: 'Circular' }

/** Step 3: assigns the generated rounds to blocks (vehicles) via round-robin —
 *  the first round always opens block 1; each following round goes into
 *  whichever open block is already free and "tightest" (the latest
 *  `readyAgainMinutes` among the eligible ones), and only opens a new block if
 *  none is free in time, nor within the maneuver margin (a block freeing up
 *  shortly after the round's ideal time, by up to `maneuverMarginMinutes` — in
 *  that case the round is delayed until the block frees up, instead of
 *  opening another vehicle for just a few minutes' difference). */
export function assignRoundsToBlocks(
  rounds:                GeneratedRound[],
  maneuverMarginMinutes: number,
): GeneratedBlock[] {
  interface OpenBlock { block: GeneratedBlock; availableFrom: number }
  const open: OpenBlock[] = []

  for (const round of rounds) {
    const anchorDep = round.legs[0].departureMinutes

    let chosen: OpenBlock | null = null
    for (const ob of open) {
      if (ob.availableFrom <= anchorDep && (!chosen || ob.availableFrom > chosen.availableFrom)) chosen = ob
    }

    if (!chosen) {
      for (const ob of open) {
        if (ob.availableFrom > anchorDep && ob.availableFrom - anchorDep <= maneuverMarginMinutes) {
          if (!chosen || ob.availableFrom < chosen.availableFrom) chosen = ob
        }
      }
    }

    if (chosen) {
      const shift = Math.max(0, chosen.availableFrom - anchorDep)
      const placedRound = shift > 0
        ? {
            ...round,
            legs: round.legs.map(l => ({ ...l, departureMinutes: l.departureMinutes + shift, arrivalMinutes: l.arrivalMinutes + shift })),
            readyAgainMinutes: round.readyAgainMinutes + shift,
          }
        : round
      chosen.block.rounds.push(placedRound)
      chosen.availableFrom = placedRound.readyAgainMinutes
    } else {
      open.push({ block: { id: crypto.randomUUID(), rounds: [round] }, availableFrom: round.readyAgainMinutes })
    }
  }

  return open.map(ob => ob.block)
}

export interface FixedTripCandidate {
  _tempId:               string
  routeId:               string
  originLocalityId:      string
  destinationLocalityId: string
  departureMinutes:      number
  arrivalMinutes:        number
  requiredVehicleType?:  string
  // Minimum gap required, after this trip's arrival, before the next trip in the
  // same block can depart (the registered turnback/interval time for this trip's
  // own direction/cycle window) — 0/undefined when unknown, which enforces no gap
  // at all (same as the pre-existing behavior for any caller that doesn't supply it).
  intervalMinutes?:      number
}

// ── shared packing primitive ────────────────────────────────────────────────
//
// Both assignFixedTripsToBlocks (below) and redistributeTrips (Fase
// "Redistribuir" — see docs/FLOW.md) need the exact same greedy loop: walk
// candidates in departure order, and for each one scan every still-open block
// for the tightest still-valid fit, opening a new block only when none
// qualifies. What differs between them is only what "fits" means and what
// placing a candidate into a block actually commits — a fixed, already-known
// arrival for the OSO-switch case; a cycle that may retroactively shrink the
// block's last trip (within its margin) for the elastic Redistribuir case.
// `evaluate` decides both: it returns null when the candidate can't go in that
// block at all, or `{ score, commit }` when it can — `score` is what the
// tightest-fit comparison ranks by (so both a static field comparison and an
// elastic one that can prefer a block only reachable by shrinking share the
// same ranking), and `commit()` performs the actual mutation, invoked only for
// the block that wins. `openNew` builds the first item of a fresh block from a
// candidate that fit nowhere — trivial (identity) for the fixed case, but a
// real transform (candidate → placed item, cycle resolved) for the elastic one.
interface PackBlock<T> { items: T[] }

function packGreedy<C, T>(
  sorted:   C[],
  evaluate: (block: PackBlock<T>, candidate: C) => { score: number; commit: () => void } | null,
  openNew:  (candidate: C) => T,
): T[][] {
  const open: PackBlock<T>[] = []

  for (const candidate of sorted) {
    let chosen:      { score: number; commit: () => void } | null = null

    for (const block of open) {
      if (block.items.length === 0) continue
      const fit = evaluate(block, candidate)
      if (fit && (!chosen || fit.score > chosen.score)) chosen = fit
    }

    if (chosen) chosen.commit()
    else open.push({ items: [openNew(candidate)] })
  }

  return open.map(b => b.items)
}

/** Same greedy tightest-fit idea as assignRoundsToBlocks, for trips whose
 *  departureMinutes is already fixed by an approved LineDeparture — never shifts a
 *  trip's time to make it fit (no maneuver-margin tolerance: an approved partida's
 *  time isn't negotiable), and never mixes vehicle types in the same block. Used by
 *  the OSO-switch feature (switch-schedule-logic.ts), where trips come straight from
 *  the target schedule's departures instead of being generated from frequency
 *  windows — so, unlike a round (which already bundles ida+volta as one unit),
 *  each trip here is an independent leg and nothing pre-pairs them. A block can only
 *  take a trip whose originLocalityId matches where its last trip left the vehicle
 *  (or any trip at all if the block is still empty) — without this, tightest-fit-by-
 *  time-alone happily chains ida→ida→ida whenever departures are frequent enough,
 *  which no real vehicle can do without teleporting back to the origin. The next
 *  trip also can't depart before the previous one's own registered turnback/interval
 *  time has elapsed (`intervalMinutes`, when known) — same requirement redistributeTrips
 *  enforces, so a plan freshly loaded from an OSO doesn't start out with back-to-back
 *  pairings tighter than the line's own registered interval, only for Redistribuir to
 *  immediately reshuffle them the first time it runs. */
export function assignFixedTripsToBlocks<T extends FixedTripCandidate>(trips: T[]): T[][] {
  const byVehicleType = new Map<string, T[]>()
  for (const trip of trips) {
    const key   = trip.requiredVehicleType ?? ''
    const group = byVehicleType.get(key)
    if (group) group.push(trip)
    else byVehicleType.set(key, [trip])
  }

  const blocks: T[][] = []

  for (const group of byVehicleType.values()) {
    const sorted = [...group].sort((a, b) => a.departureMinutes - b.departureMinutes)
    blocks.push(...packGreedy<T, T>(sorted, (block, candidate) => {
      const last = block.items[block.items.length - 1]
      if (last.destinationLocalityId !== candidate.originLocalityId) return null
      const availableFrom = last.arrivalMinutes + (last.intervalMinutes ?? 0)
      if (availableFrom > candidate.departureMinutes) return null
      return { score: availableFrom, commit: () => { block.items.push(candidate) } }
    }, candidate => candidate))
  }

  return blocks
}

// ── Redistribuir (docs/FLOW.md) — margin-aware repack of a line's existing trips ──
//
// Reuses packGreedy above with an elastic `evaluate`: a candidate can also fit
// a block whose last trip's canonical cycle wouldn't otherwise leave room, by
// shrinking that last trip's own cycle down (never up, never below what's
// needed) within its own direction's margin. The candidate being placed always
// keeps its full canonical cycle — only the trip immediately preceding it in
// the block is ever eligible to shrink, and only by exactly the minimum needed
// to fit, so a trip's cycle is touched at most once per run no matter the
// margin, and re-running the whole operation from the same source data (as
// Redistribuir always does — see RedistributeModal) reaches the same result
// instead of compounding.

export interface RedistributeTripCandidate {
  _tempId:                 string
  tripId:                  string
  routeId:                 string
  direction:                Direction
  vehicleType:              string
  originLocalityId:        string
  destinationLocalityId:   string
  departureMinutes:        number
  // Fallback duration used only when no registered cycle window covers this
  // departure — the trip's current (pre-redistribution) duration, same
  // fallback handleAdjustCycle uses (useGanttEditor.ts).
  originalDurationMinutes: number
}

export interface RedistributedTrip {
  candidate:      RedistributeTripCandidate
  arrivalMinutes: number
}

export interface RedistributeResult {
  blocks:   RedistributedTrip[][]
  warnings: string[]
}

// Tie-breaker weight for the shrink-branch score below — margins are capped
// at 10min in the modal, so the largest possible nudge (10 * 1e-6) stays far
// under the 1-minute granularity separating it from any other candidate score.
const SHRINK_PENALTY = 1e-6

function resolveCanonicalCycle(
  metrics:     LineMetrics | null | undefined,
  dayTypeCode: string,
  direction:   Direction,
  dep:         number,
): { minutes: number; intervalMinutes: number } | null {
  const w = resolveCycleWindow(metrics, dayTypeCode, direction, dep)
  return w ? { minutes: w.minutes, intervalMinutes: w.intervalMinutes } : null
}

export function redistributeTrips(
  candidates:             RedistributeTripCandidate[],
  metrics:                LineMetrics | null | undefined,
  dayTypeCode:            string,
  marginByDirection:      Partial<Record<Direction, number>>,
  keepRegisteredInterval: boolean,
): RedistributeResult {
  let noWindowCount = 0

  function place(candidate: RedistributeTripCandidate): RedistributedTrip {
    const cycle = resolveCanonicalCycle(metrics, dayTypeCode, candidate.direction, candidate.departureMinutes)
    if (!cycle) noWindowCount++
    return { candidate, arrivalMinutes: candidate.departureMinutes + (cycle?.minutes ?? candidate.originalDurationMinutes) }
  }

  const byVehicleType = new Map<string, RedistributeTripCandidate[]>()
  for (const c of candidates) {
    const group = byVehicleType.get(c.vehicleType)
    if (group) group.push(c)
    else byVehicleType.set(c.vehicleType, [c])
  }

  const allBlocks: RedistributedTrip[][] = []

  for (const group of byVehicleType.values()) {
    const sorted = [...group].sort((a, b) => a.departureMinutes - b.departureMinutes)

    const packed = packGreedy<RedistributeTripCandidate, RedistributedTrip>(sorted, (block, candidate) => {
      const last = block.items[block.items.length - 1]
      if (last.candidate.destinationLocalityId !== candidate.originLocalityId) return null

      const lastCycle             = resolveCanonicalCycle(metrics, dayTypeCode, last.candidate.direction, last.candidate.departureMinutes)
      const lastCanonicalDuration = lastCycle?.minutes ?? (last.arrivalMinutes - last.candidate.departureMinutes)
      const lastCanonicalArrival  = last.candidate.departureMinutes + lastCanonicalDuration
      const interval              = keepRegisteredInterval ? (lastCycle?.intervalMinutes ?? 0) : 1
      const naturalAvailableFrom  = lastCanonicalArrival + interval

      if (naturalAvailableFrom <= candidate.departureMinutes) {
        return {
          score: naturalAvailableFrom,
          commit: () => {
            block.items[block.items.length - 1] = { ...last, arrivalMinutes: lastCanonicalArrival }
            block.items.push(place(candidate))
          },
        }
      }

      // Margin only ever applies to guarantee a fit, and never shrinks a cycle
      // past zero — a margin larger than the trip's own registered duration is
      // clamped, not honored literally.
      const margin       = Math.min(marginByDirection[last.candidate.direction] ?? 0, lastCanonicalDuration)
      const shrinkNeeded  = naturalAvailableFrom - candidate.departureMinutes
      if (margin <= 0 || shrinkNeeded > margin) return null

      return {
        // Every block reaching this branch commits to zero idle after
        // shrinking, so departureMinutes alone can't rank between them — the
        // SHRINK_PENALTY nudge breaks the tie toward whichever needs the
        // least shrink, small enough to never outrank a naturally-tight block
        // (any real idle is at least a full minute, dwarfing the nudge).
        score: candidate.departureMinutes - shrinkNeeded * SHRINK_PENALTY,
        commit: () => {
          block.items[block.items.length - 1] = { ...last, arrivalMinutes: lastCanonicalArrival - shrinkNeeded }
          block.items.push(place(candidate))
        },
      }
    }, place)

    allBlocks.push(...packed)
  }

  const warnings: string[] = []
  if (noWindowCount > 0) {
    warnings.push(`${noWindowCount} viagem(ns) sem ciclo configurado para o horário de partida — duração original mantida`)
  }

  return { blocks: allBlocks, warnings }
}

/** Convenience: runs steps 1–3 in sequence. */
export function generateSchedule(
  rows:                   GenWindow[],
  opStartMinutes:         number,
  opEndMinutes:           number,
  firstTripDirection:     Direction,
  lastTripDirection:      Direction,
  maneuverMarginMinutes:  number,
): { blocks: GeneratedBlock[]; warnings: string[] } {
  const { rounds, warnings } = generateRounds(rows, opStartMinutes, opEndMinutes, firstTripDirection, lastTripDirection)
  const blocks = assignRoundsToBlocks(rounds, maneuverMarginMinutes)
  return { blocks, warnings }
}
