import { Module } from '@nestjs/common'
import { DayTypeModule } from './day-type/day-type.module'
import { ServicePeriodModule } from './service-period/service-period.module'
import { TripModule } from './trip/trip.module'
import { PlanningConfigModule } from './settings/planning-config/planning-config.module'
import { VehiclePlanModule } from './vehicle-plan/vehicle-plan.module'

@Module({
  imports: [DayTypeModule, ServicePeriodModule, TripModule, PlanningConfigModule, VehiclePlanModule],
  exports: [DayTypeModule, ServicePeriodModule, TripModule, PlanningConfigModule, VehiclePlanModule],
})
export class TimetablingModule {}
