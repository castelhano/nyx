import type { VehicleTypeValue } from '@nyx/schemas'
import type { VehicleSolverInput } from './vehicle-solver.calc'

// Shared by VehicleSolverService and the worker — see docs/architecture/transit/solver.md.

// the locked blocks always stay as they are; the rest is rebuilt
export interface VehicleSolverParams {
  // current: the search starts from the plan's blocks (refine them); scratch: from a new
  // construction (after a settings change, or to get away from the current structure)
  start:     'current' | 'scratch'
  direction: 'balanced' | 'fleet' | 'km'
}

export const DEFAULT_VEHICLE_SOLVER_PARAMS: VehicleSolverParams = { start: 'current', direction: 'balanced' }

// where the search started — "Melhorias" count from here
export interface VehicleSolverStart {
  from:        'current' | 'construction'
  // links of the plan's blocks the rules don't take ("F01 16:20 → 309 16:44"): each one splits
  // its block in two — a vehicle more
  brokenLinks: string[]
  // why the plan's blocks couldn't be the start (start: current, from: construction)
  fallback:    string | null
  summary:     VehicleSolverSummary
}

export type DeadrunKind = 'ACCESS' | 'RETURN' | 'DISPLACEMENT'

// a block as it would be persisted: trips in order, the deadruns and intervals around them
export interface ProposalBlock {
  depotId:     string
  branchId:    string | null
  vehicleType: VehicleTypeValue
  tripIds:     string[]
  // bundleId: a trip group's own rows keep their group
  deadruns:    { type: DeadrunKind; originLocalityId: string; destinationLocalityId: string; departureMinutes: number; arrivalMinutes: number; bundleId?: string }[]
  // intervalTypeId: kept from a trip group's own intervals; absent = the default interval type
  intervals:   { departureMinutes: number; arrivalMinutes: number; intervalTypeId?: string; bundleId?: string }[]
}

// What the Cenários tab compares — for the proposal and for the plan as it is
export interface VehicleSolverSummary {
  score:        number
  fleetCount:   number
  deadrunKm:    number
  productiveKm: number
  totalKm:      number
  // blocks with modeling issues (validateBlock)
  issueBlocks:  number
  byBranch:     { branchId: string | null; fleet: number; km: number }[]
  byDepot:      { depotId: string; vehicleType: VehicleTypeValue; fleet: number }[]
  // what each criterion costs: weight and value (0–1) — loss = weight × (1 − value) ÷ Σ weights
  criteria:     { key: string; weight: number; value: number }[]
}

export interface VehicleSolverProposal {
  index:   number
  summary: VehicleSolverSummary
  // what the search optimizes (raw score under the direction's settings) — ranks the proposals
  // of a generation's searches
  rank:    number
  // the rebuilt blocks only — the locked ones stay as they are
  blocks:  ProposalBlock[]
}

// worker → host; the host forwards everything but the proposal's blocks over SSE
// elapsed / sinceImprovement in ms; bestScore unrounded
export type VehicleSolverMessage =
  | { type: 'progress'; elapsed: number; attempts: number; improvements: number; bestScore: number; sinceImprovement: number }
  | { type: 'start'; start: VehicleSolverStart }
  | { type: 'proposal'; proposal: VehicleSolverProposal }
  // interrupted: the API lost the run (restart) — only a saved run ends so, never a worker
  | { type: 'done'; stopReason: 'finished' | 'user_stopped' | 'max_time' | 'no_improvement' | 'interrupted'; elapsed: number; attempts: number }
  | { type: 'error'; message: string }

// host → worker
export type VehicleSolverCommand = { type: 'stop' }

// each worker of a generation searches from its own seed (see VehicleSolverService.start)
export interface VehicleSolverWorkerData { input: VehicleSolverInput; seed: number }
