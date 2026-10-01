import { z } from 'zod'

// Shared shape between TransitTrip.markings (manual, per-viagem) and
// LineDeparture.markings (the OSO's "molde" — copied into a TransitTrip on materialization
// and kept in sync both ways afterwards, see docs/proposal/plan_oso_attribute_sync_v1.md).
// Never used for the DISPLACEMENT marking, which is a fixed constant in the OSO export
// pipeline, never persisted (docs/proposal/trash/plan_trip_markings_v1.md, regra 6).

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

// Order-sensitive (first entry claiming a channel wins in the export) but key-order-
// insensitive — jsonb reorders object keys, so a plain JSON.stringify of a value read back
// from the database can differ from the same value built client-side. null and [] are equal.
export function sameMarkings(a: TripMarking[] | null | undefined, b: TripMarking[] | null | undefined): boolean {
  const norm = (list: TripMarking[] | null | undefined) =>
    JSON.stringify((list ?? []).map(m => [m.legendText, m.fontStyle ?? null, m.bgColor ?? null]))
  return norm(a) === norm(b)
}
