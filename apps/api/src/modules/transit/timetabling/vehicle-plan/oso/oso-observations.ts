import type { OsoAssembled } from './oso-assembler'
import type { TripMarkingFontStyle, TripMarkingBgColor } from '@nyx/schemas'

// Layer 5 of the OSO export pipeline (docs/proposal/plan_oso_export_v1.md) — the
// "Observações estruturadas" layer the original doc described but never built. Builds the
// OBSERVAÇÃO cell's lines from every marking actually present in the exported recorte
// (manual TransitTrip.markings + the inferred DISPLACEMENT constant, both carried on
// OsoTripEvent/OsoDeadrunEvent by the assembler) — condition and dedupe by exact legendText
// string (docs/proposal/plan_trip_markings_v1.md, regra 9): no shared id to key off, so two
// labels typed with different spacing/capitalization produce two lines.
//
// Each line also carries the style of its first occurrence, so the renderer can draw a small
// "LEG" swatch next to the text (same font/fill as the marked cells) instead of coloring the
// whole sentence — see oso-workbook.renderer.ts's obsLine/obsSlots.

export interface OsoObservationLine {
  legendText: string
  fontStyle?: TripMarkingFontStyle
  bgColor?:   TripMarkingBgColor
}

export interface OsoObservations {
  lines: OsoObservationLine[]
}

export function computeOsoObservations(assembled: OsoAssembled): OsoObservations {
  const seen  = new Set<string>()
  const lines: OsoObservationLine[] = []

  for (const carro of assembled.carros) {
    for (const e of carro.events) {
      if (e.kind !== 'trip' && e.kind !== 'deadrun') continue
      for (const marking of e.markings ?? []) {
        if (seen.has(marking.legendText)) continue
        seen.add(marking.legendText)
        lines.push({ legendText: marking.legendText, fontStyle: marking.fontStyle, bgColor: marking.bgColor })
      }
    }
  }

  return { lines }
}
