import { Injectable } from '@nestjs/common'
import { scheduleSettingsSchema, ScheduleSettings } from '@nyx/schemas'
import { PrismaService } from '../../../prisma/prisma.service'

@Injectable()
export class TransitScheduleConfigService {
  private readonly key = 'transit.schedule'

  constructor(private readonly prisma: PrismaService) {}

  async get(branchId?: string): Promise<ScheduleSettings> {
    const scopeValue = branchId ?? 'global'
    const row = await this.prisma.settings.findUnique({
      where: { key_scope: { key: this.key, scope: scopeValue } },
    })
    if (!row && branchId) {
      const globalRow = await this.prisma.settings.findUnique({
        where: { key_scope: { key: this.key, scope: 'global' } },
      })
      return scheduleSettingsSchema.parse(globalRow?.value ?? {}) as ScheduleSettings
    }
    return scheduleSettingsSchema.parse(row?.value ?? {}) as ScheduleSettings
  }

  async put(dto: unknown, branchId?: string): Promise<ScheduleSettings> {
    const scopeValue = branchId ?? 'global'
    const validated  = scheduleSettingsSchema.parse(dto)
    const row = await this.prisma.settings.upsert({
      where:  { key_scope: { key: this.key, scope: scopeValue } },
      update: { value: validated as object },
      create: { key: this.key, scope: scopeValue, value: validated as object },
    })
    return row.value as ScheduleSettings
  }
}
