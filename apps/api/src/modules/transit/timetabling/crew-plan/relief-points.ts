import type { ReliefPoint } from '@nyx/schemas'
import { PrismaService } from '../../../../prisma/prisma.service'

// Where a DutyPiece may start/end on a block: each trip's route endpoints (at its real
// departure/arrival), every allowsCrewChange stop along the way, and deadrun endpoints
// (depot pull-out/pull-in, displacements). A mid-trip stop's time follows the OSO
// export's rule (oso-workbook.renderer.ts, loadMinutesBeforeDestination): the trip's real
// arrivalMinutes minus the minutes from that stop to the route's destination, walking
// backward through deltaMinutes with TravelTimeMatrix as fallback for missing legs.

type Span = { startMinutes: number; endMinutes: number }

export interface BlockReliefData {
  window: Span | null
  // the parts of the window where the vehicle is in service and therefore needs a driver:
  // the window minus the vehicle's own intervals (BlockInterval) and minus time parked at
  // the depot between a RETURN deadrun and a later ACCESS one
  serviceSpans: Span[]
  points: ReliefPoint[]
}

interface StopRow { localityId: string | null; deltaMinutes: number | null; allowsCrewChange: boolean }

export function computeBlockRelief(input: {
  trips: {
    id: string; departureMinutes: number; arrivalMinutes: number
    originLocalityId: string; destinationLocalityId: string
    stops: StopRow[] // route localities ordered by sequence
  }[]
  deadruns: { type: string; originLocalityId: string; destinationLocalityId: string; departureMinutes: number; arrivalMinutes: number }[]
  intervals: { departureMinutes: number; arrivalMinutes: number }[]
  matrixMinutes: Map<string, number> // `${from}:${to}` → baseMinutes
}): BlockReliefData {
  const points: ReliefPoint[] = []

  for (const t of input.trips) {
    points.push({ localityId: t.originLocalityId,      minutes: t.departureMinutes, kind: 'TRIP_ORIGIN',      tripId: t.id })
    points.push({ localityId: t.destinationLocalityId, minutes: t.arrivalMinutes,   kind: 'TRIP_DESTINATION', tripId: t.id })

    // endpoints (first/last stop) are already covered above
    const stops = t.stops
    let acc = 0
    for (let i = stops.length - 1; i > 0; i--) {
      const prev = stops[i - 1], cur = stops[i]
      acc += cur.deltaMinutes ?? (prev.localityId && cur.localityId ? input.matrixMinutes.get(`${prev.localityId}:${cur.localityId}`) : undefined) ?? 0
      if (i - 1 === 0 || !prev.allowsCrewChange || !prev.localityId) continue
      const minutes = Math.max(t.departureMinutes, t.arrivalMinutes - acc)
      points.push({ localityId: prev.localityId, minutes, kind: 'CREW_CHANGE_STOP', tripId: t.id })
    }
  }

  for (const d of input.deadruns) {
    points.push({ localityId: d.originLocalityId,      minutes: d.departureMinutes, kind: 'DEADRUN_ORIGIN' })
    points.push({ localityId: d.destinationLocalityId, minutes: d.arrivalMinutes,   kind: 'DEADRUN_DESTINATION' })
  }

  const starts = [...input.trips, ...input.deadruns, ...input.intervals].map(e => e.departureMinutes)
  const ends   = [...input.trips, ...input.deadruns, ...input.intervals].map(e => e.arrivalMinutes)
  const window = starts.length ? { startMinutes: Math.min(...starts), endMinutes: Math.max(...ends) } : null

  const idle: Span[] = input.intervals.map(i => ({ startMinutes: i.departureMinutes, endMinutes: i.arrivalMinutes }))
  const byTime = [...input.deadruns].sort((a, b) => a.departureMinutes - b.departureMinutes)
  for (const ret of byTime.filter(d => d.type === 'RETURN')) {
    const nextAccess = byTime.find(d => d.type === 'ACCESS' && d.departureMinutes >= ret.arrivalMinutes)
    if (nextAccess) idle.push({ startMinutes: ret.arrivalMinutes, endMinutes: nextAccess.departureMinutes })
  }

  points.sort((a, b) => a.minutes - b.minutes)
  return { window, serviceSpans: window ? subtractSpans(window, idle) : [], points }
}

