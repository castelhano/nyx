export interface FlatCriterionConfig {
  active:    boolean
  direction: 'minimize' | 'maximize'
  weight:    number
}

export interface RangeCriterionConfig {
  active:   boolean
  modifier: number
  floor:    number
  idealMin: number
  idealMax: number
  ceiling:  number
}

export interface SolverPlanningConfig {
  operationalDayStartHour:  number
  demandModifier:           number
  stopNoImprovementMinutes: number
  stopMaxTotalMinutes:      number
  flat: {
    fleetUsage:           FlatCriterionConfig
    deadrunKm:            FlatCriterionConfig
    totalKm:              FlatCriterionConfig
    distributionVariance: FlatCriterionConfig
    specialFleetUsage:    FlatCriterionConfig
    driverUsage:          FlatCriterionConfig
    overtime:             FlatCriterionConfig
  }
  range: {
    lineTransfer: RangeCriterionConfig
    tripInterval: RangeCriterionConfig
    deadrunRatio: RangeCriterionConfig
  }
}

export interface SolverTrip {
  id:                    string
  lineId:                string
  originLocalityId:      string
  destinationLocalityId: string
  departureMinutes:      number
  arrivalMinutes:        number
  requiredVehicleType:   string | null
  constraints:           { locked?: string[]; pinnedBlock?: string } | null
}

export interface SolverMatrixEntry {
  minutes: number
  km:      number
}

export interface SolverInitialBlock {
  depotId:     string
  vehicleType: string
  tripIds:     string[]  // ordered by sequence
}

export interface SolverConfig {
  planId:        string
  config:        SolverPlanningConfig
  trips:         SolverTrip[]
  matrix:        Record<string, SolverMatrixEntry>
  depots:        string[]
  initialBlocks: SolverInitialBlock[]  // existing arrangement; empty = use greedy from scratch
}

export interface SolverBlockTrip {
  tripId:          string
  sequence:        number
  isDeadhead:      boolean
  deadheadMinutes: number
  deadheadKm:      number
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
