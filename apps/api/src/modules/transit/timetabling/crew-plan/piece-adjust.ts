import type { PieceAdjustFailure, ReliefPoint, ReliefPointKind } from '@nyx/schemas'

// How a piece left stale by a VehiclePlan edit (OUT_OF_BLOCK_WINDOW / INVALID_RELIEF_POINT)
// follows that edit: each end moves to its anchored event's new time — same trip or deadrun,
// same kind, same locality. An end still on a valid point stays put. Ends without an anchor
// (stale before anchors were kept) fall back to the closest point at the same locality, when
// it's the only one at that distance and within FALLBACK_MAX_SHIFT.

const FALLBACK_MAX_SHIFT = 60

// `${kind}:${tripId | deadrunId}` — DutyPiece.startAnchor / endAnchor
export function anchorOf(p: ReliefPoint): string | null {
  const ref = p.tripId ?? p.deadrunId
  return ref ? `${p.kind}:${ref}` : null
}

// several events can share a point (a zero-layover turn: one trip's arrival and the next one's
// departure) — a start takes over at a departure, an end hands over at an arrival
const START_ORDER: ReliefPointKind[] = ['TRIP_ORIGIN', 'DEADRUN_ORIGIN', 'CREW_CHANGE_STOP', 'TRIP_DESTINATION', 'DEADRUN_DESTINATION']
const END_ORDER:   ReliefPointKind[] = ['TRIP_DESTINATION', 'DEADRUN_DESTINATION', 'CREW_CHANGE_STOP', 'TRIP_ORIGIN', 'DEADRUN_ORIGIN']

// anchor of a valid end: the current one while it still sits on that point, else the preferred event there
export function resolveAnchor(
  points: ReliefPoint[], localityId: string, minutes: number, current: string | null, side: 'start' | 'end',
): string | null {
  const here = points.filter(p => p.localityId === localityId && p.minutes === minutes)
  if (current && here.some(p => anchorOf(p) === current)) return current
  const order = side === 'start' ? START_ORDER : END_ORDER
  const best  = [...here].sort((a, b) => order.indexOf(a.kind) - order.indexOf(b.kind))[0]
  return best ? anchorOf(best) : null
}

export type PieceAdjust =
  | { ok: true; start: ReliefPoint; end: ReliefPoint }
  | { ok: false; side: 'start' | 'end' | null; reason: PieceAdjustFailure }

type Edge = { ok: true; point: ReliefPoint } | { ok: false; reason: PieceAdjustFailure }

export function planPieceAdjust(
  piece: {
    startMinutes: number; endMinutes: number; startLocalityId: string; endLocalityId: string
    startAnchor: string | null; endAnchor: string | null
  },
  points: ReliefPoint[],
): PieceAdjust {
  const start = resolveEdge(points, piece.startLocalityId, piece.startMinutes, piece.startAnchor)
  if (!start.ok) return { ok: false, side: 'start', reason: start.reason }
  const end = resolveEdge(points, piece.endLocalityId, piece.endMinutes, piece.endAnchor)
  if (!end.ok) return { ok: false, side: 'end', reason: end.reason }
  if (start.point.minutes >= end.point.minutes) return { ok: false, side: null, reason: 'INVERTED' }
  return { ok: true, start: start.point, end: end.point }
}

function resolveEdge(points: ReliefPoint[], localityId: string, minutes: number, anchor: string | null): Edge {
  const here  = points.filter(p => p.localityId === localityId)
  const exact = here.find(p => p.minutes === minutes)
  if (exact) return { ok: true, point: exact }

  const distance = (p: ReliefPoint) => Math.abs(p.minutes - minutes)
  if (anchor) {
    // more than one only when the trip passes the locality twice (circular route stop)
    const hits = here.filter(p => anchorOf(p) === anchor).sort((a, b) => distance(a) - distance(b))
    return hits.length ? { ok: true, point: hits[0] } : { ok: false, reason: 'ANCHOR_GONE' }
  }

  const near = here.filter(p => distance(p) <= FALLBACK_MAX_SHIFT).sort((a, b) => distance(a) - distance(b))
  if (near.length === 0) return { ok: false, reason: 'NO_CANDIDATE' }
  const tie = near.some(p => p.minutes !== near[0].minutes && distance(p) === distance(near[0]))
  return tie ? { ok: false, reason: 'AMBIGUOUS' } : { ok: true, point: near[0] }
}
