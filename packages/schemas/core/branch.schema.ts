import { z } from 'zod'
import '../zod-meta'
import { withMeta } from '../with-meta'

export const branchSchema = withMeta(
  z.object({
    id:        z.uuid().meta({listVisibility: 'hidden'}),
    companyId: z.uuid().meta({ label: 'Empresa', listVisibility: 'hidden', className: 'md:w-1/2', widget: 'select', resource: 'company', labelField: 'legalName', keybind: 'q', filter: { type: 'relation', endpoint: 'core/company', labelField: 'legalName' } }),
    // Geral
    name:      z.string().min(2).meta({ label: 'Nome', className: 'md:w-1/2', listVisibility: 'visible', placeholder: 'Nome abreviado', keybind: 'g' }),
    taxId:     z.string().length(14).nullable().optional().meta({ label: 'CNPJ', mask: 'cnpj', className: 'md:w-64', placeholder: '00.000.000/00', listVisibility: 'hidden', keybind: 'x' }),
    isActive:  z.boolean().default(true).meta({ label: 'Ativo', listVisibility: 'visible' }),
    // Contato
    phone:     z.string().nullable().optional().meta({ label: 'Telefone', mask: 'phone', className: 'md:w-64', placeholder: '(00) 00000-0000', listVisibility: 'hidden', keybind: 'f' }),
    email:     z.email().nullable().optional().meta({ label: 'E-mail', widget: 'email', className: 'md:w-64', placeholder: 'contato@filial.com.br', listVisibility: 'hidden', keybind: 'e' }),
    // Endereço
    address:   z.string().nullable().optional().meta({ label: 'Endereço', placeholder: 'Rua, número, complemento', listVisibility: 'never', keybind: 'd' }),
    city:      z.string().nullable().optional().meta({ label: 'Cidade', className: 'md:w-1/2', listVisibility: 'visible', keybind: 'v' }),
    state:     z.string().max(2).nullable().optional().meta({ label: 'UF', className: 'w-24', placeholder: 'SP', listVisibility: 'visible', keybind: 'y' }),
    zipCode:   z.string().nullable().optional().meta({ label: 'CEP', mask: 'cep', className: 'md:w-64', placeholder: '00000-000', listVisibility: 'never', keybind: 'p' }),
    // Controle
    createdAt: z.date().meta({ showInForm: false }),
    updatedAt: z.date().meta({ showInForm: false }),
  }),
  {
    label:       'Filial',
    labelPlural: 'Filiais',
    nameField:   'name',
    breadcrumb: [
      { resource: 'company', contextField: 'companyId', listLabel: 'Empresas', nameField: 'legalName', keybind: 'f9' },
    ],
    groups: {
      'Contato':       ['phone', 'email'],
      'Endereço':      ['address', 'city', 'state', 'zipCode'],
    },
  },
)

export const createBranchSchema = branchSchema.omit({ id: true, createdAt: true, updatedAt: true })
export const updateBranchSchema = createBranchSchema.partial()

export type Branch          = z.infer<typeof branchSchema>
export type CreateBranchDto = z.infer<typeof createBranchSchema>
export type UpdateBranchDto = z.infer<typeof updateBranchSchema>
