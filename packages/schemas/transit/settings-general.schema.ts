import { z } from 'zod'

export const generalSettingsSchema = z.object({
  operationalDayStartHour: z.number().int().min(0).max(6).default(3),
})

export type GeneralSettings = z.infer<typeof generalSettingsSchema>
