import { z } from 'zod'
import '../zod-meta'
import { withMeta } from '../with-meta'

export const companySchema = withMeta(
  z.object({
    id:        z.uuid().meta({listVisibility: 'hidden'}),
    // Geral
    tradeName: z.string().nullable().optional().meta({ label: 'Nome Fantasia', listVisibility: 'visible', placeholder: 'Nome Fantasia', filter: true, keybind: 'v', className: 'md:w-1/4' }),
    legalName: z.string().min(2).meta({ label: 'Razão Social', className: 'md:w-1/2', listVisibility: 'hidden', placeholder: 'Razão social', keybind: 'l' }),
    taxId:     z.string().length(8).meta({ label: 'CNPJ Raiz', className: 'md:w-1/2', mask: 'cnpj-base', placeholder: '00.000.000', keybind: 'x', listVisibility: 'visible' }),
    isActive:  z.boolean().default(true).meta({ label: 'Ativo', listVisibility: 'visible' }),
    // Contato
    phone:     z.string().nullable().optional().meta({ label: 'Telefone', mask: 'phone', className: 'md:w-1/2', placeholder: '(00) 00000-0000', listVisibility: 'hidden', keybind: 'f' }),
    email:     z.email().nullable().optional().meta({ label: 'E-mail', widget: 'email', className: 'md:w-1/2', placeholder: 'contato@empresa.com.br', listVisibility: 'hidden', keybind: 'e' }),
    website:   z.string().nullable().optional().meta({ label: 'Website', className: 'md:w-1/2', placeholder: 'https://empresa.com.br', listVisibility: 'never', keybind: 'k' }),
    // Endereço
    address:   z.string().nullable().optional().meta({ label: 'Endereço', placeholder: 'Rua, número, complemento', listVisibility: 'never', keybind: 'd' }),
    city:      z.string().nullable().optional().meta({ label: 'Cidade', placeholder: 'Cidade', className: 'md:w-1/3', listVisibility: 'hidden', keybind: 'g' }),
    state:     z.string().max(2).nullable().optional().meta({ label: 'UF', className: 'md:w-40', placeholder: 'SP', listVisibility: 'hidden', keybind: 'y' }),
    zipCode:   z.string().nullable().optional().meta({ label: 'CEP', mask: 'cep', className: 'md:w-1/3', placeholder: '00000-000', listVisibility: 'hidden', keybind: 'p' }),
    // Controle
    createdAt: z.date().meta({ showInForm: false, listVisibility: 'never' }),
    updatedAt: z.date().meta({ showInForm: false, listVisibility: 'never' }),
  }),
  {
    label:        'Empresa',
    labelPlural:  'Empresas',
    nameField:    'legalName',
    icon:         'Building',
    afterCreate:  '/core/branch?companyId={id}',
    groups: {
      'Contato':       ['phone', 'email', 'website'],
      'Endereço':      ['address', 'city', 'state', 'zipCode'],
    },
  },
)

export const createCompanySchema = companySchema.omit({ id: true, createdAt: true, updatedAt: true })
export const updateCompanySchema = createCompanySchema.partial()

export type Company          = z.infer<typeof companySchema>
export type CreateCompanyDto = z.infer<typeof createCompanySchema>
export type UpdateCompanyDto = z.infer<typeof updateCompanySchema>
