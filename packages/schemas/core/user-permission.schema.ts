import { z } from 'zod'
import '../zod-meta'
import { withMeta } from '../with-meta'

export const permissionActionEnum = z.enum(['create', 'read', 'update', 'delete'])

export const userPermissionSchema = withMeta(
  z.object({
    id:        z.uuid().meta({listVisibility: 'hidden'}),
    userId:    z.uuid().meta({ label: 'Usuário', listVisibility: 'hidden', widget: 'select', resource: 'user', domain: 'core', labelField: 'name', importRef: 'username' }),
    resource:  z.string().min(1).meta({ label: 'Recurso', listVisibility: 'visible' }),
    // the import takes a resource's actions together (importFields.actions)
    action:    permissionActionEnum.meta({ label: 'Ação', listVisibility: 'visible', widget: 'select', importable: false }),
    createdAt: z.date().meta({ showInForm: false }),
  }),
  {
    label:       'Permissão',
    labelPlural: 'Permissões',
    nameField:   'resource',
    breadcrumb: [
      { resource: 'user', contextField: 'userId', listLabel: 'Usuários', nameField: 'name' },
    ],
    // a row replaces the user's actions on that resource; resources left out of the file are kept
    importKey:    ['userId', 'resource'],
    importFields: {
      actions: z.array(permissionActionEnum).min(1).meta({
        label:        'Ações',
        optionLabels: { create: 'Criar', read: 'Ver', update: 'Editar', delete: 'Excluir' },
      }),
    },
    importNotice: 'Cada linha substitui as ações do usuário naquele recurso; recursos fora do arquivo não mudam. O recurso é a chave usada na URL (ex.: vehicle-plan).',
    // every enum value appears at least once — the file is how users learn the accepted values
    importExamples: [
      { user: 'ana.souza',  resource: 'vehicle',  actions: 'read|update' },
      { user: 'ana.souza',  resource: 'employee', actions: 'create|read|update|delete' },
      { user: 'bruno.lima', resource: 'holiday',  actions: 'read' },
    ],
  },
)

export const createUserPermissionSchema = userPermissionSchema.omit({ id: true, createdAt: true })
export const updateUserPermissionSchema = createUserPermissionSchema.partial()

export type UserPermission          = z.infer<typeof userPermissionSchema>
export type CreateUserPermissionDto = z.infer<typeof createUserPermissionSchema>
export type UpdateUserPermissionDto = z.infer<typeof updateUserPermissionSchema>
