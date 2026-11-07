import { z } from 'zod'

// GTFS feed for Goal (docs/architecture/transit/gtfs-export.md).

const dayString = z.string().regex(/^\d{4}-\d{2}-\d{2}$/)

// which trips carry a block_id: none, only those of a trip group, or all
export const gtfsBlockIdModeSchema = z.enum(['none', 'bundled', 'all'])
export type GtfsBlockIdMode = z.infer<typeof gtfsBlockIdModeSchema>

export const gtfsExportRequestSchema = z.object({
  scopeOperatorId: z.uuid(),
  periodStart:     dayString,
  periodEnd:       dayString,
  // Goal takes one day type per load, and each day type counts its own loads
  dayTypes:        z.array(z.object({ id: z.uuid(), version: z.number().int().min(1) })).length(1),
  blockIdMode:     gtfsBlockIdModeSchema.default('bundled'),
  // the report has errors (items left out) and the user chose to download anyway
  confirmErrors:   z.boolean().default(false),
}).refine(r => r.periodStart <= r.periodEnd, { message: 'Período inválido' })

export type GtfsExportRequest = z.input<typeof gtfsExportRequestSchema>

export interface GtfsReport {
  // nothing is generated
  blockers: string[]
  // an item is left out of the feed
  errors:   string[]
  warnings: string[]
}

export interface GtfsLineSummary {
  routeId: string
  name:    string
  trips:   number
  km:      number
  minutes: number
}

export interface GtfsPreview {
  serviceIds: string[]
  lines:      GtfsLineSummary[]
  report:     GtfsReport
  // trips carrying a block_id
  blockTrips: number
}

export interface GtfsOperatorOption {
  id:           string
  abbr:         string
  scopeName:    string
  // by day type id; a day type never exported isn't listed and starts at 1
  nextVersions: Record<string, number>
}

export interface GtfsDayTypeOption {
  id:   string
  code: string
  name: string
}

export interface GtfsOptions {
  operators: GtfsOperatorOption[]
  dayTypes:  GtfsDayTypeOption[]
}

export function gtfsServiceId(operatorAbbr: string, dayTypeName: string, version: number): string {
  return `${gtfsSlug(operatorAbbr)}_${gtfsSlug(dayTypeName)}_V${String(version).padStart(3, '0')}`
}

// gtfs-RAPIDO-U003.zip
export function gtfsFileName(operatorAbbr: string, dayTypes: { code: string; version: number }[]): string {
  const versions = dayTypes.map(d => `${d.code}${String(d.version).padStart(3, '0')}`)
  return `gtfs-${[operatorAbbr, ...versions].join('-')}.zip`
}

function gtfsSlug(text: string): string {
  return text.normalize('NFD').replace(/[̀-ͯ]/g, '').toUpperCase().replace(/[^A-Z0-9]+/g, '_')
}
