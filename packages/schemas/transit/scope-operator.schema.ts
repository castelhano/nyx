import { z } from 'zod'
import '../zod-meta'
import { withMeta } from '../with-meta'

export const scopeOperatorSchema = withMeta(
  z.object({
    id: z.uuid().meta({ listVisibility: 'hidden' }),

    scopeId: z.uuid().meta({
      label:          'Escopo',
      showInForm:     false,
      listVisibility: 'hidden',
    }),

    branchId: z.uuid().meta({
      label:          'Filial',
      widget:         'select',
      resource:       'branch',
      domain:         'core',
      labelField:     'name',
      listVisibility: 'visible',
      filter:         { type: 'relation', endpoint: 'core/branch', labelField: 'name' },
    }),

    abbr: z.string().min(1).max(10).meta({
      label:          'Sigla',
      listVisibility: 'visible',
      className:      'md:w-32',
      keybind:        'a',
    }),

    share: z.number().min(0).max(100).optional().meta({
      label:          'Participação (%)',
      listVisibility: 'visible',
      className:      'md:w-32',
    }),

    createdAt: z.date().meta({ showInForm: false, listVisibility: 'never' }),
    updatedAt: z.date().meta({ showInForm: false, listVisibility: 'never' }),
  }),
  {
    label:       'Operador',
    labelPlural: 'Operadores',
    nameField:   'abbr',
    icon:        'Building2',
    breadcrumb: [
      { resource: 'scope', contextField: 'scopeId', listLabel: 'Escopo', nameField: 'name', keybind: 'f10' },
    ],
  },
)

export const createScopeOperatorSchema = scopeOperatorSchema.omit({ id: true, createdAt: true, updatedAt: true })
export const updateScopeOperatorSchema  = createScopeOperatorSchema.partial()

export type ScopeOperator          = z.infer<typeof scopeOperatorSchema>
export type CreateScopeOperatorDto = z.infer<typeof createScopeOperatorSchema>
export type UpdateScopeOperatorDto = z.infer<typeof updateScopeOperatorSchema>
