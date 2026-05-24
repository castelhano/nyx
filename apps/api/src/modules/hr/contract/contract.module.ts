import { Module } from '@nestjs/common'
import { ContractController } from './contract.controller'
import { ContractService } from './contract.service'
import { CaslModule } from '../../../auth/casl.module'

@Module({
  imports:     [CaslModule],
  controllers: [ContractController],
  providers:   [ContractService],
  exports:     [ContractService],
})
export class ContractModule {}
