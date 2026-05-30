import { z } from 'zod'
import '../zod-meta'
import { withMeta } from '../with-meta'

export const dayTypeSchema = withMeta(
  z.object({
    id: z.uuid().meta({listVisibility: 'hidden'}),

    code: z.string().min(1).max(10).meta({
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

    description: z.string().optional().meta({
      label:          'Descrição',
      listVisibility: 'hidden',
      keybind:        'd',
    }),

    // lower number renders first in selects and reports
    sortOrder: z.number().int().default(0).meta({
      label:     'Ordem',
      className: 'md:w-28',
      keybind:   'o',
      helpText: 'Ordem de exibição em componentes'
    }),

    createdAt: z.date().meta({ showInForm: false, listVisibility: 'never' }),
    updatedAt: z.date().meta({ showInForm: false, listVisibility: 'never' }),
  }),
  {
    label:       'Tipo de Dia',
    labelPlural: 'Tipos de Dia',
    nameField:   'name',
    icon:        'CalendarDays',
    defaultSort: { field: 'sortOrder', order: 'asc' },
  },
)

export const createDayTypeSchema = dayTypeSchema.omit({ id: true, createdAt: true, updatedAt: true })
export const updateDayTypeSchema  = createDayTypeSchema.partial()

export type DayType          = z.infer<typeof dayTypeSchema>
export type CreateDayTypeDto = z.infer<typeof createDayTypeSchema>
export type UpdateDayTypeDto = z.infer<typeof updateDayTypeSchema>
