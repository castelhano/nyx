import { Body, Controller, HttpCode, Post, Req, UseGuards } from '@nestjs/common'
import { LineRevision, CreateLineRevisionDto, UpdateLineRevisionDto } from '@nyx/schemas'
import type { AuthUser } from '@nyx/types'
import { BaseController } from '../../../../core/base.controller'
import { CaslAbilityFactory } from '../../../../auth/casl.factory'
import { JwtAuthGuard } from '../../../../auth/policies.guard'
import { LineRevisionService } from './line-revision.service'

@Controller('transit/line-revision')
@UseGuards(JwtAuthGuard)
export class LineRevisionController extends BaseController<LineRevision, CreateLineRevisionDto, UpdateLineRevisionDto> {
  constructor(
    private readonly lineRevisionService: LineRevisionService,
    caslFactory: CaslAbilityFactory,
  ) {
    super(lineRevisionService, caslFactory)
  }

  // the route screen's "Registrar alteração" — creates or merges into the revision of the date
  @Post('register')
  @HttpCode(200)
  async register(@Req() req: { user?: AuthUser }, @Body() body: unknown): Promise<LineRevision> {
    await this.assertAbility(req.user, 'create')
    return this.lineRevisionService.register(body)
  }
}
