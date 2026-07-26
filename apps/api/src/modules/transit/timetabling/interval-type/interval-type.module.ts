import { Module } from '@nestjs/common'
import { IntervalTypeController } from './interval-type.controller'
import { IntervalTypeService } from './interval-type.service'
import { CaslModule } from '../../../../auth/casl.module'

@Module({
  imports:     [CaslModule],
  controllers: [IntervalTypeController],
  providers:   [IntervalTypeService],
  exports:     [IntervalTypeService],
})
export class IntervalTypeModule {}
