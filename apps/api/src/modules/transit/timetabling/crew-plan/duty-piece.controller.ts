import { Controller, Get, HttpCode, Param, Post, Req, UseGuards } from '@nestjs/common'
import type { AuthUser } from '@nyx/types'
import { DutyPiece, CreateDutyPieceDto, UpdateDutyPieceDto } from '@nyx/schemas'
import { BaseController } from '../../../../core/base.controller'
import { CaslAbilityFactory } from '../../../../auth/casl.factory'
import { JwtAuthGuard } from '../../../../auth/policies.guard'
import { DutyPieceService } from './duty-piece.service'

@Controller('transit/duty-piece')
@UseGuards(JwtAuthGuard)
export class DutyPieceController extends BaseController<DutyPiece, CreateDutyPieceDto, UpdateDutyPieceDto> {
  constructor(
    private readonly dutyPieceService: DutyPieceService,
    caslFactory: CaslAbilityFactory,
  ) {
    super(dutyPieceService, caslFactory)
  }

  // block window + valid relief points (the only ones the UI should offer)
  @Get('relief-points/:vehicleBlockId')
  async reliefPoints(@Req() req: { user?: AuthUser }, @Param('vehicleBlockId') vehicleBlockId: string) {
    await this.assertAbility(req.user, 'read')
    return this.dutyPieceService.listReliefPoints(vehicleBlockId)
  }

  // stale piece follows the VehiclePlan edit that broke it (piece-adjust.ts)
  @Post(':id/adjust')
  @HttpCode(200)
  async adjust(@Req() req: { user?: AuthUser }, @Param('id') id: string) {
    await this.assertAbility(req.user, 'update')
    return this.dutyPieceService.adjust(id)
  }

  // every stale piece of the crew plan
  @Post('adjust-plan/:crewPlanId')
  @HttpCode(200)
  async adjustPlan(@Req() req: { user?: AuthUser }, @Param('crewPlanId') crewPlanId: string) {
    await this.assertAbility(req.user, 'update')
    return this.dutyPieceService.adjustPlan(crewPlanId)
  }
}
