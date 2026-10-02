import { Injectable } from '@nestjs/common'
import { planningSettingsSchema, PlanningSettings } from '@nyx/schemas'
import { PrismaService } from '../../../prisma/prisma.service'
import { BaseSettingsService } from '../../../core/base-settings.service'

// Per transit Scope (the VehiclePlan's), falling back to global. A VehiclePlan may carry its
// own full copy (VehiclePlan.settings) — see VehiclePlanService.resolveSettings.
@Injectable()
export class TransitPlanningConfigService extends BaseSettingsService<PlanningSettings> {
  constructor(prisma: PrismaService) {
    super(prisma, 'transit.planning', 'transit', planningSettingsSchema, 'transitScope')
  }
}
