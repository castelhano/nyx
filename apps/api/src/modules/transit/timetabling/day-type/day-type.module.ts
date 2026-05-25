import { Module } from '@nestjs/common'
import { DayTypeController } from './day-type.controller'
import { DayTypeService } from './day-type.service'
import { CaslModule } from '../../../../auth/casl.module'

@Module({
  imports:     [CaslModule],
  controllers: [DayTypeController],
  providers:   [DayTypeService],
  exports:     [DayTypeService],
})
export class DayTypeModule {}
