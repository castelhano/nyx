import { z } from 'zod'
import '../zod-meta'

export const userSchema = z.object({
  id:           z.string().uuid(),
  name:         z.string().min(2).meta({ label: 'Nome', showInList: true, placeholder: 'Nome completo' }),
  username:     z.string().min(3).meta({ label: 'Username', showInList: true, searchable: true, placeholder: 'Username' }),
  email:        z.string().email().nullable().optional().meta({ label: 'E-mail', showInList: false, placeholder: 'email@domain.com' }),
  passwordHash: z.string().meta({ showInList: false, showInForm: false }),
  role:         z.enum(['admin', 'operator', 'viewer']).meta({ label: 'Perfil', showInList: true, width: 'w-full md:w-60' }),
  isActive:     z.boolean().default(true).meta({ label: 'Ativo', showInList: true }),
  createdAt:    z.date().meta({ showInForm: false }),
  updatedAt:    z.date().meta({ showInForm: false }),
})

export const createUserSchema = userSchema
  .omit({ id: true, createdAt: true, updatedAt: true, passwordHash: true })
  .extend({ password: z.string().min(8).meta({ label: 'Senha', widget: 'password' }) })

export const updateUserSchema = createUserSchema.partial()

export const changePasswordSchema = z.object({
  currentPassword: z.string(),
  newPassword:     z.string().min(8),
})

export type User              = z.infer<typeof userSchema>
export type CreateUserDto     = z.infer<typeof createUserSchema>
export type UpdateUserDto     = z.infer<typeof updateUserSchema>
export type ChangePasswordDto = z.infer<typeof changePasswordSchema>
