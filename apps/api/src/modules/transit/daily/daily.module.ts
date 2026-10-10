import { Module } from '@nestjs/common'
import { CaslModule } from '../../../auth/casl.module'
import { TransitSettingsModule } from '../settings/transit-settings.module'
import { DayTypeModule } from '../timetabling/day-type/day-type.module'
import { DailyOperationController } from './daily-operation.controller'
import { DailyOperationService } from './daily-operation.service'

// The real day: materialized plans, allocated to vehicles and crew members
@Module({
  imports:     [CaslModule, TransitSettingsModule, DayTypeModule],
  controllers: [DailyOperationController],
  providers:   [DailyOperationService],
  exports:     [DailyOperationService],
})
export class DailyModule {}
