import { Module } from '@nestjs/common'
import { CompanyModule } from './company/company.module'
import { BranchModule } from './branch/branch.module'
import { UserModule } from './user/user.module'
import { UserPermissionModule } from './user-permission/user-permission.module'
import { UserBranchModule } from './user-branch/user-branch.module'
import { SettingsModule } from './settings/settings.module'
import { JobModule } from './job/job.module'
import { Domain } from '../../core/domain-registry'

@Domain({ label: 'Controle', icon: 'Shield' })
@Module({
  imports: [CompanyModule, BranchModule, UserModule, UserPermissionModule, UserBranchModule, SettingsModule, JobModule],
})
export class CoreModule {}
