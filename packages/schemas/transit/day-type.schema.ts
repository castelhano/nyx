import { z } from 'zod'
import '../zod-meta'
import { withMeta } from '../with-meta'

export const dayTypePatternSchema = z.discriminatedUnion('type', [
  z.object({
    type: z.literal('weekdays'),
    days: z.array(z.number().int().min(1).max(7)),
  }),
  z.object({
    type:         z.literal('month_window'),
    anchor:       z.enum(['start', 'end']),
    days:         z.number().int().min(1).max(31),
    baseWeekdays: z.array(z.number().int().min(1).max(7)).optional(),
  }),
])

export type DayTypePattern = z.infer<typeof dayTypePatternSchema>

export const dayTypeSchema = withMeta(
  z.object({
    id: z.uuid().meta({listVisibility: 'hidden'}),

    code: z.string().min(1).max(6).meta({
      label:          'Código',
      placeholder:    'U',
      listVisibility: 'visible',
      className:      'md:w-40 uppercase',
      keybind:        'c',
    }),

    name: z.string().min(2).meta({
      label:          'Nome',
      placeholder:    'Ex: Dia Útil',
      listVisibility: 'visible',
      className:      'md:w-96',
      keybind:        'n',
    }),

    description: z.string().optional().meta({
      label:          'Descrição',
      placeholder:    'Descrição opcional',
      listVisibility: 'hidden',
      className:      'md:w-96',
      keybind:        'd',
    }),

    pattern: dayTypePatternSchema.nullable().optional().meta({
      label:          'Padrão de dias',
      helpText:       'Define quais dias do calendário este tipo cobre. Sem padrão = só via exceção de calendário.',
      showInForm:     false,
      listVisibility: 'visible',
    }),

    // lower number renders first in selects and reports
    sortOrder: z.number().int().default(0).meta({
      label:       'Ordem',
      placeholder: '0',
      className:   'md:w-28',
      keybind:     'o',
      helpText:    'Número menor = maior prioridade na resolução automática de padrões sobrepostos',
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
