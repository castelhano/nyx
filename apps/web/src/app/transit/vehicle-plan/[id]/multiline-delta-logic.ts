// Pure helpers for multi-line delta-aware generation (Fase 4 — see
// docs/proposal/plan_generate_multiline_delta_v1.md).

import type { Direction, GeneratedRound } from './line-generator-logic'

// One RouteLocality row, in the shape needed here (ordered stop/waypoint
// sequence for a single route/direction). `localityId` null = OSRM waypoint,
// not a real stop — ignored when comparing stop sequences (4.1), but its
// deltaMinutes still counts toward the leg cost (4.2).
export interface RouteLegRef {
  localityId:   string | null
  sequence:     number
  deltaMinutes: number | null
}

// ── 4.1 — detect the delta point between a pair of routes ──────────────────

/** First shared stop (walking from the end) between two same-direction stop
 *  sequences — the point past which the two lines run the same trunk. Only
 *  real stops are compared (waypoints ignored); returns null when the routes
 *  don't share a destination at all, *or* when the only thing they share is
 *  the destination itself with nothing before it in common — that's not a
 *  trunk, just where both trips happen to end. A rider can't be waiting to
 *  board either line there; the ride is already over, so it isn't a delta
 *  (contrast with commonPrefixLocality, where a single shared point — the
 *  origin — still is one, since it's about simultaneous dispatch, not
 *  boarding). */
export function commonSuffixLocality(routeA: RouteLegRef[], routeB: RouteLegRef[]): string | null {
  const realA = [...routeA].filter(r => r.localityId != null).sort((a, b) => a.sequence - b.sequence)
  const realB = [...routeB].filter(r => r.localityId != null).sort((a, b) => a.sequence - b.sequence)

  let i = realA.length - 1
  let j = realB.length - 1
  let commonStart: string | null = null
  let matchCount = 0

  while (i >= 0 && j >= 0 && realA[i].localityId === realB[j].localityId) {
    commonStart = realA[i].localityId
    matchCount++
    i--
    j--
  }

  return matchCount >= 2 ? commonStart : null
}

/** Mirror of commonSuffixLocality for a shared *origin* instead of a shared
 *  destination — two lines dispatched from the same terminal that diverge
 *  from there (never reconverging) are just as real a delta as two lines
 *  converging onto a common destination (see "origem e/ou destino iguais" in
 *  the plan doc — origin-in-common is the other degenerate case, not a
 *  lesser one). Walks forward from the start, returning the last stop still
 *  shared before the routes diverge. */
export function commonPrefixLocality(routeA: RouteLegRef[], routeB: RouteLegRef[]): string | null {
  const realA = [...routeA].filter(r => r.localityId != null).sort((a, b) => a.sequence - b.sequence)
  const realB = [...routeB].filter(r => r.localityId != null).sort((a, b) => a.sequence - b.sequence)

  let i = 0
  let j = 0
  let commonEnd: string | null = null

  while (i < realA.length && j < realB.length && realA[i].localityId === realB[j].localityId) {
    commonEnd = realA[i].localityId
    i++
    j++
  }

  return commonEnd
}

/** Either kind of shared point between two routes — destination-anchored
 *  (commonSuffixLocality) checked first since a passenger waiting mid-trunk
 *  is the primary scenario the plan describes, falling back to an
 *  origin-anchored match (commonPrefixLocality) when the destinations
 *  differ. A pair can only ever contribute one delta candidate, never both,
 *  to keep 4.5's "one delta per direction" grouping well-defined. */
export function commonDeltaLocality(routeA: RouteLegRef[], routeB: RouteLegRef[]): string | null {
  return commonSuffixLocality(routeA, routeB) ?? commonPrefixLocality(routeA, routeB)
}

export interface DeltaGroup {
  direction:       Direction
  deltaLocalityId: string
  lineIds:         string[] // 2+ — every line sharing this exact delta point in this direction
}

/** 4.5 — groups the given lines per direction by whether they share one exact
 *  delta point. Per direction: picks the line with the longest real-stop
 *  sequence as the anchor (most likely the trunk+ramal "parent"), computes
 *  commonDeltaLocality against every other line with a route in that
 *  direction, then keeps only the largest cluster that agrees on the same
 *  locality — per the resolved doubt, a direction always closes on a single
 *  delta, never a chain of several. Lines that disagree, or have no route in
 *  that direction, simply aren't part of that direction's group (they still
 *  generate normally, ungrouped). */
