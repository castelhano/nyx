import type { VehicleTypeValue } from '@nyx/schemas'

// Shared by VehicleSolverService and the worker — see docs/architecture/transit/solver.md.

export interface VehicleSolverParams {
  // complete: keep the locked blocks and rebuild the rest; scratch: rebuild every block
  base:      'complete' | 'scratch'
  direction: 'balanced' | 'fleet' | 'km'
}

export const DEFAULT_VEHICLE_SOLVER_PARAMS: VehicleSolverParams = { base: 'complete', direction: 'balanced' }

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
  // the rebuilt blocks only — the locked ones stay as they are
  blocks:  ProposalBlock[]
}

// worker → host; the host forwards everything but the proposal's blocks over SSE
// elapsed / sinceImprovement in ms; bestScore unrounded
export type VehicleSolverMessage =
  | { type: 'progress'; elapsed: number; attempts: number; improvements: number; bestScore: number; sinceImprovement: number }
  | { type: 'proposal'; proposal: VehicleSolverProposal }
  | { type: 'done'; stopReason: 'finished' | 'user_stopped' | 'max_time' | 'no_improvement'; elapsed: number; attempts: number }
  | { type: 'error'; message: string }

// host → worker
export type VehicleSolverCommand = { type: 'stop' }
