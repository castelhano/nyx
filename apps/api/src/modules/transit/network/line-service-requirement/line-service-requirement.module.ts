import { Module } from '@nestjs/common'
import { LineServiceRequirementController } from './line-service-requirement.controller'
import { LineServiceRequirementService } from './line-service-requirement.service'
import { CaslModule } from '../../../../auth/casl.module'

@Module({
  imports:     [CaslModule],
  controllers: [LineServiceRequirementController],
  providers:   [LineServiceRequirementService],
  exports:     [LineServiceRequirementService],
})
export class LineServiceRequirementModule {}
