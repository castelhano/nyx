import { z } from 'zod'
import '../zod-meta'
import { withMeta } from '../with-meta'
import { CREW_ROLES, CREW_ROLE_LABEL } from './duty.schema'
import { vehicleTypeSchema, VEHICLE_TYPE_LABELS } from './vehicle-type'

export const OVERTIME_PREFERENCE_LABEL: Record<string, string> = {
  LIKES:   'Gosta de hora extra',
  NEUTRAL: 'Indiferente',
  AVOIDS:  'Evita hora extra',
}

const crewBreadcrumb = [
  { resource: 'crew-member', contextField: 'crewMemberId', listLabel: 'Operadores', nameField: 'displayName', nameFirstWord: false },
]

// A crew member's operational profile — see CrewMember in transit.prisma. code, displayName, branchId
// and shiftId are computed by CrewMemberService (from the Employee and the current
// CrewMemberShift); shiftId on create/update starts a new CrewMemberShift today.
export const crewMemberSchema = withMeta(
  z.object({
    id: z.uuid().meta({ listVisibility: 'hidden' }),

    employeeId: z.uuid().meta({
      label:                'Funcionário',
      widget:               'combobox',
      resource:             'employee',
      domain:               'hr',
      labelField:           'fullName',
      relatedDisplayFields: ['code'],
      listVisibility:       'hidden',
      lazyEdit:             true,
      className:            'md:w-1/2',
      keybind:              'f',
    }),

    // the Employee's code — the reference (nameField) typed in lookups
    code: z.string().optional().meta({
      label:          'Matrícula',
      listVisibility: 'hidden',
      showInForm:     false,
      sortable:       false,
      computed:       true,
    }),

    // "1234 — Fulano de Tal"
    displayName: z.string().optional().meta({
      label:          'Operador',
      listVisibility: 'visible',
      showInForm:     false,
      sortable:       false,
      computed:       true,
    }),

    // the Employee's branch
    branchId: z.uuid().optional().meta({
      label:          'Empresa',
      widget:         'select',
      resource:       'branch',
      domain:         'core',
      labelField:     'name',
      listVisibility: 'visible',
      showInForm:     false,
      sortable:       false,
      computed:       true,
    }),

    // the current CrewMemberShift — changing it starts a new one today (history in "Turnos")
    shiftId: z.uuid().optional().meta({
      label:          'Turno atual',
      helpText:       'Trocar aqui inicia o novo turno hoje. Para outras datas: botão Turnos (F6).',
      widget:         'select',
      resource:       'crew-shift',
      domain:         'transit',
      labelField:     'code',
      listVisibility: 'visible',
      sortable:       false,
      computed:       true,
      className:      'md:w-1/4',
      keybind:        't',
    }),

    role: z.enum(CREW_ROLES).default('DRIVER').meta({
      label:          'Função',
      listVisibility: 'visible',
      filter:         true,
      defaultValue:   'DRIVER',
      className:      'md:w-1/4',
      optionLabels:   CREW_ROLE_LABEL,
    }),

    isRosterable: z.boolean().default(true).meta({
      label:          'Entra na geração de escala',
      widget:         'switch',
      listVisibility: 'visible',
      filter:         true,
      defaultValue:   'true',
    }),

    notBeforeMinutes: z.number().int().min(0).max(2880).optional().nullable().meta({
      label:          'Não inicia antes de',
      row:            'Horário',
      helpText:       'Vazio: valem os limites do turno.',
      widget:         'time',
      listVisibility: 'hidden',
      className:      'md:w-40',
    }),

    notAfterMinutes: z.number().int().min(0).max(2880).optional().nullable().meta({
      label:          'Não termina depois de',
      row:            'Horário',
      widget:         'time',
      listVisibility: 'hidden',
      className:      'md:w-40',
    }),

    restPatternId: z.uuid().optional().nullable().meta({
      label:          'Regime de folga',
      helpText:       'Vazio: o regime do turno.',
      widget:         'select',
      resource:       'rest-pattern',
      domain:         'transit',
      labelField:     'name',
      listVisibility: 'hidden',
      className:      'md:w-[20.75rem]',
    }),

    // the group's offset from the pattern's anchor (restGroupOffsets)
    restOffset: z.number().int().min(0).default(0).meta({
      label:          'Grupo no regime',
      helpText:       'Grupos do mesmo regime revezam as folgas.',
      widget:         'rest-group',
      listVisibility: 'hidden',
      className:      'md:w-[20.75rem]',
    }),

    blockedVehicleTypes: z.array(vehicleTypeSchema).default([]).meta({
      label:          'Não opera',
      helpText:       'Tipos de veículo que o operador não pode operar.',
      widget:         'multi-select',
      optionLabels:   VEHICLE_TYPE_LABELS,
      listVisibility: 'never',
    }),

    preferredVehicleId: z.uuid().optional().nullable().meta({
      label:          'Carro fixo',
      helpText:       'O gerador tenta manter o operador neste carro. Vazio: o carro habitual dele.',
      widget:         'combobox',
      resource:       'vehicle',
      domain:         'fleet',
      labelField:     'code',
      listVisibility: 'hidden',
      lazyEdit:       true,
      className:      'md:w-[20.75rem]',
    }),

    weeklyHours: z.number().int().min(1).max(44).optional().nullable().meta({
      label:          'Semanal (h)',
      row:            'Carga',
      helpText:       'Vazio: a do contrato, ou a padrão da empresa. Mensal = semanal × 5.',
      listVisibility: 'hidden',
      className:      'md:w-28',
    }),

    overtimePreference: z.enum(['LIKES', 'NEUTRAL', 'AVOIDS']).default('NEUTRAL').meta({
      label:          'Hora extra',
      row:            'Carga',
      listVisibility: 'hidden',
      defaultValue:   'NEUTRAL',
      className:      'md:w-52',
      optionLabels:   OVERTIME_PREFERENCE_LABEL,
    }),

    licenseCategory: z.string().max(5).optional().meta({
      label:          'Categoria',
      row:            'CNH',
      listVisibility: 'hidden',
      className:      'md:w-40',
    }),

    licenseExpiresAt: z.date().optional().nullable().meta({
      label:          'Validade',
      row:            'CNH',
      listVisibility: 'hidden',
      className:      'md:w-44',
    }),

    courseExpiresAt: z.date().optional().nullable().meta({
      label:          'Validade curso transp. coletivo',
      listVisibility: 'hidden',
      className:      'md:w-44',
    }),

    notes: z.string().optional().meta({
      label:          'Observações',
      widget:         'textarea',
      listVisibility: 'never',
    }),

    createdAt: z.date().meta({ showInForm: false, listVisibility: 'never' }),
    updatedAt: z.date().meta({ showInForm: false, listVisibility: 'never' }),
  }),
  {
    label:         'Operador',
    labelPlural:   'Operadores',
    featured:      2,
    nameField:     'code',
    nameFirstWord: false,
    icon:          'IdCard',
    groups: {
      'Escala':     ['notBeforeMinutes', 'notAfterMinutes', 'restPatternId', 'restOffset', 'blockedVehicleTypes', 'preferredVehicleId', 'weeklyHours', 'overtimePreference'],
      'Documentos': ['licenseCategory', 'licenseExpiresAt', 'courseExpiresAt'],
    },
  },
)

