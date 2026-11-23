import { z } from 'zod'
import '../zod-meta'
import { withMeta } from '../with-meta'

// official extension of one direction before and after the change — from is null when the
// direction had no official km yet
export const lineRevisionKmSchema = z.object({
  from: z.number().nullable(),
  to:   z.number(),
})

export const lineRevisionExtensionSchema = z.object({
  OUTBOUND: lineRevisionKmSchema.optional(),
  INBOUND:  lineRevisionKmSchema.optional(),
  CIRCULAR: lineRevisionKmSchema.optional(),
})

// A change to the line's official trajectory — see LineRevision in transit.prisma
export const lineRevisionSchema = withMeta(
  z.object({
    id: z.uuid().meta({ listVisibility: 'hidden' }),

    lineId: z.uuid().meta({
      label:          'Linha',
      showInForm:     false,
      listVisibility: 'hidden',
    }),

    validFrom: z.date().meta({
      label:          'Vigência a partir de',
      listVisibility: 'visible',
      defaultValue:   '$today',
      className:      'md:w-48',
      keybind:        'i',
    }),

    description: z.string().min(2).meta({
      label:          'Descrição',
      placeholder:    'Ex: Trajeto alterado para atender a FEI',
      listVisibility: 'visible',
      className:      'md:w-1/2',
      keybind:        's',
    }),

    approvalRef: z.string().optional().nullable().meta({
      label:          'N Controle',
      placeholder:    'Opcional',
      listVisibility: 'visible',
      className:      'md:w-48',
      keybind:        'o',
    }),

    // written by POST /transit/line-revision/register (route screen) — shown read-only in the
    // form (widget 'km-change'), never written by it (LineRevisionService.update drops it)
    extensionKm: lineRevisionExtensionSchema.optional().meta({
      label:          'Extensão',
      widget:         'km-change',
      listVisibility: 'never',
    }),

    createdAt: z.date().meta({ showInForm: false, listVisibility: 'never' }),
    updatedAt: z.date().meta({ showInForm: false, listVisibility: 'never' }),
  }),
  {
    label:         'Alteração de Trajeto',
    labelPlural:   'Alterações de Trajeto',
    nameField:     'description',
    nameFirstWord: false,
    icon:          'History',
    defaultSort:   { field: 'validFrom', order: 'desc' },
    breadcrumb:    [
      { resource: 'transit-line', contextField: 'lineId', listLabel: 'Linhas', nameField: 'code', keybind: 'f7', overflow: true, order: 2 },
    ],
  },
)

export const createLineRevisionSchema = lineRevisionSchema.omit({ id: true, createdAt: true, updatedAt: true })
export const updateLineRevisionSchema  = createLineRevisionSchema.partial()

// body of POST /transit/line-revision/register — upserts the revision of (lineId, validFrom)
export const registerLineRevisionSchema = z.object({
  lineId:      z.uuid(),
  validFrom:   z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
  description: z.string().trim().min(2),
  approvalRef: z.string().trim().optional().nullable(),
  extensionKm: lineRevisionExtensionSchema,
})

export type LineRevision            = z.infer<typeof lineRevisionSchema>
export type LineRevisionExtension   = z.infer<typeof lineRevisionExtensionSchema>
export type CreateLineRevisionDto   = z.infer<typeof createLineRevisionSchema>
export type UpdateLineRevisionDto   = z.infer<typeof updateLineRevisionSchema>
export type RegisterLineRevisionDto = z.infer<typeof registerLineRevisionSchema>
