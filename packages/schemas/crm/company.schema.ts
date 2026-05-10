import { z } from 'zod'
import '../zod-meta'
import { withMeta } from '../with-meta'

export const companySchema = withMeta(
  z.object({
    id:        z.string().uuid(),
    // Identificação
    legalName: z.string().min(2).meta({ label: 'Razão Social', showInList: true, placeholder: 'Razão Social completa' }),
    tradeName: z.string().nullable().optional().meta({ label: 'Nome Fantasia', showInList: true, placeholder: 'Nome Fantasia' }),
    taxId:     z.string().length(14).meta({ label: 'CNPJ', mask: 'cnpj', searchable: true, placeholder: '00000000000000' }),
    type:      z.enum(['client', 'supplier', 'partner', 'other']).meta({ label: 'Tipo', showInList: true, widget: 'select' }),
    isActive:  z.boolean().default(true).meta({ label: 'Ativo', showInList: true }),
    // Contato
    phone:     z.string().nullable().optional().meta({ label: 'Telefone', mask: 'phone', placeholder: '(00) 00000-0000' }),
    email:     z.string().email().nullable().optional().meta({ label: 'E-mail', placeholder: 'contato@empresa.com.br' }),
    website:   z.string().nullable().optional().meta({ label: 'Website', placeholder: 'https://empresa.com.br' }),
    // Endereço
    address:   z.string().nullable().optional().meta({ label: 'Endereço', placeholder: 'Rua, número, complemento' }),
    city:      z.string().nullable().optional().meta({ label: 'Cidade' }),
    state:     z.string().max(2).nullable().optional().meta({ label: 'UF', width: 'w-24', placeholder: 'SP' }),
    zipCode:   z.string().nullable().optional().meta({ label: 'CEP', mask: 'cep', placeholder: '00000-000' }),
    // Controle
    createdAt: z.date().meta({ showInForm: false }),
    updatedAt: z.date().meta({ showInForm: false }),
  }),
  {
    label:       'Empresa',
    labelPlural: 'Empresas',
    nameField:   'legalName',
    groups: {
      'Identificação': ['legalName', 'tradeName', 'taxId', 'type', 'isActive'],
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
