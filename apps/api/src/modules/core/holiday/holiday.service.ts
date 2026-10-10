import { BadRequestException, Injectable } from '@nestjs/common'
import { holidaySchema, Holiday, CreateHolidayDto, UpdateHolidayDto } from '@nyx/schemas'
import { PrismaService } from '../../../prisma/prisma.service'
import { BaseService } from '../../../core/base.service'
import { stringContains } from '../../../core/db.utils'

@Injectable()
export class HolidayService extends BaseService<Holiday, CreateHolidayDto, UpdateHolidayDto> {
  constructor(prisma: PrismaService) {
    super(prisma, 'holiday', holidaySchema, 'core')
  }

  protected buildSearchWhere(search: string) {
    return { name: stringContains(search) }
  }

  override async create(dto: CreateHolidayDto): Promise<Holiday> {
    await this.assertUnique(null, dto.date, dto.branchId ?? null)
    return super.create(dto)
  }

  override async update(id: string, dto: UpdateHolidayDto): Promise<Holiday> {
    const current = await this.findOne(id)
    await this.assertUnique(id, dto.date ?? current.date, dto.branchId !== undefined ? dto.branchId ?? null : current.branchId ?? null)
    return super.update(id, dto)
  }

  // @@unique([date, branchId]) doesn't hold for global holidays (NULL branchId never collides)
  private async assertUnique(id: string | null, date: Date | string, branchId: string | null): Promise<void> {
    const dup = await this.prisma.holiday.findFirst({
      where:  { date: new Date(date), branchId, ...(id ? { id: { not: id } } : {}) },
      select: { id: true },
    })
    if (dup) throw new BadRequestException(branchId ? 'A empresa já tem um feriado nessa data' : 'Já existe um feriado geral nessa data')
  }
}