export const createCrewMemberSchema = crewMemberSchema.omit({ id: true, createdAt: true, updatedAt: true, code: true, displayName: true, branchId: true })
export const updateCrewMemberSchema  = createCrewMemberSchema.partial()

export type CrewMember          = z.infer<typeof crewMemberSchema>
export type CreateCrewMemberDto = z.infer<typeof createCrewMemberSchema>
export type UpdateCrewMemberDto = z.infer<typeof updateCrewMemberSchema>

// ── shift history ─────────────────────────────────────────────────────────────

export const crewMemberShiftSchema = withMeta(
  z.object({
    id: z.uuid().meta({ listVisibility: 'hidden' }),

    crewMemberId: z.uuid().meta({ label: 'Operador', showInForm: false, listVisibility: 'hidden' }),

    shiftId: z.uuid().meta({
      label:          'Turno',
      widget:         'select',
      resource:       'crew-shift',
      domain:         'transit',
      labelField:     'code',
      listVisibility: 'visible',
      className:      'md:w-44',
      keybind:        't',
    }),

    validFrom: z.date().meta({
      label:          'Desde',
      listVisibility: 'visible',
      className:      'md:w-44',
      defaultValue:   '$today',
      keybind:        'd',
    }),

    validTo: z.date().optional().nullable().meta({
      label:          'Até',
      helpText:       'Vazio: vigente. Um novo turno encerra o anterior no dia anterior ao seu início.',
      listVisibility: 'visible',
      className:      'md:w-44',
    }),

    createdAt: z.date().meta({ showInForm: false, listVisibility: 'never' }),
    updatedAt: z.date().meta({ showInForm: false, listVisibility: 'never' }),
  }),
  {
    label:       'Turno do Operador',
    labelPlural: 'Turnos',
    nameField:   'validFrom',
    icon:        'Sunrise',
    defaultSort: { field: 'validFrom', order: 'desc' },
    breadcrumb:  crewBreadcrumb.map(b => ({ ...b, keybind: 'f6', order: 1 })),
  },
)

