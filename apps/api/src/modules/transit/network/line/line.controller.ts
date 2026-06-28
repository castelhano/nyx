import { Controller, Get, Post, Body, UseGuards } from '@nestjs/common'
import { Line, CreateLineDto, UpdateLineDto } from '@nyx/schemas'
import { BaseController } from '../../../../core/base.controller'
import { CaslAbilityFactory } from '../../../../auth/casl.factory'
import { JwtAuthGuard } from '../../../../auth/policies.guard'
import { LineService } from './line.service'

@Controller('transit/transit-line')
@UseGuards(JwtAuthGuard)
export class LineController extends BaseController<Line, CreateLineDto, UpdateLineDto> {
  constructor(
    private readonly lineService: LineService,
    caslFactory: CaslAbilityFactory,
  ) {
    super(lineService, caslFactory)
  }

  @Get('extension-review')
  reviewExtensions() {
    return this.lineService.reviewExtensions()
  }

  @Post('extension-review/apply')
  applyExtensions(
    @Body() body: { updates: Array<{ lineId: string; direction: string; computedKm: number }> },
  ) {
    return this.lineService.applyExtensions(body.updates ?? [])
  }

  @Post('demand/apply')
  applyDemand(
    @Body() body: {
      dayTypeCode: string
      updates: Array<{ lineId: string; demand: Record<string, Record<string, number>> }>
    },
  ) {
    return this.lineService.applyDemand(body.dayTypeCode ?? '', body.updates ?? [])
  }
}
