import { Injectable } from '@nestjs/common'
import { rosterSettingsSchema, RosterSettings } from '@nyx/schemas'
import { PrismaService } from '../../../prisma/prisma.service'
import { BaseSettingsService } from '../../../core/base-settings.service'

@Injectable()
export class TransitRosterConfigService extends BaseSettingsService<RosterSettings> {
  constructor(prisma: PrismaService) {
    super(prisma, 'transit.roster', 'transit', rosterSettingsSchema)
  }
}
