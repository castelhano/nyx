import { z } from 'zod'
import '../zod-meta'
import { withMeta } from '../with-meta'

export const blockIntervalSchema = withMeta(
  z.object({
    id: z.uuid().meta({ listVisibility: 'hidden' }),

    vehicleBlockId: z.uuid().meta({
      label:          'Bloco',
      showInForm:     false,
      listVisibility: 'hidden',
    }),

    intervalTypeId: z.uuid().meta({
      label:          'Tipo',
      widget:         'select',
      resource:       'interval-type',
      domain:         'transit',
      labelField:     'name',
      listVisibility: 'visible',
      keybind:        't',
    }),

    departureMinutes: z.number().int().min(0).meta({
      label:          'Início (min)',
      listVisibility: 'visible',
      keybind:        'p',
    }),

    arrivalMinutes: z.number().int().min(0).meta({
      label:          'Fim (min)',
      listVisibility: 'visible',
      keybind:        'h',
    }),

    createdAt: z.date().meta({ showInForm: false, listVisibility: 'never' }),
    updatedAt: z.date().meta({ showInForm: false, listVisibility: 'never' }),
  }),
  {
    label:       'Intervalo',
    labelPlural: 'Intervalos',
    nameField:   'intervalTypeId',
    hidden:      true,
    defaultSort: { field: 'departureMinutes', order: 'asc' },
  },
)

export const createBlockIntervalSchema = blockIntervalSchema.omit({ id: true, createdAt: true, updatedAt: true })
export const updateBlockIntervalSchema  = createBlockIntervalSchema.partial()

export type BlockInterval          = z.infer<typeof blockIntervalSchema>
export type CreateBlockIntervalDto = z.infer<typeof createBlockIntervalSchema>
export type UpdateBlockIntervalDto = z.infer<typeof updateBlockIntervalSchema>
