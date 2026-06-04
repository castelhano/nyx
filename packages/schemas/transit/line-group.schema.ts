import { z } from 'zod'
import '../zod-meta'
import { withMeta } from '../with-meta'

export const lineGroupSchema = withMeta(
  z.object({
    id: z.uuid().meta({ listVisibility: 'hidden' }),

    name: z.string().min(1).meta({
      label:          'Nome',
      listVisibility: 'visible',
      keybind:        'n',
    }),

    branchId: z.uuid().optional().meta({
      label:          'Filial',
      widget:         'select',
      resource:       'branch',
      domain:         'core',
      labelField:     'name',
      listVisibility: 'visible',
      filter:         { type: 'relation', endpoint: 'core/branch', labelField: 'name' },
      keybind:        'f',
    }),

    lineIds: z.array(z.uuid()).default([]).meta({
      label:          'Linhas',
      widget:         'multi-select',
      resource:       'transit-line',
      domain:         'transit',
      labelField:     'code',
      listVisibility: 'hidden',
      keybind:        'l',
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
    label:       'Grupo de Linhas',
    labelPlural: 'Grupos de Linhas',
    nameField:   'name',
    icon:        'Layers',
  },
)

export const createLineGroupSchema = lineGroupSchema.omit({ id: true, createdAt: true, updatedAt: true })
export const updateLineGroupSchema  = createLineGroupSchema.partial()

export type LineGroup          = z.infer<typeof lineGroupSchema>
export type CreateLineGroupDto = z.infer<typeof createLineGroupSchema>
export type UpdateLineGroupDto = z.infer<typeof updateLineGroupSchema>
