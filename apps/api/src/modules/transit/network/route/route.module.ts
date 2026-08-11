import { Module } from '@nestjs/common'
import { RouteController } from './route.controller'
import { RouteService } from './route.service'
import { TravelTimeModule } from '../travel-time/travel-time.module'
import { LineModule } from '../line/line.module'
import { TransitSettingsModule } from '../../settings/transit-settings.module'
import { CaslModule } from '../../../../auth/casl.module'

@Module({
  imports:     [CaslModule, TravelTimeModule, LineModule, TransitSettingsModule],
  controllers: [RouteController],
  providers:   [RouteService],
  exports:     [RouteService],
})
export class RouteModule {}
