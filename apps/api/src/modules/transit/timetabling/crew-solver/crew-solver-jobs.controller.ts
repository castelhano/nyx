import { Controller, Get, Req, UseGuards, ForbiddenException } from '@nestjs/common'
import type { AuthUser } from '@nyx/types'
import { CaslAbilityFactory } from '../../../../auth/casl.factory'
import { JwtOrQueryGuard } from '../../../../auth/policies.guard'
import { CrewSolverService } from './crew-solver.service'

// App-wide list of crew solver generations (running or waiting to be used) — the topbar's
// background generations indicator. Its own prefix: under transit/crew-plan it would sit next
// to the crew plan's `:id` routes.
@Controller('transit/crew-solver')
@UseGuards(JwtOrQueryGuard)
export class CrewSolverJobsController {
  constructor(
    private readonly solver:      CrewSolverService,
    private readonly caslFactory: CaslAbilityFactory,
  ) {}

  @Get('jobs')
  async jobs(@Req() req: { user?: AuthUser }) {
    if (req.user) {
      const ability = await this.caslFactory.createForUser(req.user)
      if (!ability.can('read', 'CrewPlan')) throw new ForbiddenException()
    }
    return { jobs: await this.solver.listJobs() }
  }
}
