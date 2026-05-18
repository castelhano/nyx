import { z } from 'zod'
import '../zod-meta'
import { withMeta } from '../with-meta'

export const userSchema = withMeta(
  z.object({
    id:           z.string().uuid(),
    name:         z.string().min(2).meta({ label: 'Nome', listVisibility: 'visible', placeholder: 'Nome completo', filter: true }),
    username:     z.string().min(3).meta({ label: 'Username', listVisibility: 'visible', searchable: true, placeholder: 'Username' }),
    email:        z.string().email().nullable().optional().meta({ label: 'E-mail', listVisibility: 'hidden', placeholder: 'email@domain.com' }),
    passwordHash: z.string().meta({ listVisibility: 'never', showInForm: false }),
    role:         z.enum(['admin', 'operator', 'viewer']).meta({ label: 'Perfil', listVisibility: 'visible', className: 'w-full md:w-60', filter: true }),
    isActive:             z.boolean().default(true).meta({ label: 'Ativo', listVisibility: 'visible', filter: true }),
    forcePasswordChange:  z.boolean().default(false).meta({ label: 'Forçar troca de senha no login', listVisibility: 'never' }),
    createdAt:            z.date().meta({ showInForm: false }),
    updatedAt:            z.date().meta({ showInForm: false }),
  }),
  {
    label:       'Usuário',
    labelPlural: 'Usuários',
    icon:        'Users',
    groups: {
      'Acesso': ['role', 'isActive', 'forcePasswordChange'],
    },
  },
)

export const createUserSchema = userSchema
  .omit({ id: true, createdAt: true, updatedAt: true, passwordHash: true })
  .extend({ password: z.string().min(1).meta({ label: 'Senha', widget: 'password' }) })

export const updateUserSchema = createUserSchema.partial()

export const changePasswordSchema = z.object({
  currentPassword: z.string(),
  newPassword:     z.string().min(8),
})

export type User              = z.infer<typeof userSchema>
export type CreateUserDto     = z.infer<typeof createUserSchema>
export type UpdateUserDto     = z.infer<typeof updateUserSchema>
export type ChangePasswordDto = z.infer<typeof changePasswordSchema>
