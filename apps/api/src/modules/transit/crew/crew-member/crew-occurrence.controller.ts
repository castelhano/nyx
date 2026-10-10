import { Body, Controller, Param, Patch, Post, Req, UseGuards } from '@nestjs/common'
import { CrewOccurrence, CreateCrewOccurrenceDto, UpdateCrewOccurrenceDto } from '@nyx/schemas'
import type { AuthUser } from '@nyx/types'
import { BaseController } from '../../../../core/base.controller'
import { CaslAbilityFactory } from '../../../../auth/casl.factory'
import { JwtAuthGuard } from '../../../../auth/policies.guard'
import { CrewOccurrenceService } from './crew-occurrence.service'

@Controller('transit/crew-occurrence')
@UseGuards(JwtAuthGuard)
export class CrewOccurrenceController extends BaseController<CrewOccurrence, CreateCrewOccurrenceDto, UpdateCrewOccurrenceDto> {
  constructor(
    private readonly occurrences: CrewOccurrenceService,
    caslFactory: CaslAbilityFactory,
  ) {
    super(occurrences, caslFactory)
  }

  // the user is recorded as who launched / reviewed it
  @Post()
  override async create(@Req() req: { user?: AuthUser }, @Body() dto: CreateCrewOccurrenceDto): Promise<CrewOccurrence> {
    await this.assertAbility(req.user, 'create')
    return this.occurrences.createAs(dto, req.user?.id)
  }

  @Patch(':id')
  override async update(@Req() req: { user?: AuthUser }, @Param('id') id: string, @Body() dto: UpdateCrewOccurrenceDto): Promise<CrewOccurrence> {
    await this.assertAbility(req.user, 'update')
    return this.occurrences.updateAs(id, dto, req.user?.id)
  }
}
