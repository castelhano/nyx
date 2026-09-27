import { Module } from '@nestjs/common'
import { CrewSolverController } from './crew-solver.controller'
import { CrewSolverJobsController } from './crew-solver-jobs.controller'
import { CrewSolverService } from './crew-solver.service'
import { CrewPlanModule } from '../crew-plan/crew-plan.module'
import { CaslModule } from '../../../../auth/casl.module'

@Module({
  imports:     [CrewPlanModule, CaslModule],
  controllers: [CrewSolverController, CrewSolverJobsController],
  providers:   [CrewSolverService],
})
export class CrewSolverModule {}
