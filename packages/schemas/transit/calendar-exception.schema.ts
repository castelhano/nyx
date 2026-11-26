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

    // every line of the scope, including lines created later. Either scopeId or lineIds,
    // never both and never neither (enforced by the service)
    scopeId: z.uuid().nullable().optional().meta({
      label:          'Escopo',
      widget:         'select',
      resource:       'scope',
      domain:         'transit',
      labelField:     'name',
      listVisibility: 'visible',
      filter:         { type: 'relation', endpoint: 'transit/scope', labelField: 'name' },
      helpText:       'Inclui linhas criadas depois.',
      keybind:        'e',
    }),

    // only these lines — backed by LineCalendarExceptionLine
    lineIds: z.array(z.uuid()).default([]).meta({
      label:          'Linhas',
      widget:         'multi-select',
      resource:       'transit-line',
      domain:         'transit',
      labelField:     'code',
      listVisibility: 'hidden',
      helpText:       'Use escopo ou linhas, não os dois.',
      keybind:        'l',
    }),

    sourceDayTypeId: z.uuid().optional().meta({
      label:          'De',
      widget:         'select',
      resource:       'day-type',
      domain:         'transit',
      labelField:     'name',
      listVisibility: 'visible',
      filter:         { type: 'relation', endpoint: 'transit/day-type', labelField: 'name' },
      helpText:       'Vazio = todos os dias.',
      keybind:        's',
    }),

    overrideDayTypeId: z.uuid().meta({
      label:          'Para',
      widget:         'select',
      resource:       'day-type',
      domain:         'transit',
      labelField:     'name',
      listVisibility: 'visible',
      filter:         { type: 'relation', endpoint: 'transit/day-type', labelField: 'name' },
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
    label:       'Troca tipo dia',
    labelPlural: 'Troca tipos dia',
    nameField:   'notes',
    icon:        'CalendarSync',
    defaultSort: { field: 'validFrom', order: 'desc' },
  },
)

export const createCalendarExceptionSchema = calendarExceptionSchema.omit({ id: true, createdAt: true, updatedAt: true })
export const updateCalendarExceptionSchema  = createCalendarExceptionSchema.partial()

export type CalendarException          = z.infer<typeof calendarExceptionSchema>
export type CreateCalendarExceptionDto = z.infer<typeof createCalendarExceptionSchema>
export type UpdateCalendarExceptionDto = z.infer<typeof updateCalendarExceptionSchema>
