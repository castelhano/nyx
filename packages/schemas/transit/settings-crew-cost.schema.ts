import { z } from 'zod'
import { withMeta } from '../with-meta'

// Crew cost parameters per CrewRole — per transit Scope (one CCT), falling back to global.
// Always the current values, no vigência: the DOP recomputes past periods with them.
// Overtime (+50%) and the night premium (20% of
// the reduced night hour) are fixed in code.

export const crewRoleCostSchema = z.object({
  // R$ per month
  baseSalary:         z.number().min(0).default(0),
  // contractual hours per month — the hourly rate divisor
  monthlyHours:       z.number().min(1).default(220),
  // % over salary + overtime + night premium, everything included (INSS, FGTS, 13º, férias…)
  chargesPercent:     z.number().min(0).default(0),
  // R$ per employee per month, summed benefits (no charges on top)
  benefitsPerEmployee: z.number().min(0).default(0),
})
export type CrewRoleCost = z.infer<typeof crewRoleCostSchema>

const roleDefault: CrewRoleCost = { baseSalary: 0, monthlyHours: 220, chargesPercent: 0, benefitsPerEmployee: 0 }

export const crewCostSettingsSchema = withMeta(z.object({
  byRole: z.object({
    DRIVER:         crewRoleCostSchema.default(roleDefault),
    FARE_COLLECTOR: crewRoleCostSchema.default(roleDefault),
    ASSISTANT:      crewRoleCostSchema.default(roleDefault),
  }).default({ DRIVER: roleDefault, FARE_COLLECTOR: roleDefault, ASSISTANT: roleDefault }),
}), {
  // Served by the custom `transit/settings` page — not a resource of its own
  label:  'Custos de Pessoal',
  hidden: true,
})
export type CrewCostSettings = z.infer<typeof crewCostSettingsSchema>
