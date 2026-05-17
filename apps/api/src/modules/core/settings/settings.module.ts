import { Module } from '@nestjs/common'
import { PasswordPolicyModule } from './password-policy/password-policy.module'
import { SettingsService } from './settings.service'

@Module({
  imports:   [PasswordPolicyModule],
  providers: [SettingsService],
  exports:   [PasswordPolicyModule],
})
export class SettingsModule {}
