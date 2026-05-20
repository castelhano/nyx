import { z } from 'zod'
import '../zod-meta'
import { withMeta } from '../with-meta'

export const permissionActionEnum = z.enum(['create', 'read', 'update', 'delete'])

export const userPermissionSchema = withMeta(
  z.object({
    id:        z.string().uuid(),
    userId:    z.string().uuid().meta({ label: 'Usuário', listVisibility: 'hidden', keybind: 'u' }),
    resource:  z.string().min(1).meta({ label: 'Recurso', listVisibility: 'visible', keybind: 's' }),
    action:    permissionActionEnum.meta({ label: 'Ação', listVisibility: 'visible', widget: 'select', keybind: 'k' }),
    createdAt: z.date().meta({ showInForm: false }),
  }),
  {
    label:       'Permissão',
    labelPlural: 'Permissões',
    nameField:   'resource',
    breadcrumb: [
      { resource: 'user', contextField: 'userId', listLabel: 'Usuários', nameField: 'name', keybind: 'p' },
    ],
  },
)

export const createUserPermissionSchema = userPermissionSchema.omit({ id: true, createdAt: true })
export const updateUserPermissionSchema = createUserPermissionSchema.partial()

export type UserPermission          = z.infer<typeof userPermissionSchema>
export type CreateUserPermissionDto = z.infer<typeof createUserPermissionSchema>
export type UpdateUserPermissionDto = z.infer<typeof updateUserPermissionSchema>
