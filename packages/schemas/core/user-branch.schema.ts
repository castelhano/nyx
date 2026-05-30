import { z } from 'zod'
import '../zod-meta'
import { withMeta } from '../with-meta'

export const branchUserRoleEnum = z.enum(['owner', 'manager', 'member'])

export const userBranchSchema = withMeta(
  z.object({
    id:        z.uuid().meta({listVisibility: 'hidden'}),
    userId:    z.uuid().meta({ label: 'Usuário', listVisibility: 'hidden' }),
    branchId:  z.uuid().meta({ label: 'Filial', listVisibility: 'visible' }),
    role:      branchUserRoleEnum.meta({ label: 'Papel', listVisibility: 'visible', widget: 'select' }),
    createdAt: z.date().meta({ showInForm: false }),
  }),
  {
    label:       'Vínculo de Filial',
    labelPlural: 'Vínculos de Filial',
    nameField:   'branchId',
    breadcrumb: [
      { resource: 'user', contextField: 'userId', listLabel: 'Usuários', nameField: 'name' },
    ],
  },
)

export const createUserBranchSchema = userBranchSchema.omit({ id: true, createdAt: true })
export const updateUserBranchSchema = createUserBranchSchema.partial()

export type UserBranch          = z.infer<typeof userBranchSchema>
export type CreateUserBranchDto = z.infer<typeof createUserBranchSchema>
export type UpdateUserBranchDto = z.infer<typeof updateUserBranchSchema>
