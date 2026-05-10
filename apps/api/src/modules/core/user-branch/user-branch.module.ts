import { Module } from '@nestjs/common'
import { UserBranchController } from './user-branch.controller'
import { UserBranchService } from './user-branch.service'
import { CaslModule } from '../../../auth/casl.module'

@Module({
  imports:     [CaslModule],
  controllers: [UserBranchController],
  providers:   [UserBranchService],
  exports:     [UserBranchService],
})
export class UserBranchModule {}
