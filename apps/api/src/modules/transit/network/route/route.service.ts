import { Injectable, NotFoundException } from '@nestjs/common'
import { Prisma } from '@prisma/client'
import { routeSchema, Route, CreateRouteDto, UpdateRouteDto } from '@nyx/schemas'
import { PrismaService } from '../../../../prisma/prisma.service'
import { BaseService } from '../../../../core/base.service'
import { stringContains } from '../../../../core/db.utils'
import { OsrmService } from '../travel-time/osrm.service'

export interface RouteLocalityWithLocality {
  id: string
  routeId: string
  localityId: string | null
  lat: number | null
  lng: number | null
  sequence: number
  deltaMinutes: number | null
  deltaKm: number | null
  deltaSource: string
  geometry: unknown
  allowsCrewChange: boolean
  createdAt: Date
  updatedAt: Date
  locality: { id: string; name: string; code: string; lat: number | null; lng: number | null } | null
}

export interface SuggestedLocality {
  id: string
  name: string
  code: string
  lat: number
  lng: number
  distanceM: number
  insertAfterSequence: number
}

@Injectable()
export class RouteService extends BaseService<Route, CreateRouteDto, UpdateRouteDto> {
  constructor(
    prisma: PrismaService,
    private readonly osrm: OsrmService,
  ) {
    super(prisma, 'transitRoute', routeSchema, 'transit')
  }

  protected buildSearchWhere(search: string) {
    return { name: stringContains(search) }
  }

  // at most one primary route per (lineId, direction) — used to pick which
  // trajectory represents the line's official extension for that direction
  override async create(dto: CreateRouteDto): Promise<Route> {
    if (!dto.isPrimary) return super.create(dto)
    return this.prisma.$transaction(async (tx) => {
      await tx.transitRoute.updateMany({
        where: { lineId: dto.lineId, direction: dto.direction, isPrimary: true },
        data:  { isPrimary: false },
      })
      return tx.transitRoute.create({ data: this.sanitizeDto(dto as Record<string, unknown>) as Prisma.TransitRouteUncheckedCreateInput }) as unknown as Route
    })
  }

  override async update(id: string, dto: UpdateRouteDto): Promise<Route> {
    if (!dto.isPrimary) return super.update(id, dto)
    const current = await this.findOne(id)
    return this.prisma.$transaction(async (tx) => {
      await tx.transitRoute.updateMany({
        where: { lineId: current.lineId, direction: dto.direction ?? current.direction, isPrimary: true, id: { not: id } },
        data:  { isPrimary: false },
      })
      return tx.transitRoute.update({ where: { id }, data: this.sanitizeDto(dto as Record<string, unknown>) as Prisma.TransitRouteUncheckedUpdateInput }) as unknown as Route
    })
  }

  async getTrajectory(routeId: string): Promise<RouteLocalityWithLocality[]> {
    const route = await this.prisma.transitRoute.findUnique({ where: { id: routeId } })
    if (!route) throw new NotFoundException('TransitRoute not found')
    return this.prisma.routeLocality.findMany({
      where:   { routeId },
      orderBy: { sequence: 'asc' },
      include: { locality: { select: { id: true, name: true, code: true, abbr: true, lat: true, lng: true } } },
    }) as Promise<RouteLocalityWithLocality[]>
  }

  private coordsFromLocalities(localities: RouteLocalityWithLocality[]): { lat: number; lng: number }[] {
    return localities.map((rl) => {
      const lat = rl.localityId ? rl.locality?.lat : rl.lat
      const lng = rl.localityId ? rl.locality?.lng : rl.lng
      if (lat == null || lng == null) throw new Error(`RouteLocality ${rl.id} has no coordinates`)
      return { lat, lng }
    })
  }

  // forceAll overwrites MANUAL overrides too (and resets them to OSRM) — used when a
  // point is deleted, since the legs around it no longer represent the same trip
  async reprocess(routeId: string, opts: { forceAll?: boolean } = {}): Promise<void> {
    const localities = await this.getTrajectory(routeId)
    if (localities.length < 2) return

    const coords = this.coordsFromLocalities(localities)
    const result = await this.osrm.getRoute(coords)

    await this.prisma.$transaction(
      localities.map((rl, i) => {
        if (i === 0) {
          return this.prisma.routeLocality.update({
            where: { id: rl.id },
            data:  { geometry: Prisma.JsonNull },
          })
        }
        const leg = result.legs[i - 1]
        const updates: Record<string, unknown> = { geometry: leg.geometry as unknown }
        if (opts.forceAll || rl.deltaSource !== 'MANUAL') {
          updates.deltaMinutes = Math.ceil(leg.duration / 60)
          updates.deltaKm      = Math.round(leg.distance / 10) / 100
          if (opts.forceAll) updates.deltaSource = 'OSRM'
        }
        return this.prisma.routeLocality.update({ where: { id: rl.id }, data: updates })
      }),
    )
  }

