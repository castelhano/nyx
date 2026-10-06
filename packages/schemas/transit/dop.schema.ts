import { z } from 'zod'
import '../zod-meta'
import { withMeta } from '../with-meta'

// Registered purely for resourceRegistry/discovery/CASL — DOP has no Prisma model and
// no CRUD, just a computed GET. `scopeId` is
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

// Scope-level, cross-line km per empresa (VehicleBlock.branchId). branchId is null
// for the 'Não informado' bucket — blocks with no branch assigned.
export interface DopBranchBreakdown {
  branchId:    string | null
  branchName:  string
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

  // Snapshot values (not summed over the period) from the line's predominant day type in the
  // period (the one with most days that had an active plan covering the line).
  avgSpeed:              number | null
  occupancyIndex:        number | null
  peakMorningInterval:   number | null
  peakAfternoonInterval: number | null
  offPeakInterval:       number | null
  peakFleetMorning:      number | null
  peakFleetAfternoon:    number | null
  peakFleetOffPeak:      number | null
  // the line's operational fleet: its larger peak (morning / afternoon), isolated
  // reinforcements left out — the vehicles it needs, each line on its own
  fleetOperacional:      number | null
}

export interface DopPeriodSummary {
  scopeId: string
  from:    string
  to:      string

  calendar: DopDayTypeCount[]
  lines:    DopLineSummary[]
  byBranch: DopBranchBreakdown[]

  totals: {
    // the Scope's operational fleet: on each day, the larger peak of every plan in force, each
    // vehicle once however many lines it runs; the period's figure is the most common day's
    fleetOperacional: number
    // vehicle hours in the period: the plans' blocks from pull-out to pull-in, summed per day
    vehicleHoursMes:  number
    kmProdutivaMes:   number
    kmOciosaMes:      number
    tripsMes:         number
  }
}

// ── visão Escala ─────────────────────────────────────────────────────────────
// Every *ByRole map is keyed by CrewRole (DRIVER, FARE_COLLECTOR, ASSISTANT) — the page
// filters/sums roles itself.

export interface DopCrewMetrics {
  // snapshot rows (byDayType): duty-equivalents on one day of that type;
  // period rows: duty-days (Σ over the days)
  dutyShare:       number
  workMinutes:     number
  paidMinutes:     number
  overtimeMinutes: number
  nightMinutes:    number
  // period rows only — the role's total cost allocated by paid minutes
  cost:            number
}

export interface DopCrewLine {
  // null = Sem linha (duties with no trip)
  lineId:   string | null
  lineCode: string
  lineName: string
  byDayType: { dayTypeId: string; byRole: Record<string, DopCrewMetrics> }[]
  byRole:    Record<string, DopCrewMetrics>
}

export interface DopCrewBranch {
  branchId:   string | null
  branchName: string
  byRole:     Record<string, DopCrewMetrics>
}

export interface DopCrewRoleQuality {
  dutyCount:            number
  byKind:               Record<string, number>
  issueDutyCount:       number
  staleDutyCount:       number
  interShiftBelowFloor: number
  interShiftBelowIdeal: number
  avgSpreadMinutes:     number
  avgWorkMinutes:       number
  avgBreakMinutes:      number
  avgVehicleChanges:    number
  avgLineChanges:       number
  multiLineCount:       number
}

// snapshot of the crew plan in force on the most recent day of that type
export interface DopCrewDayTypeQuality {
  dayTypeId: string
  score:     number | null
  byRole:    Record<string, DopCrewRoleQuality>
}

export interface DopCrewStaffing {
  // max over the period of max(biggest Mon–Fri; Sat + Sun), and the typical week behind it
  estimate: number
  weekday:  number
  saturday: number
  sunday:   number
}

export interface DopCrewCost {
  fixed:    number
  overtime: number
  night:    number
  charges:  number
  benefits: number
  total:    number
}

export interface DopCrewPeriodSummary {
  scopeId: string
  from:    string
  to:      string
  days:    number

  calendar: DopDayTypeCount[]
  // DayType covering Mon–Fri (weekdays pattern) — base of "Jornadas/dia útil" and the fleet
  referenceDayTypeId: string | null
  referenceFleet:     number
  // days where a line had an active VehiclePlan but no active CrewPlan
  noCrewDays: { dayTypeId: string; days: number }[]

  lines:    DopCrewLine[]
  byBranch: DopCrewBranch[]
  quality:  DopCrewDayTypeQuality[]
  staffing: Record<string, DopCrewStaffing>
  costs:    Record<string, DopCrewCost>
  // DRIVER-covered service minutes in the period (efficiency denominator)
  coveredMinutes: number
}
