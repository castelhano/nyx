import type { ReliefPoint } from '@nyx/schemas'
import { PrismaService } from '../../../../prisma/prisma.service'

// Where a DutyPiece may start/end on a block: each trip's route endpoints (at its real
// departure/arrival), every allowsCrewChange stop along the way, and deadrun endpoints
// (depot pull-out/pull-in, displacements). A mid-trip stop's time follows the OSO
// export's rule (oso-workbook.renderer.ts, loadMinutesBeforeDestination): the trip's real
// arrivalMinutes minus the minutes from that stop to the route's destination, walking
// backward through deltaMinutes with TravelTimeMatrix as fallback for missing legs.

export interface BlockReliefData {
  window: { startMinutes: number; endMinutes: number } | null
  points: ReliefPoint[]
}

interface StopRow { localityId: string | null; deltaMinutes: number | null; allowsCrewChange: boolean }

export function computeBlockRelief(input: {
  trips: {
    id: string; departureMinutes: number; arrivalMinutes: number
    originLocalityId: string; destinationLocalityId: string
    stops: StopRow[] // route localities ordered by sequence
  }[]
  deadruns: { originLocalityId: string; destinationLocalityId: string; departureMinutes: number; arrivalMinutes: number }[]
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

  points.sort((a, b) => a.minutes - b.minutes)
  return { window, points }
}

export function isReliefPoint(points: ReliefPoint[], localityId: string, minutes: number): boolean {
  return points.some(p => p.localityId === localityId && p.minutes === minutes)
}

// Loads everything computeBlockRelief needs for a set of blocks in a few queries.
export async function loadBlockRelief(prisma: PrismaService, blockIds: string[]): Promise<Map<string, BlockReliefData>> {
  const result = new Map<string, BlockReliefData>()
  if (blockIds.length === 0) return result

  const blocks = await prisma.vehicleBlock.findMany({
    where:  { id: { in: blockIds } },
    select: {
      id: true,
      blockTrips: {
        select: {
          trip: {
            select: {
              id: true, departureMinutes: true, arrivalMinutes: true,
              route: {
                select: {
                  originLocalityId: true, destinationLocalityId: true,
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
      blockDeadruns:  { select: { originLocalityId: true, destinationLocalityId: true, departureMinutes: true, arrivalMinutes: true } },
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
    result.set(b.id, computeBlockRelief({
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
    }))
  }
  return result
}
