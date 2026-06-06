import { z } from 'zod'
import { rangeCriterionSchema } from './settings-planning.schema'

const rangeDefault = {
  layover:            { active: true, modifier: 1.0, floor: 360, idealMin: 440, idealMax: 550, ceiling: 560 },
  shiftBreak:         { active: true, modifier: 1.0, floor: 60,  idealMin: 70,  idealMax: 110, ceiling: 120 },
  interShiftRest:     { active: true, modifier: 1.0, floor: 600, idealMin: 660, idealMax: 960, ceiling: 960 },
  splitShiftInterval: { active: true, modifier: 1.0, floor: 60,  idealMin: 60,  idealMax: 240, ceiling: 250 },
  driverPrefLine:     { active: true, modifier: 1.0, floor: 90,  idealMin: 90,  idealMax: 100, ceiling: 100 },
  driverPrefTech:     { active: true, modifier: 1.0, floor: 90,  idealMin: 90,  idealMax: 100, ceiling: 100 },
}

export const scheduleSettingsSchema = z.object({
  range: z.object({
    layover:            rangeCriterionSchema,
    shiftBreak:         rangeCriterionSchema,
    interShiftRest:     rangeCriterionSchema,
    splitShiftInterval: rangeCriterionSchema,
    driverPrefLine:     rangeCriterionSchema,
    driverPrefTech:     rangeCriterionSchema,
  }).default(rangeDefault),
})

export type ScheduleSettings = z.infer<typeof scheduleSettingsSchema>
