import { z } from 'zod'
import '../zod-meta'
import { withMeta } from '../with-meta'

export const CREW_ROLES = ['DRIVER', 'FARE_COLLECTOR', 'ASSISTANT'] as const
export type CrewRole = typeof CREW_ROLES[number]

// Display prefix of the duty number — derived from the role, never stored
export const CREW_ROLE_PREFIX: Record<CrewRole, string> = {
  DRIVER:         'D',
  FARE_COLLECTOR: 'C',
  ASSISTANT:      'A',
}

export function formatDutyNumber(role: CrewRole, dutyNumber: number): string {
  return `${CREW_ROLE_PREFIX[role]}${dutyNumber}`
}

export const dutySummarySchema = z.object({
  spreadMinutes:   z.number(),
  workMinutes:     z.number(),
  paidMinutes:     z.number(),
  breakMinutes:    z.number(),
  overtimeMinutes: z.number(),
  nightMinutes:    z.number(),
  pieceCount:      z.number(),
  vehicleChanges:  z.number(),
  lineChanges:     z.number(),
  // distinct lines operated in the day (A→B→A = 2)
  lineCount:       z.number(),
  // effective sign-on / sign-off (explicit activities or the implicit settings minutes)
  startMinutes:    z.number().nullable(),
  endMinutes:      z.number().nullable(),
  // rough estimate assuming the same duty is worked the next day — null when the day
  // type doesn't run on consecutive days; the real rest comes from the roster
  interShiftRestMinutes: z.number().nullable(),
  // time between pieces that is neither the meal nor the split interval — at the employer's
  // disposal, so worked (includes walking between pieces)
  idleMinutes:     z.number().default(0),
  // meters walked between pieces at different places
  walkMeters:      z.number().default(0),
  // the duty's stops — vehicle idle within its pieces + gaps between them (not breaks, not the
  // split interval): total and longest one (fractioned intrajornada)
  stopMinutes:        z.number().default(0),
  longestStopMinutes: z.number().default(0),
  // how a STRAIGHT duty met the intrajornada (settings.mealRule) — null when it didn't / n.a.
  mealForm:        z.enum(['CONTINUOUS', 'FRACTIONED']).nullable().default(null),
})
export type DutySummary = z.infer<typeof dutySummarySchema>

// A rule not met — flagged, never blocks a save. Range criteria flag only outside
// [floor, ceiling] (`error`); outside the ideal they only cost score (see settings-crew.schema.ts).
// `warning` is left for the non-range checks (MIN_PIECE, MEAL_LOCATION, TRAVEL_GAP without matrix).
export const dutyIssueSchema = z.object({
  code: z.enum([
    'WORK_TIME', 'SPREAD', 'MEAL_BREAK', 'SPLIT_INTERVAL', 'WALK_DISTANCE', 'MEAL_REQUIRED', 'PIECE_OFF_SERVICE',
    'CONTINUOUS_DRIVING', 'MIN_PIECE', 'TRAVEL_GAP', 'BRANCH_MISMATCH', 'MEAL_LOCATION',
  ]),
  severity: z.enum(['warning', 'error']),
  value:    z.number(),
  limit:    z.number().optional(),
  // when the rule points at a specific piece — lets the Gantt flag that block span
  pieceId:  z.string().optional(),
  // when it points at a specific activity (e.g. a meal break outside a meal locality)
  activityId: z.string().optional(),
})
export type DutyIssue = z.infer<typeof dutyIssueSchema>

export const dutySchema = withMeta(
  z.object({
    id: z.uuid().meta({ listVisibility: 'hidden' }),

    crewPlanId: z.uuid().meta({
      label:          'Escala',
      showInForm:     false,
      listVisibility: 'hidden',
    }),

    role: z.enum(CREW_ROLES).default('DRIVER').meta({
      label:          'Papel',
      listVisibility: 'visible',
      filter:         true,
      defaultValue:   'DRIVER',
      className:      'md:w-40',
      keybind:        'p',
      optionLabels: {
        DRIVER:         'Motorista',
        FARE_COLLECTOR: 'Cobrador',
        ASSISTANT:      'Auxiliar',
      },
    }),

    // numbered per role; omitted on create → next free number for the role (DutyService)
    dutyNumber: z.number().int().min(1).optional().meta({
      label:          'Tabela',
      listVisibility: 'visible',
      className:      'md:w-28',
      keybind:        'n',
    }),

    kind: z.enum(['STRAIGHT', 'SPLIT', 'TRIPPER', 'STANDBY']).default('STRAIGHT').meta({
      label:          'Tipo',
      listVisibility: 'visible',
      filter:         true,
      defaultValue:   'STRAIGHT',
      className:      'md:w-44',
      keybind:        't',
      optionLabels: {
        STRAIGHT: 'Corrida',
        SPLIT:    'Dupla pegada',
        TRIPPER:  'Meia jornada',
        STANDBY:  'Reserva',
      },
    }),

    branchId: z.uuid().optional().nullable().meta({
      label:          'Operador',
      widget:         'select',
      resource:       'branch',
      domain:         'core',
      labelField:     'name',
      listVisibility: 'visible',
      keybind:        'o',
    }),

    summary: z.record(z.string(), z.unknown()).optional().meta({
      label:          'Resumo',
      listVisibility: 'never',
      showInForm:     false,
    }),

    isStale: z.boolean().default(false).meta({
      label:          'Desatualizada',
      listVisibility: 'hidden',
      showInForm:     false,
    }),

    issues: z.array(z.record(z.string(), z.unknown())).optional().nullable().meta({
      label:          'Pendências',
      listVisibility: 'never',
      showInForm:     false,
    }),

    hasIssues: z.boolean().default(false).meta({
      label:          'Com pendências',
      listVisibility: 'hidden',
      showInForm:     false,
    }),

    // DutyConstraints — { locked?: true }: the crew solver never changes a locked duty
    constraints: z.record(z.string(), z.unknown()).optional().meta({
      label:          'Restrições',
      listVisibility: 'never',
      showInForm:     false,
    }),

    notes: z.string().optional().meta({
      label:          'Observações',
      listVisibility: 'hidden',
      widget:         'textarea',
    }),

    createdAt: z.date().meta({ showInForm: false, listVisibility: 'never' }),
    updatedAt: z.date().meta({ showInForm: false, listVisibility: 'never' }),
  }),
  {
    label:       'Jornada',
    labelPlural: 'Jornadas',
    nameField:   'dutyNumber',
    defaultSort: { field: 'dutyNumber', order: 'asc' },
    breadcrumb:  [
      { resource: 'crew-plan', contextField: 'crewPlanId', listLabel: 'Escalas', nameField: 'description' },
    ],
  },
)

export const createDutySchema = dutySchema.omit({ id: true, createdAt: true, updatedAt: true })
export const updateDutySchema  = createDutySchema.partial()

export type Duty          = z.infer<typeof dutySchema>
export type CreateDutyDto = z.infer<typeof createDutySchema>
export type UpdateDutyDto = z.infer<typeof updateDutySchema>
