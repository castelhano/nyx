import type { CrewPlanSummary } from '@nyx/schemas'
import type { CrewSolverInput, SolverDuty } from './crew-solver.calc'

// Shared by CrewSolverService and the worker — see docs/proposal/plan_crew_solver_v1.md.

export interface CrewSolverParams {
  // complete: keep the locked duties and cover the rest; scratch: vehicles only
  base:          'complete' | 'scratch'
  direction:     'balanced' | 'fewer_duties' | 'fewer_paid'
  fareCollector: boolean
  assistant:     boolean
}

export const DEFAULT_CREW_SOLVER_PARAMS: CrewSolverParams = {
  base: 'complete', direction: 'balanced', fareCollector: false, assistant: false,
}

export interface CrewSolverProposal {
  index:   number
  summary: CrewPlanSummary
  duties:  SolverDuty[]
}

// worker → host; the host forwards everything but the proposal's duties over SSE
export type CrewSolverMessage =
  | { type: 'progress'; elapsed: number; attempts: number; bestScore: number }
  | { type: 'proposal'; proposal: CrewSolverProposal }
  | { type: 'done'; stopReason: 'finished' | 'user_stopped'; elapsed: number }
  | { type: 'error'; message: string }

export type CrewSolverWorkerData = CrewSolverInput
