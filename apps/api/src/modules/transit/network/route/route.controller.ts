import { Controller, Get, Post, Req, Body, Param, UseGuards, HttpCode, Logger } from '@nestjs/common'
import { Route, CreateRouteDto, UpdateRouteDto } from '@nyx/schemas'
import { BaseController } from '../../../../core/base.controller'
import { CaslAbilityFactory } from '../../../../auth/casl.factory'
import { JwtAuthGuard } from '../../../../auth/policies.guard'
import type { AuthUser } from '@nyx/types'
import { RouteService } from './route.service'

@Controller('transit/transit-route')
@UseGuards(JwtAuthGuard)
export class RouteController extends BaseController<Route, CreateRouteDto, UpdateRouteDto> {
  private readonly logger = new Logger(RouteController.name)

  constructor(
    private readonly routeService: RouteService,
    caslFactory: CaslAbilityFactory,
  ) {
    super(routeService, caslFactory)
  }

  @Post()
  override async create(@Req() req: { user?: AuthUser }, @Body() dto: CreateRouteDto): Promise<Route> {
    const route = await super.create(req, dto)
    const created = route as unknown as { id: string; originLocalityId: string; destinationLocalityId: string }
    this.routeService
      .buildInitialTrajectory(created.id, created.originLocalityId, created.destinationLocalityId)
      .catch((err) => this.logger.error(`buildInitialTrajectory failed for route ${created.id}: ${err.message}`))
    return route
  }

  @Get(':id/trajectory')
  getTrajectory(@Param('id') id: string) {
    return this.routeService.getTrajectory(id)
  }

  @Post(':id/reprocess')
  @HttpCode(200)
  async reprocess(@Param('id') id: string, @Body() body?: { forceAll?: boolean }) {
    await this.routeService.reprocess(id, { forceAll: body?.forceAll })
    return { ok: true }
  }

  @Post(':id/suggest-localities')
  @HttpCode(200)
  suggestLocalities(@Param('id') id: string) {
    return this.routeService.suggestLocalities(id)
  }
}
