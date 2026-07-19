import { Injectable, NotFoundException, BadRequestException } from '@nestjs/common'
import { PrismaService } from '../../../../prisma/prisma.service'
import { BaseService } from '../../../../core/base.service'
import { lineScheduleSchema, LineSchedule, CreateLineScheduleDto, UpdateLineScheduleDto } from '@nyx/schemas'

@Injectable()
export class LineScheduleService extends BaseService<LineSchedule, CreateLineScheduleDto, UpdateLineScheduleDto> {
  constructor(prisma: PrismaService) {
    super(prisma, 'lineSchedule', lineScheduleSchema, 'transit')
  }

  override async create(dto: CreateLineScheduleDto): Promise<LineSchedule> {
    const data = this.sanitizeDto(dto as Record<string, unknown>)
    const version = await this.nextVersion(data.lineId as string, data.dayTypeId as string)
    return this.model.create({ data: { ...data, version, status: 'DRAFT' } })
  }

  private async nextVersion(lineId: string, dayTypeId: string): Promise<number> {
    const last = await this.prisma.lineSchedule.aggregate({
      where: { lineId, dayTypeId },
      _max:  { version: true },
    })
    return (last._max.version ?? 0) + 1
  }

  override async remove(id: string): Promise<void> {
    const schedule = await this.prisma.lineSchedule.findUnique({ where: { id } })
    if (!schedule) throw new NotFoundException('LineSchedule not found')
    if (schedule.status !== 'DRAFT') throw new BadRequestException('Only DRAFT schedules can be deleted')

    await this.prisma.$transaction(async tx => {
      await tx.transitTrip.deleteMany({ where: { lineScheduleId: id } })
      await tx.lineSchedule.delete({ where: { id } })
    })
  }

  async duplicate(id: string): Promise<LineSchedule> {
    const schedule = await this.prisma.lineSchedule.findUnique({
      where:   { id },
      include: { trips: true },
    })
    if (!schedule) throw new NotFoundException('LineSchedule not found')

    const version = await this.nextVersion(schedule.lineId, schedule.dayTypeId)

    return this.prisma.$transaction(async tx => {
      const newSchedule = await tx.lineSchedule.create({
        data: {
          lineId:    schedule.lineId,
          dayTypeId: schedule.dayTypeId,
          version,
          status:    'DRAFT',
          notes:     schedule.notes ?? undefined,
        },
      })

      if (schedule.trips.length > 0) {
        await tx.transitTrip.createMany({
          data: schedule.trips.map(t => ({
            routeId:             t.routeId,
            dayTypeId:           t.dayTypeId,
            lineScheduleId:      newSchedule.id,
            departureMinutes:    t.departureMinutes,
            arrivalMinutes:      t.arrivalMinutes,
            requiredVehicleType: t.requiredVehicleType ?? undefined,
            constraints:         t.constraints ?? undefined,
            notes:               t.notes ?? undefined,
          })),
        })
      }

      return newSchedule as unknown as LineSchedule
    })
  }

  async approve(id: string, force = false): Promise<{ conflict: { id: string; version: number } } | null> {
    const schedule = await this.prisma.lineSchedule.findUnique({ where: { id } })
    if (!schedule) throw new NotFoundException('LineSchedule not found')
    if (schedule.status !== 'DRAFT') throw new BadRequestException('Only DRAFT schedules can be approved')

    const conflict = await this.prisma.lineSchedule.findFirst({
      where:  { id: { not: id }, lineId: schedule.lineId, dayTypeId: schedule.dayTypeId, status: 'APPROVED' },
      select: { id: true, version: true },
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
}
