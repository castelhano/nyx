import { Module } from '@nestjs/common'
import { RouteLocalityController } from './route-locality.controller'
import { RouteLocalityService } from './route-locality.service'
import { CaslModule } from '../../../../auth/casl.module'

@Module({
  imports:     [CaslModule],
  controllers: [RouteLocalityController],
  providers:   [RouteLocalityService],
  exports:     [RouteLocalityService],
})
export class RouteLocalityModule {}
