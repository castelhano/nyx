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
   * Entries with source = MANUAL are never overwritten.
   */
  async generateMatrix(): Promise<{ generated: number; skipped: number }> {
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

    const depots = await this.prisma.transitLocality.findMany({
      where:  { isDepot: true },
      select: { id: true },
    })
    for (const d of depots) relevantIds.add(d.id)

    const allLocalities = await this.prisma.transitLocality.findMany({
      where:  { id: { in: [...relevantIds] } },
      select: { id: true, lat: true, lng: true },
    })

    // only localities with both coordinates can be sent to OSRM
    const localities = allLocalities.filter((l) => l.lat != null && l.lng != null)
    const skipped    = allLocalities.length - localities.length

    if (localities.length < 2) {
      this.logger.warn(`OSRM matrix skipped: not enough localities with coordinates (${localities.length}/${allLocalities.length})`)
      return { generated: 0, skipped }
    }

    // OSRM expects longitude,latitude
    const coords   = localities.map((l) => `${l.lng},${l.lat}`).join(';')
    const radiuses = localities.map(() => 'unlimited').join(';')
    const url      = `${this.osrmUrl}/table/v1/driving/${coords}?annotations=duration,distance&radiuses=${radiuses}`

    this.logger.debug(`OSRM request: ${localities.length} localities, URL length=${url.length}`)
    this.logger.debug(`OSRM URL: ${url}`)

    type OsrmWaypoint = { location: [number, number]; distance: number; name: string }
    type OsrmResponse = {
      durations:    (number | null)[][]
      distances:    (number | null)[][]
      sources:      OsrmWaypoint[]
      destinations: OsrmWaypoint[]
    }

    let data: OsrmResponse
    try {
      const res = await fetch(url)
      if (!res.ok) throw new Error(`OSRM returned ${res.status}`)
      data = await res.json() as OsrmResponse
    } catch (err) {
      this.logger.warn(`OSRM matrix failed: ${(err as Error).message}`)
      throw err
    }

    // Persist snapInfo for each locality based on OSRM sources
    const checkedAt = new Date().toISOString()
    const snapUpdates = localities.map((locality, i) => {
      const waypoint = data.sources[i]
      if (!waypoint) return null
      return this.prisma.transitLocality.update({
        where: { id: locality.id },
        data: {
          snapInfo: {
            lat:       waypoint.location[1],
            lng:       waypoint.location[0],
            distanceM: waypoint.distance,
            roadName:  waypoint.name || undefined,
            checkedAt,
          },
        },
      })
    }).filter(Boolean)

    await Promise.all(snapUpdates)

    const snappedCount = localities.filter((_, i) => (data.sources[i]?.distance ?? 0) > 0).length
    if (snappedCount > 0) {
      this.logger.warn(`OSRM snapping: ${snappedCount} localities adjusted to nearest road`)
    }

    const manualEntries = await this.prisma.travelTimeMatrix.findMany({
      where:  { source: 'MANUAL' },
      select: { originId: true, destinationId: true },
    })
    const manualSet = new Set(manualEntries.map((r) => `${r.originId}:${r.destinationId}`))

    const localityIds = localities.map((l) => l.id)

    // Build all new entries — skip manual pairs and OSRM null responses
    type MatrixRow = { originId: string; destinationId: string; baseMinutes: number; distanceKm: number; source: 'OSRM' }
    const insertData: MatrixRow[] = []
    let nullPairs = 0

    for (let i = 0; i < localities.length; i++) {
      for (let j = 0; j < localities.length; j++) {
        if (i === j) continue
        const origin      = localities[i]
        const destination = localities[j]
        if (manualSet.has(`${origin.id}:${destination.id}`)) continue

        const rawDuration = data.durations[i]?.[j] ?? null
        const rawDistance = data.distances[i]?.[j] ?? null

        if (rawDuration == null || rawDistance == null) {
          nullPairs++
          this.logger.debug(`OSRM null pair: ${origin.id} → ${destination.id}`)
          continue
        }

        insertData.push({
          originId:      origin.id,
          destinationId: destination.id,
          baseMinutes:   Math.ceil(rawDuration / 60),
          distanceKm:    Math.round(rawDistance / 10) / 100,
          source:        'OSRM',
        })
      }
    }

    // Atomic replace: delete stale OSRM entries, then bulk-insert the fresh ones
    await this.prisma.$transaction([
      this.prisma.travelTimeMatrix.deleteMany({
        where: {
          source:        'OSRM',
          originId:      { in: localityIds },
          destinationId: { in: localityIds },
        },
      }),
      this.prisma.travelTimeMatrix.createMany({ data: insertData }),
    ])

    this.logger.log(
      `OSRM matrix updated: localities=${localities.length} skipped=${skipped} generated=${insertData.length} nullPairs=${nullPairs}`,
    )
    return { generated: insertData.length, skipped }
  }
}
