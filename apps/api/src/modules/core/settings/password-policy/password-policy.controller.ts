import { Controller, UseGuards } from '@nestjs/common'
import { JwtAuthGuard } from '../../../../auth/policies.guard'
import { BaseSettingsController } from '../../../../core/base-settings.controller'
import { PasswordPolicyService } from './password-policy.service'
import type { PasswordPolicy } from '@nyx/schemas'

@Controller('core/password-policy')
@UseGuards(JwtAuthGuard)
export class PasswordPolicyController extends BaseSettingsController<PasswordPolicy> {
  constructor(service: PasswordPolicyService) {
    super(service)
  }
}
