import { z } from 'zod'
import '../zod-meta'
import { withMeta } from '../with-meta'

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
      filter: true
    }),

    type: z.enum(['URBAN', 'METROPOLITAN', 'RURAL', 'SPECIAL']).default('URBAN').meta({
      label:          'Tipo',
      listVisibility: 'visible',
      filter:         true,
      className:      'md:w-1/4',
      keybind:        'p',
      optionLabels: {
        URBAN:        'Urbano',
        METROPOLITAN: 'Metropolitano',
        RURAL:        'Rural',
        SPECIAL:      'Especial',
      },
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
          from:            z.number().min(0).max(23).default(0).meta({ label: 'De',             min: 0, max: 23 }),
          to:              z.number().min(0).max(23).default(23).meta({ label: 'Até',            min: 0, max: 23 }),
          minutes:         z.number().positive().min(1).meta({ label: 'Viagem (min)',  min: 1 }),
          intervalMinutes: z.number().min(0).default(0).meta({ label: 'Intervalo (min)', min: 0 }),
        })).optional().meta({ label: 'Ida' }),
        INBOUND: z.array(z.object({
          from:            z.number().min(0).max(23).default(0).meta({ label: 'De',             min: 0, max: 23 }),
          to:              z.number().min(0).max(23).default(23).meta({ label: 'Até',            min: 0, max: 23 }),
          minutes:         z.number().positive().min(1).meta({ label: 'Viagem (min)',  min: 1 }),
          intervalMinutes: z.number().min(0).default(0).meta({ label: 'Intervalo (min)', min: 0 }),
        })).optional().meta({ label: 'Volta' }),
        CIRCULAR: z.array(z.object({
          from:            z.number().min(0).max(23).default(0).meta({ label: 'De',             min: 0, max: 23 }),
          to:              z.number().min(0).max(23).default(23).meta({ label: 'Até',            min: 0, max: 23 }),
          minutes:         z.number().positive().min(1).meta({ label: 'Viagem (min)',  min: 1 }),
          intervalMinutes: z.number().min(0).default(0).meta({ label: 'Intervalo (min)', min: 0 }),
        })).optional().meta({ label: 'Circular' }),
      }).optional().meta({ label: 'Janelas de Ciclo' }),
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
