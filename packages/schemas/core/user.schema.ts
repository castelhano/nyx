import { z } from 'zod'
import '../zod-meta'
import { withMeta } from '../with-meta'

export const userSchema = withMeta(
  z.object({
    id:           z.uuid().meta({listVisibility: 'hidden'}),
    name:         z.string().min(2).meta({ label: 'Nome', listVisibility: 'visible', placeholder: 'Nome completo', filter: true, keybind: 'g', className: 'md:w-1/2' }),
    username:     z.string().min(3).meta({ label: 'Username', listVisibility: 'visible', placeholder: 'Username', keybind: 'y', className: 'w-full md:w-1/3' }),
    email:        z.email().nullable().optional().meta({ label: 'E-mail', listVisibility: 'hidden', placeholder: 'email@domain.com', keybind: 'e', className: 'md:w-1/2' }),
    passwordHash: z.string().meta({ listVisibility: 'never', showInForm: false }),
    role:         z.enum(['admin', 'operator']).meta({ label: 'Perfil', listVisibility: 'visible', className: 'w-full md:w-1/3', filter: true, keybind: 'l' }),
    isActive:             z.boolean().default(true).meta({ label: 'Ativo', listVisibility: 'visible', filter: true }),
    forcePasswordChange:  z.boolean().default(false).meta({ label: 'Forçar troca de senha no login', listVisibility: 'never' }),
    createdAt:            z.date().meta({ showInForm: false }),
    updatedAt:            z.date().meta({ showInForm: false }),
  }),
  {
    label:       'Usuário',
    labelPlural: 'Usuários',
    icon:        'Users',
    importKey:   'username',
    // only on create: an existing user's password and permissions are never touched by the import
    importFields: {
      password: z.string().min(1).meta({ label: 'Senha temporária' }),
      branches: z.array(z.uuid()).optional().meta({
        label: 'Filiais', widget: 'multi-select', resource: 'branch', domain: 'core', labelField: 'name',
      }),
      permissionsFrom: z.uuid().optional().meta({
        label: 'Copiar permissões de', widget: 'select', resource: 'user', domain: 'core', labelField: 'name', importRef: 'username',
      }),
    },
    importNotice: 'O arquivo contém senhas temporárias em texto puro — descarte-o após a importação. A troca de senha é exigida no primeiro acesso. Senha e permissões de usuários já cadastrados não são alteradas.',
    // every enum value appears at least once — the file is how users learn the accepted values
    importExamples: [
      { username: 'ana.souza',   name: 'Ana Souza',   email: 'ana.souza@email.com', role: 'operator', isActive: 'SIM', password: 'Troca@123', branches: 'Filial Centro|Filial Norte', permissionsFrom: 'carlos.dias' },
      { username: 'bruno.lima',  name: 'Bruno Lima',  role: 'admin',    password: 'Troca@123' },
      { username: 'carla.mendes', name: 'Carla Mendes', role: 'operator', isActive: 'NAO', password: 'Troca@123', branches: 'Filial Centro' },
      { username: 'diego.rocha', email: 'diego.rocha@email.com', branches: 'Filial Norte', password: 'ignorada para usuário existente' },
    ],
  },
)

export const createUserSchema = userSchema
  .omit({ id: true, createdAt: true, updatedAt: true, passwordHash: true })
  .extend({ password: z.string().min(1).meta({ label: 'Senha', widget: 'password', keybind: 's' }) })

export const updateUserSchema = createUserSchema.partial()

export const changePasswordSchema = z.object({
  currentPassword: z.string(),
  newPassword:     z.string().min(8),
})

export type User              = z.infer<typeof userSchema>
export type CreateUserDto     = z.infer<typeof createUserSchema>
export type UpdateUserDto     = z.infer<typeof updateUserSchema>
export type ChangePasswordDto = z.infer<typeof changePasswordSchema>
