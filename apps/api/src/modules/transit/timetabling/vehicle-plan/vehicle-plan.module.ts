import { Module } from '@nestjs/common'
import { VehiclePlanController } from './vehicle-plan.controller'
import { VehiclePlanService } from './vehicle-plan.service'
import { VehicleBlockController } from './vehicle-block.controller'
import { VehicleBlockService } from './vehicle-block.service'
import { VehiclePlanImportController } from './vehicle-plan-import.controller'
import { VehiclePlanImportService } from './vehicle-plan-import.service'
import { TransitSettingsModule } from '../../settings/transit-settings.module'
import { JobModule } from '../../../core/job/job.module'
import { CaslModule } from '../../../../auth/casl.module'

@Module({
  imports:     [TransitSettingsModule, JobModule, CaslModule],
  controllers: [VehiclePlanController, VehicleBlockController, VehiclePlanImportController],
  providers:   [VehiclePlanService, VehicleBlockService, VehiclePlanImportService],
  exports:     [VehiclePlanService],
})
export class VehiclePlanModule {}
