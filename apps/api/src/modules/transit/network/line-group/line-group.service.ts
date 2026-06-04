import { Injectable } from '@nestjs/common'
import { lineGroupSchema, LineGroup, CreateLineGroupDto, UpdateLineGroupDto } from '@nyx/schemas'
import { PrismaService } from '../../../../prisma/prisma.service'
import { BaseService } from '../../../../core/base.service'
import { stringContains } from '../../../../core/db.utils'
import type { PaginatedResult, PaginationQuery } from '@nyx/types'

@Injectable()
export class LineGroupService extends BaseService<LineGroup, CreateLineGroupDto, UpdateLineGroupDto> {
  constructor(prisma: PrismaService) {
    super(prisma, 'lineGroup', lineGroupSchema, 'transit')
  }

  protected buildSearchWhere(search: string) {
    return { name: stringContains(search) }
  }

  private async fetchLineIds(groupIds: string[]): Promise<Map<string, string[]>> {
    if (groupIds.length === 0) return new Map()
    const links = await this.prisma.lineGroupLine.findMany({ where: { lineGroupId: { in: groupIds } } })
    const map = new Map<string, string[]>()
    for (const link of links) {
      if (!map.has(link.lineGroupId)) map.set(link.lineGroupId, [])
      map.get(link.lineGroupId)!.push(link.lineId)
    }
    return map
  }

  override async findAll(query: PaginationQuery): Promise<PaginatedResult<LineGroup>> {
    const result = await super.findAll(query)
    const map = await this.fetchLineIds((result.data as any[]).map((g: any) => g.id))
    return {
      ...result,
      data: (result.data as any[]).map(g => ({ ...g, lineIds: map.get(g.id) ?? [] })),
    }
  }

  override async findOne(id: string): Promise<LineGroup> {
    const group = await super.findOne(id) as any
    const map = await this.fetchLineIds([id])
    return { ...group, lineIds: map.get(id) ?? [] } as any
  }

  override async create(dto: CreateLineGroupDto): Promise<LineGroup> {
    const d = dto as any
    const lineIds: string[] = Array.isArray(d.lineIds) ? d.lineIds : []
    const record = await this.prisma.lineGroup.create({
      data: {
        name:     d.name,
        branchId: d.branchId ?? null,
        notes:    d.notes    ?? null,
        lines:    { create: lineIds.map(lineId => ({ lineId })) },
      },
    })
    return { ...record, lineIds } as any
  }

  override async update(id: string, dto: UpdateLineGroupDto): Promise<LineGroup> {
    await this.findOne(id)
    const d = dto as any
    const data: Record<string, any> = {}
    if (d.name     !== undefined) data.name     = d.name
    if (d.branchId !== undefined) data.branchId = d.branchId ?? null
    if (d.notes    !== undefined) data.notes    = d.notes    ?? null
    if (Array.isArray(d.lineIds)) {
      data.lines = {
        deleteMany: {},
        create: (d.lineIds as string[]).map(lineId => ({ lineId })),
      }
    }
    await this.prisma.lineGroup.update({ where: { id }, data })
    return this.findOne(id)
  }
}
