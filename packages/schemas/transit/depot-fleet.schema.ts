import { z } from 'zod'
import '../zod-meta'
import { withMeta } from '../with-meta'

export const depotFleetSchema = withMeta(
  z.object({
    id: z.uuid(),

    branchId: z.uuid().meta({
      label:          'Filial',
      widget:         'select',
      resource:       'branch',
      domain:         'core',
      labelField:     'name',
      listVisibility: 'hidden',
      filter:         { type: 'relation', endpoint: 'core/branch', labelField: 'name' },
      lazyEdit:       true,
      keybind:        'f',
    }),

    // relatedWhere filters the display label; garagens are localities with isDepot: true
    localityId: z.uuid().meta({
      label:          'Garagem',
      widget:         'select',
      resource:       'locality',
      domain:         'transit',
      labelField:     'name',
      relatedWhere:   { isDepot: true },
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

    quantity: z.number().int().min(1).meta({
      label:          'Quantidade',
      listVisibility: 'visible',
      className:      'md:w-36',
      keybind:        'q',
    }),

    createdAt: z.date().meta({ showInForm: false, listVisibility: 'never' }),
    updatedAt: z.date().meta({ showInForm: false, listVisibility: 'never' }),
  }),
  {
    label:       'Contingente',
    labelPlural: 'Contingentes',
    nameField:   'vehicleType',
    icon:        'Warehouse',
    defaultSort: { field: 'quantity', order: 'desc' },
  },
)

export const createDepotFleetSchema = depotFleetSchema.omit({ id: true, createdAt: true, updatedAt: true })
export const updateDepotFleetSchema  = createDepotFleetSchema.partial()

export type DepotFleet          = z.infer<typeof depotFleetSchema>
export type CreateDepotFleetDto = z.infer<typeof createDepotFleetSchema>
export type UpdateDepotFleetDto = z.infer<typeof updateDepotFleetSchema>
