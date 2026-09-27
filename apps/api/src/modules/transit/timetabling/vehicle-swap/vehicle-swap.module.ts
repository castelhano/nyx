import { Module } from '@nestjs/common'
import { VehicleSwapController } from './vehicle-swap.controller'
import { VehicleSwapService } from './vehicle-swap.service'
import { VehiclePlanModule } from '../vehicle-plan/vehicle-plan.module'
import { CrewPlanModule } from '../crew-plan/crew-plan.module'
import { CaslModule } from '../../../../auth/casl.module'

// Own module: it needs both VehiclePlanService and CrewPlanService, and VehiclePlanModule
// already depends on CrewPlanModule
@Module({
  imports:     [VehiclePlanModule, CrewPlanModule, CaslModule],
  controllers: [VehicleSwapController],
  providers:   [VehicleSwapService],
})
export class VehicleSwapModule {}
