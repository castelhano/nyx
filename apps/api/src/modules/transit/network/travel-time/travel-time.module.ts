import { Module } from '@nestjs/common'
import { TravelTimeController } from './travel-time.controller'
import { TravelTimeService } from './travel-time.service'
import { OsrmService } from './osrm.service'
import { CaslModule } from '../../../../auth/casl.module'

@Module({
  imports:     [CaslModule],
  controllers: [TravelTimeController],
  providers:   [TravelTimeService, OsrmService],
  exports:     [TravelTimeService, OsrmService],
})
export class TravelTimeModule {}
