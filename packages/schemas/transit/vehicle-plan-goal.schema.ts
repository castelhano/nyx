import { z } from 'zod'

// Goal planning (docs/proposal/plan_goal_planning_v1.md) — what the user asks for. Etapa 1 only
// handles fleet reduction; km goals and increases come in etapa 3.
export const vehiclePlanGoalSchema = z.object({
  kind:   z.literal('FLEET_REDUCE'),
  // cars to take out: no half-hour of the day above (current peak − amount)
  amount: z.number().int().min(1).max(500),
  // empresas the goal is measured on — empty: the whole plan
  branchIds:     z.array(z.uuid()).default([]),
  // lines the suggestion may touch — empty: every line of the plan
  lineIds:       z.array(z.uuid()).default([]),
  // lines the suggestion never touches
  lockedLineIds: z.array(z.uuid()).default([]),
  // most cars a single band of a line may lose — null: no limit (the band keeps at least 1)
  maxCutPerBand: z.number().int().min(1).nullable().default(null),
  // longest headway a cut may leave — null: the line criterion maxGap.ceiling
  maxHeadwayMinutes: z.number().int().min(1).nullable().default(null),
  // lines with no demand data enter only after the ones with demand run out
  useLinesWithoutDemand: z.boolean().default(true),
})
export type VehiclePlanGoal      = z.infer<typeof vehiclePlanGoalSchema>
export type VehiclePlanGoalInput = z.input<typeof vehiclePlanGoalSchema>
