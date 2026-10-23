import { z } from 'zod'
import '../zod-meta'
import { withMeta } from '../with-meta'
import { contractSchema } from './contract.schema'

export const employeeSchema = withMeta(
  z.object({
    id: z.uuid().meta({listVisibility: 'hidden'}),

    companyId: z.string().optional().meta({
      label: 'Empresa',
      widget: 'select',
      resource: 'company',
      domain: 'core',
      labelField: 'legalName',
      virtual: true,
      lazyEdit: true,
      className: 'md:w-1/2',
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
    }),

    code: z.string().min(1).meta({
      label: 'Matrícula',
      listVisibility: 'visible',
      className: 'md:w-1/3',
      filter: true,
      keybind: 'c',
    }),

    fullName: z.string().min(2).meta({
      label: 'Nome Completo',
      listVisibility: 'visible',
      filter: true,
      keybind: 'g',
    }),

    preferredName: z.string().optional().meta({
      label: 'Nome Preferido',
      listVisibility: 'hidden',
      className: 'md:w-1/3',
      keybind: 'm',
    }),

    taxId: z.string().meta({
      label: 'CPF',
      mask: 'cpf',
      className: 'md:w-1/3',
      listVisibility: 'hidden',
      keybind: 'x',
    }),

    status: z.enum(['ACTIVE', 'INACTIVE', 'ON_LEAVE', 'TERMINATED']).meta({
      defaultValue: 'ACTIVE',
      label: 'Status',
      listVisibility: 'visible',
      filter: true,
      className: 'md:w-1/3',
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
      className: 'md:w-1/4'
    }),

    gender: z.enum(['MALE', 'FEMALE', 'OTHER', 'PREFER_NOT_TO_SAY']).optional().meta({
      label: 'Gênero',
      listVisibility: 'never',
      className: 'md:w-1/3',
      optionLabels: {
        MALE:              'Masculino',
        FEMALE:            'Feminino',
        OTHER:             'Outro',
        PREFER_NOT_TO_SAY: 'Não informar',
      },
    }),

    maritalStatus: z.enum(['SINGLE', 'MARRIED', 'DIVORCED', 'WIDOWED', 'DOMESTIC_PARTNERSHIP']).optional().meta({
      label: 'Estado Civil',
      listVisibility: 'never',
      className: 'md:w-1/3',
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
      className: 'md:w-1/2',
      placeholder: 'email@domain.com',
    }),

    phone: z.string().optional().meta({
      label: 'Telefone',
      mask: 'phone',
      className: 'md:w-1/4',
      placeholder: '(00) 00000 0000',
      listVisibility: 'hidden',
      keybind: 'f',
    }),

    hireDate: z.date().meta({
      label: 'Admissão',
      listVisibility: 'hidden',
      filter: { type: 'date_range' },
      className: 'md:w-1/4',
      defaultValue: '$today',
    }),

    terminationDate: z.date().optional().meta({
      label: 'Demissão',
      listVisibility: 'hidden',
      className: 'md:w-1/4',
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
    nameField:   'code',
    icon:        'UserRound',
    defaultSort: { field: 'fullName', order: 'asc' },
    afterCreate:    '/hr/contract?employeeId={id}',
    defaultFilters: { status: 'ACTIVE' },
    importKey:      'code',
    // a filled contract column means a NEW contract (see EmployeeService.importWrite)
    importNested: {
      contract: {
        schema:  contractSchema,
        columns: {
          contractStart:   'startDate',
          jobTitle:        'jobTitleId',
          contractType:    'type',
          salary:          'salary',
          contractEnd:     'endDate',
          weeklyHours:     'weeklyHours',
          workDaysPerWeek: 'workDaysPerWeek',
        },
      },
    },
    // every enum value appears at least once — the file is how users learn the accepted values
    importExamples: [
      {
        code: '000101', branch: 'Filial Centro', fullName: 'Ana Paula Souza', preferredName: 'Ana', taxId: '12345678901',
        status: 'ACTIVE', dateOfBirth: '12/05/1990', gender: 'FEMALE', maritalStatus: 'MARRIED', email: 'ana.souza@email.com',
        phone: '11987654321', hireDate: '01/02/2024', notes: 'Exemplo completo, com contrato',
        contractStart: '01/02/2024', jobTitle: 'Motorista', contractType: 'CLT', salary: '3500,00', weeklyHours: '42', workDaysPerWeek: '6',
      },
      {
        code: '000102', branch: 'Filial Centro', fullName: 'Bruno Lima', taxId: '23456789012', status: 'ACTIVE', gender: 'MALE',
        maritalStatus: 'SINGLE', hireDate: '10/03/2025',
        contractStart: '10/03/2025', jobTitle: 'Analista', contractType: 'PJ', salary: '8000,00', contractEnd: '09/03/2027',
      },
      {
        code: '000103', branch: 'Filial Centro', fullName: 'Carla Mendes', taxId: '34567890123', status: 'ON_LEAVE', gender: 'OTHER',
        maritalStatus: 'DIVORCED', hireDate: '05/01/2026',
        contractStart: '05/01/2026', jobTitle: 'Cobrador', contractType: 'TEMPORARY', salary: '2400,00', contractEnd: '04/07/2026',
      },
      {
        code: '000104', branch: 'Filial Centro', fullName: 'Diego Rocha', taxId: '45678901234', status: 'INACTIVE', gender: 'PREFER_NOT_TO_SAY',
        maritalStatus: 'WIDOWED', hireDate: '01/08/2025',
        contractStart: '01/08/2025', jobTitle: 'Estagiário', contractType: 'INTERNSHIP', salary: '1500,00', weeklyHours: '30', workDaysPerWeek: '5',
      },
      {
        code: '000105', branch: 'Filial Centro', fullName: 'Elisa Prado', taxId: '56789012345', status: 'TERMINATED', gender: 'FEMALE',
        maritalStatus: 'DOMESTIC_PARTNERSHIP', hireDate: '01/03/2024', terminationDate: '15/09/2025',
        contractStart: '01/03/2024', jobTitle: 'Aprendiz', contractType: 'APPRENTICE', salary: '1200,00', contractEnd: '28/02/2026',
      },
      { code: '000106', branch: 'Filial Centro', fullName: 'Fábio Nunes', taxId: '67890123456', hireDate: '02/01/2026', notes: 'Mínimo para criar: sem contrato' },
      { code: '000090', phone: '1134567890', notes: 'Matrícula já cadastrada: atualiza só as células preenchidas' },
      { code: '000091', contractStart: '01/01/2027', jobTitle: 'Fiscal', contractType: 'CLT', salary: '4200,00', notes: 'Novo contrato: o vigente é encerrado em 31/12/2026' },
    ],
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
