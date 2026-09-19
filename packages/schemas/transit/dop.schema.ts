import { z } from 'zod'
import '../zod-meta'
import { withMeta } from '../with-meta'

// Registered purely for resourceRegistry/discovery/CASL (docs/proposal/plan_dop_v1.md,
// decisão 3) — DOP has no Prisma model and no CRUD, just a computed GET. `scopeId` is
// the only "field" that matters here, kept mostly so this is a real ZodObject.
export const dopSchema = withMeta(
  z.object({
    scopeId: z.uuid(),
  }),
  {
    label:       'Dados Operacionais Previstos',
    labelPlural: 'Dados Operacionais Previstos',
    nameField:   'scopeId',
    icon:        'Gauge',
    isSingleton: true,
  },
)
export type Dop = z.infer<typeof dopSchema>

// ── response shape (computed, never persisted) ──────────────────────────────

export interface DopDayTypeCount {
  dayTypeId:   string
  dayTypeCode: string
  dayTypeName: string
  days:        number
}

export interface DopLineDayTypeBreakdown extends DopDayTypeCount {
  fleet:       number | null
  trips:       number
  kmProdutiva: number
  kmOciosa:    number
}

export interface DopLineSummary {
  lineId:   string
  lineCode: string
  lineName: string

  byDayType: DopLineDayTypeBreakdown[]

  tripsMes:       number
  kmProdutivaMes: number
  kmOciosaMes:    number

  // Snapshot values (not summed over the period) from the most recent day in
  // range that had an active plan covering this line.
  avgSpeed:              number | null
  occupancyIndex:        number | null
  peakMorningInterval:   number | null
  peakAfternoonInterval: number | null
  offPeakInterval:       number | null
  peakFleetMorning:      number | null
  peakFleetAfternoon:    number | null
  peakFleetOffPeak:      number | null
}

export interface DopPeriodSummary {
  scopeId: string
  from:    string
  to:      string

  calendar: DopDayTypeCount[]
  lines:    DopLineSummary[]

  totals: {
    fleetOperacional: number
    kmProdutivaMes:   number
    kmOciosaMes:      number
    tripsMes:         number
  }
}
