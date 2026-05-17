import { Module } from '@nestjs/common'
import { UserController } from './user.controller'
import { UserService } from './user.service'
import { CaslModule } from '../../../auth/casl.module'
import { PasswordPolicyModule } from '../settings/password-policy/password-policy.module'

@Module({
  imports:     [CaslModule, PasswordPolicyModule],
  controllers: [UserController],
  providers:   [UserService],
  exports:     [UserService],
})
export class UserModule {}
