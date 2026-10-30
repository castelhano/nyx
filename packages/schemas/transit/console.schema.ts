import { z } from 'zod'
import '../zod-meta'
import { withMeta } from '../with-meta'

// Painel de Escala — the effective logical plans × the active crew of one scope + empresa + role,
// as a typical week, and the adjustments of the crew it makes (docs/architecture/transit/
// console.md). Registered purely for discovery / CASL, like the DOP: no model,
// one computed GET (the snapshot) plus the actions.
export const consoleSchema = withMeta(
  z.object({
    branchId: z.uuid(),
  }),
  {
    label:       'Painel de Escala',
    labelPlural: 'Painel de Escala',
    nameField:   'branchId',
    icon:        'Gauge',
    isSingleton: true,
    featured:    5,
  },
)
export type Console = z.infer<typeof consoleSchema>

// ── snapshot (computed, never persisted) ─────────────────────────────────────

export const CONSOLE_SECTIONS = ['plans', 'staffing', 'shifts', 'groups', 'crew', 'daily', 'adjust'] as const
export type ConsoleSection = typeof CONSOLE_SECTIONS[number]

export const CONSOLE_SECTION_LABEL: Record<ConsoleSection, string> = {
  plans:    'Escalas efetivas',
  staffing: 'Demanda × quadro',
  shifts:   'Distribuição de turnos',
  groups:   'Grupos de folga',
  crew:     'Cadastro do quadro',
  daily:    'Dias gerados com erro',
  adjust:   'Ajustes',
}

export const CONSOLE_ALERT_CODES = [
  'PLAN_NO_CREW', 'DUTY_NO_BRANCH', 'LINE_NO_PLAN', 'BRANCH_MULTI_SCOPE', 'PLAN_FUTURE', 'PLAN_UNCOVERED', 'PLAN_STALE',
  'CREW_SHORT', 'DUTY_UNFIT',
  'DUTY_NO_SHIFT', 'SHIFT_IDLE', 'SHIFT_NO_CREW',
  'GROUPS_OFF_DEMAND', 'REST_RUN_LONG',
  'LINE_SHORT', 'LINE_MARGIN', 'NO_PROFILE', 'NO_SHIFT', 'NO_PATTERN', 'FIXED_CAR_CONFLICT', 'AWAY',
  'DAILY_ERROR',
] as const
export type ConsoleAlertCode = typeof CONSOLE_ALERT_CODES[number]

export type ConsoleSeverity = 'error' | 'warning' | 'info'

// where an alert / row leads — the page turns it into a route
export type ConsoleLink =
  | { kind: 'vehicle-plan'; id: string }
  | { kind: 'crew-plan'; id: string }
  | { kind: 'escala'; date: string }
  | { kind: 'crew-member'; id: string }
  | { kind: 'crew-member-lines'; id: string }
  | { kind: 'crew-shift'; id: string }
  | { kind: 'rest-pattern'; id: string }
  | { kind: 'employee'; id: string }
  | { kind: 'section'; section: ConsoleSection }

export interface ConsoleAlert {
  code:     ConsoleAlertCode
  severity: ConsoleSeverity
  section:  ConsoleSection
  text:     string
  link?:    ConsoleLink
}

export interface ConsoleCrewRef { id: string; code: string; name: string }

export interface ConsoleDayType {
  id:   string
  code: string
  name: string
  // days of the reference window with this day type
  days: number
}

export interface ConsoleShift {
  id:   string
  code: string
  name: string
  startFloor: number; startIdealMin: number; startIdealMax: number; startCeiling: number
  endFloor:   number; endIdealMin:   number; endIdealMax:   number; endCeiling:   number
  allowSplit: boolean
}

// A — the effective plan of a day type
export interface ConsolePlanRow {
  dayTypeId: string
  // fleet: the empresa's cars in use (its blocks with trips); reserve: its active cars (incl. in
  // maintenance) beyond those
  vehiclePlan: { id: string; label: string; validFrom: string | null; fleet: number | null; reserve: number; trips: number } | null
  crewPlan: {
    id: string; label: string
    // the empresa's duties of the role (plantões of the plan included)
    duties: number
    byKind: Record<string, number>
    avgWorkMinutes: number
    overtimePct: number
    uncoveredMinutes: number
    stale: number
    issues: number
    // duties with no empresa in a shared scope (DUTY_NO_BRANCH)
    noBranch: number
    score: number | null
  } | null
  // the effective plan starts more than CONSOLE_FUTURE_DAYS from today
  future: boolean
  // active lines of the scope outside the plan
  linesWithoutPlan: string[]
}

export const CONSOLE_FUTURE_DAYS = 10

// B — demand × crew
export interface ConsoleStaffCell {
  demand:  number
  // crew of the shift working on the worst day of the type in the window — what `balance` uses
  worst:   number
  avg:     number
  balance: number
}

export interface ConsoleStaffRow {
  shiftId:  string
  cells:    Record<string, ConsoleStaffCell>
  // available crew members of the shift (afastados out)
  current:  number
}