export function subtractSpans(from: Span, cut: Span[]): Span[] {
  const out: Span[] = []
  let cursor = from.startMinutes
  for (const c of [...cut].sort((a, b) => a.startMinutes - b.startMinutes)) {
    if (c.endMinutes <= cursor || c.startMinutes >= from.endMinutes) continue
    if (c.startMinutes > cursor) out.push({ startMinutes: cursor, endMinutes: c.startMinutes })
    cursor = Math.max(cursor, c.endMinutes)
  }
  if (cursor < from.endMinutes) out.push({ startMinutes: cursor, endMinutes: from.endMinutes })
  return out
}

export function isReliefPoint(points: ReliefPoint[], localityId: string, minutes: number): boolean {
  return points.some(p => p.localityId === localityId && p.minutes === minutes)
}

export interface LoadedBlockRelief extends BlockReliefData {
  branchId: string | null
  trips:    { departureMinutes: number; arrivalMinutes: number; lineId: string }[]
}

// Loads everything computeBlockRelief needs for a set of blocks in a few queries — plus the
// block's operator and trip lines, which crew-scoring.calc.ts needs alongside the points.
export async function loadBlockRelief(prisma: PrismaService, blockIds: string[]): Promise<Map<string, LoadedBlockRelief>> {
  const result = new Map<string, LoadedBlockRelief>()
  if (blockIds.length === 0) return result

  const blocks = await prisma.vehicleBlock.findMany({
    where:  { id: { in: blockIds } },
    select: {
      id: true,
      branchId: true,
      blockTrips: {
        select: {
          trip: {
            select: {
              id: true, departureMinutes: true, arrivalMinutes: true,
              route: {
                select: {
                  lineId: true, originLocalityId: true, destinationLocalityId: true,
                  localities: {
                    orderBy: { sequence: 'asc' },
                    select:  { localityId: true, deltaMinutes: true, allowsCrewChange: true },
                  },
                },
              },
            },
          },
        },
      },
      blockDeadruns:  { select: { type: true, originLocalityId: true, destinationLocalityId: true, departureMinutes: true, arrivalMinutes: true } },
      blockIntervals: { select: { departureMinutes: true, arrivalMinutes: true } },
    },
  })

  const missing = new Map<string, { originId: string; destinationId: string }>()
  for (const b of blocks) {
    for (const { trip } of b.blockTrips) {
      const stops = trip.route.localities
      for (let i = 1; i < stops.length; i++) {
        const from = stops[i - 1].localityId, to = stops[i].localityId
        if (stops[i].deltaMinutes == null && from && to) missing.set(`${from}:${to}`, { originId: from, destinationId: to })
      }
    }
  }
  const matrix = missing.size
    ? await prisma.travelTimeMatrix.findMany({
        where:  { OR: [...missing.values()] },
        select: { originId: true, destinationId: true, baseMinutes: true },
      })
    : []
  const matrixMinutes = new Map(matrix.map(m => [`${m.originId}:${m.destinationId}`, m.baseMinutes]))

  for (const b of blocks) {
    const relief = computeBlockRelief({
      trips: b.blockTrips.map(({ trip }) => ({
        id:                    trip.id,
        departureMinutes:      trip.departureMinutes,
        arrivalMinutes:        trip.arrivalMinutes,
        originLocalityId:      trip.route.originLocalityId,
        destinationLocalityId: trip.route.destinationLocalityId,
        stops:                 trip.route.localities,
      })),
      deadruns:  b.blockDeadruns,
      intervals: b.blockIntervals,
      matrixMinutes,
    })
    result.set(b.id, {
      ...relief,
      branchId: b.branchId,
      trips:    b.blockTrips.map(({ trip }) => ({ departureMinutes: trip.departureMinutes, arrivalMinutes: trip.arrivalMinutes, lineId: trip.route.lineId })),
    })
  }
  return result
}
