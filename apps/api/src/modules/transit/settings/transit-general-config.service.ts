import { Injectable } from '@nestjs/common'
import { generalSettingsSchema, GeneralSettings } from '@nyx/schemas'
import { PrismaService } from '../../../prisma/prisma.service'
import { BaseSettingsService } from '../../../core/base-settings.service'

@Injectable()
export class TransitGeneralConfigService extends BaseSettingsService<GeneralSettings> {
  constructor(prisma: PrismaService) {
    super(prisma, 'transit.general', 'transit', generalSettingsSchema, 'global')
  }
}
