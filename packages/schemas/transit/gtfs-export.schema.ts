import { z } from 'zod'

// GTFS feed for Goal (docs/proposal/plan_gtfs_export_v2.md).

const dayString = z.string().regex(/^\d{4}-\d{2}-\d{2}$/)

export const gtfsExportRequestSchema = z.object({
  scopeOperatorId: z.uuid(),
  periodStart:     dayString,
  periodEnd:       dayString,
  dayTypeIds:      z.array(z.uuid()).min(1),
  version:         z.number().int().min(1),
  includeBlocks:   z.boolean().default(false),
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
}

export interface GtfsOperatorOption {
  id:          string
  abbr:        string
  scopeName:   string
  nextVersion: number
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

function gtfsSlug(text: string): string {
  return text.normalize('NFD').replace(/[̀-ͯ]/g, '').toUpperCase().replace(/[^A-Z0-9]+/g, '_')
}
