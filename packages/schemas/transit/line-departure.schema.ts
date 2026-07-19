import { z } from 'zod'
import '../zod-meta'
import { withMeta } from '../with-meta'

export const lineDepartureSchema = withMeta(
  z.object({
    id: z.uuid().meta({listVisibility: 'hidden'}),

    lineScheduleId: z.uuid().meta({
      label:          'Quadro de Horários',
      showInForm:     false,
      listVisibility: 'hidden',
    }),

    routeId: z.uuid().meta({
      label:          'Sentido',
      widget:         'select',
      resource:       'transit-route',
      domain:         'transit',
      labelField:     'name',
      listVisibility: 'visible',
      filter:         { type: 'relation', endpoint: 'transit/transit-route', labelField: 'name' },
      keybind:        'r',
    }),

    departureMinutes: z.number().int().min(0).meta({
      label:          'Partida (min)',
      listVisibility: 'visible',
      className:      'md:w-40',
      keybind:        'p',
    }),

    requiredVehicleType: z.enum(['STANDARD', 'MICRO_BUS', 'MINIBUS', 'VAN']).optional().meta({
      label:          'Veículo Requerido',
      listVisibility: 'visible',
      filter:         true,
      className:      'md:w-48',
      keybind:        'v',
      optionLabels: {
        STANDARD:  'Ônibus',
        MICRO_BUS: 'Micro-ônibus',
        MINIBUS:   'Miniônibus',
        VAN:       'Van',
      },
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
    label:       'Partida',
    labelPlural: 'Partidas',
    nameField:   'departureMinutes',
    icon:        'Timer',
    defaultSort: { field: 'departureMinutes', order: 'asc' },
    breadcrumb:  [
      { resource: 'line-schedule', contextField: 'lineScheduleId', listLabel: 'Partidas', nameField: 'version', keybind: 'f9' },
    ],
  },
)

export const createLineDepartureSchema = lineDepartureSchema.omit({ id: true, createdAt: true, updatedAt: true })
export const updateLineDepartureSchema  = createLineDepartureSchema.partial()

export type LineDeparture          = z.infer<typeof lineDepartureSchema>
export type CreateLineDepartureDto = z.infer<typeof createLineDepartureSchema>
export type UpdateLineDepartureDto = z.infer<typeof updateLineDepartureSchema>