export function detectDeltaGroups(
  routesByLine: Map<string, Partial<Record<Direction, RouteLegRef[]>>>,
): DeltaGroup[] {
  const groups: DeltaGroup[] = []
  const lineIds = [...routesByLine.keys()]

  for (const direction of ['OUTBOUND', 'INBOUND', 'CIRCULAR'] as Direction[]) {
    const withRoute = lineIds.filter(id => (routesByLine.get(id)?.[direction]?.length ?? 0) > 0)
    if (withRoute.length < 2) continue

    const realStopCount = (id: string) => (routesByLine.get(id)![direction] ?? []).filter(r => r.localityId != null).length
    const anchor = withRoute.reduce((best, id) => realStopCount(id) > realStopCount(best) ? id : best, withRoute[0])

    const votes = new Map<string, string[]>()
    for (const id of withRoute) {
      if (id === anchor) continue
      const delta = commonDeltaLocality(routesByLine.get(anchor)![direction]!, routesByLine.get(id)![direction]!)
      if (!delta) continue
      const list = votes.get(delta) ?? []
      list.push(id)
      votes.set(delta, list)
    }

    let bestDelta: string | null = null
    let bestMembers: string[] = []
    for (const [delta, members] of votes) {
      if (members.length > bestMembers.length) { bestDelta = delta; bestMembers = members }
    }

    if (bestDelta) groups.push({ direction, deltaLocalityId: bestDelta, lineIds: [anchor, ...bestMembers] })
  }

  return groups
}

// ── 4.2 — anchor the crossing instant at the delta ──────────────────────────

export interface DeltaOffset { minutes: number; complete: boolean }

/** Sum of deltaMinutes for every leg between the route's origin and
 *  `targetLocalityId` (inclusive). `complete: false` means at least one leg
 *  in between has no registered deltaMinutes — caller should fall back to a
 *  single TravelTimeMatrix origin↔delta lookup instead (same pattern as
 *  resolveNearestDepot), rather than trust a partial sum. Returns null when
 *  the target isn't even in this route's stop sequence. */
export function sumDeltaMinutesToLocality(routeLocalities: RouteLegRef[], targetLocalityId: string): DeltaOffset | null {
  const sorted = [...routeLocalities].sort((a, b) => a.sequence - b.sequence)
  const targetIdx = sorted.findIndex(r => r.localityId === targetLocalityId)
  if (targetIdx < 0) return null
  if (targetIdx === 0) return { minutes: 0, complete: true }

  let sum = 0
  for (let i = 1; i <= targetIdx; i++) {
    const dm = sorted[i].deltaMinutes
    if (dm == null) return { minutes: 0, complete: false }
    sum += dm
  }
  return { minutes: sum, complete: true }
}

/** Resolves the crossing-instant offset (4.2) for every line in a group: the
 *  per-leg sum when complete, falling back to a single origin↔delta
 *  TravelTimeMatrix lookup otherwise (same pattern as resolveNearestDepot).
 *  Shared between the generator modal and the read-only frequency panels so
 *  the two never drift apart on how an offset is derived. A line silently
 *  drops out of the returned map when neither source can resolve it. */
export async function resolveGroupOffsets(
  group:               Pick<DeltaGroup, 'direction' | 'deltaLocalityId' | 'lineIds'>,
  legsByLineDirection: Map<string, Partial<Record<Direction, RouteLegRef[]>>>,
  getOriginLocalityId: (lineId: string, direction: Direction) => string | null,
  getTravelTimeFn:     (originId: string, destinationId: string) => Promise<number | null>,
): Promise<Map<string, number>> {
  const offsets = new Map<string, number>()
  for (const lineId of group.lineIds) {
    const legs = legsByLineDirection.get(lineId)?.[group.direction] ?? []
    const sum  = sumDeltaMinutesToLocality(legs, group.deltaLocalityId)
    if (sum?.complete) { offsets.set(lineId, sum.minutes); continue }
    const originId = getOriginLocalityId(lineId, group.direction)
    if (!originId) continue
    const fallback = await getTravelTimeFn(originId, group.deltaLocalityId)
    if (fallback != null) offsets.set(lineId, fallback)
  }
  return offsets
}

// ── 4.3 — interleave without recolliding ────────────────────────────────────

export type PriorityMode = 'base' | 'delta'

export interface InterleaveParams {
  perLineRounds:          Map<string, GeneratedRound[]> // already generated independently per line (Fase 3, unchanged)
  crossingOffsetMinutes:  Map<string, number>            // 4.2 offset, per line, for this direction's delta
  direction:               Direction
  minTrunkHeadwayMinutes: number
  // Cap on how far a round can move, as a fraction of its own "natural
  // headway" (distance to its nearest same-line neighbor at the crossing,
  // before any adjustment) — default proposal was half; exposed as a
  // configurable field in the modal.
  maxShiftFraction:        number
  mode:                    PriorityMode
  // Required when mode === 'delta': that line's rounds never move — every
  // needed adjustment against it is absorbed entirely by the other line.
  principalLineId?:        string
}

interface CrossingEntry { lineId: string; roundIndex: number; crossingMinutes: number; naturalHeadway: number }

