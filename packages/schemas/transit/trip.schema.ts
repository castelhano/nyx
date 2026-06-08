import { z } from 'zod'
import '../zod-meta'
import { withMeta } from '../with-meta'

// Constraints shape — managed via dedicated UI controls, not raw JSON input
export interface TripConstraints {
  locked?: string[]       // field names the solver cannot modify, e.g. ['departureMinutes']
  pinnedBlock?: string    // UUID — trip cannot be moved to another block in future runs
}

export const tripSchema = withMeta(
  z.object({
    id: z.uuid().meta({listVisibility: 'hidden'}),

    dayTypeIds: z.array(z.uuid()).min(1).meta({
      label:          'Tipos de Dia',
      widget:         'multi-select',
      resource:       'day-type',
      domain:         'transit',
      labelField:     'name',
      listVisibility: 'visible',
      keybind:        'd',
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

    // minutes from operational day start — allows values > 1440 for overnight trips
    departureMinutes: z.number().int().min(0).meta({
      label:          'Partida (min)',
      listVisibility: 'visible',
      className:      'md:w-40',
      keybind:        'p',
    }),

    arrivalMinutes: z.number().int().min(0).meta({
      label:          'Chegada (min)',
      listVisibility: 'visible',
      className:      'md:w-40',
      keybind:        'h',
    }),

    requiredVehicleType: z.enum(['STANDARD', 'MICRO_BUS', 'MINIBUS', 'VAN']).optional().meta({
      label:          'Veículo Requerido',
      listVisibility: 'hidden',
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

    // managed via dedicated lock UI — not rendered as a raw JSON field
    constraints: z.record(z.string(), z.unknown()).optional().meta({
      label:          'Restrições',
      listVisibility: 'never',
      showInForm:     false,
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
    label:       'Viagem',
    labelPlural: 'Viagens',
    nameField:   'departureMinutes',
    hidden:      true,
    defaultSort: { field: 'departureMinutes', order: 'asc' },
  },
)

export const createTripSchema = tripSchema.omit({ id: true, createdAt: true, updatedAt: true })
export const updateTripSchema  = createTripSchema.partial()

export type Trip          = z.infer<typeof tripSchema>
export type CreateTripDto = z.infer<typeof createTripSchema>
export type UpdateTripDto = z.infer<typeof updateTripSchema>
