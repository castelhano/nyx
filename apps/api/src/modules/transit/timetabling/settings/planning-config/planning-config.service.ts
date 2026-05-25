import { Injectable } from '@nestjs/common'
import { planningConfigSchema, PlanningConfig } from '@nyx/schemas'
import { PrismaService } from '../../../../../prisma/prisma.service'
import { BaseSettingsService } from '../../../../../core/base-settings.service'

@Injectable()
export class PlanningConfigService extends BaseSettingsService<PlanningConfig> {
  constructor(prisma: PrismaService) {
    super(prisma, 'planning-config', 'transit', planningConfigSchema, 'global')
  }
}