  async reprocessLegs(routeId: string, affectedSequences: number[]): Promise<void> {
    const allLocalities = await this.getTrajectory(routeId)
    if (allLocalities.length < 2) return

    const seqSet = new Set(affectedSequences)
    // include predecessor sequence for each affected to compute the leg
    const targetSeqs = new Set<number>()
    for (const s of seqSet) {
      targetSeqs.add(s)
      if (s > 1) targetSeqs.add(s - 1)
    }

    const idxs = allLocalities
      .map((rl, i) => ({ rl, i }))
      .filter(({ rl }) => targetSeqs.has(rl.sequence))
      .map(({ i }) => i)

    if (idxs.length === 0) return

    // collect distinct consecutive pairs that need recomputation
    const pairs: Array<[number, number]> = []
    for (const idx of idxs) {
      if (idx === 0) continue
      const prev = allLocalities[idx - 1]
      const curr = allLocalities[idx]
      if (seqSet.has(curr.sequence) || seqSet.has(prev.sequence)) {
        pairs.push([idx - 1, idx])
      }
    }

    // deduplicate pairs
    const uniquePairs = [...new Map(pairs.map((p) => [`${p[0]}-${p[1]}`, p])).values()]

    await Promise.all(
      uniquePairs.map(async ([fromIdx, toIdx]) => {
        const fromRl = allLocalities[fromIdx]
        const toRl   = allLocalities[toIdx]
        const fromCoords = this.coordsFromLocalities([fromRl])[0]
        const toCoords   = this.coordsFromLocalities([toRl])[0]
        const result = await this.osrm.getRoute([fromCoords, toCoords])
        const leg    = result.legs[0]
        const updates: Record<string, unknown> = { geometry: leg.geometry as unknown }
        if (toRl.deltaSource !== 'MANUAL') {
          updates.deltaMinutes = Math.ceil(leg.duration / 60)
          updates.deltaKm      = Math.round(leg.distance / 10) / 100
        }
        await this.prisma.routeLocality.update({ where: { id: toRl.id }, data: updates })
      }),
    )
  }

  async suggestLocalities(routeId: string): Promise<SuggestedLocality[]> {
    const localities = await this.getTrajectory(routeId)
    const hasGeometry = localities.some((rl) => rl.geometry != null)
    if (!hasGeometry) throw new Error('Gere a trajetória antes de sugerir pontos')

    // reconstruct full route geometry from stored legs
    const coords: [number, number][] = []
    for (const rl of localities) {
      if (!rl.geometry) continue
      const geom = rl.geometry as { coordinates: [number, number][] }
      if (coords.length === 0) coords.push(...geom.coordinates)
      else coords.push(...geom.coordinates.slice(1))
    }
    if (coords.length < 2) throw new Error('Trajetória insuficiente para sugestões')

    const existingLocalityIds = new Set(localities.map((rl) => rl.localityId).filter(Boolean))

    // bounding box prefilter
    const lngs = coords.map((c) => c[0])
    const lats  = coords.map((c) => c[1])
    const MARGIN = 0.001  // ~100m in degrees
    const minLat = Math.min(...lats) - MARGIN
    const maxLat = Math.max(...lats) + MARGIN
    const minLng = Math.min(...lngs) - MARGIN
    const maxLng = Math.max(...lngs) + MARGIN

    const candidates = await this.prisma.transitLocality.findMany({
      where: {
        id:  { notIn: [...existingLocalityIds] as string[] },
        lat: { gte: minLat, lte: maxLat },
        lng: { gte: minLng, lte: maxLng },
      },
      select: { id: true, name: true, code: true, lat: true, lng: true },
    })

    const threshold = Number(process.env.OSRM_SUGGEST_THRESHOLD_M ?? 50)

    // Turf — dynamically imported to keep the module tree clean
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    const turf = require('@turf/turf') as typeof import('@turf/turf')
    const lineGeom = turf.lineString(coords)

    const results: SuggestedLocality[] = []

    for (const candidate of candidates) {
      if (candidate.lat == null || candidate.lng == null) continue
      const point    = turf.point([candidate.lng, candidate.lat])
      const nearest  = turf.nearestPointOnLine(lineGeom, point, { units: 'meters' })
      const distM    = nearest.properties.dist ?? Infinity
      if (distM > threshold) continue

      const location = nearest.properties.location ?? 0

      // find which segment this falls after
      let cumulative = 0
      let insertAfterSequence = localities[0].sequence
      for (let i = 1; i < localities.length; i++) {
        const leg = localities[i].geometry as { coordinates: [number, number][] } | null
        if (!leg) continue
        const segLen = turf.length(turf.lineString(leg.coordinates), { units: 'meters' })
        if (cumulative + segLen >= location) {
          insertAfterSequence = localities[i - 1].sequence
          break
        }
        cumulative += segLen
        insertAfterSequence = localities[i].sequence
      }

      results.push({
        id:                    candidate.id,
        name:                  candidate.name,
        code:                  candidate.code,
        lat:                   candidate.lat,
        lng:                   candidate.lng,
        distanceM:             Math.round(distM),
        insertAfterSequence,
      })
    }

    return results.sort((a, b) => a.insertAfterSequence - b.insertAfterSequence || a.distanceM - b.distanceM)
  }

  async buildInitialTrajectory(routeId: string, originId: string, destinationId: string): Promise<void> {
    const [origin, destination] = await Promise.all([
      this.prisma.transitLocality.findUnique({ where: { id: originId }, select: { id: true, lat: true, lng: true } }),
      this.prisma.transitLocality.findUnique({ where: { id: destinationId }, select: { id: true, lat: true, lng: true } }),
    ])
    if (!origin || !destination) return
    if (origin.lat == null || origin.lng == null || destination.lat == null || destination.lng == null) return

    const now = new Date()
    await this.prisma.routeLocality.createMany({
      data: [
        { routeId, localityId: originId,      sequence: 1, allowsCrewChange: false, createdAt: now, updatedAt: now },
        { routeId, localityId: destinationId, sequence: 2, allowsCrewChange: false, createdAt: now, updatedAt: now },
      ],
    })

    try {
      await this.reprocess(routeId)
    } catch {
      // OSRM offline — trajectory generated lazily later
    }
  }
}
