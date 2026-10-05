import { z } from 'zod'
import '../zod-meta'
import { withMeta } from '../with-meta'
import { vehicleTypeSchema } from './vehicle-type'

export const snapInfoSchema = z.object({
  lat:       z.number(),
  lng:       z.number(),
  distanceM: z.number(),
  roadName:  z.string().optional(),
  checkedAt: z.string().datetime(),
})

// A depot's operation (TransitLocality.depot, only meaningful while isDepot) — read by the
// vehicle solver, docs/architecture/transit/solver.md:
//  operators  branchIds whose vehicles may be based here; empty = any operator
//  capacity   physical limits, all enforced together: vehicleType null = the whole depot;
//             none = no limit
export const depotConfigSchema = z.object({
  operators: z.array(z.uuid()).default([]),
  capacity:  z.array(z.object({
    vehicleType: vehicleTypeSchema.nullable(),
    max:         z.number().int().min(0),
  })).default([]),
})

export type DepotConfig = z.infer<typeof depotConfigSchema>

export const localitySchema = withMeta(
  z.object({
    id: z.uuid().meta({listVisibility: 'hidden'}),

    code: z.string().min(1).max(10).meta({
      label:           'Código',
      listVisibility:  'visible',
      className:       'md:w-36',
      keybind:         'c',
      filter:          true,
      suggestEndpoint: '/transit/transit-locality/next-code',
      suggestParams:   ['lat', 'lng'],
    }),

    abbr: z.string().max(16).optional().meta({
      label:          'Abreviação',
      listVisibility: 'visible',
      className:      'md:w-48',
      maxLength:      16,
      keybind:        'f',
    }),

    name: z.string().min(2).meta({
      label:          'Nome',
      listVisibility: 'visible',
      filter:         true,
      // matches the width of the lat input in the map-picker row below: (100% - button 36px - 2 gaps of 8px) / 2
      className:      'md:w-[calc(50%_-_26px)]',
      keybind:        'd',
    }),

    lat: z.number().optional().meta({
      label:          'Latitude',
      listVisibility: 'hidden',
      className:      'md:w-70',
      keybind:        'a',
      widget:         'map-picker',
      pairField:      'lng',
    }),

    lng: z.number().optional().meta({
      label:          'Longitude',
      listVisibility: 'hidden',
      showInForm:     false,
    }),

    isDepot: z.boolean().default(false).meta({
      label:          'É Depósito',
      widget:         'switch',
      listVisibility: 'visible',
      filter:         true,
    }),

    notes: z.string().optional().meta({
      label:          'Observações',
      widget:         'textarea',
      listVisibility: 'never',
    }),

    // edited by the locality page's own field component (shown while isDepot)
    depot: depotConfigSchema.optional().meta({
      label:          'Garagem',
      listVisibility: 'never',
    }),

    snapInfo: snapInfoSchema.nullable().optional().meta({ showInForm: false, listVisibility: 'never' }),

    createdAt: z.date().meta({ showInForm: false, listVisibility: 'never' }),
    updatedAt: z.date().meta({ showInForm: false, listVisibility: 'never' }),
  }),
  {
    label:       'Localidade',
    labelPlural: 'Localidades',
    nameField:   'code',
    icon:        'MapPin',
    defaultSort: { field: 'name', order: 'asc' },
  },
)

export const createLocalitySchema = localitySchema.omit({ id: true, createdAt: true, updatedAt: true })
export const updateLocalitySchema  = createLocalitySchema.partial()

export type SnapInfo          = z.infer<typeof snapInfoSchema>
export type Locality          = z.infer<typeof localitySchema>
export type CreateLocalityDto = z.infer<typeof createLocalitySchema>
export type UpdateLocalityDto = z.infer<typeof updateLocalitySchema>
