import { Module } from '@nestjs/common'
import { LocalityModule } from './locality/locality.module'
import { LineModule } from './line/line.module'
import { RouteModule } from './route/route.module'
import { RouteLocalityModule } from './route-locality/route-locality.module'
import { TravelTimeModule } from './travel-time/travel-time.module'
import { DepotFleetModule } from './depot-fleet/depot-fleet.module'

@Module({
  imports: [LocalityModule, LineModule, RouteModule, RouteLocalityModule, TravelTimeModule, DepotFleetModule],
  exports: [LocalityModule, LineModule, RouteModule, RouteLocalityModule, TravelTimeModule, DepotFleetModule],
})
export class NetworkModule {}
