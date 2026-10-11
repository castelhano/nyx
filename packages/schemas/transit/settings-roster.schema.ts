import { z } from 'zod'
import { withMeta } from '../with-meta'
import { rangeCriterionSchema } from './settings-planning.schema'

// The real roster's rules of one empresa (Settings scope 'branch', falling back to global).
// The rest between duties is a CCT rule — it lives in the crew settings (per transit Scope).
// See docs/proposal/brainchild/plan_crew_rostering_impl_v2.md §2.8 and §5.

// the generator's behavior on a configurable rule — WARN assigns anyway as a last resort (high
// cost) and the day shows the issue
export const ROSTER_RULE_MODES = ['BLOCK', 'WARN'] as const
const ruleMode = z.enum(ROSTER_RULE_MODES)

const rosterRangeDefault = {
  // % of the trip minutes on preferred lines, each rank weighted by its grade
  driverPrefLine: { active: true, modifier: 20, floor: 0, idealMin: 70, idealMax: 100, ceiling: 100 },
  // average minutes per duty away from the effective shift's ideal start/end
  shiftFit:       { active: true, modifier: 20, floor: 0, idealMin: 0,  idealMax: 15,  ceiling: 120 },
  // % below the period load, pro rata up to the horizon's end (ensureMonthlyLoad)
  loadDeficit:    { active: true, modifier: 30, floor: 0, idealMin: 0,  idealMax: 3,   ceiling: 20  },
  // minutes above the period load, for whoever avoids overtime (load off)
  overtimePref:   { active: true, modifier: 10, floor: 0, idealMin: 0,  idealMax: 120, ceiling: 1200 },
  // duty signature changes in the load period
  tableChanges:   { active: true, modifier: 20, floor: 0, idealMin: 0,  idealMax: 1,   ceiling: 6   },
}

export const rosterSettingsSchema = withMeta(z.object({
  // what CrewMemberLine.access means: WHITELIST — a crew member only operates his ENABLED
  // lines; BLACKLIST — every line but his BLOCKED ones
  lineAccessMode:    z.enum(['WHITELIST', 'BLACKLIST']).default('BLACKLIST'),
  // preferred lines per crew member (CrewMemberLine.rank 1..n)
  maxPreferredLines: z.number().int().min(0).max(10).default(3),
  // weekly hours when neither the crew member nor his contract set them (monthly = weekly × 5)
  defaultWeeklyHours: z.number().int().min(1).max(44).default(42),
  // weight of each preferred rank in driverPrefLine (%): rank 1 = [0], rank 2 = [1]...
  preferredLineGrades: z.array(z.number().min(0).max(100)).default([100, 60, 30]),
  // first day of the load period (1 = calendar month)
  loadPeriodStartDay:  z.number().int().min(1).max(28).default(1),
  // the habitual car = the one most driven in these last days
  habitualVehicleDays: z.number().int().min(1).max(90).default(14),
  ruleModes: z.object({
    lineAccess:     ruleMode.default('BLOCK'),
    vehicleType:    ruleMode.default('BLOCK'),
    shiftWindow:    ruleMode.default('BLOCK'),
    interShiftRest: ruleMode.default('BLOCK'),
    license:        ruleMode.default('BLOCK'),
    // some empresas operate for a while with the course expired, never with the license
    course:         ruleMode.default('BLOCK'),
  }).default({ lineAccess: 'BLOCK', vehicleType: 'BLOCK', shiftWindow: 'BLOCK', interShiftRest: 'BLOCK', license: 'BLOCK', course: 'BLOCK' }),
  range: z.object({
    driverPrefLine: rangeCriterionSchema.default(rosterRangeDefault.driverPrefLine),
    shiftFit:       rangeCriterionSchema.default(rosterRangeDefault.shiftFit),
    loadDeficit:    rangeCriterionSchema.default(rosterRangeDefault.loadDeficit),
    overtimePref:   rangeCriterionSchema.default(rosterRangeDefault.overtimePref),
    tableChanges:   rangeCriterionSchema.default(rosterRangeDefault.tableChanges),
  }).default(rosterRangeDefault),
}), {
  // Served by the custom `transit/settings` page — must not show up as its own resource in the
  // sidebar/discovery.
  label:  'Configurações de Escala Real',
  hidden: true,
})

export type RosterSettings = z.infer<typeof rosterSettingsSchema>

export const LINE_ACCESS_MODE_LABEL: Record<RosterSettings['lineAccessMode'], string> = {
  WHITELIST: 'WHITELIST • libera todas',
  BLACKLIST: 'BLACKLIST • bloqueia todos',
}

export const ROSTER_RULE_LABEL: Record<keyof RosterSettings['ruleModes'], { label: string; hint: string }> = {
  lineAccess:     { label: 'Linha do Operador',  hint: 'Linha bloqueada (ou não habilitada) para o operador' },
  vehicleType:    { label: 'Tipo de Veículo',    hint: 'Tipo de veículo bloqueado para o operador' },
  shiftWindow:    { label: 'Janela do Turno',    hint: 'Fora do turno, dos limites do operador ou de uma restrição de horário' },
  interShiftRest: { label: 'Interjornada',       hint: 'Descanso abaixo do mínimo entre dias seguidos' },
  license:        { label: 'CNH',                hint: 'CNH vencida na data' },
  course:         { label: 'Curso',              hint: 'Curso de transporte coletivo vencido na data' },
}

export const ROSTER_RULE_MODE_LABEL: Record<typeof ROSTER_RULE_MODES[number], string> = {
  BLOCK: 'Bloqueia',
  WARN:  'Alerta',
}
