import { z } from 'zod'
import '../zod-meta'
import { withMeta } from '../with-meta'

export const permissionActionEnum = z.enum(['create', 'read', 'update', 'delete'])

export const userPermissionSchema = withMeta(
  z.object({
    id:        z.string().uuid(),
    userId:    z.string().uuid().meta({ label: 'Usuário', showInList: false }),
    resource:  z.string().min(1).meta({ label: 'Recurso', showInList: true }),
    action:    permissionActionEnum.meta({ label: 'Ação', showInList: true, widget: 'select' }),
    createdAt: z.date().meta({ showInForm: false, showInList: false }),
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
