import { z } from 'zod'
import '../zod-meta'
import { withMeta } from '../with-meta'

export const employeeSchema = withMeta(
  z.object({
    id: z.uuid(),

    companyId: z.string().optional().meta({
      label: 'Empresa',
      widget: 'select',
      resource: 'company',
      domain: 'core',
      labelField: 'legalName',
      virtual: true,
      lazyEdit: true,
      className: 'md:w-1/2',
      keybind: 'q',
    }),

    branchId: z.uuid().meta({
      label: 'Filial',
      widget: 'select',
      resource: 'branch',
      domain: 'core',
      labelField: 'name',
      dependsOn: 'companyId',
      relatedDisplayFields: ['companyId'],
      listVisibility: 'visible',
      filter: { type: 'relation', endpoint: 'core/branch', labelField: 'name' },
      lazyEdit: true,
      className: 'md:w-1/2',
      keybind: 'f',
    }),

    code: z.string().min(1).meta({
      label: 'Matrícula',
      listVisibility: 'visible',
      className: 'md:w-40',
      keybind: 'm',
    }),

    fullName: z.string().min(2).meta({
      label: 'Nome Completo',
      listVisibility: 'visible',
      keybind: 'g',
    }),

    preferredName: z.string().optional().meta({
      label: 'Nome Preferido',
      listVisibility: 'hidden',
      keybind: 'p',
    }),

    taxId: z.string().meta({
      label: 'CPF',
      mask: 'cpf',
      className: 'md:w-44',
      listVisibility: 'hidden',
      keybind: 'x',
    }),

    status: z.enum(['ACTIVE', 'INACTIVE', 'ON_LEAVE', 'TERMINATED']).meta({
      defaultValue: 'ACTIVE',
      label: 'Status',
      listVisibility: 'visible',
      filter: true,
      className: 'md:w-48',
      keybind: 's',
      optionLabels: {
        ACTIVE:     'Ativo',
        INACTIVE:   'Inativo',
        ON_LEAVE:   'Afastado',
        TERMINATED: 'Desligado',
      },
    }),

    photoUrl: z.string().optional().meta({
      label: 'Foto',
      widget: 'avatar',
      listVisibility: 'never',
    }),

    dateOfBirth: z.date().optional().meta({
      label: 'Data de Nascimento',
      listVisibility: 'never',
      keybind: 'd',
    }),

    gender: z.enum(['MALE', 'FEMALE', 'OTHER', 'PREFER_NOT_TO_SAY']).optional().meta({
      label: 'Gênero',
      listVisibility: 'never',
      className: 'md:w-64',
      keybind: 'e',
      optionLabels: {
        MALE:              'Masculino',
        FEMALE:            'Feminino',
        OTHER:             'Outro',
        PREFER_NOT_TO_SAY: 'Prefiro não informar',
      },
    }),

    maritalStatus: z.enum(['SINGLE', 'MARRIED', 'DIVORCED', 'WIDOWED', 'DOMESTIC_PARTNERSHIP']).optional().meta({
      label: 'Estado Civil',
      listVisibility: 'never',
      className: 'md:w-48',
      keybind: 'v',
      optionLabels: {
        SINGLE:               'Solteiro(a)',
        MARRIED:              'Casado(a)',
        DIVORCED:             'Divorciado(a)',
        WIDOWED:              'Viúvo(a)',
        DOMESTIC_PARTNERSHIP: 'União Estável',
      },
    }),

    email: z.email().optional().meta({
      label: 'E-mail',
      widget: 'email',
      listVisibility: 'hidden',
      className: 'md:w-72',
      keybind: 'k',
    }),

    phone: z.string().optional().meta({
      label: 'Telefone',
      mask: 'phone',
      className: 'md:w-48',
      listVisibility: 'hidden',
      keybind: 't',
    }),

    hireDate: z.date().meta({
      label: 'Admissão',
      listVisibility: 'visible',
      filter: { type: 'date_range' },
      keybind: 'a',
      defaultValue: '$today',
    }),

    terminationDate: z.date().optional().meta({
      label: 'Demissão',
      listVisibility: 'hidden',
      keybind: 'r',
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
    label:       'Funcionário',
    labelPlural: 'Funcionários',
    nameField:   'fullName',
    icon:        'UserRound',
    defaultSort: { field: 'fullName', order: 'asc' },
    groups: {
      'Pessoal':   ['dateOfBirth', 'gender', 'maritalStatus', 'photoUrl'],
      'Contato':   ['email', 'phone'],
      'Histórico': ['hireDate', 'terminationDate', 'notes'],
    },
  },
)

export const createEmployeeSchema = employeeSchema.omit({ id: true, createdAt: true, updatedAt: true })
export const updateEmployeeSchema = createEmployeeSchema.partial()

export type Employee          = z.infer<typeof employeeSchema>
export type CreateEmployeeDto = z.infer<typeof createEmployeeSchema>
export type UpdateEmployeeDto = z.infer<typeof updateEmployeeSchema>
