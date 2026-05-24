import { z } from 'zod'
import '../zod-meta'
import { withMeta } from '../with-meta'

export const routeSchema = withMeta(
  z.object({
    id: z.uuid(),

    lineId: z.uuid().meta({
      label:          'Linha',
      showInForm:     false,
      listVisibility: 'hidden',
    }),

    direction: z.enum(['OUTBOUND', 'INBOUND', 'CIRCULAR']).meta({
      label:          'Sentido',
      listVisibility: 'visible',
      className:      'md:w-40',
      keybind:        'd',
      optionLabels: {
        OUTBOUND: 'Ida',
        INBOUND:  'Volta',
        CIRCULAR: 'Circular',
      },
    }),

    name: z.string().min(2).meta({
      label:          'Descrição',
      listVisibility: 'visible',
      keybind:        'n',
    }),

    originLocalityId: z.uuid().meta({
      label:          'Origem',
      widget:         'select',
      resource:       'locality',
      domain:         'transit',
      labelField:     'name',
      listVisibility: 'visible',
      keybind:        'o',
    }),

    destinationLocalityId: z.uuid().meta({
      label:          'Destino',
      widget:         'select',
      resource:       'locality',
      domain:         'transit',
      labelField:     'name',
      listVisibility: 'visible',
      keybind:        'e',
    }),

    isActive: z.boolean().default(true).meta({
      label:          'Ativo',
      widget:         'switch',
      listVisibility: 'visible',
      filter:         true,
      defaultValue:   'true',
      keybind:        'a',
    }),

    createdAt: z.date().meta({ showInForm: false, listVisibility: 'never' }),
    updatedAt: z.date().meta({ showInForm: false, listVisibility: 'never' }),
  }),
  {
    label:       'Sentido',
    labelPlural: 'Sentidos',
    nameField:   'name',
    breadcrumb:  [
      { resource: 'line', contextField: 'lineId', listLabel: 'Linhas', nameField: 'name', keybind: 'f9' },
    ],
    defaultSort: { field: 'direction', order: 'asc' },
  },
)

export const createRouteSchema = routeSchema.omit({ id: true, createdAt: true, updatedAt: true })
export const updateRouteSchema  = createRouteSchema.partial()

export type Route          = z.infer<typeof routeSchema>
export type CreateRouteDto = z.infer<typeof createRouteSchema>
export type UpdateRouteDto = z.infer<typeof updateRouteSchema>
