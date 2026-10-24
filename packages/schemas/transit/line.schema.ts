import { z } from 'zod'
import '../zod-meta'
import { withMeta } from '../with-meta'
import { vehicleTypeSchema, VEHICLE_TYPE_LABELS } from './vehicle-type'
import { externalCodesSchema } from './plan-export/external-system'

const windowEntrySchema = z.object({
  from:            z.number().min(0).max(23.5).default(0).meta({ label: 'De',             min: 0, max: 23.5 }),
  to:              z.number().min(0).max(23.5).default(23.5).meta({ label: 'Até',           min: 0, max: 23.5 }),
  minutes:         z.number().positive().min(1).meta({ label: 'Viagem (min)',  min: 1 }),
  intervalMinutes: z.number().min(0).default(0).meta({ label: 'Intervalo (min)', min: 0 }),
  isDerived:       z.boolean().optional().meta({ label: 'Inferida' }),
})

export const lineVehicleTypesSchema = z.object({
  allowed:   z.array(vehicleTypeSchema).default([]).meta({ label: 'Permitidos', optionLabels: VEHICLE_TYPE_LABELS }),
  preferred: vehicleTypeSchema.nullable().default(null).meta({ label: 'Preferido', optionLabels: VEHICLE_TYPE_LABELS }),
})

export type LineVehicleTypes = z.infer<typeof lineVehicleTypesSchema>

