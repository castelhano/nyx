import { Controller, UseGuards } from '@nestjs/common'
import { PlanningConfig } from '@nyx/schemas'
import { BaseSettingsController } from '../../../../../core/base-settings.controller'
import { CaslAbilityFactory } from '../../../../../auth/casl.factory'
import { JwtAuthGuard } from '../../../../../auth/policies.guard'
import { PlanningConfigService } from './planning-config.service'

@Controller('transit/planning-config')
@UseGuards(JwtAuthGuard)
export class PlanningConfigController extends BaseSettingsController<PlanningConfig> {
  constructor(
    service: PlanningConfigService,
    caslFactory: CaslAbilityFactory,
  ) {
    super(service, caslFactory)
  }
}
