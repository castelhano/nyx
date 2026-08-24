import { Controller, Delete, Param, Query, Req, UseGuards } from '@nestjs/common'
import type { AuthUser } from '@nyx/types'
import { Trip, CreateTripDto, UpdateTripDto } from '@nyx/schemas'
import { BaseController } from '../../../../core/base.controller'
import { CaslAbilityFactory } from '../../../../auth/casl.factory'
import { JwtAuthGuard } from '../../../../auth/policies.guard'
import { TripService } from './trip.service'

@Controller('transit/transit-trip')
@UseGuards(JwtAuthGuard)
export class TripController extends BaseController<Trip, CreateTripDto, UpdateTripDto> {
  constructor(
    private readonly tripService: TripService,
    caslFactory: CaslAbilityFactory,
  ) {
    super(tripService, caslFactory)
  }

  // Overrides BaseController's generic delete just to pass skipScore through —
  // used by the Gantt Save flow, which deletes many trips in a batch and does a
  // single rescore at the end (see VehiclePlanController.rescore).
  @Delete(':id')
  override async remove(
    @Req() req: { user?: AuthUser },
    @Param('id') id: string,
    @Query('skipScore') skipScore?: string,
  ): Promise<void> {
    await this.assertAbility(req.user, 'delete')
    return this.tripService.remove(id, { skipScore: skipScore === 'true' })
  }
}