export interface ConsoleStaffing {
  rows:   ConsoleStaffRow[]
  // per day type: duties that fit no shift
  noShift: Record<string, number>
  // per day type: all the duties, and the most the crew can cover on its worst day (matching)
  totals: Record<string, { demand: number; coverable: number }>
}

// The crew the effective plans need (docs/architecture/transit/console.md, Sizing):
// operational — the fewest that cover every duty on every day of the window with the regimes,
// the shift windows and the empresa's roster rules — plus the vacation reserve (30 days a year,
// even through the year). The hour bank's crew apart: the planned overtime's banked share
// (bankPct of it) taken as days off, beyond what the crew already works idle.
export interface ConsoleSizing {
  current:     number
  operational: number
  vacation:    number
  // operational + vacation
  required:    number
  // current − required: < 0 short, > 0 spare
  balance:     number
  bank:        number
  // RosterSettings.hourBankCompPct
  bankPct:     number
  shifts:      { shiftId: string; current: number; operational: number; vacation: number; bank: number; required: number }[]
  // where the operational crew differs from the current one, per shift and rest group
  // (CrewMember.restOffset; label A, B… — null: not one of the pattern's groups)
  groups:      { shiftId: string; offset: number; label: string | null; current: number; add: number; remove: number }[]
  // per day type: duties nobody can take on its worst day (no shift fits, or no one may operate
  // the line / vehicle type) — not a matter of crew size
  unfit:       Record<string, number>
}

// C — shifts
export interface ConsoleShiftsAnalysis {
  // per day type: each duty's sign-on (plantões left out)
  starts:  Record<string, number[]>
  // per day type: duties fitting no shift, and the earliest / latest of their sign-ons
  noShift: Record<string, { count: number; earliest: number | null; latest: number | null }>
  // duties fitting two shifts (decided by priority only)
  overlaps: { shiftIds: [string, string]; count: number }[]
  // a shift with crew working on a day type (on average) and no duty on it
  idle: { shiftId: string; dayTypeId: string; crew: number }[]
  // a shift with duties and no crew
  noCrew: string[]
}

// D — rest groups
export interface ConsoleGroupPattern {
  patternId: string
  name:      string
  // longest run of days worked in the cycle
  maxRun:    number
  groups:    { label: string; offset: number; count: number; ideal: number }[]
  // crew members between groups (an offset set by hand)
  outside:   number
}

export interface ConsoleGroups {
  shiftId:  string
  patterns: ConsoleGroupPattern[]
  // crew members of the shift without a rest pattern
  noPattern: number
  // per weekday (0 = Monday): crew working on its worst date in the window, duties
  weekdays: { supply: number; demand: number }[]
  // the worst balance now and with the ideal groups
  worstNow:   number
  worstIdeal: number
}

// E — crew records
export interface ConsoleLineRow {
  lineId:   string
  lineCode: string
  shiftId:  string
  // duties of the shift whose dominant line it is, on its busiest day type
  duties:   number
  need:     number
  // need + the empresa's margin (transit.roster.lineMarginPct)
  ideal:    number
  // crew of the shift who may operate it (line access + vehicle type)
  enabled:  number
  // of those, who has it as a priority or preferred line
  bonded:   number
  gap:      number
}

export interface ConsoleCrewData {
  noProfile: { employeeId: string; code: string; name: string; jobTitle: string; role: string; hireDate: string }[]
  noShift:   ConsoleCrewRef[]
  noPattern: ConsoleCrewRef[]
  // isRosterable off
  outOfGenerator: ConsoleCrewRef[]
  // a long absence (not férias) — out of the supply
  away:      (ConsoleCrewRef & { reason: string; until: string })[]
  // on férias now — info only, never out of the supply
  vacation:  (ConsoleCrewRef & { until: string; cover: string | null })[]
  fixedCar:  (ConsoleCrewRef & { vehicleCode: string; reason: string })[]
  lines:     ConsoleLineRow[]
}

// F — generated days with errors
export interface ConsoleDailyError {
  operationId: string
  date:        string
  // why the copy is no longer what's in force (outdated) — null when it is
  outdated:    string | null
  issues:      { code: string; label: string; count: number }[]
}

export interface ConsoleSectionStatus { severity: ConsoleSeverity | 'ok'; count: number }

export interface ConsoleSnapshot {
  scopeId:  string
  branchId: string
  role:     string
  today:    string
  // the scopes the empresa operates — more than one is a configuration to fix
  scopes:   { id: string; name: string }[]
  dayTypes: ConsoleDayType[]
  shifts:   ConsoleShift[]
  plans:    ConsolePlanRow[]
  staffing: ConsoleStaffing
  sizing:   ConsoleSizing
  shiftsAnalysis: ConsoleShiftsAnalysis
  groups:   ConsoleGroups[]
  crew:     { active: number; away: number; vacation: number }
  crewData: ConsoleCrewData
  dailyErrors: ConsoleDailyError[]
  alerts:   ConsoleAlert[]
  status:   Record<ConsoleSection, ConsoleSectionStatus>
}
