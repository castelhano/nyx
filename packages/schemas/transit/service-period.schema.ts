import { z } from 'zod'
import '../zod-meta'
import { withMeta } from '../with-meta'

export const servicePeriodSchema = withMeta(
  z.object({
    id: z.uuid().meta({listVisibility: 'hidden'}),

    branchId: z.uuid().meta({
      label:          'Filial',
      widget:         'select',
      resource:       'branch',
      domain:         'core',
      labelField:     'name',
      listVisibility: 'hidden',
      filter:         { type: 'relation', endpoint: 'core/branch', labelField: 'name' },
      lazyEdit:       true,
      keybind:        'f',
    }),

    name: z.string().min(2).meta({
      label:          'Nome',
      listVisibility: 'visible',
      keybind:        'n',
    }),

    validFrom: z.date().meta({
      label:          'Início da Vigência',
      listVisibility: 'visible',
      filter:         { type: 'date_range' },
      defaultValue:   '$today',
      keybind:        'i',
    }),

    validTo: z.date().optional().meta({
      label:          'Fim da Vigência',
      listVisibility: 'visible',
      keybind:        'v',
    }),

    status: z.enum(['DRAFT', 'ACTIVE', 'ARCHIVED']).default('DRAFT').meta({
      label:          'Status',
      listVisibility: 'visible',
      filter:         true,
      className:      'md:w-40',
      defaultValue:   'DRAFT',
      keybind:        's',
      optionLabels: {
        DRAFT:    'Rascunho',
        ACTIVE:   'Ativo',
        ARCHIVED: 'Arquivado',
      },
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
    label:       'Período de Serviço',
    labelPlural: 'Períodos de Serviço',
    nameField:   'name',
    icon:        'CalendarRange',
    defaultSort: { field: 'validFrom', order: 'desc' },
  },
)

export const createServicePeriodSchema = servicePeriodSchema.omit({ id: true, createdAt: true, updatedAt: true })
export const updateServicePeriodSchema  = createServicePeriodSchema.partial()

export type ServicePeriod          = z.infer<typeof servicePeriodSchema>
export type CreateServicePeriodDto = z.infer<typeof createServicePeriodSchema>
export type UpdateServicePeriodDto = z.infer<typeof updateServicePeriodSchema>
