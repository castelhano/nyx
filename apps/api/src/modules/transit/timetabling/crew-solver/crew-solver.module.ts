import { Module } from '@nestjs/common'
import { CrewSolverController } from './crew-solver.controller'
import { CrewSolverService } from './crew-solver.service'
import { CrewPlanModule } from '../crew-plan/crew-plan.module'
import { CaslModule } from '../../../../auth/casl.module'

@Module({
  imports:     [CrewPlanModule, CaslModule],
  controllers: [CrewSolverController],
  providers:   [CrewSolverService],
})
export class CrewSolverModule {}
