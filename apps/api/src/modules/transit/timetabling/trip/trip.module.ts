import { Module } from '@nestjs/common'
import { TripController } from './trip.controller'
import { TripService } from './trip.service'
import { CaslModule } from '../../../../auth/casl.module'

@Module({
  imports:     [CaslModule],
  controllers: [TripController],
  providers:   [TripService],
  exports:     [TripService],
})
export class TripModule {}
