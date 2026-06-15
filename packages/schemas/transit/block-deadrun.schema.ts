import { z } from 'zod'
import '../zod-meta'
import { withMeta } from '../with-meta'

export const blockDeadrunSchema = withMeta(
  z.object({
    id: z.uuid().meta({ listVisibility: 'hidden' }),

    vehicleBlockId: z.uuid().meta({
      label:          'Bloco',
      showInForm:     false,
      listVisibility: 'hidden',
    }),

    type: z.enum(['ACCESS', 'RETURN', 'DISPLACEMENT']).meta({
      label:          'Tipo',
      listVisibility: 'visible',
      optionLabels: {
        ACCESS:       'Acesso',
        RETURN:       'Recolhida',
        DISPLACEMENT: 'Deslocamento',
      },
    }),

    originLocalityId: z.uuid().meta({
      label:          'Origem',
      widget:         'select',
      resource:       'transit-locality',
      domain:         'transit',
      labelField:     'name',
      listVisibility: 'visible',
      keybind:        'o',
    }),

    destinationLocalityId: z.uuid().meta({
      label:          'Destino',
      widget:         'select',
      resource:       'transit-locality',
      domain:         'transit',
      labelField:     'name',
      listVisibility: 'visible',
      keybind:        'd',
    }),

    departureMinutes: z.number().int().min(0).meta({
      label:          'Partida (min)',
      listVisibility: 'visible',
      keybind:        'p',
    }),

    arrivalMinutes: z.number().int().min(0).meta({
      label:          'Chegada (min)',
      listVisibility: 'visible',
      keybind:        'h',
    }),

    createdAt: z.date().meta({ showInForm: false, listVisibility: 'never' }),
    updatedAt: z.date().meta({ showInForm: false, listVisibility: 'never' }),
  }),
  {
    label:       'Vazio',
    labelPlural: 'Vazios',
    nameField:   'type',
    hidden:      true,
    defaultSort: { field: 'departureMinutes', order: 'asc' },
  },
)

export const createBlockDeadrunSchema = blockDeadrunSchema.omit({ id: true, createdAt: true, updatedAt: true })
export const updateBlockDeadrunSchema  = createBlockDeadrunSchema.partial()

export type BlockDeadrun          = z.infer<typeof blockDeadrunSchema>
export type CreateBlockDeadrunDto = z.infer<typeof createBlockDeadrunSchema>
export type UpdateBlockDeadrunDto = z.infer<typeof updateBlockDeadrunSchema>