export const createCrewMemberShiftSchema = crewMemberShiftSchema.omit({ id: true, createdAt: true, updatedAt: true })
export const updateCrewMemberShiftSchema  = createCrewMemberShiftSchema.partial()

export type CrewMemberShift          = z.infer<typeof crewMemberShiftSchema>
export type CreateCrewMemberShiftDto = z.infer<typeof createCrewMemberShiftSchema>
export type UpdateCrewMemberShiftDto = z.infer<typeof updateCrewMemberShiftSchema>

// ── lines ─────────────────────────────────────────────────────────────────────

export const CREW_LINE_ACCESS_LABEL: Record<string, string> = {
  ENABLED: 'Habilitada',
  BLOCKED: 'Bloqueada',
}

export const crewMemberLineSchema = withMeta(
  z.object({
    id: z.uuid().meta({ listVisibility: 'hidden' }),

    crewMemberId: z.uuid().meta({ label: 'Operador', showInForm: false, listVisibility: 'hidden' }),

    lineId: z.uuid().meta({
      label:          'Linha',
      widget:         'combobox',
      resource:       'transit-line',
      domain:         'transit',
      labelField:     'code',
      listVisibility: 'visible',
      className:      'md:w-1/3',
      keybind:        'l',
    }),

    access: z.enum(['ENABLED', 'BLOCKED']).optional().nullable().meta({
      label:          'Acesso',
      helpText:       'Empresa no modo "habilitadas": o operador só opera as linhas Habilitadas. No modo "bloqueadas": opera todas menos as Bloqueadas.',
      listVisibility: 'visible',
      className:      'md:w-1/4',
      keybind:        'a',
      optionLabels:   CREW_LINE_ACCESS_LABEL,
    }),

    rank: z.number().int().min(1).max(10).optional().nullable().meta({
      label:          'Preferência',
      helpText:       '1 = primária, 2 = secundária... Só entre as linhas que o operador pode operar.',
      listVisibility: 'visible',
      className:      'md:w-28',
      keybind:        'p',
    }),

    createdAt: z.date().meta({ showInForm: false, listVisibility: 'never' }),
    updatedAt: z.date().meta({ showInForm: false, listVisibility: 'never' }),
  }),
  {
    label:       'Linha do Operador',
    labelPlural: 'Linhas',
    nameField:   'lineId',
    icon:        'Route',
    defaultSort: { field: 'rank', order: 'asc' },
    breadcrumb:  crewBreadcrumb.map(b => ({ ...b, keybind: 'f7', order: 2 })),
  },
)

export const createCrewMemberLineSchema = crewMemberLineSchema.omit({ id: true, createdAt: true, updatedAt: true })
export const updateCrewMemberLineSchema  = createCrewMemberLineSchema.partial()

export type CrewMemberLine          = z.infer<typeof crewMemberLineSchema>
export type CreateCrewMemberLineDto = z.infer<typeof createCrewMemberLineSchema>
export type UpdateCrewMemberLineDto = z.infer<typeof updateCrewMemberLineSchema>

// ── occurrences ───────────────────────────────────────────────────────────────

export const CREW_OCCURRENCE_KIND_LABEL: Record<string, string> = {
  ABSENCE:     'Ausência',
  TIME_WINDOW: 'Restrição de horário',
}

export const CREW_OCCURRENCE_STATUS_LABEL: Record<string, string> = {
  REQUESTED: 'Solicitada',
  APPROVED:  'Aprovada',
  REJECTED:  'Recusada',
  CANCELLED: 'Cancelada',
}

export const CREW_OCCURRENCE_ORIGIN_LABEL: Record<string, string> = {
  PORTAL:          'Portal do operador',
  STAFF_ON_BEHALF: 'Pedido do operador (lançado)',
  STAFF:           'Lançamento da empresa',
}

