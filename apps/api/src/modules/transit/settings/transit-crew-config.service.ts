import { Injectable } from '@nestjs/common'
import { crewSettingsSchema, CrewSettings } from '@nyx/schemas'
import { PrismaService } from '../../../prisma/prisma.service'
import { BaseSettingsService } from '../../../core/base-settings.service'

// Per transit Scope (one CCT shared by every operator of the Scope), falling back to global.
@Injectable()
export class TransitCrewConfigService extends BaseSettingsService<CrewSettings> {
  constructor(prisma: PrismaService) {
    super(prisma, 'transit.crew', 'transit', crewSettingsSchema, 'transitScope')
  }
}
