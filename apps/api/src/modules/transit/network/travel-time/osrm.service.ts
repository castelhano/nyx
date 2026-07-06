import { Injectable, Logger } from '@nestjs/common'
import { PrismaService } from '../../../../prisma/prisma.service'

export type GeoJSONLineString = { type: 'LineString'; coordinates: [number, number][] }

export interface OsrmRouteLeg {
  duration: number        // seconds
  distance: number        // metres
  geometry: GeoJSONLineString
}

export interface OsrmRouteResult {
  fullGeometry: GeoJSONLineString
  legs: OsrmRouteLeg[]
}

export interface OsrmNearestResult {
  location: [number, number]  // [lng, lat]
  distance: number
  name: string
}

@Injectable()
export class OsrmService {
  private readonly logger = new Logger(OsrmService.name)
  private readonly osrmUrl = process.env.OSRM_URL ?? 'http://localhost:5000'

  constructor(private readonly prisma: PrismaService) {}

  async getRoute(coords: { lat: number; lng: number }[]): Promise<OsrmRouteResult> {
    if (coords.length < 2) throw new Error('At least 2 coordinates required for route')
    const coordStr = coords.map((c) => `${c.lng},${c.lat}`).join(';')
    const url = `${this.osrmUrl}/route/v1/driving/${coordStr}?geometries=geojson&overview=full&steps=true`

    this.logger.debug(`OSRM /route request: ${url}`)

    type OsrmWaypoint = { location: [number, number]; distance: number; name: string }
    type OsrmStep = { geometry: GeoJSONLineString }
    type OsrmLeg  = { duration: number; distance: number; steps: OsrmStep[] }
    type OsrmResp = { routes: Array<{ geometry: GeoJSONLineString; legs: OsrmLeg[]; distance: number; duration: number }>; waypoints?: OsrmWaypoint[] }

    let data: OsrmResp
    try {
      const res = await fetch(url)
      if (!res.ok) throw new Error(`OSRM /route returned ${res.status}`)
      data = await res.json() as OsrmResp
    } catch (err) {
      const msg = (err as Error).message ?? ''
      const isConn = msg === 'fetch failed' || msg.includes('ECONNREFUSED') || msg.includes('ENOTFOUND')
      throw new Error(isConn ? `Servidor OSRM não responde (${this.osrmUrl})` : msg)
    }

    const route = data.routes[0]
    if (!route) throw new Error('OSRM returned no routes')

    this.logger.debug(`OSRM /route response: total distance=${route.distance}m duration=${route.duration}s legs=${route.legs.length}`)
    data.waypoints?.forEach((wp, i) => {
      this.logger.debug(
        `  waypoint[${i}] requested=(${coords[i].lng},${coords[i].lat}) `
        + `snapped=(${wp.location[0]},${wp.location[1]}) snapDistance=${wp.distance}m name="${wp.name}"`,
      )
    })

    const legs: OsrmRouteLeg[] = route.legs.map((leg) => {
      const coords: [number, number][] = []
      for (let j = 0; j < leg.steps.length; j++) {
        const stepCoords = leg.steps[j].geometry.coordinates
        if (j === 0) coords.push(...stepCoords)
        else coords.push(...stepCoords.slice(1))
      }
      return { duration: leg.duration, distance: leg.distance, geometry: { type: 'LineString', coordinates: coords } }
    })

    return { fullGeometry: route.geometry, legs }
  }

  async getNearestPoint(lat: number, lng: number): Promise<OsrmNearestResult> {
    const url = `${this.osrmUrl}/nearest/v1/driving/${lng},${lat}`
    type OsrmResp = { waypoints: Array<{ location: [number, number]; distance: number; name: string }> }
    const res  = await fetch(url)
    if (!res.ok) throw new Error(`OSRM /nearest returned ${res.status}`)
    const data = await res.json() as OsrmResp
    const wp   = data.waypoints[0]
    if (!wp) throw new Error('OSRM returned no nearest waypoint')
    return { location: wp.location, distance: wp.distance, name: wp.name }
  }

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
  async generateMatrix(opts: { source?: 'OSRM' | 'MANUAL' } = {}): Promise<{ generated: number; skipped: number }> {
    const entrySource = opts.source ?? 'OSRM'
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
      if (rl.localityId) relevantIds.add(rl.localityId)
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
      const msg = (err as Error).message ?? ''
      this.logger.warn(`OSRM matrix failed: ${msg}`)
      const isConnErr = msg === 'fetch failed' || msg.includes('ECONNREFUSED') || msg.includes('ENOTFOUND')
      throw new Error(isConnErr ? `Servidor OSRM não responde (${this.osrmUrl})` : msg)
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

    const localityIds = localities.map((l) => l.id)

    // When generating as OSRM, preserve existing MANUAL entries
    const manualSet = new Set<string>()
    if (entrySource === 'OSRM') {
      const manualEntries = await this.prisma.travelTimeMatrix.findMany({
        where:  { source: 'MANUAL', originId: { in: localityIds }, destinationId: { in: localityIds } },
        select: { originId: true, destinationId: true },
      })
      for (const r of manualEntries) manualSet.add(`${r.originId}:${r.destinationId}`)
    }

    // Build all new entries — skip manual pairs (OSRM mode only) and OSRM null responses
    type MatrixRow = { originId: string; destinationId: string; baseMinutes: number; distanceKm: number; source: 'OSRM' | 'MANUAL' }
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
          source:        entrySource,
        })
      }
    }

    // Atomic replace: delete stale entries, then bulk-insert the fresh ones
    // MANUAL mode deletes everything (OSRM + MANUAL) to fully overwrite
    // OSRM mode deletes only OSRM entries to preserve MANUAL overrides
    await this.prisma.$transaction([
      this.prisma.travelTimeMatrix.deleteMany({
        where: {
          ...(entrySource === 'OSRM' ? { source: 'OSRM' } : {}),
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
