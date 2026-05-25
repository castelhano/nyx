import { Module } from '@nestjs/common'
import { PlanningConfigController } from './planning-config.controller'
import { PlanningConfigService } from './planning-config.service'
import { CaslModule } from '../../../../../auth/casl.module'

@Module({
  imports:     [CaslModule],
  controllers: [PlanningConfigController],
  providers:   [PlanningConfigService],
  exports:     [PlanningConfigService],
})
export class PlanningConfigModule {}
