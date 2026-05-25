import { Controller, UseGuards } from '@nestjs/common'
import { RouteLocality, CreateRouteLocalityDto, UpdateRouteLocalityDto } from '@nyx/schemas'
import { BaseController } from '../../../../core/base.controller'
import { CaslAbilityFactory } from '../../../../auth/casl.factory'
import { JwtAuthGuard } from '../../../../auth/policies.guard'
import { RouteLocalityService } from './route-locality.service'

@Controller('transit/route-locality')
@UseGuards(JwtAuthGuard)
export class RouteLocalityController extends BaseController<RouteLocality, CreateRouteLocalityDto, UpdateRouteLocalityDto> {
  constructor(
    private readonly routeLocalityService: RouteLocalityService,
    caslFactory: CaslAbilityFactory,
  ) {
    super(routeLocalityService, caslFactory)
  }
}
