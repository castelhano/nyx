import { Module } from '@nestjs/common'
import { CalendarExceptionController } from './calendar-exception.controller'
import { CalendarExceptionService } from './calendar-exception.service'
import { CaslModule } from '../../../../auth/casl.module'

@Module({
  imports:     [CaslModule],
  controllers: [CalendarExceptionController],
  providers:   [CalendarExceptionService],
  exports:     [CalendarExceptionService],
})
export class CalendarExceptionModule {}
