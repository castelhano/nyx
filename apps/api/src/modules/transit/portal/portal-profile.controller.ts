import { Controller, UseGuards } from '@nestjs/common'
import { PortalProfile, CreatePortalProfileDto, UpdatePortalProfileDto } from '@nyx/schemas'
import { BaseController } from '../../../core/base.controller'
import { CaslAbilityFactory } from '../../../auth/casl.factory'
import { JwtAuthGuard } from '../../../auth/policies.guard'
import { PortalProfileService } from './portal-profile.service'

@Controller('transit/portal-profile')
@UseGuards(JwtAuthGuard)
export class PortalProfileController extends BaseController<PortalProfile, CreatePortalProfileDto, UpdatePortalProfileDto> {
  constructor(
    service: PortalProfileService,
    caslFactory: CaslAbilityFactory,
  ) {
    super(service, caslFactory)
  }
}
