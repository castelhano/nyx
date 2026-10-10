import { Module } from '@nestjs/common'
import { CrewShiftController } from './crew-shift.controller'
import { CrewShiftService } from './crew-shift.service'
import { CaslModule } from '../../../../auth/casl.module'

@Module({
  imports:     [CaslModule],
  controllers: [CrewShiftController],
  providers:   [CrewShiftService],
  exports:     [CrewShiftService],
})
export class CrewShiftModule {}
