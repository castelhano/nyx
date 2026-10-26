import { z } from 'zod'
import { withMeta } from '../with-meta'
import { rangeCriterionSchema } from './settings-planning.schema'
import { CREW_ROLES } from './duty.schema'

// The real roster's rules of one empresa (Settings scope 'branch', falling back to global).
// The rest between duties is a CCT rule — it lives in the crew settings (per transit Scope).
// See docs/architecture/transit/rostering.md.

// the generator's behavior on a configurable rule — WARN assigns anyway as a last resort (high
// cost) and the day shows the issue
export const ROSTER_RULE_MODES = ['BLOCK', 'WARN'] as const
const ruleMode = z.enum(ROSTER_RULE_MODES)

function rosterReserveTargetSchema() {
  return z.object({
    role:         z.enum(CREW_ROLES).default('DRIVER'),
    dayTypeId:    z.uuid('Informe o tipo de dia'),
    startMinutes: z.number().int().min(0).max(1439),
    endMinutes:   z.number().int().min(1).max(2879),
    localityId:   z.uuid().nullable().default(null),
    count:        z.number().int().min(1).max(99),
  }).refine(t => t.endMinutes > t.startMinutes, { message: 'O fim do plantão deve ser depois do início', path: ['endMinutes'] })
}

const rosterRangeDefault = {
  // % of the trip minutes on the empresa's priority lines (CrewMemberLine.priority) — weighs more
  // than the crew member's own preferences, so those come first
  priorityLine:   { active: true, modifier: 30, floor: 0, idealMin: 70, idealMax: 100, ceiling: 100 },
  // % of the trip minutes on preferred lines, each rank weighted by its grade
  driverPrefLine: { active: true, modifier: 20, floor: 0, idealMin: 70, idealMax: 100, ceiling: 100 },
  // average minutes per duty away from the effective shift's ideal start/end
  shiftFit:       { active: true, modifier: 20, floor: 0, idealMin: 0,  idealMax: 15,  ceiling: 120 },
  // % below the period load, pro rata up to the horizon's end (ensureMonthlyLoad)
  loadDeficit:    { active: true, modifier: 30, floor: 0, idealMin: 0,  idealMax: 3,   ceiling: 20  },
  // minutes above the period load, for whoever avoids overtime (load off)
  overtimePref:   { active: true, modifier: 10, floor: 0, idealMin: 0,  idealMax: 120, ceiling: 1200 },
  // duty changes (a different table than the last one under the same crew plan) in the load period
  tableChanges:   { active: true, modifier: 20, floor: 0, idealMin: 0,  idealMax: 0,   ceiling: 6   },
  // days whose duty changes on a PUBLISHED day the generator redoes (includePublished)
  publishedChanges: { active: true, modifier: 60, floor: 0, idealMin: 0, idealMax: 0, ceiling: 2 },
}

// Painel de Escala — who the Painel suggests moving once it knows how many: tie-breaks in priority
// order (each breaks the previous one's ties; matrícula last). shiftTenure: the latest to arrive
// at their current shift go first; hireDate: the most recently hired go first.
export const REBALANCE_CRITERIA = ['lineSpread', 'shiftTenure', 'hireDate'] as const
export type RebalanceCriterion = typeof REBALANCE_CRITERIA[number]

// groupsOnly: weighs only in the rest groups suggestion — the others skip it
export const REBALANCE_CRITERION_LABEL: Record<RebalanceCriterion, { label: string; hint: string; groupsOnly?: true }> = {
  lineSpread:  { label: 'Distribuir linhas entre os grupos', hint: 'Move primeiro quem tem linhas (prioritárias ou preferidas) concentradas no grupo, para o grupo onde elas têm menos candidatos', groupsOnly: true },
  shiftTenure: { label: 'Mais novo no turno',   hint: 'Move primeiro quem chegou por último ao turno de origem' },
  hireDate:    { label: 'Mais novo na empresa', hint: 'Move primeiro os admitidos mais recentemente — preserva os antigos' },
}

const rebalanceRulesDefault = { criteria: REBALANCE_CRITERIA.map(key => ({ key, active: true })) }

export const rebalanceRulesSchema = z.object({
  criteria: z.array(z.object({ key: z.enum(REBALANCE_CRITERIA), active: z.boolean() })).default(rebalanceRulesDefault.criteria),
})
export type RebalanceRules = z.infer<typeof rebalanceRulesSchema>

