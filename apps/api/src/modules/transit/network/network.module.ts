import { Module } from '@nestjs/common'
import { LocalityModule } from './locality/locality.module'
import { LineModule } from './line/line.module'
import { RouteModule } from './route/route.module'
import { RouteLocalityModule } from './route-locality/route-locality.module'
import { TravelTimeModule } from './travel-time/travel-time.module'

@Module({
  imports: [LocalityModule, LineModule, RouteModule, RouteLocalityModule, TravelTimeModule],
  exports: [LocalityModule, LineModule, RouteModule, RouteLocalityModule, TravelTimeModule],
})
export class NetworkModule {}
