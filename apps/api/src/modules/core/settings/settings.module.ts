import { Module } from '@nestjs/common'
import { PasswordPolicyModule } from './password-policy/password-policy.module'

@Module({
  imports: [PasswordPolicyModule],
  exports: [PasswordPolicyModule],
})
export class SettingsModule {}
