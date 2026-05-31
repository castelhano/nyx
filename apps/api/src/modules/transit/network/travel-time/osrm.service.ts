import { Injectable, Logger } from '@nestjs/common'
import { PrismaService } from '../../../../prisma/prisma.service'

@Injectable()
export class OsrmService {
  private readonly logger = new Logger(OsrmService.name)
  private readonly osrmUrl = process.env.OSRM_URL ?? 'http://localhost:5000'

  constructor(private readonly prisma: PrismaService) {}

  /**
   * Regenerates travel-time entries for the subset of localities that are
   * actually needed by the system:
   *
   *   • depots            — dead-run origin/destination
   *   • route endpoints   — TransitRoute.originLocalityId / destinationLocalityId
   *   • route waypoints   — RouteLocality points (deltaMinutes fallback)
   *
   * Fase 2 addition: RouteLocality where allowsCrewChange = true will also
   * be relevant for crew scheduling, but they are already covered by the
   * waypoints set above.
   *
   * Entries with source = MANUAL are never overwritten.
   */
  async generateMatrix(): Promise<void> {
    const [routes, routeLocalityIds] = await Promise.all([
      this.prisma.transitRoute.findMany({
        select: { originLocalityId: true, destinationLocalityId: true },
      }),
      this.prisma.routeLocality.findMany({
        select: { localityId: true },
      }),
    ])

    const relevantIds = new Set<string>()
    for (const r of routes) {
      relevantIds.add(r.originLocalityId)
      relevantIds.add(r.destinationLocalityId)
    }
    for (const rl of routeLocalityIds) {
      relevantIds.add(rl.localityId)
    }

    // depots are fetched last so we can reuse the id list
    const depots = await this.prisma.transitLocality.findMany({
      where:  { isDepot: true },
      select: { id: true },
    })
    for (const d of depots) relevantIds.add(d.id)

    if (relevantIds.size < 2) return

    const localities = await this.prisma.transitLocality.findMany({
      where:  { id: { in: [...relevantIds] } },
      select: { id: true, lat: true, lng: true },
    })

    const coords = localities.map((l) => `${l.lng},${l.lat}`).join(';')
    const url    = `${this.osrmUrl}/table/v1/driving/${coords}?annotations=duration,distance`

    let data: { durations: number[][], distances: number[][] }
    try {
      const res = await fetch(url)
      if (!res.ok) throw new Error(`OSRM returned ${res.status}`)
      data = await res.json() as { durations: number[][], distances: number[][] }
    } catch (err) {
      this.logger.warn(`OSRM matrix failed: ${(err as Error).message}`)
      return
    }

    const manualEntries = await this.prisma.travelTimeMatrix.findMany({
      where:  { source: 'MANUAL' },
      select: { originId: true, destinationId: true },
    })
    const manualSet = new Set(manualEntries.map((r) => `${r.originId}:${r.destinationId}`))

    const upserts: Promise<unknown>[] = []

    for (let i = 0; i < localities.length; i++) {
      for (let j = 0; j < localities.length; j++) {
        if (i === j) continue
        const origin      = localities[i]
        const destination = localities[j]
        if (manualSet.has(`${origin.id}:${destination.id}`)) continue

        const baseMinutes = data.durations[i][j] / 60
        const distanceKm  = data.distances[i][j] / 1000

        upserts.push(
          this.prisma.travelTimeMatrix.upsert({
            where:  { originId_destinationId: { originId: origin.id, destinationId: destination.id } },
            update: { baseMinutes, distanceKm, source: 'OSRM' },
            create: { originId: origin.id, destinationId: destination.id, baseMinutes, distanceKm, source: 'OSRM' },
          }),
        )
      }
    }

    await Promise.all(upserts)
    this.logger.log(`OSRM matrix updated: relevant=${localities.length} pairs=${upserts.length}`)
  }
}
