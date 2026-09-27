import { Injectable } from '@nestjs/common'
import { crewCostSettingsSchema, CrewCostSettings } from '@nyx/schemas'
import { PrismaService } from '../../../prisma/prisma.service'
import { BaseSettingsService } from '../../../core/base-settings.service'

// Per transit Scope (one CCT shared by every operator of the Scope), falling back to global.
@Injectable()
export class TransitCrewCostConfigService extends BaseSettingsService<CrewCostSettings> {
  constructor(prisma: PrismaService) {
    super(prisma, 'transit.crewCost', 'transit', crewCostSettingsSchema, 'transitScope')
  }
}
