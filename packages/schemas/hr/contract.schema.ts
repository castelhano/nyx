import { z } from 'zod'
import '../zod-meta'
import { withMeta } from '../with-meta'

export const contractSchema = withMeta(
  z.object({
    id: z.uuid(),

    employeeId: z.uuid().meta({
      showInForm: false,
      listVisibility: 'never',
    }),

    jobTitleId: z.uuid().meta({
      label: 'Cargo',
      widget: 'select',
      resource: 'job-title',
      domain: 'hr',
      labelField: 'name',
      listVisibility: 'visible',
      filter: { type: 'relation', endpoint: 'hr/job-title', labelField: 'name' },
      keybind: 'c',
    }),

    type: z.enum(['CLT', 'PJ', 'TEMPORARY', 'INTERNSHIP', 'APPRENTICE']).meta({
      label: 'Tipo',
      listVisibility: 'visible',
      filter: true,
      className: 'md:w-48',
      keybind: 't',
      optionLabels: {
        CLT:        'CLT',
        PJ:         'PJ',
        TEMPORARY:  'Temporário',
        INTERNSHIP: 'Estágio',
        APPRENTICE: 'Jovem Aprendiz',
      },
    }),

    status: z.enum(['ACTIVE', 'SUSPENDED', 'TERMINATED', 'EXPIRED']).meta({
      label: 'Status',
      listVisibility: 'visible',
      filter: true,
      className: 'md:w-44',
      keybind: 's',
      optionLabels: {
        ACTIVE:     'Ativo',
        SUSPENDED:  'Suspenso',
        TERMINATED: 'Rescindido',
        EXPIRED:    'Expirado',
      },
    }),

    startDate: z.date().meta({
      label: 'Início',
      listVisibility: 'visible',
      keybind: 'i',
    }),

    endDate: z.date().optional().meta({
      label: 'Término',
      listVisibility: 'visible',
      keybind: 'r',
    }),

    salary: z.number().positive().meta({
      label: 'Salário',
      listVisibility: 'visible',
      widget: 'currency',
      className: 'md:w-44',
      keybind: 'l',
    }),

    weeklyHours: z.number().int().min(1).max(44).default(44).meta({
      label: 'Horas Semanais',
      listVisibility: 'hidden',
      className: 'md:w-32',
      keybind: 'h',
    }),

    notes: z.string().optional().meta({
      label: 'Observações',
      widget: 'textarea',
      listVisibility: 'never',
    }),

    createdAt: z.date().meta({ showInForm: false, listVisibility: 'never' }),
    updatedAt: z.date().meta({ showInForm: false, listVisibility: 'never' }),
  }),
  {
    label:       'Contrato',
    labelPlural: 'Contratos',
    nameField:   'type',
    breadcrumb: [
      {
        resource:     'employee',
        contextField: 'employeeId',
        listLabel:    'Funcionários',
        nameField:    'fullName',
        keybind:      'f9',
      },
    ],
  },
)

export const createContractSchema = contractSchema.omit({ id: true, createdAt: true, updatedAt: true })
export const updateContractSchema = createContractSchema.partial()

export type Contract          = z.infer<typeof contractSchema>
export type CreateContractDto = z.infer<typeof createContractSchema>
export type UpdateContractDto = z.infer<typeof updateContractSchema>
