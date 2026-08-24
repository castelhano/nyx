import { z } from 'zod'
import '../zod-meta'
import { withMeta } from '../with-meta'

export const lineScheduleSchema = withMeta(
  z.object({
    id: z.uuid().meta({listVisibility: 'hidden'}),

    lineId: z.uuid().meta({
      label:          'Linha',
      showInForm:     false,
      listVisibility: 'hidden',
    }),

    dayTypeId: z.uuid().meta({
      label:          'Tipo de Dia',
      widget:         'select',
      resource:       'day-type',
      domain:         'transit',
      labelField:     'name',
      listVisibility: 'visible',
      filter:         { type: 'relation', endpoint: 'transit/day-type', labelField: 'name' },
      keybind:        'd',
      className:      'md:w-1/3',
    }),

    // managed via the "Duplicar" / "Aprovar" actions — not editable through the bulk
    // form, to preserve the supersession transaction (only one APPROVED per line+dayType)
    status: z.enum(['DRAFT', 'APPROVED', 'SUPERSEDED', 'ARCHIVED']).default('DRAFT').meta({
      label:          'Status',
      listVisibility: 'visible',
      filter:         true,
      showInForm:     false,
      optionLabels: {
        DRAFT:      'Rascunho',
        APPROVED:   'Aprovado',
        SUPERSEDED: 'Substituído',
        ARCHIVED:   'Arquivado',
      },
    }),

    validFrom: z.date().optional().nullable().meta({
      label:          'Vigência Início',
      showInForm:     false,
      listVisibility: 'visible',
    }),

    validTo: z.date().optional().nullable().meta({
      label:          'Vigência Fim',
      showInForm:     false,
      listVisibility: 'visible',
    }),

    approvalRef: z.string().min(1).meta({
      label:          'OSO',
      placeholder:    'No do processo',
      listVisibility: 'visible',
      className:      'md:w-1/3',
      keybind:        'o',
    }),

    approvedAt: z.date().optional().nullable().meta({
      label:          'Aprovado em',
      showInForm:     false,
      listVisibility: 'hidden',
    }),

    notes: z.string().optional().meta({
      label:          'Observações',
      widget:         'textarea',
      listVisibility: 'never',
    }),

    createdAt: z.date().meta({ showInForm: false, listVisibility: 'never' }),
    updatedAt: z.date().meta({ showInForm: false, listVisibility: 'never' }),
  }),
  {
    label:       'OSO',
    labelPlural: 'OSOs',
    nameField:   'approvalRef',
    icon:        'CalendarSync',
    defaultSort: { field: 'createdAt', order: 'desc' },
    breadcrumb:  [
      { resource: 'transit-line', contextField: 'lineId', listLabel: 'Linhas', nameField: 'code', keybind: 'f10', overflow: true },
    ],
    rowActions: [
      {
        action:     'duplicate',
        label:      'Duplicar',
        icon:       'Copy',
        permission: 'create',
        method:     'POST',
        endpoint:   (row) => `/transit/line-schedule/${row.id}/duplicate`,
      },
      {
        action:      'approve',
        label:       'Aprovar',
        icon:        'Check',
        permission:  'update',
        method:      'POST',
        endpoint:    (row) => `/transit/line-schedule/${row.id}/approve`,
        visibleWhen: { field: 'status', value: 'DRAFT' },
      },
    ],
  },
)

export const createLineScheduleSchema = lineScheduleSchema.omit({ id: true, createdAt: true, updatedAt: true })
export const updateLineScheduleSchema  = createLineScheduleSchema.partial()

export type LineSchedule          = z.infer<typeof lineScheduleSchema>
export type CreateLineScheduleDto = z.infer<typeof createLineScheduleSchema>
export type UpdateLineScheduleDto = z.infer<typeof updateLineScheduleSchema>
