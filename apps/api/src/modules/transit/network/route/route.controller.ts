import { Controller, UseGuards } from '@nestjs/common'
import { Route, CreateRouteDto, UpdateRouteDto } from '@nyx/schemas'
import { BaseController } from '../../../../core/base.controller'
import { CaslAbilityFactory } from '../../../../auth/casl.factory'
import { JwtAuthGuard } from '../../../../auth/policies.guard'
import { RouteService } from './route.service'

@Controller('transit/transit-route')
@UseGuards(JwtAuthGuard)
export class RouteController extends BaseController<Route, CreateRouteDto, UpdateRouteDto> {
  constructor(
    routeService: RouteService,
    caslFactory: CaslAbilityFactory,
  ) {
    super(routeService, caslFactory)
  }
}
