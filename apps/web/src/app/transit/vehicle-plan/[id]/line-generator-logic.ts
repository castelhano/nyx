// Pure helpers for the per-line schedule generator (see
// docs/proposal/vehicle-plan-line-schedule-generator.md). Prototyped against
// mock data in apps/web/src/app/playground/ before landing here unchanged —
// only the imports changed to point at real app types.

import type { CycleWindow } from './views/vehicles.view'

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

    // Placeholder only — estimateFleetCounts() overwrites this from real
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

function rideCycleMinutes(w: GenWindow): number {
  return w.outboundMinutes + w.inboundMinutes
}

/** Groups consecutive, fully-known rows whose ride cycle (ida+volta only —
 *  stop/turnback intervals don't count) stays within `toleranceMinutes` of
 *  the group's anchor: the ride cycle of whichever row started the group,
 *  fixed for the group's whole lifetime. This bounds every member to within
 *  the stated tolerance of the anchor — comparing instead against a running
 *  "furthest point reached so far" would let a sequence of small steps chain
 *  into a much larger drift than the label promises. The group's final value
 *  is the member with the largest ride cycle, taken whole (never mixes ida
 *  from one row with volta from another). Rows with any unknown side never
 *  start or join a group — a tolerance match against a 0 placeholder isn't a
 *  real match. */
export function mergeByTolerance(rows: GenWindow[], toleranceMinutes: number): GenWindow[] {
  if (toleranceMinutes <= 0) return rows

  const merged: GenWindow[] = []
  let anchor = NaN

  for (const row of rows) {
    const bothKnown     = row.outboundKnown && row.inboundKnown
    const last          = merged[merged.length - 1]
    const lastBothKnown = !!last && last.outboundKnown && last.inboundKnown

    if (bothKnown && lastBothKnown && Math.abs(rideCycleMinutes(row) - anchor) <= toleranceMinutes) {
      if (rideCycleMinutes(row) > rideCycleMinutes(last)) {
        merged[merged.length - 1] = { ...row, from: last.from, to: row.to }
      } else {
        last.to = row.to
      }
      continue
    }

    merged.push({ ...row })
    if (bothKnown) anchor = rideCycleMinutes(row)
  }

  return merged
}

// Target occupancy fleet sizing assumes: don't run a vehicle any fuller than
// this, on average, during the band's peak hour.
const TARGET_OCCUPANCY = 0.8

// Demand is stored per hour (string keys); a band can span several hours and
// straddle half-hour boundaries, so this scans every whole hour the band
// touches and keeps the worst one — sizing fleet for a band's average hour
// would under-serve its actual peak.
function peakDemandInRange(
  from:   number,
  to:     number,
  demand: Partial<Record<Direction, Record<string, number>>>,
): number {
  let peak = 0
  for (const dir of ['OUTBOUND', 'INBOUND'] as Direction[]) {
    const dirDemand = demand[dir]
    if (!dirDemand) continue
    for (let hour = Math.floor(from); hour < Math.ceil(to); hour++) {
      const v = dirDemand[String(hour)] ?? 0
      if (v > peak) peak = v
    }
  }
  return peak
}

/** Sizes fleet from real demand instead of a flat guess: enough vehicles to
 *  carry the band's peak-hour demand (worse of ida/volta — a vehicle serves
 *  both directions in sequence, so it has to cover whichever leg is heavier)
 *  without exceeding TARGET_OCCUPANCY on average. Falls back to the old flat
 *  cycle/15 heuristic when there's no demand data to size from at all — that
 *  case is unfortunately still common (see docs/proposal/…): most lines
 *  don't have demand imported yet. */
export function estimateFleetCounts(
  rows:            GenWindow[],
  demand:          Partial<Record<Direction, Record<string, number>>>,
  vehicleCapacity: number,
): GenWindow[] {
  return rows.map(row => {
    const cycleTotal = totalCycleMinutes(row)
    if (cycleTotal <= 0) return { ...row, fleetCount: 1 }

    const peakDemand = peakDemandInRange(row.from, row.to, demand)
    if (peakDemand <= 0) {
      return { ...row, fleetCount: Math.max(1, Math.round(cycleTotal / 15)) }
    }

    const capacityPerTrip = vehicleCapacity * TARGET_OCCUPANCY
    if (capacityPerTrip <= 0) return { ...row, fleetCount: 1 }

    const tripsPerHourNeeded = peakDemand / capacityPerTrip
    const fleetCount = Math.max(1, Math.ceil(tripsPerHourNeeded * cycleTotal / 60))
    return { ...row, fleetCount }
  })
}

/** Merge a row with the next one. Default cycle times become the max of the
 *  two (never silently shrink a window's assumed duration); fleet count keeps
 *  the first row's value — both stay user-editable after the merge. A side is
 *  only "known" in the merged row if it was known on at least one of the two
 *  — max() already picks the real value over a 0 placeholder in that case. */
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
    fleetCount:       a.fleetCount,
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
 *  fleet count (a fractional/broken frequency), pads `inboundMinutes` with
 *  whatever's missing to reach the next multiple — always adding time to the
 *  volta leg, never shortening anything, so the frequency becomes a clean
 *  whole-minute figure. No-op if it's already closed. */
export function closeFrequency(rows: GenWindow[], index: number): GenWindow[] {
  const row = rows[index]
  if (!row || row.fleetCount <= 0) return rows
  const total     = totalCycleMinutes(row)
  const remainder = total % row.fleetCount
  if (remainder === 0) return rows
  const toAdd = row.fleetCount - remainder
  return rows.map((r, i) => i === index ? { ...r, inboundMinutes: r.inboundMinutes + toAdd, inboundKnown: true } : r)
}

// ── oferta × demanda ──────────────────────────────────────────────────────────

function windowCoveringHour(rows: GenWindow[], hour: number): GenWindow | undefined {
  return rows.find(w => hour >= w.from && hour < w.to)
}

/** oferta(hour) = (round trips/hour for one direction) × capacity per trip.
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
    const hourMidMinutes = hour * 60 + 30
    const inOperation    = hourMidMinutes >= opStartMinutes && hourMidMinutes < opEndMinutes
    const w              = windowCoveringHour(rows, hour + 0.5)

    for (const dir of ['OUTBOUND', 'INBOUND'] as Direction[]) {
      if (!inOperation || !w) { result[dir]![hour] = 0; continue }
      const cycleTotal      = totalCycleMinutes(w)
      const tripsPerHour    = cycleTotal > 0 ? (w.fleetCount * 60) / cycleTotal : 0
      const capacityPerTrip = vehicleCapacity * (1 + (renewalIndex[dir] ?? 0) / 100)
      result[dir]![hour]    = Math.round(tripsPerHour * capacityPerTrip)
    }
  }

  return result
}

/** Rough estimate for the modal's preview footer — not the real scheduling
 *  algorithm (that's the next step: a round-robin walk mirroring
 *  handleAdjustCycle in page.tsx). Good enough to sanity-check a
 *  configuration before closing the modal. */
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
