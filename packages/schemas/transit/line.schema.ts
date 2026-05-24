import { z } from 'zod'
import '../zod-meta'
import { withMeta } from '../with-meta'

export const lineSchema = withMeta(
  z.object({
    id: z.uuid(),

    branchId: z.uuid().meta({
      label:          'Filial',
      widget:         'select',
      resource:       'branch',
      domain:         'core',
      labelField:     'name',
      listVisibility: 'hidden',
      filter:         { type: 'relation', endpoint: 'core/branch', labelField: 'name' },
      lazyEdit:       true,
      keybind:        'f',
    }),

    code: z.string().min(1).max(20).meta({
      label:          'Código',
      listVisibility: 'visible',
      className:      'md:w-32',
      keybind:        'c',
    }),

    name: z.string().min(2).meta({
      label:          'Nome',
      listVisibility: 'visible',
      keybind:        'n',
    }),

    type: z.enum(['URBAN', 'METROPOLITAN', 'RURAL', 'SPECIAL']).meta({
      label:          'Tipo',
      listVisibility: 'visible',
      filter:         true,
      className:      'md:w-48',
      keybind:        't',
      optionLabels: {
        URBAN:        'Urbano',
        METROPOLITAN: 'Metropolitano',
        RURAL:        'Rural',
        SPECIAL:      'Especial',
      },
    }),

    isActive: z.boolean().default(true).meta({
      label:          'Ativo',
      widget:         'switch',
      listVisibility: 'visible',
      filter:         true,
      defaultValue:   'true',
      keybind:        'a',
    }),

    notes: z.string().optional().meta({
      label:          'Observações',
      widget:         'textarea',
      listVisibility: 'never',
    }),

    createdAt: z.date().meta({ showInForm: false, listVisibility: 'never' }),
    updatedAt: z.date().meta({ showInForm: false, listVisibility: 'never' }),
  }),
  {
    label:       'Linha',
    labelPlural: 'Linhas',
    nameField:   'name',
    icon:        'Route',
    defaultSort: { field: 'code', order: 'asc' },
  },
)

export const createLineSchema = lineSchema.omit({ id: true, createdAt: true, updatedAt: true })
export const updateLineSchema  = createLineSchema.partial()

export type Line          = z.infer<typeof lineSchema>
export type CreateLineDto = z.infer<typeof createLineSchema>
export type UpdateLineDto = z.infer<typeof updateLineSchema>
