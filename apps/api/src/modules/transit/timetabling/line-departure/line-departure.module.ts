import { Module } from '@nestjs/common'
import { LineDepartureController } from './line-departure.controller'
import { LineDepartureService } from './line-departure.service'
import { CaslModule } from '../../../../auth/casl.module'

@Module({
  imports:     [CaslModule],
  controllers: [LineDepartureController],
  providers:   [LineDepartureService],
  exports:     [LineDepartureService],
})
export class LineDepartureModule {}
