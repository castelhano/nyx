import { z } from 'zod'
import '../zod-meta'
import { withMeta } from '../with-meta'

export const blockTripSchema = withMeta(
  z.object({
    id: z.uuid().meta({listVisibility: 'hidden'}),

    vehicleBlockId: z.uuid().meta({
      label:          'Bloco',
      showInForm:     false,
      listVisibility: 'hidden',
    }),

    tripId: z.uuid().meta({
      label:          'Viagem',
      widget:         'select',
      resource:       'transit-trip',
      domain:         'transit',
      labelField:     'departureMinutes',
      listVisibility: 'visible',
      keybind:        'v',
    }),

    sequence: z.number().int().min(1).meta({
      label:          'Ordem',
      listVisibility: 'visible',
      className:      'md:w-28',
      keybind:        's',
    }),

    // true when the vehicle travels empty to reach the next trip's origin
    isDeadhead: z.boolean().default(false).meta({
      label:          'Em Vazio',
      widget:         'switch',
      listVisibility: 'visible',
      filter:         true,
      keybind:        'z',
    }),

    // populated by solver from TravelTime matrix
    deadheadMinutes: z.number().int().optional().meta({
      label:          'Tempo em Vazio (min)',
      listVisibility: 'hidden',
      showInForm:     false,
      className:      'md:w-44',
    }),

    deadheadKm: z.number().optional().meta({
      label:          'Km em Vazio',
      listVisibility: 'hidden',
      showInForm:     false,
      className:      'md:w-36',
    }),

    createdAt: z.date().meta({ showInForm: false, listVisibility: 'never' }),
    updatedAt: z.date().meta({ showInForm: false, listVisibility: 'never' }),
  }),
  {
    label:       'Viagem no Bloco',
    labelPlural: 'Viagens no Bloco',
    nameField:   'sequence',
    breadcrumb:  [
      { resource: 'vehicle-block', contextField: 'vehicleBlockId', listLabel: 'Blocos', nameField: 'blockNumber', keybind: 'f9' },
    ],
    defaultSort: { field: 'sequence', order: 'asc' },
  },
)

export const createBlockTripSchema = blockTripSchema.omit({ id: true, createdAt: true, updatedAt: true })
export const updateBlockTripSchema  = createBlockTripSchema.partial()

export type BlockTrip          = z.infer<typeof blockTripSchema>
export type CreateBlockTripDto = z.infer<typeof createBlockTripSchema>
export type UpdateBlockTripDto = z.infer<typeof updateBlockTripSchema>
