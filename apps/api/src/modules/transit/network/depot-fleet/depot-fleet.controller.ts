import { Controller, UseGuards } from '@nestjs/common'
import { DepotFleet, CreateDepotFleetDto, UpdateDepotFleetDto } from '@nyx/schemas'
import { BaseController } from '../../../../core/base.controller'
import { CaslAbilityFactory } from '../../../../auth/casl.factory'
import { JwtAuthGuard } from '../../../../auth/policies.guard'
import { DepotFleetService } from './depot-fleet.service'

@Controller('transit/depot-fleet')
@UseGuards(JwtAuthGuard)
export class DepotFleetController extends BaseController<DepotFleet, CreateDepotFleetDto, UpdateDepotFleetDto> {
  constructor(
    private readonly depotFleetService: DepotFleetService,
    caslFactory: CaslAbilityFactory,
  ) {
    super(depotFleetService, caslFactory)
  }
}
