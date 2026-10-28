import { z } from 'zod'
import '../zod-meta'
import { withMeta } from '../with-meta'
import { CREW_ROLES, CREW_ROLE_LABEL } from './duty.schema'
import { vehicleTypeSchema, VEHICLE_TYPE_LABELS } from './vehicle-type'
import { portalPermissionsSchema } from './portal-profile.schema'

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
      importRef:            'code',
      listVisibility:       'hidden',
      lazyEdit:             true,
      className:            'md:w-1/2',
      keybind:              'f',
    }),

    // the Employee's code — the reference (nameField) typed in lookups
    code: z.string().optional().meta({
      label:          'Matrícula',
      listVisibility: 'visible',
      showInForm:     false,
      sortable:       false,
      computed:       true,
      filter:         true,
      keybind:        'c',
    }),

    // the Employee's fullName / preferredName
    fullName: z.string().optional().meta({
      label:          'Nome',
      listVisibility: 'visible',
      showInForm:     false,
      sortable:       false,
      computed:       true,
      filter:         true,
      keybind:        'g',
    }),

    preferredName: z.string().optional().nullable().meta({
      label:          'Apelido',
      listVisibility: 'hidden',
      showInForm:     false,
      sortable:       false,
      computed:       true,
      filter:         true,
      keybind:        'a',
    }),

    // "1234 — Fulano de Tal" — breadcrumb and lookups; the list shows code / fullName
    displayName: z.string().optional().meta({
      label:          'Operador',
      listVisibility: 'never',
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
      keybind:        'k',
    }),

    // on create, suggested from the employee's current job title (CrewRoleJobTitle)
    role: z.enum(CREW_ROLES).default('DRIVER').meta({
      label:           'Função',
      listVisibility:  'visible',
      filter:          true,
      defaultValue:    'DRIVER',
      className:       'md:w-1/4',
      optionLabels:    CREW_ROLE_LABEL,
      suggestEndpoint: '/transit/crew-member/suggest-role',
      suggestParams:   ['employeeId'],
    }),

    isRosterable: z.boolean().default(true).meta({
      label:          'Entra na geração de escala',
      widget:         'switch',
      listVisibility: 'visible',
      filter:         true,
      defaultValue:   true,
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
      // imported as the group's letter (restGroup), converted by CrewMemberService
      importable:     false,
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
      // only the crew member's empresa's vehicles (branchId is the Employee's, computed)
      dependsOn:      'branchId',
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

    // crew portal — null: the empresa's default profile
    portalProfileId: z.uuid().optional().nullable().meta({
      label:          'Perfil do portal',
      helpText:       'Vazio: o perfil padrão da empresa.',
      widget:         'select',
      resource:       'portal-profile',
      domain:         'transit',
      labelField:     'name',
      dependsOn:      'branchId',
      listVisibility: 'hidden',
      className:      'md:w-[20.75rem]',
    }),

    // his own permissions over the profile's — only the fields set (a quota list whole)
    portalOverride: portalPermissionsSchema.partial().optional().nullable().meta({
      label:          'Permissões próprias',
      helpText:       'Substituem as do perfil só nos campos preenchidos.',
      widget:         'object-editor',
      showInForm:     true,
      listVisibility: 'never',
      importable:     false,
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
    defaultSort:   { field: 'employee.code', order: 'asc' },
    stayOnSave:    true,
    groups: {
      'Escala':     ['notBeforeMinutes', 'notAfterMinutes', 'restPatternId', 'restOffset', 'blockedVehicleTypes', 'preferredVehicleId', 'weeklyHours', 'overtimePreference'],
      'Documentos': ['licenseCategory', 'licenseExpiresAt', 'courseExpiresAt'],
      'Portal':     ['portalProfileId', 'portalOverride'],
    },
    rowActions: [
      {
        // the portal PIN back to the CPF's first 6 digits, changed at the next login
        action:     'resetPortalPin',
        label:      'Resetar PIN do portal',
        icon:       'KeyRound',
        permission: 'update',
        method:     'POST',
        endpoint:   (row) => `/transit/crew-member/${row.id}/portal-pin/reset`,
        confirm:    {
          title:        'Resetar o PIN do portal?',
          description:  'O PIN volta para os 6 primeiros dígitos do CPF e deverá ser trocado no próximo acesso. Sessões abertas no portal são encerradas.',
          confirmLabel: 'Resetar',
        },
      },
    ],
    importKey: 'employeeId',
    // like the form: the shift starts today (on create, or when it differs from the current one)
    importFields: {
      shift: z.uuid().meta({
        label: 'Turno', widget: 'select', resource: 'crew-shift', domain: 'transit', labelField: 'code',
      }),
      restGroup: z.string().regex(/^[A-Za-z]+$/).optional().meta({ label: 'Grupo no regime (A, B…)' }),
    },
    // every enum value appears at least once — the file is how users learn the accepted values
    importExamples: [
      {
        employee: '1001', shift: 'MANHA', role: 'DRIVER', isRosterable: 'SIM', notBeforeMinutes: '5:00', notAfterMinutes: '14:30',
        restPattern: 'Escala 6x1', restGroup: 'A', blockedVehicleTypes: 'ARTICULATED|BI_ARTICULATED', preferredVehicle: '2045',
        weeklyHours: '44', overtimePreference: 'LIKES', licenseCategory: 'D', licenseExpiresAt: '15/08/2028', courseExpiresAt: '10/03/2027',
      },
      {
        employee: '1002', shift: 'TARDE', role: 'FARE_COLLECTOR', isRosterable: 'NAO', notAfterMinutes: '25:30',
        restGroup: 'B', overtimePreference: 'AVOIDS',
      },
      {
        employee: '1003', shift: 'MANHA', role: 'ASSISTANT', blockedVehicleTypes: 'STANDARD|MICRO_BUS|MINIBUS|VAN',
        overtimePreference: 'NEUTRAL', notes: 'Somente linhas do centro',
      },
      { employee: '1004', licenseExpiresAt: '20/01/2029' },
    ],
  },
)

export const createCrewMemberSchema = crewMemberSchema.omit({ id: true, createdAt: true, updatedAt: true, code: true, fullName: true, preferredName: true, displayName: true, branchId: true })
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
      keybind:        'k',
    }),

    validFrom: z.date().meta({
      label:          'Desde',
      listVisibility: 'visible',
      className:      'md:w-44',
      defaultValue:   '$today',
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
    }),

    // the empresa's priority line for him — set by staff, beyond his own preferences and with no limit
    priority: z.boolean().default(false).meta({
      label:          'Prioritária (empresa)',
      helpText:       'Definida pela empresa, além das preferências do operador e sem limite. O gerador considera as prioritárias antes das preferidas; o operador não altera.',
      widget:         'switch',
      listVisibility: 'visible',
      defaultValue:   false,
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
      keybind:        'o',
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
      helpText:       'Pedido do operador guarda o que foi pedido.',
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

    // férias only — who covers the crew member's duties in the period
    coverCrewMemberId: z.uuid().optional().nullable().meta({ label: 'Ferista', showInForm: false, listVisibility: 'never' }),

    createdAt: z.date().meta({ showInForm: false, listVisibility: 'hidden' }),
    updatedAt: z.date().meta({ showInForm: false, listVisibility: 'never' }),
  }),
  {
    label:       'Pedido',
    labelPlural: 'Pedidos',
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
