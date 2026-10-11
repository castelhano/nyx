import { z } from 'zod'
import '../zod-meta'
import { withMeta } from '../with-meta'

// A date's real operation of a transit Scope — see DailyOperation in transit.prisma. Created by
// materializing the plans in force on the date (DailyOperationService.create).

export const DAILY_STATUS_LABEL: Record<string, string> = {
  PLANNED:   'Planejada',
  PUBLISHED: 'Publicada',
  CLOSED:    'Encerrada',
}

export const dailyOperationSchema = withMeta(
  z.object({
    id: z.uuid().meta({ listVisibility: 'hidden' }),

    scopeId: z.uuid().meta({
      label:          'Escopo',
      widget:         'select',
      resource:       'scope',
      domain:         'transit',
      labelField:     'name',
      listVisibility: 'visible',
      filter:         { type: 'relation', endpoint: 'transit/scope', labelField: 'name' },
      className:      'md:w-1/3',
      keybind:        'e',
    }),

    date: z.date().meta({
      label:          'Data',
      listVisibility: 'visible',
      filter:         { type: 'date_range' },
      className:      'md:w-1/4',
      defaultValue:   '$today',
      keybind:        'd',
    }),

    dayTypeId: z.uuid().optional().meta({
      label:          'Tipo de Dia',
      widget:         'select',
      resource:       'day-type',
      domain:         'transit',
      labelField:     'name',
      listVisibility: 'visible',
      showInForm:     false,
    }),

    status: z.enum(['PLANNED', 'PUBLISHED', 'CLOSED']).default('PLANNED').meta({
      label:          'Situação',
      widget:         'badge',
      listVisibility: 'visible',
      filter:         true,
      showInForm:     false,
      optionLabels:   DAILY_STATUS_LABEL,
      optionColors:   { PLANNED: 'warning', PUBLISHED: 'success', CLOSED: 'muted' },
    }),

    sources:     z.array(z.record(z.string(), z.unknown())).optional().meta({ label: 'Origem', showInForm: false, listVisibility: 'never' }),
    summary:     z.record(z.string(), z.unknown()).optional().nullable().meta({ label: 'Resumo', showInForm: false, listVisibility: 'never' }),
    publishedAt: z.date().optional().nullable().meta({ label: 'Publicada em', showInForm: false, listVisibility: 'hidden' }),
    closedAt:    z.date().optional().nullable().meta({ label: 'Encerrada em', showInForm: false, listVisibility: 'never' }),

    createdAt: z.date().meta({ showInForm: false, listVisibility: 'never' }),
    updatedAt: z.date().meta({ showInForm: false, listVisibility: 'never' }),
  }),
  {
    label:       'Escala Diária',
    labelPlural: 'Escalas Diárias',
    featured:    3,
    nameField:   'date',
    icon:        'CalendarClock',
    defaultSort: { field: 'date', order: 'desc' },
    afterCreate: '/transit/daily-operation/{id}',
  },
)

export const createDailyOperationSchema = dailyOperationSchema.pick({ scopeId: true, date: true })
export const updateDailyOperationSchema  = createDailyOperationSchema.partial()

export type DailyOperation          = z.infer<typeof dailyOperationSchema>
export type CreateDailyOperationDto = z.infer<typeof createDailyOperationSchema>
export type UpdateDailyOperationDto = z.infer<typeof updateDailyOperationSchema>

// the logical plan each line of the day was copied from
export interface DailySource {
  vehiclePlanId: string
  crewPlanId:    string | null
  dayTypeId:     string
  lineIds:       string[]
}

// ── the day's own issues (besides the plan's DutyIssue / VehicleBlockIssue) ──────────

export const DAILY_ISSUE_CODES = [
  // duty / crew
  'DUTY_UNASSIGNED',       // a DRIVER duty with nobody
  'CREW_ABSENT',           // approved absence on the date
  'CREW_ON_DAY_OFF',       // day off of the rest pattern (or a DAY_OFF/COMP_OFF entry)
  'CREW_MULTIPLE_DUTIES',  // more than one duty on the day
  'CREW_INACTIVE',         // employee not active / out of the generator
  'NO_SHIFT',              // no shift in force for the crew member
  'SHIFT_WINDOW',          // outside the crew member's window (shift + bounds + time-window request)
  'LINE_NOT_ALLOWED',      // a line he may not operate (branch's line access mode)
  'VEHICLE_TYPE_BLOCKED',  // a vehicle type blocked for him
  'CREW_BRANCH_MISMATCH',  // crew member of another empresa than the duty's
  'INTER_SHIFT_REST',      // rest from / to the neighboring day's duty below the floor
  'LICENSE_EXPIRED',       // driver's license (CNH) expired
  'COURSE_EXPIRED',        // collective transport course expired
  // block / vehicle
  'BLOCK_NO_VEHICLE',
  'VEHICLE_DOUBLE',        // same vehicle on overlapping blocks
  'VEHICLE_UNAVAILABLE',   // inactive or out of service on the date
  'VEHICLE_TYPE_MISMATCH', // type not accepted by the block's lines / trips
  'VEHICLE_BRANCH_MISMATCH',
  'BLOCK_NO_CREW',         // service span with no DRIVER piece
] as const
export type DailyIssueCode = typeof DAILY_ISSUE_CODES[number]

export interface DailyIssue {
  code:     DailyIssueCode
  severity: 'warning' | 'error'
  // minutes or count, when it has one
  value?:   number
  // the crew member it is about (duty issues)
  crewMemberId?: string
}

export const DAILY_ISSUE_LABEL: Record<DailyIssueCode, string> = {
  DUTY_UNASSIGNED:         'Tabela sem operador',
  CREW_ABSENT:             'Operador com ausência aprovada',
  CREW_ON_DAY_OFF:         'Operador de folga',
  CREW_MULTIPLE_DUTIES:    'Operador em mais de uma tabela',
  CREW_INACTIVE:           'Operador inativo',
  NO_SHIFT:                'Operador sem turno',
  SHIFT_WINDOW:            'Fora do horário do operador',
  LINE_NOT_ALLOWED:        'Linha não permitida ao operador',
  VEHICLE_TYPE_BLOCKED:    'Tipo de veículo bloqueado ao operador',
  CREW_BRANCH_MISMATCH:    'Operador de outra empresa',
  INTER_SHIFT_REST:        'Interjornada abaixo do mínimo',
  LICENSE_EXPIRED:         'CNH vencida',
  COURSE_EXPIRED:          'Curso de transporte coletivo vencido',
  BLOCK_NO_VEHICLE:        'Sem veículo',
  VEHICLE_DOUBLE:          'Veículo em dois carros ao mesmo tempo',
  VEHICLE_UNAVAILABLE:     'Veículo indisponível',
  VEHICLE_TYPE_MISMATCH:   'Tipo de veículo não aceito',
  VEHICLE_BRANCH_MISMATCH: 'Veículo de outra empresa',
  BLOCK_NO_CREW:           'Carro sem motorista em parte do serviço',
}

// DailyOperation.summary
export interface DailySummary {
  // issue counts by code — the plan's (duty/block) and the day's
  issues:          Record<string, number>
  dutyCount:       number
  assignedCount:   number
  blockCount:      number
  vehicleCount:    number
  // trips without a vehicle (mixed day) / cancelled
  uncoveredTrips:  number
  cancelledTrips:  number
}
