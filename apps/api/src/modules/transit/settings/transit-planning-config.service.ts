import { Injectable } from '@nestjs/common'
import { planningSettingsSchema, PlanningSettings } from '@nyx/schemas'
import { PrismaService } from '../../../prisma/prisma.service'

@Injectable()
export class TransitPlanningConfigService {
  private readonly key = 'transit.planning'

  constructor(private readonly prisma: PrismaService) {}

  async get(branchId?: string): Promise<PlanningSettings> {
    const scopeValue = branchId ?? 'global'
    const row = await this.prisma.settings.findUnique({
      where: { key_scope: { key: this.key, scope: scopeValue } },
    })
    if (!row && branchId) {
      const globalRow = await this.prisma.settings.findUnique({
        where: { key_scope: { key: this.key, scope: 'global' } },
      })
      return planningSettingsSchema.parse(globalRow?.value ?? {}) as PlanningSettings
    }
    return planningSettingsSchema.parse(row?.value ?? {}) as PlanningSettings
  }

  async put(dto: unknown, branchId?: string): Promise<PlanningSettings> {
    const scopeValue = branchId ?? 'global'
    const validated  = planningSettingsSchema.parse(dto)
    const row = await this.prisma.settings.upsert({
      where:  { key_scope: { key: this.key, scope: scopeValue } },
      update: { value: validated as object },
      create: { key: this.key, scope: scopeValue, value: validated as object },
    })
    return row.value as PlanningSettings
  }
}
