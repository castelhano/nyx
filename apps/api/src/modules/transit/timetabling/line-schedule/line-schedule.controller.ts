import { Controller, Post, Param, Body, UseGuards, HttpCode } from '@nestjs/common'
import { LineSchedule, CreateLineScheduleDto, UpdateLineScheduleDto } from '@nyx/schemas'
import { BaseController } from '../../../../core/base.controller'
import { CaslAbilityFactory } from '../../../../auth/casl.factory'
import { JwtAuthGuard } from '../../../../auth/policies.guard'
import { LineScheduleService } from './line-schedule.service'

@Controller('transit/line-schedule')
@UseGuards(JwtAuthGuard)
export class LineScheduleController extends BaseController<LineSchedule, CreateLineScheduleDto, UpdateLineScheduleDto> {
  constructor(
    private readonly lineScheduleService: LineScheduleService,
    caslFactory: CaslAbilityFactory,
  ) {
    super(lineScheduleService, caslFactory)
  }

  @Post(':id/duplicate')
  @HttpCode(201)
  duplicate(@Param('id') id: string) {
    return this.lineScheduleService.duplicate(id)
  }

  @Post(':id/approve')
  @HttpCode(200)
  approve(@Param('id') id: string, @Body('force') force: boolean) {
    return this.lineScheduleService.approve(id, force ?? false)
  }
}
