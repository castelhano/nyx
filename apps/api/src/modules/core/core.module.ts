import { Module } from '@nestjs/common'
import { CompanyModule } from './company/company.module'
import { BranchModule } from './branch/branch.module'
import { UserModule } from './user/user.module'
import { UserPermissionModule } from './user-permission/user-permission.module'
import { UserBranchModule } from './user-branch/user-branch.module'

@Module({
  imports: [CompanyModule, BranchModule, UserModule, UserPermissionModule, UserBranchModule],
})
export class CoreModule {}
