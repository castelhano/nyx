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

    // grantor's logo for this scope, printed in the exported OSO's header
    // (docs/proposal/plan_oso_export_v1.md) — kept out of osoConfig because AutoForm's
    // File-to-URL swap on submit only scans the payload's root level, not Json fields
    logoUrl: z.string().optional().meta({
      label:          'Logo',
      widget:         'avatar',
      listVisibility: 'never',
    }),

    // grantor name and fixed signatures printed on the exported OSO — see
    // docs/proposal/plan_oso_export_v1.md
    osoConfig: z.object({
      organName: z.string().optional().meta({ label: 'Nome do Órgão' }),
      signatures: z.array(
        z.object({
          role: z.string().meta({ label: 'Cargo' }),
          name: z.string().meta({ label: 'Nome' }),
        }),
      ).default([]).meta({ label: 'Assinaturas' }),
    }).optional().meta({
      label:          'Config. OSO',
      widget:         'object-editor',
      showInForm:     true,
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
