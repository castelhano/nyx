import { Injectable, NotFoundException, BadRequestException } from '@nestjs/common'
import { PrismaService } from '../../../../prisma/prisma.service'
import { BaseService } from '../../../../core/base.service'
import { lineDepartureSchema, LineDeparture, CreateLineDepartureDto, UpdateLineDepartureDto } from '@nyx/schemas'

@Injectable()
export class LineDepartureService extends BaseService<LineDeparture, CreateLineDepartureDto, UpdateLineDepartureDto> {
  constructor(prisma: PrismaService) {
    super(prisma, 'lineDeparture', lineDepartureSchema, 'transit')
  }

  // Departures can only be created/edited/removed while their LineSchedule version is
  // still DRAFT — once approved, that version is frozen to preserve history.
  private async assertScheduleIsDraft(lineScheduleId: string): Promise<void> {
    const schedule = await this.prisma.lineSchedule.findUnique({
      where:  { id: lineScheduleId },
      select: { status: true },
    })
    if (!schedule) throw new NotFoundException('LineSchedule not found')
    if (schedule.status !== 'DRAFT') {
      throw new BadRequestException('Este quadro de horários já foi aprovado — crie uma nova versão para editá-lo')
    }
  }

  override async create(dto: CreateLineDepartureDto): Promise<LineDeparture> {
    await this.assertScheduleIsDraft(dto.lineScheduleId)
    return super.create(dto)
  }

  override async update(id: string, dto: UpdateLineDepartureDto): Promise<LineDeparture> {
    const existing = await this.prisma.lineDeparture.findUnique({ where: { id }, select: { lineScheduleId: true } })
    if (!existing) throw new NotFoundException('LineDeparture not found')
    await this.assertScheduleIsDraft(existing.lineScheduleId)
    return super.update(id, dto)
  }

  override async remove(id: string): Promise<void> {
    const existing = await this.prisma.lineDeparture.findUnique({ where: { id }, select: { lineScheduleId: true } })
    if (!existing) throw new NotFoundException('LineDeparture not found')
    await this.assertScheduleIsDraft(existing.lineScheduleId)
    return super.remove(id)
  }
}
