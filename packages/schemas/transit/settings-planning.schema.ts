import { z } from 'zod'

export const flatCriterionSchema = z.object({
  active:    z.boolean(),
  direction: z.enum(['minimize', 'maximize']),
  weight:    z.number().min(0),
})

export const rangeCriterionSchema = z.object({
  active:   z.boolean(),
  modifier: z.number().min(0).max(100),
  floor:    z.number().min(0),
  idealMin: z.number().min(0),
  idealMax: z.number().min(0),
  ceiling:  z.number().min(0),
})

const flatDefault = {
  fleetUsage:           { active: true,  direction: 'minimize' as const, weight: 300 },
  deadrunKm:            { active: true,  direction: 'minimize' as const, weight: 50  },
  totalKm:              { active: true,  direction: 'minimize' as const, weight: 2   },
  distributionVariance: { active: true,  direction: 'minimize' as const, weight: 200 },
  specialFleetUsage:    { active: true,  direction: 'minimize' as const, weight: 150 },
  driverUsage:          { active: false, direction: 'minimize' as const, weight: 150 },
  overtime:             { active: false, direction: 'minimize' as const, weight: 6   },
}

const rangeDefault = {
  lineTransfer:    { active: true, modifier: 1.0, floor: 0,   idealMin: 0,   idealMax: 0,   ceiling: 4   },
  tripInterval:    { active: true, modifier: 0.3, floor: 3,   idealMin: 5,   idealMax: 10,  ceiling: 15  },
  deadrunRatio:    { active: true, modifier: 1.0, floor: 0,   idealMin: 0,   idealMax: 10,  ceiling: 25  },
  minBlockDuration:{ active: true, modifier: 0.3, floor: 180, idealMin: 420, idealMax: 900, ceiling: 1080 },
}

export const planningSettingsSchema = z.object({
  stopNoImprovementMinutes: z.number().int().min(1).max(60).default(10),
  stopMaxTotalMinutes:      z.number().int().min(1).max(1440).default(240),

  flat: z.object({
    fleetUsage:           flatCriterionSchema,
    deadrunKm:            flatCriterionSchema,
    totalKm:              flatCriterionSchema,
    distributionVariance: flatCriterionSchema,
    specialFleetUsage:    flatCriterionSchema,
    driverUsage:          flatCriterionSchema,
    overtime:             flatCriterionSchema,
  }).default(flatDefault),

  range: z.object({
    lineTransfer:    rangeCriterionSchema,
    tripInterval:    rangeCriterionSchema,
    deadrunRatio:    rangeCriterionSchema,
    minBlockDuration:rangeCriterionSchema,
  }).default(rangeDefault),
})

export type PlanningSettings = z.infer<typeof planningSettingsSchema>
export type FlatCriterion    = z.infer<typeof flatCriterionSchema>
export type RangeCriterion   = z.infer<typeof rangeCriterionSchema>
