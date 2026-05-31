export interface SolverPlanningConfig {
  minLayoverMinutes: number
  maxLayoverMinutes: number
  maxDeadrunSoftMinutes: number
  maxDeadrunHardMinutes: number
  blockDurationMinMinutes: number
  blockDurationIdealMinMinutes: number
  blockDurationIdealMaxMinutes: number
  blockDurationMaxMinutes: number
  weightMinimizeFleet: number
  weightMinimizeDeadrun: number
  weightBlockDuration: number
  stopNoImprovementMinutes: number
  stopMaxTotalMinutes: number
}

export interface SolverTrip {
  id: string
  originLocalityId: string
  destinationLocalityId: string
  departureMinutes: number
  arrivalMinutes: number
  requiredVehicleType: string | null
  constraints: { locked?: string[]; pinnedBlock?: string } | null
}

export interface SolverMatrixEntry {
  minutes: number
  km: number
}

export interface SolverConfig {
  planId: string
  config: SolverPlanningConfig
  trips: SolverTrip[]
  matrix: Record<string, SolverMatrixEntry>
  depots: string[]
}

export interface SolverBlockTrip {
  tripId: string
  sequence: number
  isDeadhead: boolean
  deadheadMinutes: number
  deadheadKm: number
}

export interface SolverBlock {
  blockNumber:       number
  depotId:           string
  vehicleType:       string
  trips:             SolverBlockTrip[]
  totalMinutes:      number
  productiveMinutes: number
  deadrunMinutes:    number
  totalKm:           number
  productiveKm:      number
  deadrunKm:         number
}

export interface SolverResult {
  blocks:            SolverBlock[]
  score:             number
  fleetCount:        number
  deadrunKm:         number
  productiveKm:      number
  totalKm:           number
  deadrunMinutes:    number
  productiveMinutes: number
  totalMinutes:      number
}

export type SolverMessage =
  | { type: 'progress'; attempt: number; bestScore: number; bestFleet: number; deadrunKm: number; elapsed: number }
  | { type: 'improvement'; scenario: SolverResult }
  | { type: 'done'; stopReason: 'no_improvement' | 'max_time' | 'user_stopped' }

export type WorkerCommand = { type: 'stop' }
