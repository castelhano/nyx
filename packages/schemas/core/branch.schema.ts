import { z } from 'zod'
import '../zod-meta'
import { withMeta } from '../with-meta'

export const branchSchema = withMeta(
  z.object({
    id:        z.string().uuid(),
    companyId: z.string().uuid().meta({ label: 'Empresa', listVisibility: 'hidden', widget: 'select', resource: 'company', labelField: 'legalName' }),
    // Geral
    name:      z.string().min(2).meta({ label: 'Nome', listVisibility: 'visible', placeholder: 'Nome abreviado' }),
    taxId:     z.string().length(14).nullable().optional().meta({ label: 'CNPJ', mask: 'cnpj', placeholder: '00.000.000/00', listVisibility: 'hidden' }),
    isActive:  z.boolean().default(true).meta({ label: 'Ativo', listVisibility: 'visible' }),
    // Contato
    phone:     z.string().nullable().optional().meta({ label: 'Telefone', mask: 'phone', placeholder: '(00) 00000-0000', listVisibility: 'hidden' }),
    email:     z.string().email().nullable().optional().meta({ label: 'E-mail', placeholder: 'contato@filial.com.br', listVisibility: 'hidden' }),
    // Endereço
    address:   z.string().nullable().optional().meta({ label: 'Endereço', placeholder: 'Rua, número, complemento', listVisibility: 'never' }),
    city:      z.string().nullable().optional().meta({ label: 'Cidade', listVisibility: 'visible' }),
    state:     z.string().max(2).nullable().optional().meta({ label: 'UF', width: 'w-24', placeholder: 'SP', listVisibility: 'visible' }),
    zipCode:   z.string().nullable().optional().meta({ label: 'CEP', mask: 'cep', placeholder: '00000-000', listVisibility: 'never' }),
    // Controle
    createdAt: z.date().meta({ showInForm: false }),
    updatedAt: z.date().meta({ showInForm: false }),
  }),
  {
    label:       'Filial',
    labelPlural: 'Filiais',
    nameField:   'name',
    breadcrumb: [
      { resource: 'company', contextField: 'companyId', listLabel: 'Empresas', nameField: 'legalName' },
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
