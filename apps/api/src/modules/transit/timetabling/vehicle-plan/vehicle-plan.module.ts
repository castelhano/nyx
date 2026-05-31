import { Module } from '@nestjs/common'
import { VehiclePlanController } from './vehicle-plan.controller'
import { VehiclePlanService } from './vehicle-plan.service'
import { VehicleBlockController } from './vehicle-block.controller'
import { VehicleBlockService } from './vehicle-block.service'
import { PlanningConfigModule } from '../settings/planning-config/planning-config.module'
import { CaslModule } from '../../../../auth/casl.module'

@Module({
  imports:     [PlanningConfigModule, CaslModule],
  controllers: [VehiclePlanController, VehicleBlockController],
  providers:   [VehiclePlanService, VehicleBlockService],
})
export class VehiclePlanModule {}
