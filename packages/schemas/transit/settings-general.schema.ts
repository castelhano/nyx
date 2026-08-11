import { z } from 'zod'

export const generalSettingsSchema = z.object({
  operationalDayStartHour:        z.number().int().min(0).max(6).default(3),
  demandModifier:                 z.number().min(0.5).max(3.0).default(1.0),
  // when true, persisting a change to a route's primary trajectory (reprocess,
  // or the route becoming isPrimary) auto-syncs TransitLine.metrics.extensionKm
  // for that direction — skipping the manual review/apply flow
  propagateExtensionToOfficialKm: z.boolean().default(true),
  suggestThresholdM:              z.number().int().min(1).max(1000).default(300),
})

export type GeneralSettings = z.infer<typeof generalSettingsSchema>
