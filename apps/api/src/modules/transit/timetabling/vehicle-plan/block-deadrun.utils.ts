import { PrismaService } from '../../../../prisma/prisma.service'

// A BlockDeadrun has no FK to the trip(s) it's anchored to — like BlockInterval
// (see block-interval.utils.ts), the link is positional, but the rule differs per
// type: ACCESS is anchored to the block's first trip (by sequence), RETURN to its
// last, and DISPLACEMENT to the nearest preceding trip in chronological order (same
// "latest arrivalMinutes <= departureMinutes" rule as intervals).
export async function findDeadrunIdsAnchoredToTrips(
  prisma:         PrismaService,
  vehicleBlockId: string,
  tripIds:        string[],
): Promise<string[]> {
  if (tripIds.length === 0) return []
  const db = prisma as any

  const [trips, deadruns] = await Promise.all([
    db.blockTrip.findMany({
      where:   { vehicleBlockId },
      select:  { tripId: true, trip: { select: { departureMinutes: true, arrivalMinutes: true } } },
      orderBy: { sequence: 'asc' },
    }),
    db.blockDeadrun.findMany({
      where:  { vehicleBlockId },
      select: { id: true, type: true, departureMinutes: true },
    }),
  ])

  if (trips.length === 0 || deadruns.length === 0) return []

  const tripIdSet   = new Set(tripIds)
  const firstTripId = trips[0].tripId as string
  const lastTripId  = trips[trips.length - 1].tripId as string
  const byDeparture = trips
    .map((bt: any) => ({ tripId: bt.tripId as string, dep: bt.trip.departureMinutes as number, arr: bt.trip.arrivalMinutes as number }))
    .sort((a: any, b: any) => a.dep - b.dep)

  const anchored: string[] = []

  for (const dr of deadruns) {
    if (dr.type === 'ACCESS') {
      if (tripIdSet.has(firstTripId)) anchored.push(dr.id)
      continue
    }
    if (dr.type === 'RETURN') {
      if (tripIdSet.has(lastTripId)) anchored.push(dr.id)
      continue
    }

    let anchorTripId: string | null = null
    for (const t of byDeparture) {
      if (t.arr <= dr.departureMinutes) anchorTripId = t.tripId
      else break
    }
    if (anchorTripId && tripIdSet.has(anchorTripId)) anchored.push(dr.id)
  }

  return anchored
}
