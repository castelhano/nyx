import { z } from 'zod'
import '../zod-meta'
import { withMeta } from '../with-meta'

// inferido a partir da conciliação bilhetagem x GPS: excedente de embarques na
// viagem de maior ocupação sobre a capacidade assumida do veículo — ver docs/architecture
const renewalIndexStatSchema = z.object({
  value:           z.number().meta({ label: 'Índice (%)' }),
  peakPax:         z.number().meta({ label: 'Pico de embarques' }),
  peakTripId:      z.string().meta({ label: 'Viagem de pico', showInForm: false }),
  tripCount:       z.number().meta({ label: 'Viagens amostradas' }),
  avgPax:          z.number().meta({ label: 'Média de embarques' }),
  assumedCapacity: z.number().meta({ label: 'Capacidade assumida' }),
  method:          z.enum(['real_window', 'cut_planned_end']).meta({ label: 'Método', showInForm: false }),
  computedAt:      z.string().meta({ label: 'Calculado em', showInForm: false }),
  sourceFile:      z.string().meta({ label: 'Arquivo fonte', showInForm: false }),
})

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

    isActive: z.boolean().default(true).meta({
      label:          'Ativo',
      widget:         'switch',
      listVisibility: 'visible',
      filter:         true,
      defaultValue:   'true',
      keybind:        'a',
    }),
    metrics: z.object({
      extensionKm: z.object({
        OUTBOUND:  z.number().positive().optional().meta({ label: 'Ida (km)' }),
        INBOUND:   z.number().positive().optional().meta({ label: 'Volta (km)' }),
        CIRCULAR:  z.number().positive().optional().meta({ label: 'Circular (km)' }),
      }).optional().meta({ label: 'Extensão por Sentido' }),
      windows: z.object({
        OUTBOUND: z.array(z.object({
          from:            z.number().min(0).max(23.5).default(0).meta({ label: 'De',             min: 0, max: 23.5 }),
          to:              z.number().min(0).max(23.5).default(23.5).meta({ label: 'Até',           min: 0, max: 23.5 }),
          minutes:         z.number().positive().min(1).meta({ label: 'Viagem (min)',  min: 1 }),
          intervalMinutes: z.number().min(0).default(0).meta({ label: 'Intervalo (min)', min: 0 }),
          isDerived:       z.boolean().optional().meta({ label: 'Inferida' }),
        })).optional().meta({ label: 'Ida' }),
        INBOUND: z.array(z.object({
          from:            z.number().min(0).max(23.5).default(0).meta({ label: 'De',             min: 0, max: 23.5 }),
          to:              z.number().min(0).max(23.5).default(23.5).meta({ label: 'Até',           min: 0, max: 23.5 }),
          minutes:         z.number().positive().min(1).meta({ label: 'Viagem (min)',  min: 1 }),
          intervalMinutes: z.number().min(0).default(0).meta({ label: 'Intervalo (min)', min: 0 }),
          isDerived:       z.boolean().optional().meta({ label: 'Inferida' }),
        })).optional().meta({ label: 'Volta' }),
        CIRCULAR: z.array(z.object({
          from:            z.number().min(0).max(23.5).default(0).meta({ label: 'De',             min: 0, max: 23.5 }),
          to:              z.number().min(0).max(23.5).default(23.5).meta({ label: 'Até',           min: 0, max: 23.5 }),
          minutes:         z.number().positive().min(1).meta({ label: 'Viagem (min)',  min: 1 }),
          intervalMinutes: z.number().min(0).default(0).meta({ label: 'Intervalo (min)', min: 0 }),
          isDerived:       z.boolean().optional().meta({ label: 'Inferida' }),
        })).optional().meta({ label: 'Circular' }),
      }).optional().meta({ label: 'Janelas de Ciclo' }),
      renewalIndex: z.object({
        OUTBOUND: renewalIndexStatSchema.optional().meta({ label: 'Ida' }),
        INBOUND:  renewalIndexStatSchema.optional().meta({ label: 'Volta' }),
        CIRCULAR: renewalIndexStatSchema.optional().meta({ label: 'Circular' }),
        overall:  renewalIndexStatSchema.optional().meta({ label: 'Geral' }),
      }).optional().meta({ label: 'Índice de Renovação' }),
    }).optional().meta({
      label:          'Métricas',
      widget:         'object-editor',
      showInForm:     true,
      listVisibility: 'never',
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
    label:       'Linha',
    labelPlural: 'Linhas',
    nameField:   'code',
    icon:        'Route',
    afterCreate: '/transit/transit-route?lineId={id}',
    defaultSort: { field: 'code', order: 'asc' },
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
