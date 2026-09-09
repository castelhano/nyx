import { Injectable, NotFoundException, BadRequestException } from '@nestjs/common'
import { PrismaService } from '../../../../prisma/prisma.service'
import { BaseService } from '../../../../core/base.service'
import {
  lineScheduleSchema, LineSchedule, CreateLineScheduleDto, UpdateLineScheduleDto,
  LineDeparture, CreateLineDepartureDto, UpdateLineDepartureDto,
} from '@nyx/schemas'
import { generateDraftRef } from './line-schedule.util'

export interface SaveDeparturesBatchDto {
  header?:     UpdateLineScheduleDto
  create?:     Omit<CreateLineDepartureDto, 'lineScheduleId'>[]
  update?:     { id: string; data: UpdateLineDepartureDto }[]
  deleteIds?:  string[]
}

export interface SaveDeparturesBatchResult {
  schedule:    LineSchedule
  departures:  LineDeparture[]
}

@Injectable()
export class LineScheduleService extends BaseService<LineSchedule, CreateLineScheduleDto, UpdateLineScheduleDto> {
  constructor(prisma: PrismaService) {
    super(prisma, 'lineSchedule', lineScheduleSchema, 'transit')
  }

  override create(dto: CreateLineScheduleDto): Promise<LineSchedule> {
    const data = this.sanitizeDto(dto)
    return this.model.create({ data: { ...data, status: 'DRAFT' } })
  }

  override async update(id: string, dto: UpdateLineScheduleDto): Promise<LineSchedule> {
    const schedule = await this.prisma.lineSchedule.findUnique({ where: { id } })
    if (!schedule) throw new NotFoundException('LineSchedule not found')

    const data = this.sanitizeDto(dto)
    return this.model.update({ where: { id }, data })
  }

  override async remove(id: string): Promise<void> {
    const schedule = await this.prisma.lineSchedule.findUnique({ where: { id } })
    if (!schedule) throw new NotFoundException('LineSchedule not found')
    if (schedule.status !== 'DRAFT') throw new BadRequestException('Only DRAFT schedules can be deleted')

    await this.prisma.$transaction(async tx => {
      await tx.lineDeparture.deleteMany({ where: { lineScheduleId: id } })
      await tx.lineSchedule.delete({ where: { id } })
    })
  }

  async duplicate(id: string): Promise<LineSchedule> {
    const schedule = await this.prisma.lineSchedule.findUnique({
      where:   { id },
      include: { departures: true },
    })
    if (!schedule) throw new NotFoundException('LineSchedule not found')

    const approvalRef = await generateDraftRef(this.prisma, schedule.lineId, schedule.dayTypeId)

    return this.prisma.$transaction(async tx => {
      const newSchedule = await tx.lineSchedule.create({
        data: {
          lineId:    schedule.lineId,
          dayTypeId: schedule.dayTypeId,
          approvalRef,
          status:    'DRAFT',
          notes:     schedule.notes ?? undefined,
        },
      })

      if (schedule.departures.length > 0) {
        await tx.lineDeparture.createMany({
          data: schedule.departures.map(d => ({
            lineScheduleId:      newSchedule.id,
            routeId:             d.routeId,
            departureMinutes:    d.departureMinutes,
            requiredVehicleType: d.requiredVehicleType ?? undefined,
            stopPattern:         d.stopPattern,
            notes:               d.notes ?? undefined,
          })),
        })
      }

      return newSchedule as unknown as LineSchedule
    })
  }

  async approve(id: string, force = false): Promise<{ conflict: { id: string; approvalRef: string } } | null> {
    const schedule = await this.prisma.lineSchedule.findUnique({ where: { id } })
    if (!schedule) throw new NotFoundException('LineSchedule not found')
    if (schedule.status !== 'DRAFT') throw new BadRequestException('Only DRAFT schedules can be approved')

    const conflict = await this.prisma.lineSchedule.findFirst({
      where:  { id: { not: id }, lineId: schedule.lineId, dayTypeId: schedule.dayTypeId, status: 'APPROVED' },
      select: { id: true, approvalRef: true },
    })

    if (conflict && !force) {
      return { conflict }
    }

    const now = new Date()

    await this.prisma.$transaction(async tx => {
      if (conflict) {
        await tx.lineSchedule.update({ where: { id: conflict.id }, data: { status: 'SUPERSEDED', validTo: now } })
      }
      await tx.lineSchedule.update({ where: { id }, data: { status: 'APPROVED', validFrom: now, approvedAt: now } })
    })

    return null
  }

  // Single commit for the schedule editor (header + departures). No status guard: editing an
  // approved schedule is allowed (the warning lives only in the frontend confirm).
  async saveBatch(id: string, dto: SaveDeparturesBatchDto): Promise<SaveDeparturesBatchResult> {
    const schedule = await this.prisma.lineSchedule.findUnique({ where: { id } })
    if (!schedule) throw new NotFoundException('LineSchedule not found')

    const existing   = await this.prisma.lineDeparture.findMany({ where: { lineScheduleId: id }, select: { id: true } })
    const existingIds = new Set(existing.map(d => d.id))

    const deleteIds = dto.deleteIds ?? []
    const updates   = dto.update ?? []
    for (const departureId of [...deleteIds, ...updates.map(u => u.id)]) {
      if (!existingIds.has(departureId)) {
        throw new BadRequestException(`LineDeparture ${departureId} does not belong to this schedule`)
      }
    }

    await this.prisma.$transaction(async tx => {
      if (dto.header) {
        const data = this.sanitizeDto(dto.header)
        if (Object.keys(data).length > 0) await tx.lineSchedule.update({ where: { id }, data })
      }

      if (deleteIds.length > 0) {
        await tx.lineDeparture.deleteMany({ where: { id: { in: deleteIds } } })
      }

      for (const u of updates) {
        await tx.lineDeparture.update({ where: { id: u.id }, data: u.data })
      }

      if (dto.create?.length) {
        await tx.lineDeparture.createMany({
          data: dto.create.map(d => ({ ...d, lineScheduleId: id })),
        })
      }
    })

    const [finalSchedule, finalDepartures] = await Promise.all([
      this.prisma.lineSchedule.findUniqueOrThrow({ where: { id } }),
      this.prisma.lineDeparture.findMany({ where: { lineScheduleId: id }, orderBy: { departureMinutes: 'asc' } }),
    ])

    return { schedule: finalSchedule as unknown as LineSchedule, departures: finalDepartures as unknown as LineDeparture[] }
  }
}
