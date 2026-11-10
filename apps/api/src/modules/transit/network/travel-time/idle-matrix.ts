import { resolveExternalCode, type ExternalCodeSystem, type IdleMatrixExport, type IdleMatrixLocality } from '@nyx/schemas'

export interface IdleMatrixInputLocality {
  code:          string
  name:          string
  isDepot:       boolean
  externalCodes: unknown
}

export interface IdleMatrixInputEntry {
  originId:      string
  destinationId: string
  baseMinutes:   number
  distanceKm:    number
  speedRatio:    number
}

const HEADER = ['Departure', 'Destination', 'Distance', 'Slot start time', 'Slot end time', 'Time']
// one slot for the whole operational day
const SLOT_START = '00:00'
const SLOT_END   = '36:00'

const pad = (n: number) => String(n).padStart(2, '0')
const duration = (minutes: number) => `${pad(Math.floor(minutes / 60))}:${pad(minutes % 60)}:00`
// up to two decimals, no trailing zeros (12.8, not 12.80)
const km = (value: number) => String(Number(value.toFixed(2)))
const byCode = (a: IdleMatrixLocality, b: IdleMatrixLocality) => a.code.localeCompare(b.code)

// docs/architecture/transit/osrm.md "Idle matrix export". The receiving system only knows the
// places a GTFS load created (trip endpoints, by the nyx code) and its depots, so the matrix keeps
// just those. Depots go under the code of `depotCodes` when given, falling back to the nyx code; a
// depot that is also a trip endpoint goes under both codes.
export function buildIdleMatrix(
  entries:     IdleMatrixInputEntry[],
  localities:  Map<string, IdleMatrixInputLocality>,
  endpointIds: Set<string>,
  depotCodes?: ExternalCodeSystem,
): IdleMatrixExport {
  const codesOf = new Map<string, string[]>()
  const omitted: IdleMatrixLocality[] = []
  const depotsWithoutCode: IdleMatrixLocality[] = []

  for (const [id, locality] of localities) {
    const codes = new Set<string>()
    if (endpointIds.has(id)) codes.add(locality.code)
    if (locality.isDepot) {
      if (depotCodes) {
        const external = resolveExternalCode(locality, depotCodes)
        if (external.fallback) depotsWithoutCode.push({ code: locality.code, name: locality.name })
        codes.add(external.code)
      } else {
        codes.add(locality.code)
      }
    }
    if (codes.size) codesOf.set(id, [...codes])
  }

  const inMatrix = new Set(entries.flatMap(e => [e.originId, e.destinationId]))
  for (const id of inMatrix) {
    const locality = localities.get(id)
    if (locality && !codesOf.has(id)) omitted.push({ code: locality.code, name: locality.name })
  }

  const rows: string[][] = []
  for (const entry of entries) {
    const origins      = codesOf.get(entry.originId)
    const destinations = codesOf.get(entry.destinationId)
    if (!origins || !destinations) continue
    for (const origin of origins) {
      for (const destination of destinations) {
        rows.push([origin, destination, km(entry.distanceKm), SLOT_START, SLOT_END, duration(Math.round(entry.baseMinutes * entry.speedRatio))])
      }
    }
  }
  rows.sort((a, b) => a[0].localeCompare(b[0]) || a[1].localeCompare(b[1]))

  return {
    csv:  [HEADER, ...rows].map(r => r.join(';')).join('\n') + '\n',
    rows: rows.length,
    omitted:           omitted.sort(byCode),
    depotsWithoutCode: depotsWithoutCode.sort(byCode),
  }
}
