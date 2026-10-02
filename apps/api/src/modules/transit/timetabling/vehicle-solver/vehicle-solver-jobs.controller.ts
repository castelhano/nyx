import { Controller, Get, Req, UseGuards, ForbiddenException } from '@nestjs/common'
import type { AuthUser } from '@nyx/types'
import { CaslAbilityFactory } from '../../../../auth/casl.factory'
import { JwtOrQueryGuard } from '../../../../auth/policies.guard'
import { VehicleSolverService } from './vehicle-solver.service'

// App-wide list of vehicle solver generations (running or waiting to be used) — the topbar's
// background generations indicator. Its own prefix: under transit/vehicle-plan it would sit
// next to the plan's `:id` routes.
@Controller('transit/vehicle-solver')
@UseGuards(JwtOrQueryGuard)
export class VehicleSolverJobsController {
  constructor(
    private readonly solver:      VehicleSolverService,
    private readonly caslFactory: CaslAbilityFactory,
  ) {}

  @Get('jobs')
  async jobs(@Req() req: { user?: AuthUser }) {
    if (req.user) {
      const ability = await this.caslFactory.createForUser(req.user)
      if (!ability.can('read', 'VehiclePlan')) throw new ForbiddenException()
    }
    return { jobs: await this.solver.listJobs() }
  }
}
