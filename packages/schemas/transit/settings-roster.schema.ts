import { z } from 'zod'
import { withMeta } from '../with-meta'
import { rangeCriterionSchema } from './settings-planning.schema'

// Rostering rules (person × date × duty) — not consumed yet, reserved for the stage after
// the logical crew schedule (docs/proposal/plan_crew_plan_v1.md).
const rangeDefault = {
  // rest between consecutive duties of the same person (minutes)
  interShiftRest: { active: true, modifier: 1.0, floor: 600, idealMin: 660, idealMax: 960, ceiling: 960 },
  // % of the duty's trips on the person's preferred lines
  driverPrefLine: { active: true, modifier: 1.0, floor: 90,  idealMin: 90,  idealMax: 100, ceiling: 100 },
  // % of the duty's trips on the person's preferred vehicle technology
  driverPrefTech: { active: true, modifier: 1.0, floor: 90,  idealMin: 90,  idealMax: 100, ceiling: 100 },
}

export const rosterSettingsSchema = withMeta(z.object({
  range: z.object({
    interShiftRest: rangeCriterionSchema,
    driverPrefLine: rangeCriterionSchema,
    driverPrefTech: rangeCriterionSchema,
  }).default(rangeDefault),
}), {
  // Served alongside General/Planning by the custom `transit/settings` page — must not
  // show up as its own resource in the sidebar/discovery.
  label:  'Configurações de Escala Nominal',
  hidden: true,
})

export type RosterSettings = z.infer<typeof rosterSettingsSchema>
