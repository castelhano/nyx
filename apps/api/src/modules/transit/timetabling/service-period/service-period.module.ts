import { Module } from '@nestjs/common'
import { ServicePeriodController } from './service-period.controller'
import { ServicePeriodService } from './service-period.service'
import { CaslModule } from '../../../../auth/casl.module'

@Module({
  imports:     [CaslModule],
  controllers: [ServicePeriodController],
  providers:   [ServicePeriodService],
  exports:     [ServicePeriodService],
})
export class ServicePeriodModule {}
