import { z } from 'zod'
import '../zod-meta'
import { withMeta } from '../with-meta'

export const calendarExceptionSchema = withMeta(
  z.object({
    id: z.uuid().meta({ listVisibility: 'hidden' }),

    validFrom: z.date().meta({
      label:          'Início',
      listVisibility: 'visible',
      filter:         { type: 'date_range' },
      defaultValue:   '$today',
      keybind:        'i',
    }),

    validTo: z.date().optional().meta({
      label:          'Fim',
      listVisibility: 'visible',
      keybind:        'v',
    }),

    sourceDayTypeId: z.uuid().optional().meta({
      label:          'Tipo de Dia Substituído',
      widget:         'select',
      resource:       'day-type',
      domain:         'transit',
      labelField:     'name',
      listVisibility: 'visible',
      filter:         { type: 'relation', endpoint: 'transit/day-type', labelField: 'name' },
      helpText:       'Qual tipo de dia será substituído no período. Vazio = todos os dias.',
      keybind:        's',
    }),

    overrideDayTypeId: z.uuid().meta({
      label:          'Tipo de Dia de Substituição',
      widget:         'select',
      resource:       'day-type',
      domain:         'transit',
      labelField:     'name',
      listVisibility: 'visible',
      filter:         { type: 'relation', endpoint: 'transit/day-type', labelField: 'name' },
      helpText:       'Tipo de dia que será aplicado no lugar.',
      keybind:        'o',
    }),

    notes: z.string().optional().meta({
      label:          'Observações',
      widget:         'textarea',
      listVisibility: 'never',
      keybind:        'n',
    }),

    createdAt: z.date().meta({ showInForm: false, listVisibility: 'never' }),
    updatedAt: z.date().meta({ showInForm: false, listVisibility: 'never' }),
  }),
  {
    label:       'Exceção de Calendário',
    labelPlural: 'Exceções de Calendário',
    nameField:   'notes',
    icon:        'CalendarX2',
    defaultSort: { field: 'validFrom', order: 'desc' },
  },
)

export const createCalendarExceptionSchema = calendarExceptionSchema.omit({ id: true, createdAt: true, updatedAt: true })
export const updateCalendarExceptionSchema  = createCalendarExceptionSchema.partial()

export type CalendarException          = z.infer<typeof calendarExceptionSchema>
export type CreateCalendarExceptionDto = z.infer<typeof createCalendarExceptionSchema>
export type UpdateCalendarExceptionDto = z.infer<typeof updateCalendarExceptionSchema>
