import { z } from 'zod'
import '../zod-meta'
import { withMeta } from '../with-meta'

export const branchUserRoleEnum = z.enum(['owner', 'manager', 'member'])

export const userBranchSchema = withMeta(
  z.object({
    id:        z.string().uuid(),
    userId:    z.string().uuid().meta({ label: 'Usuário', showInList: false }),
    branchId:  z.string().uuid().meta({ label: 'Filial', showInList: true }),
    role:      branchUserRoleEnum.meta({ label: 'Papel', showInList: true, widget: 'select' }),
    createdAt: z.date().meta({ showInForm: false, showInList: false }),
  }),
  {
    label:       'Vínculo de Filial',
    labelPlural: 'Vínculos de Filial',
    nameField:   'branchId',
  },
)

export const createUserBranchSchema = userBranchSchema.omit({ id: true, createdAt: true })
export const updateUserBranchSchema = createUserBranchSchema.partial()

export type UserBranch          = z.infer<typeof userBranchSchema>
export type CreateUserBranchDto = z.infer<typeof createUserBranchSchema>
export type UpdateUserBranchDto = z.infer<typeof updateUserBranchSchema>
