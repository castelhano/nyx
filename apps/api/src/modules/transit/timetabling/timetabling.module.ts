import { Module } from '@nestjs/common'
import { DayTypeModule } from './day-type/day-type.module'
import { LineScheduleModule } from './line-schedule/line-schedule.module'
import { LineDepartureModule } from './line-departure/line-departure.module'
import { TripModule } from './trip/trip.module'
import { VehiclePlanModule } from './vehicle-plan/vehicle-plan.module'
import { CalendarExceptionModule } from './calendar-exception/calendar-exception.module'
import { IntervalTypeModule } from './interval-type/interval-type.module'

@Module({
  imports: [DayTypeModule, LineScheduleModule, LineDepartureModule, TripModule, VehiclePlanModule, CalendarExceptionModule, IntervalTypeModule],
  exports: [DayTypeModule, LineScheduleModule, LineDepartureModule, TripModule, VehiclePlanModule, CalendarExceptionModule, IntervalTypeModule],
})
export class TimetablingModule {}
