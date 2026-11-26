import { BadRequestException, Injectable } from '@nestjs/common'
import { calendarExceptionSchema, CalendarException, CreateCalendarExceptionDto, UpdateCalendarExceptionDto } from '@nyx/schemas'
import type { AuthUser, PaginatedResult, PaginationQuery } from '@nyx/types'
import { PrismaService } from '../../../../prisma/prisma.service'
import { BaseService } from '../../../../core/base.service'

@Injectable()
export class CalendarExceptionService extends BaseService<CalendarException, CreateCalendarExceptionDto, UpdateCalendarExceptionDto> {
  constructor(prisma: PrismaService) {
    super(prisma, 'lineCalendarException', calendarExceptionSchema, 'transit')
  }

  private async fetchLineIds(exceptionIds: string[]): Promise<Map<string, string[]>> {
    if (exceptionIds.length === 0) return new Map()
    const links = await this.prisma.lineCalendarExceptionLine.findMany({ where: { exceptionId: { in: exceptionIds } } })
    const map = new Map<string, string[]>()
    for (const link of links) {
      if (!map.has(link.exceptionId)) map.set(link.exceptionId, [])
      map.get(link.exceptionId)!.push(link.lineId)
    }
    return map
  }

  // an exception targets a whole scope or a list of lines — never both, never neither
  private assertTarget(scopeId: string | null, lineIds: string[]): void {
    if (scopeId && lineIds.length > 0) throw new BadRequestException('Preencha o escopo ou as linhas, não os dois')
    if (!scopeId && lineIds.length === 0) throw new BadRequestException('Preencha o escopo ou as linhas')
  }

  override async findAll(query: PaginationQuery, user?: AuthUser): Promise<PaginatedResult<CalendarException>> {
    const result = await super.findAll(query, user)
    const map = await this.fetchLineIds((result.data as any[]).map(e => e.id))
    return {
      ...result,
      data: (result.data as any[]).map(e => ({ ...e, lineIds: map.get(e.id) ?? [] })),
    }
  }

  override async findOne(id: string, user?: AuthUser): Promise<CalendarException> {
    const exception = await super.findOne(id, user) as any
    const map = await this.fetchLineIds([id])
    return { ...exception, lineIds: map.get(id) ?? [] }
  }

  override async create(dto: CreateCalendarExceptionDto): Promise<CalendarException> {
    const { lineIds: _, ...data } = this.sanitizeDto(dto as Record<string, unknown>)
    const scopeId = (dto as any).scopeId || null
    const lineIds: string[] = Array.isArray((dto as any).lineIds) ? (dto as any).lineIds : []
    this.assertTarget(scopeId, lineIds)

    const record = await this.prisma.lineCalendarException.create({
      data: {
        ...(data as any),
        scopeId,
        lines: { create: lineIds.map(lineId => ({ lineId })) },
      },
    })
    return { ...record, lineIds } as any
  }

  override async update(id: string, dto: UpdateCalendarExceptionDto, user?: AuthUser): Promise<CalendarException> {
    const current = await this.findOne(id, user) as any
    const { lineIds: _, scopeId: __, ...data } = this.sanitizeDto(dto as Record<string, unknown>)
    const d = dto as any

    // a cleared select may arrive as '' or null; both mean "no scope"
    const scopeId: string | null = 'scopeId' in d ? (d.scopeId || null) : current.scopeId
    const lineIds: string[] = Array.isArray(d.lineIds) ? d.lineIds : current.lineIds
    this.assertTarget(scopeId, lineIds)

    await this.prisma.lineCalendarException.update({
      where: { id },
      data: {
        ...(data as any),
        scopeId,
        lines: { deleteMany: {}, create: lineIds.map(lineId => ({ lineId })) },
      },
    })
    return this.findOne(id, user)
  }
}
