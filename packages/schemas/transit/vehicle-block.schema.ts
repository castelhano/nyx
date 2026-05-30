import { z } from 'zod'
import '../zod-meta'
import { withMeta } from '../with-meta'

// Constraints shape for a generated block
export interface VehicleBlockConstraints {
  locked?: true   // entire block is frozen — trips cannot be reassigned in future runs
}

export const vehicleBlockSchema = withMeta(
  z.object({
    id: z.uuid().meta({listVisibility: 'hidden'}),

    vehiclePlanId: z.uuid().meta({
      label:          'Planejamento',
      showInForm:     false,
      listVisibility: 'hidden',
    }),

    blockNumber: z.number().int().min(1).meta({
      label:          'Bloco',
      listVisibility: 'visible',
      className:      'md:w-28',
      keybind:        'b',
    }),

    depotId: z.uuid().meta({
      label:          'Garagem',
      widget:         'select',
      resource:       'locality',
      domain:         'transit',
      labelField:     'name',
      listVisibility: 'visible',
      filter:         { type: 'relation', endpoint: 'transit/locality', labelField: 'name' },
      keybind:        'g',
    }),

    vehicleType: z.enum(['BUS', 'MICRO_BUS', 'MINIBUS', 'VAN']).meta({
      label:          'Tipo de Veículo',
      listVisibility: 'visible',
      filter:         true,
      className:      'md:w-48',
      keybind:        't',
      optionLabels: {
        BUS:       'Ônibus',
        MICRO_BUS: 'Micro-ônibus',
        MINIBUS:   'Miniônibus',
        VAN:       'Van',
      },
    }),

    // populated by solver
    totalMinutes: z.number().int().optional().meta({
      label:          'Duração (min)',
      listVisibility: 'visible',
      showInForm:     false,
      className:      'md:w-40',
    }),

    totalKm: z.number().optional().meta({
      label:          'Km Total',
      listVisibility: 'visible',
      showInForm:     false,
      className:      'md:w-36',
    }),

    constraints: z.record(z.string(), z.unknown()).optional().meta({
      label:          'Restrições',
      listVisibility: 'never',
      showInForm:     false,
    }),

    createdAt: z.date().meta({ showInForm: false, listVisibility: 'never' }),
    updatedAt: z.date().meta({ showInForm: false, listVisibility: 'never' }),
  }),
  {
    label:       'Bloco de Veículo',
    labelPlural: 'Blocos de Veículo',
    nameField:   'blockNumber',
    breadcrumb:  [
      { resource: 'vehicle-plan', contextField: 'vehiclePlanId', listLabel: 'Planejamentos', nameField: 'status', keybind: 'f9' },
    ],
    defaultSort: { field: 'blockNumber', order: 'asc' },
  },
)

export const createVehicleBlockSchema = vehicleBlockSchema.omit({ id: true, createdAt: true, updatedAt: true })
export const updateVehicleBlockSchema  = createVehicleBlockSchema.partial()

export type VehicleBlock          = z.infer<typeof vehicleBlockSchema>
export type CreateVehicleBlockDto = z.infer<typeof createVehicleBlockSchema>
export type UpdateVehicleBlockDto = z.infer<typeof updateVehicleBlockSchema>
