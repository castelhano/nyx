import { Controller, Get, Param, Req, UseGuards } from '@nestjs/common'
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
}
