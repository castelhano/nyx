import { Module } from '@nestjs/common'
import { HolidayController } from './holiday.controller'
import { HolidayService } from './holiday.service'
import { CaslModule } from '../../../auth/casl.module'

@Module({
  imports:     [CaslModule],
  controllers: [HolidayController],
  providers:   [HolidayService],
  exports:     [HolidayService],
})
export class HolidayModule {}
