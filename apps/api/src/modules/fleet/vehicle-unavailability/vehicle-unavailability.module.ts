import { Module } from '@nestjs/common'
import { VehicleUnavailabilityController } from './vehicle-unavailability.controller'
import { VehicleUnavailabilityService } from './vehicle-unavailability.service'
import { CaslModule } from '../../../auth/casl.module'

@Module({
  imports:     [CaslModule],
  controllers: [VehicleUnavailabilityController],
  providers:   [VehicleUnavailabilityService],
  exports:     [VehicleUnavailabilityService],
})
export class VehicleUnavailabilityModule {}
