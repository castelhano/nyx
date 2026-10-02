import { Controller, Get, Post, Param, Body, Req, Query, Sse, HttpCode, UseGuards, ForbiddenException } from '@nestjs/common'
import type { Observable } from 'rxjs'
import type { AuthUser } from '@nyx/types'
import { CaslAbilityFactory } from '../../../../auth/casl.factory'
import { JwtOrQueryGuard } from '../../../../auth/policies.guard'
import { VehicleSolverService } from './vehicle-solver.service'
import type { VehicleSolverParams } from './vehicle-solver.types'

// Vehicle plan sub-routes for "Otimizar" — starting reads the plan, accepting rewrites its
// blocks in place. JwtOrQueryGuard: the SSE stream passes the JWT as ?token=.
@Controller('transit/vehicle-plan')
@UseGuards(JwtOrQueryGuard)
export class VehicleSolverController {
  constructor(
    private readonly solver:      VehicleSolverService,
    private readonly caslFactory: CaslAbilityFactory,
  ) {}

  @Post(':id/solver/start')
  @HttpCode(200)
  async start(@Req() req: { user?: AuthUser }, @Param('id') id: string, @Body() body: { jobId: string; params?: Partial<VehicleSolverParams> }) {
    await this.assert(req.user, 'update')
    await this.solver.start(id, body?.jobId, body?.params, req.user)
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
    return { job: await this.solver.getCurrent(id) }
  }

  @Post(':id/solver/discard')
  @HttpCode(200)
  async discard(@Req() req: { user?: AuthUser }, @Param('id') id: string, @Body('jobId') jobId: string) {
    await this.assert(req.user, 'update')
    this.solver.discard(id, jobId)
    return { ok: true }
  }

  @Post(':id/solver/accept')
  @HttpCode(200)
  async accept(@Req() req: { user?: AuthUser }, @Param('id') id: string, @Body('jobId') jobId: string) {
    await this.assert(req.user, 'update')
    await this.solver.accept(id, jobId, req.user)
    return { ok: true }
  }

  private async assert(user: AuthUser | undefined, action: string): Promise<void> {
    if (!user) return
    const ability = await this.caslFactory.createForUser(user)
    if (!ability.can(action, 'VehiclePlan')) throw new ForbiddenException()
  }
}
