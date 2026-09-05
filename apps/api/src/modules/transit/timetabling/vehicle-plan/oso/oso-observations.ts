import type { OsoAssembled } from './oso-assembler'

// Layer 5 of the OSO export pipeline (docs/proposal/plan_oso_export_v1.md) — the
// "Observações estruturadas" layer the original doc described but never built. Builds the
// OBSERVAÇÃO cell's lines from every marking actually present in the exported recorte
// (manual TransitTrip.markings + the inferred DISPLACEMENT constant, both carried on
// OsoTripEvent/OsoDeadrunEvent by the assembler) — condition and dedupe by exact legendText
// string (docs/proposal/plan_trip_markings_v1.md, regra 9): no shared id to key off, so two
// labels typed with different spacing/capitalization produce two lines.

export interface OsoObservations {
  lines: string[]
}

export function computeOsoObservations(assembled: OsoAssembled): OsoObservations {
  const seen  = new Set<string>()
  const lines: string[] = []

  for (const carro of assembled.carros) {
    for (const e of carro.events) {
      if (e.kind !== 'trip' && e.kind !== 'deadrun') continue
      for (const marking of e.markings ?? []) {
        if (seen.has(marking.legendText)) continue
        seen.add(marking.legendText)
        lines.push(marking.legendText)
      }
    }
  }

  return { lines }
}
