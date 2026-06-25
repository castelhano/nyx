import { Module } from '@nestjs/common'
import { TripController } from './trip.controller'
import { TripService } from './trip.service'
import { CaslModule } from '../../../../auth/casl.module'
import { VehiclePlanModule } from '../vehicle-plan/vehicle-plan.module'

@Module({
  imports:     [CaslModule, VehiclePlanModule],
  controllers: [TripController],
  providers:   [TripService],
  exports:     [TripService],
})
export class TripModule {}
