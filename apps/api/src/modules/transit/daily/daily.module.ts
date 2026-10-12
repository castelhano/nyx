import { Module } from '@nestjs/common'
import { CaslModule } from '../../../auth/casl.module'
import { TransitSettingsModule } from '../settings/transit-settings.module'
import { DayTypeModule } from '../timetabling/day-type/day-type.module'
import { HourBankModule } from '../hour-bank/hour-bank.module'
import { DailyOperationController } from './daily-operation.controller'
import { DailyOperationService } from './daily-operation.service'
import { RosterBoardController } from './roster/roster-board.controller'
import { RosterBoardService } from './roster/roster-board.service'
import { RosterGeneratorController } from './roster/roster-generator.controller'
import { RosterGeneratorService } from './roster/roster-generator.service'

// The real day: materialized plans, allocated to vehicles and crew members (by hand or by the
// roster generator)
@Module({
  imports:     [CaslModule, TransitSettingsModule, DayTypeModule, HourBankModule],
  controllers: [DailyOperationController, RosterGeneratorController, RosterBoardController],
  providers:   [DailyOperationService, RosterGeneratorService, RosterBoardService],
  exports:     [DailyOperationService],
})
export class DailyModule {}
