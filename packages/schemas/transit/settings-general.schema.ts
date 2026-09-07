import { z } from 'zod'
import { withMeta } from '../with-meta'

export const generalSettingsSchema = withMeta(z.object({
  operationalDayStartHour:        z.number().int().min(0).max(6).default(3),
  demandModifier:                 z.number().min(0.5).max(3.0).default(1.0),
  // when true, persisting a change to a route's primary trajectory (reprocess,
  // or the route becoming isPrimary) auto-syncs TransitLine.metrics.extensionKm
  // for that direction
  propagateExtensionToOfficialKm: z.boolean().default(true),
  suggestThresholdM:              z.number().int().min(1).max(1000).default(300),
  // multiplier applied to OSRM-reported durations when (re)generating the travel-time
  // matrix — compensates for OSRM's free-flow estimate running faster than real traffic
  baseSpeedRatio:                 z.number().min(0.5).max(3.0).default(1.1),
  // default schedule generator behavior when closing a trip at an intermediate stop,
  // when the route doesn't define its own layoverPolicy (DEFAULT) — hold in place
  // (HOLD) or return to the depot (DEPOT)
  defaultLayoverPolicy:           z.enum(['HOLD', 'DEPOT']).default('HOLD'),
}), {
  // Servido junto de Planning/Schedule pela página custom `transit/settings` — não deve
  // aparecer como resource próprio no sidebar/discovery.
  label:  'Configurações Gerais',
  hidden: true,
})

export type GeneralSettings = z.infer<typeof generalSettingsSchema>
