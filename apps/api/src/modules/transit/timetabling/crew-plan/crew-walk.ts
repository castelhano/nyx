import type { PrismaService } from '../../../../prisma/prisma.service'

// How a driver gets from the end of a piece to the start of the next one at another place:
// on foot (a declared TRAVEL activity aside). Distance: the travel matrix's road distance
// (TravelTimeMatrix.distanceKm), else the straight line × STRAIGHT_LINE_FACTOR; speed fixed.
// Beyond settings.maxWalkMeters the pieces can't follow each other (WALK_DISTANCE).

export const WALK_METERS_PER_MINUTE = 4000 / 60
const STRAIGHT_LINE_FACTOR = 1.3

export interface CrewWalk {
  // `${from}:${to}` → road km
  km:     Map<string, number>
  coords: Map<string, { lat: number; lng: number }>
}

// meters on foot between two localities — 0 at the same place, null when neither the matrix
// nor the coordinates know
export function walkMeters(walk: CrewWalk, from: string, to: string): number | null {
  if (from === to) return 0
  const km = walk.km.get(`${from}:${to}`)
  if (km != null) return km * 1000
  const a = walk.coords.get(from), b = walk.coords.get(to)
  if (!a || !b) return null
  const rad = (x: number) => (x * Math.PI) / 180
  const h = Math.sin(rad(b.lat - a.lat) / 2) ** 2 + Math.cos(rad(a.lat)) * Math.cos(rad(b.lat)) * Math.sin(rad(b.lng - a.lng) / 2) ** 2
  return 2 * 6_371_000 * Math.asin(Math.sqrt(h)) * STRAIGHT_LINE_FACTOR
}

export const walkMinutes = (meters: number) => Math.ceil(meters / WALK_METERS_PER_MINUTE)

// matrix distances among the localities (or only the given pairs) and their coordinates
export async function loadCrewWalk(
  prisma: PrismaService, localityIds: string[], pairs?: { originId: string; destinationId: string }[],
): Promise<CrewWalk> {
  const [matrix, localities] = await Promise.all([
    pairs
      ? (pairs.length ? prisma.travelTimeMatrix.findMany({ where: { OR: pairs }, select: { originId: true, destinationId: true, distanceKm: true } }) : Promise.resolve([]))
      : prisma.travelTimeMatrix.findMany({
          where:  { originId: { in: localityIds }, destinationId: { in: localityIds } },
          select: { originId: true, destinationId: true, distanceKm: true },
        }),
    prisma.transitLocality.findMany({ where: { id: { in: localityIds } }, select: { id: true, lat: true, lng: true } }),
  ])
  return {
    km:     new Map(matrix.map(m => [`${m.originId}:${m.destinationId}`, m.distanceKm])),
    coords: new Map(localities.filter(l => l.lat != null && l.lng != null).map(l => [l.id, { lat: l.lat!, lng: l.lng! }])),
  }
}