// a rule saved before a criterion existed: the missing ones come in active, where the default puts them
export function withAllCriteria(rules: RebalanceRules): RebalanceRules {
  const criteria = [...rules.criteria]
  REBALANCE_CRITERIA.forEach((key, i) => {
    if (!criteria.some(c => c.key === key)) criteria.splice(Math.min(i, criteria.length), 0, { key, active: true })
  })
  return { criteria }
}

export const rosterSettingsSchema = withMeta(z.object({
  // what CrewMemberLine.access means: WHITELIST — a crew member only operates his ENABLED
  // lines; BLACKLIST — every line but his BLOCKED ones
  lineAccessMode:    z.enum(['WHITELIST', 'BLACKLIST']).default('BLACKLIST'),
  // preferred lines per crew member (CrewMemberLine.rank 1..n)
  maxPreferredLines: z.number().int().min(0).max(10).default(3),
  // the crew portal: OPTIONAL — he picks 0..max; REQUIRED — the portal stays locked until every
  // slot is filled (capped by the lines he may pick)
  portalPreferredLines: z.enum(['OPTIONAL', 'REQUIRED']).default('OPTIONAL'),
  // weekly hours when neither the crew member nor his contract set them (monthly = weekly × 5)
  defaultWeeklyHours: z.number().int().min(1).max(44).default(42),
  // weight of each preferred rank in driverPrefLine (%): rank 1 = [0], rank 2 = [1]...
  preferredLineGrades: z.array(z.number().min(0).max(100)).default([100, 60, 30]),
  // first day of the load period (1 = calendar month)
  loadPeriodStartDay:  z.number().int().min(1).max(28).default(1),
  // the habitual car = the one most driven in these last days
  habitualVehicleDays: z.number().int().min(1).max(90).default(14),
  // the hour bank's first month (mês de corte, 'YYYY-MM') — its opening balances are launched
  // in it; null = no hour bank
  hourBankStart: z.string().regex(/^\d{4}-\d{2}$/).nullable().default(null),
  // Painel de Escala: an approved absence (not férias) at least this long takes the crew member out
  // of the crew supply
  awayMinDays: z.number().int().min(1).max(365).default(15),
  // Painel de Escala: crew enabled for a line × shift beyond the need (%) — room for vacations and
  // absences; below it the line warns, below the need it's an error
  lineMarginPct: z.number().int().min(0).max(100).default(20),
  // Painel de Escala: the selection rule of its suggestions (edited there)
  rebalanceRules: rebalanceRulesSchema.default(rebalanceRulesDefault),
  // plantões (reserve): on each day of the day type, `count` STANDBY duties of the empresa from
  // start to end (minutes, end past 24h allowed) at the locality — created with the day and
  // filled by the generator with whoever is left over
  reserveTargets: z.array(rosterReserveTargetSchema()).default([]),
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
    priorityLine:   rangeCriterionSchema.default(rosterRangeDefault.priorityLine),
    driverPrefLine: rangeCriterionSchema.default(rosterRangeDefault.driverPrefLine),
    shiftFit:       rangeCriterionSchema.default(rosterRangeDefault.shiftFit),
    loadDeficit:    rangeCriterionSchema.default(rosterRangeDefault.loadDeficit),
    overtimePref:   rangeCriterionSchema.default(rosterRangeDefault.overtimePref),
    tableChanges:   rangeCriterionSchema.default(rosterRangeDefault.tableChanges),
    publishedChanges: rangeCriterionSchema.default(rosterRangeDefault.publishedChanges),
  }).default(rosterRangeDefault),
}), {
  // Served by the custom `transit/settings` page — must not show up as its own resource in the
  // sidebar/discovery.
  label:  'Configurações de Escala Real',
  hidden: true,
})

export type RosterSettings = z.infer<typeof rosterSettingsSchema>
export type RosterReserveTarget = RosterSettings['reserveTargets'][number]

export const LINE_ACCESS_MODE_LABEL: Record<RosterSettings['lineAccessMode'], string> = {
  WHITELIST: 'WHITELIST • bloqueia todas',
  BLACKLIST: 'BLACKLIST • libera todas',
}

export const PORTAL_PREFERRED_LINES_LABEL: Record<RosterSettings['portalPreferredLines'], string> = {
  OPTIONAL: 'Opcional',
  REQUIRED: 'Obrigatório',
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
