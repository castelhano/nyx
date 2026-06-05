import { Module } from '@nestjs/common'
import { VehiclePlanController } from './vehicle-plan.controller'
import { VehiclePlanService } from './vehicle-plan.service'
import { VehicleBlockController } from './vehicle-block.controller'
import { VehicleBlockService } from './vehicle-block.service'
import { VehiclePlanImportController } from './vehicle-plan-import.controller'
import { VehiclePlanImportService } from './vehicle-plan-import.service'
import { PlanningConfigModule } from '../settings/planning-config/planning-config.module'
import { JobModule } from '../../../core/job/job.module'
import { CaslModule } from '../../../../auth/casl.module'

@Module({
  imports:     [PlanningConfigModule, JobModule, CaslModule],
  controllers: [VehiclePlanController, VehicleBlockController, VehiclePlanImportController],
  providers:   [VehiclePlanService, VehicleBlockService, VehiclePlanImportService],
})
export class VehiclePlanModule {}
