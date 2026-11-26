import type { CrewPlanSummary } from '@nyx/schemas'
import type { CrewSolverInput, CrewUsage, SolverDuty } from './crew-solver.calc'

// Shared by CrewSolverService and the worker — see docs/architecture/transit/crew-solver.md.

export interface CrewSolverParams {
  // complete: keep the locked duties and cover the rest; scratch: vehicles only
  base:          'complete' | 'scratch'
  // current: the search starts from the plan's duties (refine them; what they leave without a
  // driver gets duties of its own first); scratch: from a new construction
  start:         'current' | 'scratch'
  direction:     'balanced' | 'fewer_duties' | 'fewer_paid'
  fareCollector: boolean
  assistant:     boolean
  // false: only the construction — the run ends with proposal 1
  optimize:      boolean
  // duties per shift (and SPLIT duties) up to the empresa's active crew — see CrewCapacity
  limitToCrew:   boolean
}

export const DEFAULT_CREW_SOLVER_PARAMS: CrewSolverParams = {
  base: 'complete', start: 'current', direction: 'balanced', fareCollector: false, assistant: false, optimize: true, limitToCrew: true,
}

// where the search started — "Melhorias" count from here
export interface CrewSolverStart {
  from:          'current' | 'construction'
  // duties the construction added for what the plan's duties left without a driver
  filled:        number
  // pieces of the plan's duties left out: stale, or on a block the vehicle plan no longer has
  droppedPieces: number
  // why the plan's duties couldn't be the start (start: current, from: construction)
  fallback:      string | null
  summary:       CrewPlanSummary
}

export interface CrewSolverProposal {
  index:   number
  summary: CrewPlanSummary
  duties:  SolverDuty[]
  // the duties against the active crew — null without limitToCrew
  crew:    CrewUsage | null
}

// worker → host; the host forwards everything but the proposal's duties over SSE
// elapsed / sinceImprovement in ms; bestScore unrounded
export type CrewSolverMessage =
  | { type: 'progress'; elapsed: number; attempts: number; improvements: number; bestScore: number; sinceImprovement: number }
  | { type: 'start'; start: CrewSolverStart }
  | { type: 'proposal'; proposal: CrewSolverProposal }
  // interrupted: the API lost the run (restart) — only a saved run ends so, never a worker
  | { type: 'done'; stopReason: 'finished' | 'user_stopped' | 'max_time' | 'no_improvement' | 'interrupted'; elapsed: number; attempts: number }
  | { type: 'error'; message: string }

// host → worker
export type CrewSolverCommand = { type: 'stop' }

// each worker of a generation searches from its own seed (see CrewSolverService.start)
export interface CrewSolverWorkerData { input: CrewSolverInput; seed: number; optimize: boolean; start: CrewSolverParams['start'] }
