import { z } from 'zod'
import '../zod-meta'
import { withMeta } from '../with-meta'

export const vehicleModelSchema = withMeta(
  z.object({
    id: z.uuid().meta({listVisibility: 'hidden'}),

    brandId: z.uuid().meta({
      label:          'Marca',
      widget:         'select',
      resource:       'vehicle-brand',
      domain:         'fleet',
      labelField:     'name',
      listVisibility: 'visible',
      filter:         { type: 'relation', endpoint: 'fleet/vehicle-brand', labelField: 'name' },
      keybind:        'q',
    }),

    name: z.string().min(2).meta({ label: 'Nome', listVisibility: 'visible', keybind: 'g' }),

    createdAt: z.date().meta({ showInForm: false, listVisibility: 'never' }),
    updatedAt: z.date().meta({ showInForm: false, listVisibility: 'never' }),
  }),
  {
    label:       'Modelo',
    labelPlural: 'Modelos',
    nameField:   'name',
    defaultSort: { field: 'name', order: 'asc' },
    breadcrumb: [
      { resource: 'vehicle-brand', contextField: 'brandId', listLabel: 'Marcas', nameField: 'name', keybind: 'f9' },
    ],
  },
)

export const createVehicleModelSchema = vehicleModelSchema.omit({ id: true, createdAt: true, updatedAt: true })
export const updateVehicleModelSchema = createVehicleModelSchema.partial()

export type VehicleModel          = z.infer<typeof vehicleModelSchema>
export type CreateVehicleModelDto = z.infer<typeof createVehicleModelSchema>
export type UpdateVehicleModelDto = z.infer<typeof updateVehicleModelSchema>
