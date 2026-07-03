import { z } from 'zod'
import '../zod-meta'
import { withMeta } from '../with-meta'

export const routeLocalitySchema = withMeta(
  z.object({
    id: z.uuid().meta({listVisibility: 'hidden'}),

    routeId: z.uuid().meta({
      label:          'Sentido',
      showInForm:     false,
      listVisibility: 'hidden',
    }),

    // null = routing waypoint (not a bus stop)
    localityId: z.uuid().optional().nullable().meta({
      label:          'Localidade',
      widget:         'select',
      resource:       'transit-locality',
      domain:         'transit',
      labelField:     'name',
      className:      'md:w-1/3',
      listVisibility: 'visible',
      keybind:        'l',
    }),

    // populated when localityId is null (waypoint)
    lat: z.number().optional().nullable().meta({ showInForm: false, listVisibility: 'never' }),
    lng: z.number().optional().nullable().meta({ showInForm: false, listVisibility: 'never' }),

    sequence: z.number().int().min(1).meta({
      label:          'Ordem',
      listVisibility: 'visible',
      className:      'md:w-42',
      keybind:        's',
    }),

    // null → fallback to TravelTime matrix
    deltaMinutes: z.number().int().min(0).optional().nullable().meta({
      label:          'Δ Tempo (min)',
      listVisibility: 'visible',
      className:      'md:w-42',
      keybind:        'd',
    }),

    // null → fallback to TravelTime matrix
    deltaKm: z.number().min(0).optional().nullable().meta({
      label:          'Δ Distância (km)',
      listVisibility: 'visible',
      className:      'md:w-42',
      keybind:        'k',
    }),

    deltaSource: z.enum(['OSRM', 'MANUAL']).default('OSRM').meta({
      label:          'Fonte Δ',
      listVisibility: 'never',
      showInForm:     false,
    }),

    // GeoJSON LineString — leg from previous stop to this one; null for sequence=1
    geometry: z.unknown().optional().nullable().meta({ showInForm: false, listVisibility: 'never' }),

    allowsCrewChange: z.boolean().default(false).meta({
      label:          'Troca de Turno',
      widget:         'switch',
      listVisibility: 'visible',
      filter:         true,
      keybind:        't',
    }),

    createdAt: z.date().meta({ showInForm: false, listVisibility: 'never' }),
    updatedAt: z.date().meta({ showInForm: false, listVisibility: 'never' }),
  }),
  {
    label:       'Referência',
    labelPlural: 'Referências',
    nameField:   'sequence',
    breadcrumb:  [
      { resource: 'transit-route', contextField: 'routeId', listLabel: 'Sentidos', nameField: 'name', nameFirstWord: false, keybind: 'f9' },
    ],
    defaultSort: { field: 'sequence', order: 'asc' },
  },
)

export const createRouteLocalitySchema = routeLocalitySchema.omit({ id: true, createdAt: true, updatedAt: true })
export const updateRouteLocalitySchema  = createRouteLocalitySchema.partial()

export type RouteLocality          = z.infer<typeof routeLocalitySchema>
export type CreateRouteLocalityDto = z.infer<typeof createRouteLocalitySchema>
export type UpdateRouteLocalityDto = z.infer<typeof updateRouteLocalitySchema>
