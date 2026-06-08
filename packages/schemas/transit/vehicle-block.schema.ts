import { z } from 'zod'
import '../zod-meta'
import { withMeta } from '../with-meta'

// Constraints shape for a generated block
export interface VehicleBlockConstraints {
  locked?: true   // entire block is frozen — trips cannot be reassigned in future runs
}

export const vehicleBlockSummarySchema = z.object({
  totalMinutes:      z.number(),
  productiveMinutes: z.number(),
  deadrunMinutes:    z.number(),
  totalKm:           z.number(),
  productiveKm:      z.number(),
  deadrunKm:         z.number(),
})
export type VehicleBlockSummary = z.infer<typeof vehicleBlockSummarySchema>

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
      resource:       'transit-locality',
      domain:         'transit',
      labelField:     'name',
      listVisibility: 'visible',
      filter:         { type: 'relation', endpoint: 'transit/transit-locality', labelField: 'name' },
      keybind:        'g',
    }),

    vehicleType: z.enum(['STANDARD', 'MICRO_BUS', 'MINIBUS', 'VAN']).meta({
      label:          'Tipo de Veículo',
      listVisibility: 'visible',
      filter:         true,
      className:      'md:w-48',
      keybind:        't',
      optionLabels: {
        STANDARD:  'Ônibus',
        MICRO_BUS: 'Micro-ônibus',
        MINIBUS:   'Miniônibus',
        VAN:       'Van',
      },
    }),

    isStale: z.boolean().default(false).meta({
      label:          'Desatualizado',
      listVisibility: 'hidden',
      showInForm:     false,
    }),

    // populated by solver; shape: { totalMinutes, totalKm, deadrunKm, productiveKm, ... }
    summary: z.record(z.string(), z.unknown()).optional().meta({
      label:          'Resumo',
      listVisibility: 'never',
      showInForm:     false,
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
    hidden:      true,
    defaultSort: { field: 'blockNumber', order: 'asc' },
  },
)

export const createVehicleBlockSchema = vehicleBlockSchema.omit({ id: true, createdAt: true, updatedAt: true })
export const updateVehicleBlockSchema  = createVehicleBlockSchema.partial()

export type VehicleBlock          = z.infer<typeof vehicleBlockSchema>
export type CreateVehicleBlockDto = z.infer<typeof createVehicleBlockSchema>
export type UpdateVehicleBlockDto = z.infer<typeof updateVehicleBlockSchema>
