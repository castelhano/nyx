import { Injectable } from '@nestjs/common'
import { lineSchema, Line, CreateLineDto, UpdateLineDto } from '@nyx/schemas'
import { PrismaService } from '../../../../prisma/prisma.service'
import { BaseService } from '../../../../core/base.service'
import { stringContains } from '../../../../core/db.utils'
import type { PaginatedResult, PaginationQuery } from '@nyx/types'

export interface ExtensionDivergence {
  lineId:      string
  lineCode:    string
  lineName:    string
  direction:   string
  storedKm:    number
  computedKm:  number
  diffKm:      number
  diffPercent: number
}

// Pure-numeric codes sort as numbers; mixed/alpha codes sort after, then localeCompare.
// e.g. 31 < 105 < 301 < 800 < A02 < A22B < C01 < R03
function sortByCode(a: string, b: string): number {
  const na = Number(a), nb = Number(b)
  const aNum = !isNaN(na) && String(na) === a
  const bNum = !isNaN(nb) && String(nb) === b
  if (aNum && bNum) return na - nb
  if (aNum) return -1
  if (bNum) return 1
  return a.localeCompare(b)
}

@Injectable()
export class LineService extends BaseService<Line, CreateLineDto, UpdateLineDto> {
  constructor(prisma: PrismaService) {
    super(prisma, 'transitLine', lineSchema, 'transit')
  }

  override async update(id: string, dto: UpdateLineDto): Promise<Line> {
    if (dto.metrics === undefined) return super.update(id, dto)

    const current = await this.findOne(id)
    const merged  = { ...(current.metrics as object ?? {}), ...dto.metrics }
    return this.model.update({
      where: { id },
      data:  this.sanitizeDto({ ...dto, metrics: merged } as Record<string, unknown>),
    }) as Promise<Line>
  }

  protected buildSearchWhere(search: string) {
    return {
      OR: [
        { name: stringContains(search) },
        { code: stringContains(search) },
      ],
    }
  }

  override async findAll(query: PaginationQuery): Promise<PaginatedResult<Line>> {
    if (query.sortField) return super.findAll(query)
    const all  = await super.findAll({ ...query, page: 1, pageSize: 10_000 })
    const sorted = [...all.data].sort((a, b) => sortByCode((a as any).code, (b as any).code))
    const page = query.page ?? 1
    const size = query.pageSize ?? 20
    return { data: sorted.slice((page - 1) * size, page * size), total: all.total, page, pageSize: size }
  }

  async reviewExtensions(): Promise<ExtensionDivergence[]> {
    const lines = await this.prisma.transitLine.findMany({
      where:  { isActive: true },
      select: {
        id:      true,
        code:    true,
        name:    true,
        metrics: true,
        routes: {
          where:  { isActive: true },
          select: {
            direction:            true,
            originLocalityId:     true,
            destinationLocalityId: true,
          },
        },
      },
    })

    // Collect all origin→destination pairs needed from TravelTimeMatrix
    const pairsNeeded = new Set<string>()
    for (const line of lines) {
      for (const route of line.routes) {
        pairsNeeded.add(`${route.originLocalityId}:${route.destinationLocalityId}`)
      }
    }

    const matrixMap = new Map<string, number>()
    if (pairsNeeded.size > 0) {
      const originIds = [...new Set([...pairsNeeded].map((p) => p.split(':')[0]))]
      const destIds   = [...new Set([...pairsNeeded].map((p) => p.split(':')[1]))]
      const entries   = await this.prisma.travelTimeMatrix.findMany({
        where:  { originId: { in: originIds }, destinationId: { in: destIds } },
        select: { originId: true, destinationId: true, distanceKm: true },
      })
      for (const e of entries) {
        matrixMap.set(`${e.originId}:${e.destinationId}`, e.distanceKm)
      }
    }

    const result: ExtensionDivergence[] = []

    for (const line of lines) {
      if (line.routes.length === 0) continue

      const metrics = line.metrics as { extensionKm?: Record<string, number> } | null

      for (const route of line.routes) {
        const storedKm = metrics?.extensionKm?.[route.direction]
        if (storedKm == null) continue

        const computedKm = matrixMap.get(`${route.originLocalityId}:${route.destinationLocalityId}`)
        if (computedKm == null) continue

        const diffKm = Math.abs(computedKm - storedKm)
        if (diffKm < 0.001) continue

        result.push({
          lineId:      line.id,
          lineCode:    line.code,
          lineName:    line.name,
          direction:   route.direction,
          storedKm:    Math.round(storedKm * 100) / 100,
          computedKm:  Math.round(computedKm * 100) / 100,
          diffKm:      Math.round(diffKm * 100) / 100,
          diffPercent: Math.round((diffKm / storedKm) * 10000) / 100,
        })
      }
    }

    return result.sort((a, b) => b.diffPercent - a.diffPercent)
  }

  async applyDemand(
    dayTypeCode: string,
    updates: Array<{ lineId: string; demand: Record<string, Record<string, number>> }>,
  ): Promise<{ updated: number }> {
    const ids   = updates.map((u) => u.lineId)
    const lines = await this.prisma.transitLine.findMany({
      where:  { id: { in: ids } },
      select: { id: true, code: true, metrics: true },
    })

    const lineMap = new Map(lines.map((l) => [l.id, l]))

    let updated = 0
    await Promise.all(
      updates.map(async (u) => {
        const line = lineMap.get(u.lineId)
        if (!line) return
        const metrics = (line.metrics as Record<string, unknown> ?? {})
        const demand  = { ...(metrics.demand as Record<string, unknown> ?? {}) }
        demand[dayTypeCode] = u.demand
        const newMetrics = { ...metrics, demand }
        await this.prisma.transitLine.update({
          where: { id: line.id },
          data:  { metrics: newMetrics },
        })
        updated++
      }),
    )

    return { updated }
  }

  async applyExtensions(
    updates: Array<{ lineId: string; direction: string; computedKm: number }>,
  ): Promise<{ updated: number }> {
    const byLine = new Map<string, Array<{ direction: string; computedKm: number }>>()
    for (const u of updates) {
      if (!byLine.has(u.lineId)) byLine.set(u.lineId, [])
      byLine.get(u.lineId)!.push(u)
    }

    await Promise.all(
      [...byLine.entries()].map(async ([lineId, lineUpdates]) => {
        const current = await this.prisma.transitLine.findUnique({
          where:  { id: lineId },
          select: { metrics: true },
        })
        const metrics     = (current?.metrics as Record<string, unknown> ?? {})
        const extensionKm = { ...(metrics.extensionKm as Record<string, number> ?? {}) }
        for (const u of lineUpdates) {
          extensionKm[u.direction] = Math.round(u.computedKm * 100) / 100
        }
        await this.prisma.transitLine.update({
          where: { id: lineId },
          data:  { metrics: { ...metrics, extensionKm } },
        })
      }),
    )

    return { updated: updates.length }
  }
}
