import { Module } from '@nestjs/common'
import { VehicleSolverController } from './vehicle-solver.controller'
import { VehicleSolverJobsController } from './vehicle-solver-jobs.controller'
import { VehicleSolverService } from './vehicle-solver.service'
import { VehiclePlanModule } from '../vehicle-plan/vehicle-plan.module'
import { TransitSettingsModule } from '../../settings/transit-settings.module'
import { CaslModule } from '../../../../auth/casl.module'

@Module({
  imports:     [VehiclePlanModule, TransitSettingsModule, CaslModule],
  controllers: [VehicleSolverController, VehicleSolverJobsController],
  providers:   [VehicleSolverService],
})
export class VehicleSolverModule {}
