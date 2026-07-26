import { z } from 'zod'
import '../zod-meta'
import { withMeta } from '../with-meta'

export const intervalTypeSchema = withMeta(
  z.object({
    id: z.uuid().meta({ listVisibility: 'hidden' }),

    code: z.string().min(1).max(10).meta({
      label:          'Código',
      placeholder:    'ABBR',
      listVisibility: 'visible',
      className:      'md:w-40 uppercase',
      keybind:        'c',
      maxLength:      5,
    }),

    name: z.string().min(2).meta({
      label:          'Nome',
      placeholder:    'Ex: Refeição',
      listVisibility: 'visible',
      className:      'md:w-96',
      keybind:        'g',
    }),

    isPaid: z.boolean().default(false).meta({
      label:          'Remunerado',
      listVisibility: 'visible',
    }),

    minMinutes: z.number().int().min(0).nullable().optional().meta({
      label:       'Mínimo (min)',
      placeholder: 'min',
      className:   'md:w-40',
      keybind:     'd',
    }),

    maxMinutes: z.number().int().min(0).nullable().optional().meta({
      label:       'Máximo (min)',
      placeholder: 'min',
      className:   'md:w-40',
      keybind:     'e',
    }),

    notes: z.string().optional().meta({
      label:          'Observações',
      listVisibility: 'hidden',
    }),

    createdAt: z.date().meta({ showInForm: false, listVisibility: 'never' }),
    updatedAt: z.date().meta({ showInForm: false, listVisibility: 'never' }),
  }),
  {
    label:       'Tipo de Intervalo',
    labelPlural: 'Tipos de Intervalo',
    nameField:   'name',
    icon:        'Coffee',
  },
)

export const createIntervalTypeSchema = intervalTypeSchema.omit({ id: true, createdAt: true, updatedAt: true })
export const updateIntervalTypeSchema = createIntervalTypeSchema.partial()

export type IntervalType          = z.infer<typeof intervalTypeSchema>
export type CreateIntervalTypeDto = z.infer<typeof createIntervalTypeSchema>
export type UpdateIntervalTypeDto = z.infer<typeof updateIntervalTypeSchema>
