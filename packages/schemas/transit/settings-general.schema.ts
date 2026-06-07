import { z } from 'zod'

export const generalSettingsSchema = z.object({
  operationalDayStartHour: z.number().int().min(0).max(6).default(3),
  demandModifier:          z.number().min(0.5).max(3.0).default(1.0),
})

export type GeneralSettings = z.infer<typeof generalSettingsSchema>
