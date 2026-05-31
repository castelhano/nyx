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

    localityId: z.uuid().meta({
      label:          'Localidade',
      widget:         'select',
      resource:       'transit-locality',
      domain:         'transit',
      labelField:     'name',
      listVisibility: 'visible',
      keybind:        'l',
    }),

    sequence: z.number().int().min(1).meta({
      label:          'Ordem',
      listVisibility: 'visible',
      className:      'md:w-28',
      keybind:        's',
    }),

    // null → fallback to TravelTime matrix
    deltaMinutes: z.number().int().min(0).optional().meta({
      label:          'Δ Tempo (min)',
      listVisibility: 'visible',
      className:      'md:w-36',
      keybind:        'm',
    }),

    // null → fallback to TravelTime matrix
    deltaKm: z.number().min(0).optional().meta({
      label:          'Δ Distância (km)',
      listVisibility: 'visible',
      className:      'md:w-40',
      keybind:        'k',
    }),

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
    label:       'Ponto de Referência',
    labelPlural: 'Pontos de Referência',
    nameField:   'sequence',
    breadcrumb:  [
      { resource: 'transit-route', contextField: 'routeId', listLabel: 'Sentidos', nameField: 'name', keybind: 'f8' },
    ],
    defaultSort: { field: 'sequence', order: 'asc' },
  },
)

export const createRouteLocalitySchema = routeLocalitySchema.omit({ id: true, createdAt: true, updatedAt: true })
export const updateRouteLocalitySchema  = createRouteLocalitySchema.partial()

export type RouteLocality          = z.infer<typeof routeLocalitySchema>
export type CreateRouteLocalityDto = z.infer<typeof createRouteLocalitySchema>
export type UpdateRouteLocalityDto = z.infer<typeof updateRouteLocalitySchema>
