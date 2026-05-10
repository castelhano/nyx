import { Module } from '@nestjs/common'
import { BranchController } from './branch.controller'
import { BranchService } from './branch.service'
import { CaslModule } from '../../../auth/casl.module'

@Module({
  imports:     [CaslModule],
  controllers: [BranchController],
  providers:   [BranchService],
  exports:     [BranchService],
})
export class BranchModule {}
