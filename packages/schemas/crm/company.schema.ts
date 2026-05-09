import { z } from 'zod'
import '../zod-meta'
import { withMeta } from '../with-meta'

export const companySchema = withMeta(
  z.object({
    id:        z.string().uuid(),
    legalName: z.string().min(2).meta({ label: 'Razão Social', showInList: true }),
    tradeName: z.string().nullable().meta({ label: 'Nome Fantasia', showInList: true }),
    taxId:     z.string().meta({ label: 'CNPJ', mask: 'cnpj', searchable: true }),
    type:      z.enum(['client', 'supplier', 'partner', 'other']).meta({ label: 'Tipo', showInList: true }),
    isActive:  z.boolean().default(true).meta({ label: 'Ativo', showInList: true }),
    createdAt: z.date().meta({ showInForm: false }),
    updatedAt: z.date().meta({ showInForm: false }),
  }),
  {
    label:       'Empresa',
    labelPlural: 'Empresas',
    nameField:   'legalName',
  },
)

export const createCompanySchema = companySchema.omit({ id: true, createdAt: true, updatedAt: true })
export const updateCompanySchema = createCompanySchema.partial()

export type Company          = z.infer<typeof companySchema>
export type CreateCompanyDto = z.infer<typeof createCompanySchema>
export type UpdateCompanyDto = z.infer<typeof updateCompanySchema>
