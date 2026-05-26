import { z } from 'zod'
import '../zod-meta'
import { withMeta } from '../with-meta'

export const localitySchema = withMeta(
  z.object({
    id: z.uuid(),

    code: z.string().min(1).max(20).optional().meta({
      label:          'Código',
      listVisibility: 'visible',
      className:      'md:w-32',
      keybind:        'c',
    }),

    name: z.string().min(2).meta({
      label:          'Nome',
      listVisibility: 'visible',
      keybind:        'n',
    }),

    lat: z.number().meta({
      label:     'Latitude',
      className: 'md:w-52',
      keybind:   'a',
    }),

    lng: z.number().meta({
      label:     'Longitude',
      className: 'md:w-52',
      keybind:   'o',
    }),

    isDepot: z.boolean().default(false).meta({
      label:          'É Garagem',
      widget:         'switch',
      listVisibility: 'visible',
      filter:         true,
      keybind:        'g',
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
    label:       'Localidade',
    labelPlural: 'Localidades',
    nameField:   'name',
    icon:        'MapPin',
    defaultSort: { field: 'name', order: 'asc' },
  },
)

export const createLocalitySchema = localitySchema.omit({ id: true, createdAt: true, updatedAt: true })
export const updateLocalitySchema  = createLocalitySchema.partial()

export type Locality          = z.infer<typeof localitySchema>
export type CreateLocalityDto = z.infer<typeof createLocalitySchema>
export type UpdateLocalityDto = z.infer<typeof updateLocalitySchema>
