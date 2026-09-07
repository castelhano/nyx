import { Injectable } from '@nestjs/common'
import { scheduleSettingsSchema, ScheduleSettings } from '@nyx/schemas'
import { PrismaService } from '../../../prisma/prisma.service'
import { BaseSettingsService } from '../../../core/base-settings.service'

@Injectable()
export class TransitScheduleConfigService extends BaseSettingsService<ScheduleSettings> {
  constructor(prisma: PrismaService) {
    super(prisma, 'transit.schedule', 'transit', scheduleSettingsSchema, 'branch')
  }
}