export const crewOccurrenceSchema = withMeta(
  z.object({
    id: z.uuid().meta({ listVisibility: 'hidden' }),

    crewMemberId: z.uuid().meta({ label: 'Operador', showInForm: false, listVisibility: 'hidden' }),

    kind: z.enum(['ABSENCE', 'TIME_WINDOW']).default('ABSENCE').meta({
      label:          'Tipo',
      listVisibility: 'visible',
      filter:         true,
      defaultValue:   'ABSENCE',
      className:      'md:w-1/4',
      keybind:        't',
      optionLabels:   CREW_OCCURRENCE_KIND_LABEL,
    }),

    absenceTypeId: z.uuid().optional().nullable().meta({
      label:          'Motivo',
      helpText:       'Ausências.',
      widget:         'select',
      resource:       'crew-absence-type',
      domain:         'transit',
      labelField:     'name',
      listVisibility: 'visible',
      className:      'md:w-1/3',
      keybind:        'm',
    }),

    startDate: z.date().meta({
      label:          'De',
      listVisibility: 'visible',
      filter:         { type: 'date_range' },
      className:      'md:w-1/4',
      defaultValue:   '$today',
      keybind:        'd',
    }),

    endDate: z.date().meta({
      label:          'Até',
      listVisibility: 'visible',
      className:      'md:w-1/4',
      defaultValue:   '$today',
    }),

    startNotBefore: z.number().int().min(0).max(2880).optional().nullable().meta({
      label:          'Não inicia antes de',
      helpText:       'Restrição de horário.',
      widget:         'time',
      listVisibility: 'visible',
      className:      'md:w-28',
    }),

    endNotAfter: z.number().int().min(0).max(2880).optional().nullable().meta({
      label:          'Não termina depois de',
      helpText:       'Restrição de horário — ex.: "parar até as 14:00".',
      widget:         'time',
      listVisibility: 'visible',
      className:      'md:w-28',
    }),

    status: z.enum(['REQUESTED', 'APPROVED', 'REJECTED', 'CANCELLED']).default('APPROVED').meta({
      label:          'Situação',
      widget:         'badge',
      listVisibility: 'visible',
      filter:         true,
      defaultValue:   'APPROVED',
      className:      'md:w-1/4',
      optionLabels:   CREW_OCCURRENCE_STATUS_LABEL,
      optionColors:   { REQUESTED: 'warning', APPROVED: 'success', REJECTED: 'destructive', CANCELLED: 'muted' },
    }),

    origin: z.enum(['PORTAL', 'STAFF_ON_BEHALF', 'STAFF']).default('STAFF').meta({
      label:          'Origem',
      helpText:       'Pedido do operador é sempre de um dia e guarda o que foi pedido.',
      listVisibility: 'hidden',
      filter:         true,
      defaultValue:   'STAFF',
      className:      'md:w-1/3',
      optionLabels:   CREW_OCCURRENCE_ORIGIN_LABEL,
    }),

    // what was asked — written once by the service for requests
    requested: z.record(z.string(), z.unknown()).optional().nullable().meta({
      label:          'Pedido original',
      showInForm:     false,
      listVisibility: 'never',
    }),

    createdByUserId:  z.uuid().optional().nullable().meta({ label: 'Lançado por', showInForm: false, listVisibility: 'never' }),
    reviewedByUserId: z.uuid().optional().nullable().meta({ label: 'Analisado por', showInForm: false, listVisibility: 'never' }),
    reviewedAt:       z.date().optional().nullable().meta({ label: 'Analisado em', showInForm: false, listVisibility: 'hidden' }),

    notes: z.string().optional().meta({
      label:          'Observações',
      widget:         'textarea',
      listVisibility: 'never',
    }),

    reviewNotes: z.string().optional().meta({
      label:          'Resposta',
      widget:         'textarea',
      listVisibility: 'never',
    }),

    createdAt: z.date().meta({ showInForm: false, listVisibility: 'hidden' }),
    updatedAt: z.date().meta({ showInForm: false, listVisibility: 'never' }),
  }),
  {
    label:       'Ocorrência',
    labelPlural: 'Ocorrências',
    nameField:   'startDate',
    icon:        'CalendarX',
    defaultSort: { field: 'startDate', order: 'desc' },
    breadcrumb:  crewBreadcrumb.map(b => ({ ...b, keybind: 'f8', order: 3 })),
  },
)

export const createCrewOccurrenceSchema = crewOccurrenceSchema.omit({ id: true, createdAt: true, updatedAt: true })
export const updateCrewOccurrenceSchema  = createCrewOccurrenceSchema.partial()

export type CrewOccurrence          = z.infer<typeof crewOccurrenceSchema>
export type CreateCrewOccurrenceDto = z.infer<typeof createCrewOccurrenceSchema>
export type UpdateCrewOccurrenceDto = z.infer<typeof updateCrewOccurrenceSchema>
