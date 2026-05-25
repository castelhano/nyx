import { Module } from '@nestjs/common'
import { LocalityController } from './locality.controller'
import { LocalityService } from './locality.service'
import { TravelTimeModule } from '../travel-time/travel-time.module'
import { CaslModule } from '../../../../auth/casl.module'

@Module({
  imports:     [CaslModule, TravelTimeModule],
  controllers: [LocalityController],
  providers:   [LocalityService],
  exports:     [LocalityService],
})
export class LocalityModule {}
