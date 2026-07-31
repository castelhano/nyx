import { z } from 'zod'
import '../zod-meta'
import { withMeta } from '../with-meta'

export const scopeSchema = withMeta(
  z.object({
    id: z.uuid().meta({ listVisibility: 'hidden' }),

    name: z.string().min(1).meta({
      label:          'Nome',
      listVisibility: 'visible',
      className:      'md:w-1/2',
      keybind:        'n',
    }),

    description: z.string().optional().meta({
      label:          'Descrição',
      widget:         'textarea',
      listVisibility: 'never',
    }),

    createdAt: z.date().meta({ showInForm: false, listVisibility: 'never' }),
    updatedAt: z.date().meta({ showInForm: false, listVisibility: 'never' }),
  }),
  {
    label:       'Escopo',
    labelPlural: 'Escopos',
    nameField:   'name',
    icon:        'Globe',
  },
)

export const createScopeSchema = scopeSchema.omit({ id: true, createdAt: true, updatedAt: true })
export const updateScopeSchema  = createScopeSchema.partial()

export type Scope          = z.infer<typeof scopeSchema>
export type CreateScopeDto = z.infer<typeof createScopeSchema>
export type UpdateScopeDto = z.infer<typeof updateScopeSchema>
