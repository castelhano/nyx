import { Body, Controller, ForbiddenException, Get, HttpCode, Post, Query, Req, Sse, UseGuards } from '@nestjs/common'
import type { Observable } from 'rxjs'
import type { AuthUser } from '@nyx/types'
import { CaslAbilityFactory } from '../../../../auth/casl.factory'
import { JwtOrQueryGuard } from '../../../../auth/policies.guard'
import { RosterGeneratorService } from './roster-generator.service'

// "Gerar escala" — JwtOrQueryGuard: the SSE stream passes the JWT as ?token=
@Controller('transit/roster-generator')
@UseGuards(JwtOrQueryGuard)
export class RosterGeneratorController {
  constructor(
    private readonly generator:   RosterGeneratorService,
    private readonly caslFactory: CaslAbilityFactory,
  ) {}

  @Post('start')
  @HttpCode(200)
  async start(@Req() req: { user?: AuthUser }, @Body() body: { jobId: string; params: unknown }) {
    await this.assert(req.user, 'update')
    this.generator.start(body?.jobId, body?.params)
    return { ok: true }
  }

  @Sse('stream')
  stream(@Query('jobId') jobId: string): Observable<{ data: string }> {
    return this.generator.stream(jobId)
  }

  @Post('stop')
  @HttpCode(200)
  stop(@Body('jobId') jobId: string) {
    this.generator.stop(jobId)
    return { ok: true }
  }

  @Get('current')
  async current(@Req() req: { user?: AuthUser }, @Query('branchId') branchId: string, @Query('role') role: string) {
    await this.assert(req.user, 'read')
    return { job: this.generator.getCurrent(branchId, role || 'DRIVER') }
  }

  @Get('proposal')
  async proposal(@Req() req: { user?: AuthUser }, @Query('jobId') jobId: string) {
    await this.assert(req.user, 'read')
    return { proposal: this.generator.getProposal(jobId) }
  }

  @Post('discard')
  @HttpCode(200)
  async discard(@Req() req: { user?: AuthUser }, @Body('jobId') jobId: string) {
    await this.assert(req.user, 'update')
    this.generator.discard(jobId)
    return { ok: true }
  }

  @Post('accept')
  @HttpCode(200)
  async accept(@Req() req: { user?: AuthUser }, @Body('jobId') jobId: string) {
    await this.assert(req.user, 'update')
    return this.generator.accept(jobId)
  }

  private async assert(user: AuthUser | undefined, action: string): Promise<void> {
    if (!user) return
    const ability = await this.caslFactory.createForUser(user)
    if (!ability.can(action, 'DailyOperation')) throw new ForbiddenException()
  }
}
