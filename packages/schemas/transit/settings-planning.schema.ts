import { z } from 'zod'
import { withMeta } from '../with-meta'

// Banded reward — value maps to [0,1] via floor/idealMin/idealMax/ceiling, weighted
// by `modifier` in the score's weighted average. Used both for criteria with a fixed
// universal acceptable range (lineTransfer, deadrunRatio...) and for criteria
// expressed as a self-contained ratio/coefficient of variation (distributionVariance,
// preferredVehicleType) — see docs/proposal/vehicle_plan_score_formula_v1.md §4.3.
export const rangeCriterionSchema = z.object({
  active:   z.boolean(),
  modifier: z.number().min(0).max(100),
  floor:    z.number().min(0),
  idealMin: z.number().min(0),
  idealMax: z.number().min(0),
  ceiling:  z.number().min(0),
})

// Banded reward whose floor is never a config constant — it's inferred at runtime
// from the plan/line being scored (theoretical minimum km, peak vehicle requirement).
// idealMax/ceiling are expressed as % over that inferred floor, not absolute values —
// see docs/proposal/vehicle_plan_score_formula_v1.md §6.2.
export const anchoredCriterionSchema = z.object({
  active:              z.boolean(),
  idealMaxOverPercent: z.number().min(0),
  ceilingOverPercent:  z.number().min(0),
  weight:              z.number().min(0),
})

const rangeDefault = {
  lineTransfer:         { active: true, modifier: 15, floor: 0,   idealMin: 0,   idealMax: 0,   ceiling: 4   },
  deadrunRatio:         { active: true, modifier: 15, floor: 0,   idealMin: 0,   idealMax: 10,  ceiling: 25  },
  minBlockDuration:     { active: true, modifier: 8,  floor: 180, idealMin: 420, idealMax: 900, ceiling: 1080 },
  // coefficient of variation of block duration (%) — replaces the old flat stdDev
  distributionVariance: { active: true, modifier: 20, floor: 0,   idealMin: 0,   idealMax: 20,  ceiling: 60  },
  // % of the trips of lines with a preferred vehicle type (TransitLine.vehicleTypes) running
  // in another type — the required type is a hard rule of the solver, not a criterion
  preferredVehicleType: { active: true, modifier: 10, floor: 0,   idealMin: 0,   idealMax: 0,   ceiling: 30  },
  // largest gap (p.p.) between an operator's share of the fleet and its ScopeOperator.share,
  // among the operators with a share (normalized over them) — docs/proposal/plan_vehicle_solver_v2.md
  operatorShareFleet:   { active: true, modifier: 20, floor: 0,   idealMin: 0,   idealMax: 2,   ceiling: 10  },
  // same, over total km
  operatorShareKm:      { active: true, modifier: 10, floor: 0,   idealMin: 0,   idealMax: 3,   ceiling: 15  },
}

const anchoredDefault = {
  // realized totalKm / theoretical minimum (= sum of trip km, deadrun zero)
  totalKm:    { active: true, idealMaxOverPercent: 10, ceilingOverPercent: 40, weight: 15 },
  // realized fleetCount / theoretical minimum (peak vehicle requirement)
  fleetUsage: { active: true, idealMaxOverPercent: 5,  ceilingOverPercent: 30, weight: 30 },
}

// Criteria scoped to a single line's own operation — never influenced by
// interlining/reuse decisions across lines (those are plan-level, see §2.1 of the
// proposal doc). Independent weighted-average pool from the plan-level one above.
const lineDefault = {
  // hourly occupancy (demand/supply), banded both sides, evaluated per direction
  demandMatch:          { active: true, modifier: 25, floor: 0, idealMin: 50, idealMax: 90,  ceiling: 130 },
  // coefficient of variation of headway gaps within a direction (%)
  headwayRegularity:    { active: true, modifier: 20, floor: 0, idealMin: 0,  idealMax: 25,  ceiling: 70  },
  // largest gap between consecutive departures, minutes
  maxGap:               { active: true, modifier: 15, floor: 0, idealMin: 0,  idealMax: 60,  ceiling: 180 },
  // peak-hour supply share vs peak-hour demand share, % (100 = perfectly matched)
  peakConcentration:    { active: true, modifier: 15, floor: 0, idealMin: 80, idealMax: 120, ceiling: 200 },
  // coefficient of variation of km/vehicle contributed to this line (%)
  distributionVariance: { active: true, modifier: 15, floor: 0, idealMin: 0,  idealMax: 20,  ceiling: 60  },
  // realized fleetSize / theoretical minimum (peak vehicle requirement, this line only)
  fleetUsage:           { active: true, idealMaxOverPercent: 10, ceilingOverPercent: 50, weight: 25 },
}

export const planningSettingsSchema = withMeta(z.object({
  // least time a vehicle stays at the terminal between two trips at the same place — a hard
  // rule of the vehicle solver, and the import's normalization target
  minLayoverMinutes:        z.number().int().min(0).max(60).default(5),
  stopNoImprovementMinutes: z.number().int().min(1).max(60).default(10),
  stopMaxTotalMinutes:      z.number().int().min(1).max(1440).default(240),

  range: z.object({
    lineTransfer:         rangeCriterionSchema,
    deadrunRatio:         rangeCriterionSchema,
    minBlockDuration:     rangeCriterionSchema,
    distributionVariance: rangeCriterionSchema,
    // own defaults: settings stored before these criteria existed still parse
    preferredVehicleType: rangeCriterionSchema.default(rangeDefault.preferredVehicleType),
    operatorShareFleet:   rangeCriterionSchema.default(rangeDefault.operatorShareFleet),
    operatorShareKm:      rangeCriterionSchema.default(rangeDefault.operatorShareKm),
  }).default(rangeDefault),

  anchored: z.object({
    totalKm:    anchoredCriterionSchema,
    fleetUsage: anchoredCriterionSchema,
  }).default(anchoredDefault),

  line: z.object({
    demandMatch:          rangeCriterionSchema,
    headwayRegularity:    rangeCriterionSchema,
    maxGap:               rangeCriterionSchema,
    peakConcentration:    rangeCriterionSchema,
    distributionVariance: rangeCriterionSchema,
    fleetUsage:           anchoredCriterionSchema,
  }).default(lineDefault),
}), {
  // Servido junto de General/Schedule pela página custom `transit/settings` — não deve
  // aparecer como resource próprio no sidebar/discovery.
  label:  'Configurações de Planejamento',
  hidden: true,
})

export type PlanningSettings   = z.infer<typeof planningSettingsSchema>
export type RangeCriterion     = z.infer<typeof rangeCriterionSchema>
export type AnchoredCriterion  = z.infer<typeof anchoredCriterionSchema>
