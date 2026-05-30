import { Module } from '@nestjs/common'
import { DayTypeModule } from './day-type/day-type.module'
import { TripModule } from './trip/trip.module'
import { PlanningConfigModule } from './settings/planning-config/planning-config.module'
import { VehiclePlanModule } from './vehicle-plan/vehicle-plan.module'
import { CalendarExceptionModule } from './calendar-exception/calendar-exception.module'

@Module({
  imports: [DayTypeModule, TripModule, PlanningConfigModule, VehiclePlanModule, CalendarExceptionModule],
  exports: [DayTypeModule, TripModule, PlanningConfigModule, VehiclePlanModule, CalendarExceptionModule],
})
export class TimetablingModule {}
