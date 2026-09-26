import { z } from 'zod'
import '../zod-meta'
import { withMeta } from '../with-meta'

export const dutyActivitySchema = withMeta(
  z.object({
    id: z.uuid().meta({ listVisibility: 'hidden' }),

    dutyId: z.uuid().meta({
      label:          'Jornada',
      showInForm:     false,
      listVisibility: 'hidden',
    }),

    type: z.enum(['SIGN_ON', 'SIGN_OFF', 'BREAK', 'TRAVEL', 'STANDBY']).meta({
      label:          'Tipo',
      listVisibility: 'visible',
      filter:         true,
      keybind:        't',
      optionLabels: {
        SIGN_ON:  'Apresentação',
        SIGN_OFF: 'Encerramento',
        BREAK:    'Intervalo',
        TRAVEL:   'Deslocamento',
        STANDBY:  'Reserva',
      },
    }),

    // required when type = BREAK (DutyActivityService)
    intervalTypeId: z.uuid().optional().nullable().meta({
      label:          'Tipo de Intervalo',
      widget:         'select',
      resource:       'interval-type',
      domain:         'transit',
      labelField:     'name',
      listVisibility: 'visible',
      keybind:        'n',
    }),

    startMinutes: z.number().int().min(0).meta({
      label:          'Início (min)',
      listVisibility: 'visible',
      keybind:        'i',
    }),

    endMinutes: z.number().int().min(0).meta({
      label:          'Fim (min)',
      listVisibility: 'visible',
      keybind:        'f',
    }),

    originLocalityId: z.uuid().optional().nullable().meta({
      label:          'Origem',
      widget:         'select',
      resource:       'transit-locality',
      domain:         'transit',
      labelField:     'name',
      listVisibility: 'hidden',
    }),

    destinationLocalityId: z.uuid().optional().nullable().meta({
      label:          'Destino',
      widget:         'select',
      resource:       'transit-locality',
      domain:         'transit',
      labelField:     'name',
      listVisibility: 'hidden',
    }),

    createdAt: z.date().meta({ showInForm: false, listVisibility: 'never' }),
    updatedAt: z.date().meta({ showInForm: false, listVisibility: 'never' }),
  }),
  {
    label:       'Atividade',
    labelPlural: 'Atividades',
    nameField:   'type',
    defaultSort: { field: 'startMinutes', order: 'asc' },
    breadcrumb:  [
      { resource: 'duty', contextField: 'dutyId', listLabel: 'Jornadas', nameField: 'dutyNumber' },
    ],
  },
)

export const createDutyActivitySchema = dutyActivitySchema.omit({ id: true, createdAt: true, updatedAt: true })
export const updateDutyActivitySchema  = createDutyActivitySchema.partial()

export type DutyActivity          = z.infer<typeof dutyActivitySchema>
export type CreateDutyActivityDto = z.infer<typeof createDutyActivitySchema>
export type UpdateDutyActivityDto = z.infer<typeof updateDutyActivitySchema>
