import { z } from 'zod'

// Shared shape between TransitTrip.markings (manual, per-viagem) and
// LineDeparture.markings (the "molde" copied into a TransitTrip on materialization —
// see docs/proposal/plan_trip_markings_v1.md, regra 7). Never used for the DISPLACEMENT
// marking, which is a fixed constant in the OSO export pipeline, never persisted (regra 6).

export const TRIP_MARKING_FONT_STYLES = ['BOLD', 'ITALIC', 'BOLD_ITALIC', 'UNDERLINE', 'STRIKETHROUGH'] as const
export const TRIP_MARKING_BG_COLORS   = ['AZUL', 'VERDE', 'ROSA', 'ROXO', 'CINZA', 'VERMELHO'] as const

export const tripMarkingSchema = z.object({
  legendText: z.string().min(1),
  fontStyle:  z.enum(TRIP_MARKING_FONT_STYLES).optional(),
  bgColor:    z.enum(TRIP_MARKING_BG_COLORS).optional(),
})

export type TripMarking          = z.infer<typeof tripMarkingSchema>
export type TripMarkingFontStyle = typeof TRIP_MARKING_FONT_STYLES[number]
export type TripMarkingBgColor   = typeof TRIP_MARKING_BG_COLORS[number]
