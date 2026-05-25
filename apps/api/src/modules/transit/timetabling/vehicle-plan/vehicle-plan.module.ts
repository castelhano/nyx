import { Module } from '@nestjs/common'
import { VehiclePlanController } from './vehicle-plan.controller'
import { VehiclePlanService } from './vehicle-plan.service'
import { PlanningConfigModule } from '../settings/planning-config/planning-config.module'

@Module({
  imports:     [PlanningConfigModule],
  controllers: [VehiclePlanController],
  providers:   [VehiclePlanService],
})
export class VehiclePlanModule {}
