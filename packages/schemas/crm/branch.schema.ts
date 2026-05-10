import { z } from 'zod'
import '../zod-meta'
import { withMeta } from '../with-meta'

export const branchSchema = withMeta(
  z.object({
    id:        z.string().uuid(),
    companyId: z.string().uuid().meta({ label: 'Empresa', showInList: false }),
    // Identificação
    name:      z.string().min(2).meta({ label: 'Nome', showInList: true, placeholder: 'Ex: Filial São Paulo' }),
    taxId:     z.string().length(14).nullable().optional().meta({ label: 'CNPJ', mask: 'cnpj', placeholder: '00000000000000', helpText: 'Deixe em branco para usar o CNPJ da empresa' }),
    isActive:  z.boolean().default(true).meta({ label: 'Ativo', showInList: true }),
    // Contato
    phone:     z.string().nullable().optional().meta({ label: 'Telefone', mask: 'phone', placeholder: '(00) 00000-0000' }),
    email:     z.string().email().nullable().optional().meta({ label: 'E-mail', placeholder: 'contato@filial.com.br' }),
    // Endereço
    address:   z.string().nullable().optional().meta({ label: 'Endereço', placeholder: 'Rua, número, complemento' }),
    city:      z.string().nullable().optional().meta({ label: 'Cidade', showInList: true }),
    state:     z.string().max(2).nullable().optional().meta({ label: 'UF', width: 'w-24', placeholder: 'SP', showInList: true }),
    zipCode:   z.string().nullable().optional().meta({ label: 'CEP', mask: 'cep', placeholder: '00000-000' }),
    // Controle
    createdAt: z.date().meta({ showInForm: false }),
    updatedAt: z.date().meta({ showInForm: false }),
  }),
  {
    label:       'Filial',
    labelPlural: 'Filiais',
    nameField:   'name',
    groups: {
      'Identificação': ['name', 'companyId', 'taxId', 'isActive'],
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
