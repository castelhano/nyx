import { Body, Controller, ForbiddenException, HttpCode, Param, ParseEnumPipe, Post, Req, UseGuards } from '@nestjs/common'
import type { AuthUser } from '@nyx/types'
import { DAY_REPAIR_KINDS, type DayRepairKind } from '@nyx/schemas'
import { CaslAbilityFactory } from '../../../../auth/casl.factory'
import { JwtAuthGuard } from '../../../../auth/policies.guard'
import { DayRepairService } from './day-repair.service'

// "Reparar" on the Escala screen — kind: crew (Cobrir tabelas) or vehicles (Encaixar veículos)
@Controller('transit/day-repair')
@UseGuards(JwtAuthGuard)
export class DayRepairController {
  constructor(
    private readonly repairs:     DayRepairService,
    private readonly caslFactory: CaslAbilityFactory,
  ) {}

  @Post(':kind/propose')
  @HttpCode(200)
  async propose(@Req() req: { user?: AuthUser }, @Param('kind', new ParseEnumPipe(DAY_REPAIR_KINDS)) kind: DayRepairKind, @Body() body: unknown) {
    await this.assert(req.user, 'read', body)
    return this.repairs.propose(kind, body)
  }

  @Post(':kind/apply')
  @HttpCode(200)
  async apply(@Req() req: { user?: AuthUser }, @Param('kind', new ParseEnumPipe(DAY_REPAIR_KINDS)) kind: DayRepairKind, @Body() body: unknown) {
    await this.assert(req.user, 'update', body)
    return this.repairs.apply(kind, body, req.user?.id)
  }

  private async assert(user: AuthUser | undefined, action: string, body: unknown): Promise<void> {
    if (!user) return
    const ability = await this.caslFactory.createForUser(user)
    if (!ability.can(action, 'DailyOperation')) throw new ForbiddenException()
    const branchId = (body as { branchId?: string } | null)?.branchId
    if (user.role !== 'admin' && branchId && !user.branchIds.includes(branchId)) throw new ForbiddenException()
  }
}
