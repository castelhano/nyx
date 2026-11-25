import { Module } from '@nestjs/common'
import { SolverRunStore } from './solver-run.store'

@Module({
  providers: [SolverRunStore],
  exports:   [SolverRunStore],
})
export class SolverRunModule {}
