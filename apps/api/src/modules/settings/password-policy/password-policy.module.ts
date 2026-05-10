import { Module } from '@nestjs/common'
import { PasswordPolicyController } from './password-policy.controller'
import { PasswordPolicyService } from './password-policy.service'

@Module({
  controllers: [PasswordPolicyController],
  providers:   [PasswordPolicyService],
  exports:     [PasswordPolicyService],
})
export class PasswordPolicyModule {}
