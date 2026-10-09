import type { CrewPlanSummary } from '@nyx/schemas'
import type { CrewSolverInput, SolverDuty } from './crew-solver.calc'

// Shared by CrewSolverService and the worker — see docs/architecture/transit/crew-solver.md.

export interface CrewSolverParams {
  // complete: keep the locked duties and cover the rest; scratch: vehicles only
  base:          'complete' | 'scratch'
  direction:     'balanced' | 'fewer_duties' | 'fewer_paid'
  fareCollector: boolean
  assistant:     boolean
  // false: only the construction — the run ends with proposal 1
  optimize:      boolean
}

export const DEFAULT_CREW_SOLVER_PARAMS: CrewSolverParams = {
  base: 'complete', direction: 'balanced', fareCollector: false, assistant: false, optimize: true,
}

export interface CrewSolverProposal {
  index:   number
  summary: CrewPlanSummary
  duties:  SolverDuty[]
}

// worker → host; the host forwards everything but the proposal's duties over SSE
// elapsed / sinceImprovement in ms; bestScore unrounded
export type CrewSolverMessage =
  | { type: 'progress'; elapsed: number; attempts: number; improvements: number; bestScore: number; sinceImprovement: number }
  | { type: 'proposal'; proposal: CrewSolverProposal }
  | { type: 'done'; stopReason: 'finished' | 'user_stopped' | 'max_time' | 'no_improvement'; elapsed: number; attempts: number }
  | { type: 'error'; message: string }

// host → worker
export type CrewSolverCommand = { type: 'stop' }

// each worker of a generation searches from its own seed (see CrewSolverService.start)
export interface CrewSolverWorkerData { input: CrewSolverInput; seed: number; optimize: boolean }
