import { z } from 'zod'
import '../zod-meta'
import { withMeta } from '../with-meta'

export const companySchema = withMeta(
  z.object({
    id:        z.string().uuid(),
    // Geral
    legalName: z.string().min(2).meta({ label: 'Razão Social', showInList: true, placeholder: 'Razão Social completa' }),
    tradeName: z.string().nullable().optional().meta({ label: 'Nome Fantasia', showInList: true, placeholder: 'Nome Fantasia' }),
    taxId:     z.string().length(8).meta({ label: 'CNPJ Raiz', mask: 'cnpj-base', searchable: true, placeholder: '00.000.000', listVisibility: 'hidden' }),
    type:      z.enum(['client', 'supplier', 'partner', 'other']).meta({ label: 'Tipo', listVisibility: 'visible', widget: 'select' }),
    isActive:  z.boolean().default(true).meta({ label: 'Ativo', listVisibility: 'visible' }),
    // Contato
    phone:     z.string().nullable().optional().meta({ label: 'Telefone', mask: 'phone', placeholder: '(00) 00000-0000', listVisibility: 'hidden' }),
    email:     z.string().email().nullable().optional().meta({ label: 'E-mail', placeholder: 'contato@empresa.com.br', listVisibility: 'hidden' }),
    website:   z.string().nullable().optional().meta({ label: 'Website', placeholder: 'https://empresa.com.br', listVisibility: 'never' }),
    // Endereço
    address:   z.string().nullable().optional().meta({ label: 'Endereço', placeholder: 'Rua, número, complemento', listVisibility: 'never' }),
    city:      z.string().nullable().optional().meta({ label: 'Cidade', listVisibility: 'hidden' }),
    state:     z.string().max(2).nullable().optional().meta({ label: 'UF', width: 'w-24', placeholder: 'SP', listVisibility: 'hidden' }),
    zipCode:   z.string().nullable().optional().meta({ label: 'CEP', mask: 'cep', placeholder: '00000-000', listVisibility: 'hidden' }),
    // Controle
    createdAt: z.date().meta({ showInForm: false, listVisibility: 'never' }),
    updatedAt: z.date().meta({ showInForm: false, listVisibility: 'never' }),
  }),
  {
    label:       'Empresa',
    labelPlural: 'Empresas',
    nameField:   'legalName',
    children: [
      { resource: 'branch', domain: 'core', label: 'Filiais', contextField: 'companyId' },
    ],
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
