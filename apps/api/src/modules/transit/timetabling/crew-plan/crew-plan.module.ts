import { Module } from '@nestjs/common'
import { CrewPlanController } from './crew-plan.controller'
import { CrewPlanService } from './crew-plan.service'
import { DutyController } from './duty.controller'
import { DutyService } from './duty.service'
import { DutyPieceController } from './duty-piece.controller'
import { DutyPieceService } from './duty-piece.service'
import { DutyActivityController } from './duty-activity.controller'
import { DutyActivityService } from './duty-activity.service'
import { TransitSettingsModule } from '../../settings/transit-settings.module'
import { CaslModule } from '../../../../auth/casl.module'

@Module({
  imports:     [TransitSettingsModule, CaslModule],
  controllers: [CrewPlanController, DutyController, DutyPieceController, DutyActivityController],
  providers:   [CrewPlanService, DutyService, DutyPieceService, DutyActivityService],
  exports:     [CrewPlanService],
})
export class CrewPlanModule {}
