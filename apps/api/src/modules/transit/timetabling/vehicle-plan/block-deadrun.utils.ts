import { PrismaService } from '../../../../prisma/prisma.service'

// A BlockDeadrun has no FK to the trip(s) it's anchored to — like BlockInterval
// (see block-interval.utils.ts), the link is positional, by time: ACCESS is anchored to the
// trip right after it (earliest departureMinutes >= its departure), RETURN and DISPLACEMENT to
// the nearest preceding trip (same "latest arrivalMinutes <= departureMinutes" rule as
// intervals). A block that recolhe mid-day and leaves again keeps each access/return tied to
// its own trip — removing the block's first or last trip no longer takes the others along.
export async function findDeadrunIdsAnchoredToTrips(
  prisma:         PrismaService,
  vehicleBlockId: string,
  tripIds:        string[],
): Promise<string[]> {
  if (tripIds.length === 0) return []
  const db = prisma as any

  const [trips, deadruns] = await Promise.all([
    db.blockTrip.findMany({
      where:  { vehicleBlockId },
      select: { tripId: true, trip: { select: { departureMinutes: true, arrivalMinutes: true } } },
    }),
    db.blockDeadrun.findMany({
      where:  { vehicleBlockId },
      select: { id: true, type: true, departureMinutes: true },
    }),
  ])

  if (trips.length === 0 || deadruns.length === 0) return []

  const tripIdSet   = new Set(tripIds)
  const byDeparture = trips
    .map((bt: any) => ({ tripId: bt.tripId as string, dep: bt.trip.departureMinutes as number, arr: bt.trip.arrivalMinutes as number }))
    .sort((a: any, b: any) => a.dep - b.dep)

  const anchored: string[] = []

  for (const dr of deadruns) {
    const anchor = dr.type === 'ACCESS'
      ? byDeparture.find((t: any) => t.dep >= dr.departureMinutes)
      : byDeparture.filter((t: any) => t.arr <= dr.departureMinutes).at(-1)
    if (anchor && tripIdSet.has(anchor.tripId)) anchored.push(dr.id)
  }

  return anchored
}
