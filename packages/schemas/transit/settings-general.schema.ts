import { z } from 'zod'

export const generalSettingsSchema = z.object({
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
  // comportamento padrão do gerador de planejamento ao fechar uma viagem numa parada
  // intermediária, quando a rota não define layoverPolicy própria (DEFAULT) — aguardar no
  // ponto (HOLD) ou recolher à garagem (DEPOT)
  defaultLayoverPolicy:           z.enum(['HOLD', 'DEPOT']).default('HOLD'),
})

export type GeneralSettings = z.infer<typeof generalSettingsSchema>
