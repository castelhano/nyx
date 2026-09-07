import { Injectable } from '@nestjs/common'
import { planningSettingsSchema, PlanningSettings } from '@nyx/schemas'
import { PrismaService } from '../../../prisma/prisma.service'
import { BaseSettingsService } from '../../../core/base-settings.service'

@Injectable()
export class TransitPlanningConfigService extends BaseSettingsService<PlanningSettings> {
  constructor(prisma: PrismaService) {
    super(prisma, 'transit.planning', 'transit', planningSettingsSchema, 'branch')
  }
}
