import { Module } from '@nestjs/common'
import { VehicleBrandModule } from './vehicle-brand/vehicle-brand.module'
import { VehicleModelModule } from './vehicle-model/vehicle-model.module'
import { VehicleModule } from './vehicle/vehicle.module'
import { VehicleUnavailabilityModule } from './vehicle-unavailability/vehicle-unavailability.module'
import { Domain } from '../../core/domain-registry'

@Domain({ label: 'Frota', icon: 'Bus' })
@Module({
  imports: [VehicleBrandModule, VehicleModelModule, VehicleModule, VehicleUnavailabilityModule],
})
export class FleetModule {}