export const lineSchema = withMeta(
  z.object({
    id: z.uuid().meta({listVisibility: 'hidden'}),

    code: z.string().min(1).max(20).meta({
      label:          'Código',
      listVisibility: 'visible',
      className:      'md:w-32',
      keybind:        'c',
      filter: true
    }),

    name: z.string().min(2).meta({
      label:          'Nome',
      listVisibility: 'visible',
      className: 'md:w-1/2',
      keybind:        'g',
      filter: true
    }),

    type: z.enum(['URBAN', 'METROPOLITAN', 'RURAL', 'SPECIAL']).default('URBAN').meta({
      label:          'Tipo',
      listVisibility: 'visible',
      filter:         true,
      className:      'md:w-1/4',
      keybind:        'y',
      optionLabels: {
        URBAN:        'Urbano',
        METROPOLITAN: 'Metropolitano',
        RURAL:        'Rural',
        SPECIAL:      'Especial',
      },
    }),

    scopeId: z.uuid().optional().meta({
      label:          'Escopo',
      widget:         'select',
      resource:       'scope',
      domain:         'transit',
      labelField:     'name',
      listVisibility: 'visible',
      filter:         { type: 'relation', endpoint: 'transit/scope', labelField: 'name' },
      className:      'md:w-1/4',
    }),

    // marks this line as a variant of another (e.g. "308B" derived from "308") — see
    // LineService for the "no chains" invariant enforced when this is set
    parentLineId: z.uuid().optional().meta({
      label:          'Linha base',
      widget:         'select',
      resource:       'transit-line',
      domain:         'transit',
      labelField:     'code',
      listVisibility: 'hidden',
      className:      'md:w-1/4',
    }),

    // LineOperator — the empresas operating the line; none = any operator of the Scope.
    // Each one must be an operator of the line's Scope (LineService)
    operatorBranchIds: z.array(z.uuid()).default([]).meta({
      label:          'Empresas operadoras',
      helpText:       'Vazio: qualquer empresa do escopo opera a linha.',
      widget:         'multi-select',
      resource:       'branch',
      domain:         'core',
      labelField:     'name',
      listVisibility: 'hidden',
      importName:     'operatorBranches',
    }),

    isActive: z.boolean().default(true).meta({
      label:          'Ativo',
      widget:         'switch',
      listVisibility: 'visible',
      filter:         true,
      defaultValue:   true,
      keybind:        'a',
    }),
    metrics: z.object({
      extensionKm: z.object({
        OUTBOUND:  z.number().positive().optional().meta({ label: 'Ida (km)' }),
        INBOUND:   z.number().positive().optional().meta({ label: 'Volta (km)' }),
        CIRCULAR:  z.number().positive().optional().meta({ label: 'Circular (km)' }),
      }).optional().meta({ label: 'Extensão por Sentido' }),
      // keyed by dayTypeCode first (DayType.code is a free-text resource, not a fixed
      // enum, hence z.record rather than a fixed OUTBOUND/INBOUND/CIRCULAR-style object)
      // — same convention as demand, applied via LineService.applyWindows/cycle-map.
      windows: z.record(z.string(), z.object({
        OUTBOUND: z.array(windowEntrySchema).optional().meta({ label: 'Ida' }),
        INBOUND:  z.array(windowEntrySchema).optional().meta({ label: 'Volta' }),
        CIRCULAR: z.array(windowEntrySchema).optional().meta({ label: 'Circular' }),
      })).optional().meta({ label: 'Janelas de Ciclo', resource: 'day-type', domain: 'transit', keyField: 'code', labelField: 'name' }),
      // used for supply calculation; the breakdown by direction is for informational purposes only
      // and is not currently being used
      renewalIndex: z.object({
        overall:  z.number().optional().meta({ label: 'Geral' }),
        OUTBOUND: z.number().optional().meta({ label: 'Ida' }),
        INBOUND:  z.number().optional().meta({ label: 'Volta' }),
        CIRCULAR: z.number().optional().meta({ label: 'Circular' }),
      }).optional().meta({ label: 'Índice de Renovação (%)' }),
    }).optional().meta({
      label:          'Métricas',
      widget:         'object-editor',
      showInForm:     true,
      listVisibility: 'never',
    }),

    // vehicle types the line runs with — read by the vehicle solver
    // (docs/architecture/transit/solver.md): `allowed` is a hard rule (empty = any type),
    // `preferred` only scores. A trip's requiredVehicleType overrides both.
    vehicleTypes: lineVehicleTypesSchema.optional().meta({
      label:          'Tipos de Veículo',
      listVisibility: 'never',
      importFlatten:  true,
    }),

    // code of this line in each external system the plan is exported to — blank uses `code`
    externalCodes: externalCodesSchema,

    notes: z.string().optional().meta({
      label:          'Observações',
      widget:         'textarea',
      listVisibility: 'never',
    }),

    createdAt: z.date().meta({ showInForm: false, listVisibility: 'never' }),
    updatedAt: z.date().meta({ showInForm: false, listVisibility: 'never' }),
  }),
  {
    label:       'Linha',
    labelPlural: 'Linhas',
    featured:    1,
    nameField:   'code',
    icon:        'Route',
    afterCreate: '/transit/transit-route?lineId={id}',
    defaultSort: { field: 'code', order: 'asc' },
    importKey:   'code',
    // every enum value appears at least once — the file is how users learn the accepted values;
    // a line-base (parentLine) comes from the database or from an earlier row of the same file
    importExamples: [
      { code: '308',  name: 'Centro / Bairro Norte',     type: 'URBAN',        scope: 'Escopo Urbano', operatorBranches: 'Filial Centro|Filial Norte', isActive: 'SIM',
        'externalCodes.GLOBUS': '0308', 'vehicleTypes.allowed': 'STANDARD|ARTICULATED', 'vehicleTypes.preferred': 'STANDARD' },
      { code: '308B', name: 'Centro / Bairro Norte (B)', type: 'URBAN',        scope: 'Escopo Urbano', parentLine: '308', 'vehicleTypes.preferred': 'ARTICULATED',
        notes: 'Variante: a linha base vem do banco ou de uma linha anterior do arquivo' },
      { code: '501',  name: 'Cuiabá / Várzea Grande',    type: 'METROPOLITAN', scope: 'Escopo Metropolitano',
        'vehicleTypes.allowed': 'BI_ARTICULATED|ARTICULATED', 'vehicleTypes.preferred': 'BI_ARTICULATED' },
      { code: '701',  name: 'Distrito Rural',            type: 'RURAL',        isActive: 'NAO', 'vehicleTypes.allowed': 'MICRO_BUS|MINIBUS', 'vehicleTypes.preferred': 'MICRO_BUS' },
      { code: '900',  name: 'Linha Especial Evento',     type: 'SPECIAL',      'vehicleTypes.allowed': 'VAN', 'vehicleTypes.preferred': 'VAN' },
      { code: '310',  'externalCodes.GLOBUS': '0310', 'vehicleTypes.preferred': 'MINIBUS',
        notes: 'Linha já cadastrada: só os subcampos preenchidos mudam, o resto é mantido' },
    ],
    groups: {
      'Metricas':   ['metrics'],
    },
  },
)

export const createLineSchema = lineSchema.omit({ id: true, createdAt: true, updatedAt: true })
export const updateLineSchema  = createLineSchema.partial()

export type Line          = z.infer<typeof lineSchema>
export type CreateLineDto = z.infer<typeof createLineSchema>
export type UpdateLineDto = z.infer<typeof updateLineSchema>
