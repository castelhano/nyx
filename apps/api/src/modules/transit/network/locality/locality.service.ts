import { Injectable } from '@nestjs/common'
import { localitySchema, Locality, CreateLocalityDto, UpdateLocalityDto, SnapInfo, localityQuadrant } from '@nyx/schemas'
import { PrismaService } from '../../../../prisma/prisma.service'
import { BaseService } from '../../../../core/base.service'
import { stringContains } from '../../../../core/db.utils'
import { OsrmService } from '../travel-time/osrm.service'

@Injectable()
export class LocalityService extends BaseService<Locality, CreateLocalityDto, UpdateLocalityDto> {
  constructor(
    prisma: PrismaService,
    private readonly osrm: OsrmService,
  ) {
    super(prisma, 'transitLocality', localitySchema, 'transit')
  }

  protected buildSearchWhere(search: string) {
    return {
      OR: [
        { name: stringContains(search) },
        { code: stringContains(search) },
      ],
    }
  }

  override async create(dto: CreateLocalityDto): Promise<Locality> {
    const result = await super.create(dto)
    this.osrm.generateMatrix().catch(() => {})
    return result
  }

  override async update(id: string, dto: UpdateLocalityDto): Promise<Locality> {
    const result = await super.update(id, dto)
    this.osrm.generateMatrix().catch(() => {})
    return result
  }

  // Prefix = macro-region letter + quadrant row/col (or letter + "0000" for points
  // outside the core box). The sequence within a quadrant needs a DB round-trip (count
  // of codes already using this prefix), so it can't be computed on the frontend alone.
  async suggestCode(lat: number, lng: number): Promise<string> {
    const { prefix } = localityQuadrant(lat, lng)
    const existing = await this.prisma.transitLocality.count({
      where: { code: { startsWith: `${prefix}-` } },
    })
    return `${prefix}-${String(existing + 1).padStart(3, '0')}`
  }

  async findRoutesForLocality(localityId: string) {
    return this.prisma.routeLocality.findMany({
      where:   { localityId },
      select: {
        sequence: true,
        route: {
          select: {
            id:        true,
            name:      true,
            direction: true,
            line: { select: { id: true, code: true, name: true } },
          },
        },
      },
      orderBy: { route: { line: { code: 'asc' } } },
    })
  }

  async applySnap(opts: { ids?: string[]; minDistanceM?: number }): Promise<{ updated: number; skipped: number }> {
    const where = opts.ids?.length ? { id: { in: opts.ids } } : {}

    const localities = await this.prisma.transitLocality.findMany({ where })

    const toUpdate = localities.filter((l) => {
      const snap = l.snapInfo as SnapInfo | null
      if (!snap) return false
      if (opts.minDistanceM != null && snap.distanceM < opts.minDistanceM) return false
      return true
    })

    await Promise.all(
      toUpdate.map((l) => {
        const snap = l.snapInfo as SnapInfo
        return this.prisma.transitLocality.update({
          where: { id: l.id },
          data:  { lat: snap.lat, lng: snap.lng, snapInfo: { ...snap, distanceM: 0 } },
        })
      }),
    )

    return { updated: toUpdate.length, skipped: localities.length - toUpdate.length }
  }
}
