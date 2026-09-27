import { Controller, Get, Post, Param, Body, Req, Query, Sse, HttpCode, UseGuards, ForbiddenException } from '@nestjs/common'
import type { Observable } from 'rxjs'
import type { AuthUser } from '@nyx/types'
import { CaslAbilityFactory } from '../../../../auth/casl.factory'
import { JwtOrQueryGuard } from '../../../../auth/policies.guard'
import { CrewSolverService } from './crew-solver.service'
import type { CrewSolverParams } from './crew-solver.types'

// Crew plan sub-routes for "Otimizar › Gerar escala" — starting reads the plan, accepting
// creates a new crew plan version. JwtOrQueryGuard: the SSE stream passes the JWT as ?token=.
@Controller('transit/crew-plan')
@UseGuards(JwtOrQueryGuard)
export class CrewSolverController {
  constructor(
    private readonly solver:      CrewSolverService,
    private readonly caslFactory: CaslAbilityFactory,
  ) {}

  @Post(':id/solver/start')
  @HttpCode(200)
  async start(@Req() req: { user?: AuthUser }, @Param('id') id: string, @Body() body: { jobId: string; params?: Partial<CrewSolverParams> }) {
    await this.assert(req.user, 'create')
    await this.solver.start(id, body?.jobId, body?.params)
    return { ok: true }
  }

  @Sse(':id/solver/stream')
  stream(@Query('jobId') jobId: string): Observable<{ data: string }> {
    return this.solver.stream(jobId)
  }

  @Post(':id/solver/stop')
  @HttpCode(200)
  stop(@Body('jobId') jobId: string) {
    this.solver.stop(jobId)
    return { ok: true }
  }

  // the plan's generation — running or ended and not yet used — so the screen can pick it up
  @Get(':id/solver/current')
  async current(@Req() req: { user?: AuthUser }, @Param('id') id: string) {
    await this.assert(req.user, 'read')
    return { job: this.solver.getCurrent(id) }
  }

  @Post(':id/solver/discard')
  @HttpCode(200)
  async discard(@Req() req: { user?: AuthUser }, @Param('id') id: string, @Body('jobId') jobId: string) {
    await this.assert(req.user, 'create')
    this.solver.discard(id, jobId)
    return { ok: true }
  }

  @Post(':id/solver/accept')
  @HttpCode(200)
  async accept(@Req() req: { user?: AuthUser }, @Param('id') id: string, @Body() body: { jobId: string; description?: string }) {
    await this.assert(req.user, 'create')
    return this.solver.accept(id, body?.jobId, body?.description)
  }

  private async assert(user: AuthUser | undefined, action: string): Promise<void> {
    if (!user) return
    const ability = await this.caslFactory.createForUser(user)
    if (!ability.can(action, 'CrewPlan')) throw new ForbiddenException()
  }
}
