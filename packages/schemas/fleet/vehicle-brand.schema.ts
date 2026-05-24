import { z } from 'zod'
import '../zod-meta'
import { withMeta } from '../with-meta'

export const vehicleBrandSchema = withMeta(
  z.object({
    id:        z.uuid(),
    name:      z.string().min(2).meta({ label: 'Nome', listVisibility: 'visible', keybind: 'g' }),
    createdAt: z.date().meta({ showInForm: false, listVisibility: 'never' }),
    updatedAt: z.date().meta({ showInForm: false, listVisibility: 'never' }),
  }),
  {
    label:       'Marca',
    labelPlural: 'Marcas',
    nameField:   'name',
    icon:        'Tag',
    defaultSort: { field: 'name', order: 'asc' },
  },
)

export const createVehicleBrandSchema = vehicleBrandSchema.omit({ id: true, createdAt: true, updatedAt: true })
export const updateVehicleBrandSchema = createVehicleBrandSchema.partial()

export type VehicleBrand          = z.infer<typeof vehicleBrandSchema>
export type CreateVehicleBrandDto = z.infer<typeof createVehicleBrandSchema>
export type UpdateVehicleBrandDto = z.infer<typeof updateVehicleBrandSchema>
