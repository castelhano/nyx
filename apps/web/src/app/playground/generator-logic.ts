// Pure helpers for the Line Schedule Generator prototype — kept dependency-free
// so they can move into the real feature (Phase 2 of the proposal doc) largely
// unchanged, once wired to real TransitLine data instead of mock-data.ts.

import type { CycleWindow, Direction } from './mock-data'

export interface GenWindow {
  id:                string
  from:              number // decimal hour
  to:                number
  outboundMinutes:   number // ida cycle (travel) time within this band
  outboundInterval:  number // stop/turnback time at the destination end, before starting volta
  inboundMinutes:    number // volta cycle (travel) time within this band
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

function findCovering(windows: CycleWindow[], point: number): CycleWindow | undefined {
  return windows.find(w => point >= w.from && point < w.to)
}

/** Unifies two independent per-direction cycle-window timelines (ida/volta can
 *  be registered at different granularities) into one merged timeline where
 *  each row carries both directions' cycle time for that band. This is the
 *  seed the user then freely merges/splits inside the modal. */
export function buildUnifiedWindows(outbound: CycleWindow[], inbound: CycleWindow[]): GenWindow[] {
  const bounds = new Set<number>()
  for (const w of outbound) { bounds.add(w.from); bounds.add(w.to) }
  for (const w of inbound)  { bounds.add(w.from); bounds.add(w.to) }
  const sorted = [...bounds].sort((a, b) => a - b)

  const rows: GenWindow[] = []
  for (let i = 0; i < sorted.length - 1; i++) {
    const from = sorted[i]
    const to   = sorted[i + 1]
    if (to <= from) continue
    const mid = (from + to) / 2
    const outboundMinutes = findCovering(outbound, mid)?.minutes ?? 60
    const inboundMinutes  = findCovering(inbound,  mid)?.minutes ?? 60
    // Rough starting guess only — always user-editable afterward.
    const fleetCount = Math.max(1, Math.min(12, Math.round((outboundMinutes + inboundMinutes) / 15)))
    rows.push({
      id: crypto.randomUUID(), from, to,
      outboundMinutes, outboundInterval: 0, inboundMinutes, inboundInterval: 0,
      fleetCount,
    })
  }
  return rows
}

/** Merge a row with the next one. Default cycle times become the max of the
 *  two (never silently shrink a window's assumed duration); fleet count keeps
 *  the first row's value — both stay user-editable after the merge. */
export function mergeWithNext(rows: GenWindow[], index: number): GenWindow[] {
  if (index < 0 || index >= rows.length - 1) return rows
  const a = rows[index]
  const b = rows[index + 1]
  const merged: GenWindow = {
    id:               crypto.randomUUID(),
    from:             a.from,
    to:               b.to,
    outboundMinutes:  Math.max(a.outboundMinutes,  b.outboundMinutes),
    outboundInterval: Math.max(a.outboundInterval, b.outboundInterval),
    inboundMinutes:   Math.max(a.inboundMinutes,   b.inboundMinutes),
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
  return rows.map((r, i) => i === index ? { ...r, inboundMinutes: r.inboundMinutes + toAdd } : r)
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
 *  algorithm (that's Phase 2's round-robin walk, mirroring handleAdjustCycle
 *  in page.tsx). Good enough to sanity-check a configuration before closing
 *  the modal. */
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
