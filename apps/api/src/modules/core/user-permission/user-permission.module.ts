import { Module } from '@nestjs/common'
import { UserPermissionController } from './user-permission.controller'
import { UserPermissionService } from './user-permission.service'
import { CaslModule } from '../../../auth/casl.module'

@Module({
  imports:     [CaslModule],
  controllers: [UserPermissionController],
  providers:   [UserPermissionService],
  exports:     [UserPermissionService],
})
export class UserPermissionModule {}
