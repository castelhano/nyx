import { PrismaService } from '../../../../prisma/prisma.service'

// A BlockInterval has no FK to the trip it "belongs to" — the link is positional:
// the productive trip with the latest arrivalMinutes that is still <= the interval's
// departureMinutes (nearest preceding trip in the block's chronological sequence).
// Mirrors the `prevProd` lookup used by the frontend's push/pull logic.
// See docs/proposal/vehicle-plan-block-intervals.md §2.2/§7.1.
export async function findIntervalIdsAnchoredToTrips(
  prisma:         PrismaService,
  vehicleBlockId: string,
  tripIds:        string[],
): Promise<string[]> {
  if (tripIds.length === 0) return []
  const db = prisma as any

  const [trips, intervals] = await Promise.all([
    db.blockTrip.findMany({
      where:  { vehicleBlockId },
      select: { tripId: true, trip: { select: { departureMinutes: true, arrivalMinutes: true } } },
    }),
    db.blockInterval.findMany({
      where:  { vehicleBlockId },
      select: { id: true, departureMinutes: true },
    }),
  ])

  if (intervals.length === 0) return []

  const sortedTrips = trips
    .map((bt: any) => ({ tripId: bt.tripId as string, dep: bt.trip.departureMinutes as number, arr: bt.trip.arrivalMinutes as number }))
    .sort((a: any, b: any) => a.dep - b.dep)

  const tripIdSet = new Set(tripIds)
  const anchored: string[] = []

  for (const interval of intervals) {
    let anchorTripId: string | null = null
    for (const t of sortedTrips) {
      if (t.arr <= interval.departureMinutes) anchorTripId = t.tripId
      else break
    }
    if (anchorTripId && tripIdSet.has(anchorTripId)) anchored.push(interval.id)
  }

  return anchored
}
