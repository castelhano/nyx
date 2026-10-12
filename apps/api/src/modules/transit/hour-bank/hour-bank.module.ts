import { Module } from '@nestjs/common'
import { CaslModule } from '../../../auth/casl.module'
import { TransitSettingsModule } from '../settings/transit-settings.module'
import { HourBankController } from './hour-bank.controller'
import { HourBankService } from './hour-bank.service'
import { TimesheetImportService } from './timesheet-import.service'

// Banco de horas: the forecast from the roster, the imported frequency, lots and closings
@Module({
  imports:     [CaslModule, TransitSettingsModule],
  controllers: [HourBankController],
  providers:   [HourBankService, TimesheetImportService],
  exports:     [HourBankService],
})
export class HourBankModule {}
