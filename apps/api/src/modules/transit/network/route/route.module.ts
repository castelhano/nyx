import { Module } from '@nestjs/common'
import { RouteController } from './route.controller'
import { RouteService } from './route.service'
import { TravelTimeModule } from '../travel-time/travel-time.module'
import { CaslModule } from '../../../../auth/casl.module'

@Module({
  imports:     [CaslModule, TravelTimeModule],
  controllers: [RouteController],
  providers:   [RouteService],
  exports:     [RouteService],
})
export class RouteModule {}
