import { z } from 'zod'
import '../zod-meta'
import { withMeta } from '../with-meta'

export const travelTimeSchema = withMeta(
  z.object({
    id: z.uuid().meta({listVisibility: 'hidden'}),

    originId: z.uuid().meta({
      label:          'Origem',
      widget:         'select',
      resource:       'transit-locality',
      domain:         'transit',
      labelField:     'name',
      listVisibility: 'visible',
      filter:         { type: 'relation', endpoint: 'transit/transit-locality', labelField: 'name' },
      className:      'md:w-1/2'
    }),

    destinationId: z.uuid().meta({
      label:          'Destino',
      widget:         'select',
      resource:       'transit-locality',
      domain:         'transit',
      labelField:     'name',
      listVisibility: 'visible',
      filter:         { type: 'relation', endpoint: 'transit/transit-locality', labelField: 'name' },
      className:      'md:w-1/2'
    }),

    baseMinutes: z.number().min(0).meta({
      label:          'Tempo Base (min)',
      listVisibility: 'visible',
      className:      'md:w-40'
    }),

    distanceKm: z.number().min(0).meta({
      label:          'Distância (km)',
      listVisibility: 'visible',
      className:      'md:w-40'
    }),

    peakMultiplier: z.number().min(1).max(5).default(1.0).meta({
      label:     'Multiplicador Pico',
      className: 'md:w-40'
    }),

    source: z.enum(['OSRM', 'MANUAL']).default('MANUAL').meta({
      label:          'Origem do Dado',
      listVisibility: 'visible',
      filter:         true,
      className:      'md:w-65',
      defaultValue:   'MANUAL',
      optionLabels: {
        OSRM:   'OSRM (automático)',
        MANUAL: 'Manual',
      },
    }),

    createdAt: z.date().meta({ showInForm: false, listVisibility: 'never' }),
    updatedAt: z.date().meta({ showInForm: false, listVisibility: 'never' }),
  }),
  {
    label:       'Tempo de Percurso',
    labelPlural: 'Tempos de Percurso',
    nameField:   'baseMinutes',
    icon:        'Timer',
    defaultSort: { field: 'baseMinutes', order: 'asc' },
  },
)

export const createTravelTimeSchema = travelTimeSchema.omit({ id: true, createdAt: true, updatedAt: true })
export const updateTravelTimeSchema  = createTravelTimeSchema.partial()

export type TravelTime          = z.infer<typeof travelTimeSchema>
export type CreateTravelTimeDto = z.infer<typeof createTravelTimeSchema>
export type UpdateTravelTimeDto = z.infer<typeof updateTravelTimeSchema>
