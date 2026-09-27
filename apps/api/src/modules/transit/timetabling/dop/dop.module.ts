import { Module } from '@nestjs/common'
import { DopController } from './dop.controller'
import { DopService } from './dop.service'
import { DayTypeModule } from '../day-type/day-type.module'
import { CaslModule } from '../../../../auth/casl.module'
import { TransitSettingsModule } from '../../settings/transit-settings.module'
import { DopCrewService } from './dop-crew.service'

@Module({
  imports:     [DayTypeModule, CaslModule, TransitSettingsModule],
  controllers: [DopController],
  providers:   [DopService, DopCrewService],
})
export class DopModule {}