/** Entrelaçamento por deslocamento (4.3, abordagem A). Runs a single
 *  left-to-right sweep over every round's crossing instant at the delta,
 *  sorted chronologically across the whole group: whenever two consecutive
 *  crossings from different lines are closer than minTrunkHeadwayMinutes,
 *  nudges them apart. In `base` mode both sides give way, proportionally to
 *  their own slack (a line with more room to move absorbs more of the
 *  adjustment) — so no single line always eats the correction. In `delta`
 *  mode the Principal line's rounds are the fixed reference: the other line
 *  absorbs the full adjustment (still capped by its own slack). Whenever the
 *  cap isn't enough to fully resolve a pair, it degrades silently (partial
 *  intercalation) rather than warning — the user reviews and adjusts
 *  manually what matters.
 *
 *  Known simplification: this is one forward sweep, not an iterative
 *  equilibrium — a round nudged here can end up closer to its own next
 *  same-line round than before (that pair is never itself checked, since
 *  same-line pairs aren't a trunk collision). The natural-headway cap bounds
 *  how bad this can get, but doesn't eliminate it; see the risk noted in the
 *  plan doc for very uneven group frequencies. */
export function interleaveDeltaGroup(params: InterleaveParams): Map<string, GeneratedRound[]> {
  const { perLineRounds, crossingOffsetMinutes, direction, minTrunkHeadwayMinutes, maxShiftFraction, mode, principalLineId } = params

  const perLineCrossings = new Map<string, (number | null)[]>()
  for (const [lineId, rounds] of perLineRounds) {
    const offset = crossingOffsetMinutes.get(lineId)
    perLineCrossings.set(lineId, rounds.map(r => {
      if (offset == null) return null
      const leg = r.legs.find(l => l.direction === direction)
      return leg ? leg.departureMinutes + offset : null
    }))
  }

  const entries: CrossingEntry[] = []
  for (const [lineId, list] of perLineCrossings) {
    const known = list.filter((v): v is number => v != null)
    list.forEach((crossingMinutes, roundIndex) => {
      if (crossingMinutes == null) return
      const idx  = known.indexOf(crossingMinutes)
      const prev = known[idx - 1]
      const next = known[idx + 1]
      const gaps = [prev != null ? crossingMinutes - prev : null, next != null ? next - crossingMinutes : null]
        .filter((g): g is number => g != null)
      const naturalHeadway = gaps.length > 0 ? Math.min(...gaps) : Infinity
      entries.push({ lineId, roundIndex, crossingMinutes, naturalHeadway })
    })
  }
  entries.sort((a, b) => a.crossingMinutes - b.crossingMinutes)

  const shift = new Map<string, number>()
  const key = (e: { lineId: string; roundIndex: number }) => `${e.lineId}:${e.roundIndex}`
  const currentTime = (e: CrossingEntry) => e.crossingMinutes + (shift.get(key(e)) ?? 0)

  for (let i = 0; i < entries.length - 1; i++) {
    const a = entries[i]
    const b = entries[i + 1]
    if (a.lineId === b.lineId) continue // same line — its own frequency, not a trunk collision

    const gap = currentTime(b) - currentTime(a)
    if (gap >= minTrunkHeadwayMinutes) continue
    const needed = minTrunkHeadwayMinutes - gap

    const capA   = a.naturalHeadway === Infinity ? needed : a.naturalHeadway * maxShiftFraction
    const capB   = b.naturalHeadway === Infinity ? needed : b.naturalHeadway * maxShiftFraction
    const slackA = Math.max(0, capA - Math.abs(shift.get(key(a)) ?? 0))
    const slackB = Math.max(0, capB - Math.abs(shift.get(key(b)) ?? 0))

    let backA = 0 // a moves earlier
    let fwdB  = 0 // b moves later

    if (mode === 'delta' && principalLineId && a.lineId === principalLineId) {
      fwdB = Math.min(needed, slackB)
    } else if (mode === 'delta' && principalLineId && b.lineId === principalLineId) {
      backA = Math.min(needed, slackA)
    } else {
      const totalSlack = slackA + slackB
      backA = totalSlack > 0 ? Math.min(slackA, needed * (slackA / totalSlack)) : 0
      fwdB  = Math.min(slackB, needed - backA)
    }

    if (backA > 0) shift.set(key(a), (shift.get(key(a)) ?? 0) - backA)
    if (fwdB  > 0) shift.set(key(b), (shift.get(key(b)) ?? 0) + fwdB)
  }

  const result = new Map<string, GeneratedRound[]>()
  for (const [lineId, rounds] of perLineRounds) {
    result.set(lineId, rounds.map((r, roundIndex) => {
      const delta = shift.get(`${lineId}:${roundIndex}`)
      if (!delta) return r
      return {
        ...r,
        legs: r.legs.map(l => ({ ...l, departureMinutes: l.departureMinutes + delta, arrivalMinutes: l.arrivalMinutes + delta })),
        readyAgainMinutes: r.readyAgainMinutes + delta,
      }
    }))
  }
  return result
}

export const DEFAULT_MIN_TRUNK_HEADWAY_MINUTES = 3
export const DEFAULT_MAX_SHIFT_FRACTION = 0.5
