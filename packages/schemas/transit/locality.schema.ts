import { z } from 'zod'
import '../zod-meta'
import { withMeta } from '../with-meta'

export const localitySchema = withMeta(
  z.object({
    id: z.uuid().meta({listVisibility: 'hidden'}),

    code: z.string().min(1).max(10).meta({
      label:          'Código',
      listVisibility: 'visible',
      className:      'md:w-36',
      keybind:        'c',
      filter: true
    }),

    abbr: z.string().max(10).optional().meta({
      label:          'Abreviação',
      listVisibility: 'hidden',
      className:      'md:w-36',
      keybind:        'f',
    }),

    name: z.string().min(2).meta({
      label:          'Nome',
      listVisibility: 'visible',
      filter:         true,
      className:      'md:w-1/2',
      keybind:        'd',
    }),

    lat: z.number().optional().meta({
      label:          'Latitude',
      listVisibility: 'hidden',
      className:      'md:w-70',
      keybind:        'a',
    }),

    lng: z.number().optional().meta({
      label:          'Longitude',
      listVisibility: 'hidden',
      className:      'md:w-70',
      keybind:        'o',
    }),

    isDepot: z.boolean().default(false).meta({
      label:          'É Garagem',
      widget:         'switch',
      listVisibility: 'visible',
      filter:         true,
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
