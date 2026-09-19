import { Module } from '@nestjs/common'
import { DopController } from './dop.controller'
import { DopService } from './dop.service'
import { DayTypeModule } from '../day-type/day-type.module'
import { CaslModule } from '../../../../auth/casl.module'

@Module({
  imports:     [DayTypeModule, CaslModule],
  controllers: [DopController],
  providers:   [DopService],
})
export class DopModule {}
