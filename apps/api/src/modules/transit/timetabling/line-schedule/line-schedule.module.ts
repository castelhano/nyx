import { Module } from '@nestjs/common'
import { LineScheduleController } from './line-schedule.controller'
import { LineScheduleService } from './line-schedule.service'
import { CaslModule } from '../../../../auth/casl.module'

@Module({
  imports:     [CaslModule],
  controllers: [LineScheduleController],
  providers:   [LineScheduleService],
  exports:     [LineScheduleService],
})
export class LineScheduleModule {}
