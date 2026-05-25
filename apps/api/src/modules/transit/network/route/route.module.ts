import { Module } from '@nestjs/common'
import { RouteController } from './route.controller'
import { RouteService } from './route.service'
import { CaslModule } from '../../../../auth/casl.module'

@Module({
  imports:     [CaslModule],
  controllers: [RouteController],
  providers:   [RouteService],
  exports:     [RouteService],
})
export class RouteModule {}
