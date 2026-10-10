import { z } from 'zod'
import '../zod-meta'
import { withMeta } from '../with-meta'

// A holiday — global or one branch's own (municipal). See Holiday in core.prisma.
export const holidaySchema = withMeta(
  z.object({
    id: z.uuid().meta({ listVisibility: 'hidden' }),

    date: z.date().meta({
      label:          'Data',
      listVisibility: 'visible',
      filter:         { type: 'date_range' },
      className:      'md:w-1/4',
      keybind:        'd',
    }),

    name: z.string().min(2).meta({
      label:          'Nome',
      listVisibility: 'visible',
      className:      'md:w-1/2',
      keybind:        'n',
    }),

    branchId: z.uuid().optional().nullable().meta({
      label:          'Empresa',
      helpText:       'Vazio: feriado de todas as empresas.',
      widget:         'select',
      resource:       'branch',
      domain:         'core',
      labelField:     'name',
      listVisibility: 'visible',
      filter:         { type: 'relation', endpoint: 'core/branch', labelField: 'name' },
      className:      'md:w-1/3',
      keybind:        'e',
    }),

    createdAt: z.date().meta({ showInForm: false, listVisibility: 'never' }),
    updatedAt: z.date().meta({ showInForm: false, listVisibility: 'never' }),
  }),
  {
    label:       'Feriado',
    labelPlural: 'Feriados',
    nameField:   'name',
    icon:        'CalendarDays',
    defaultSort: { field: 'date', order: 'desc' },
  },
)

export const createHolidaySchema = holidaySchema.omit({ id: true, createdAt: true, updatedAt: true })
export const updateHolidaySchema  = createHolidaySchema.partial()

export type Holiday          = z.infer<typeof holidaySchema>
export type CreateHolidayDto = z.infer<typeof createHolidaySchema>
export type UpdateHolidayDto = z.infer<typeof updateHolidaySchema>
