import { Module } from '@nestjs/common'
import { DayTypeModule } from './day-type/day-type.module'
import { LineScheduleModule } from './line-schedule/line-schedule.module'
import { LineDepartureModule } from './line-departure/line-departure.module'
import { TripModule } from './trip/trip.module'
import { VehiclePlanModule } from './vehicle-plan/vehicle-plan.module'
import { CalendarExceptionModule } from './calendar-exception/calendar-exception.module'
import { IntervalTypeModule } from './interval-type/interval-type.module'
import { DopModule } from './dop/dop.module'
import { CrewPlanModule } from './crew-plan/crew-plan.module'
import { VehicleSwapModule } from './vehicle-swap/vehicle-swap.module'
import { CrewSolverModule } from './crew-solver/crew-solver.module'
import { VehicleSolverModule } from './vehicle-solver/vehicle-solver.module'
import { PlanCsvModule } from './plan-csv/plan-csv.module'

@Module({
  imports: [DayTypeModule, LineScheduleModule, LineDepartureModule, TripModule, VehiclePlanModule, CalendarExceptionModule, IntervalTypeModule, DopModule, CrewPlanModule, VehicleSwapModule, CrewSolverModule, VehicleSolverModule, PlanCsvModule],
  exports: [DayTypeModule, LineScheduleModule, LineDepartureModule, TripModule, VehiclePlanModule, CalendarExceptionModule, IntervalTypeModule, DopModule, CrewPlanModule],
})
export class TimetablingModule {}
