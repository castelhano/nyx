import { z } from 'zod'
import '../zod-meta'
import { withMeta } from '../with-meta'

// Constraints shape for a generated plan
export interface VehiclePlanConstraints {
  locked?: true    // entire plan is frozen — solver will not touch it in future runs
}

export const vehiclePlanSummarySchema = z.object({
  fleetCount:        z.number(),
  score:             z.number(),
  deadrunKm:         z.number(),
  productiveKm:      z.number(),
  totalKm:           z.number(),
  deadrunMinutes:    z.number(),
  productiveMinutes: z.number(),
  totalMinutes:      z.number(),
  errors: z.object({
    missingMatrix: z.array(z.object({ origin: z.string(), destination: z.string() })),
  }).optional(),
})
export type VehiclePlanSummary = z.infer<typeof vehiclePlanSummarySchema>

export const vehiclePlanSchema = withMeta(
  z.object({
    id: z.uuid().meta({listVisibility: 'hidden'}),

    dayTypeId: z.uuid().meta({
      label:          'Tipo de Dia',
      widget:         'select',
      resource:       'day-type',
      domain:         'transit',
      labelField:     'name',
      listVisibility: 'visible',
      filter:         { type: 'relation', endpoint: 'transit/day-type', labelField: 'name' },
      keybind:        'd',
    }),

    description: z.string().optional().meta({
      label:          'Descrição',
      listVisibility: 'visible',
      className:      'md:w-1/3',
      keybind:        'e',
    }),

    status: z.enum(['DRAFT', 'ACTIVE']).default('DRAFT').meta({
      label:          'Status',
      listVisibility: 'visible',
      filter:         true,
      className:      'md:w-44',
      defaultValue:   'DRAFT',
      keybind:        's',
      optionLabels: {
        DRAFT:  'Rascunho',
        ACTIVE: 'Ativo',
      },
    }),

    metrics: z.record(z.string(), z.unknown()).optional().meta({
      label:          'Métricas',
      listVisibility: 'never',
      showInForm:     false,
    }),

    // populated by solver; shape: { fleetCount, score, deadrunKm, productiveKm, totalHours, ... }
    summary: z.record(z.string(), z.unknown()).optional().meta({
      label:          'Resumo',
      listVisibility: 'never',
      showInForm:     false,
    }),

    generatedAt: z.date().optional().meta({
      label:          'Gerado em',
      listVisibility: 'visible',
      showInForm:     false,
    }),

    constraints: z.record(z.string(), z.unknown()).optional().meta({
      label:          'Restrições',
      listVisibility: 'never',
      showInForm:     false,
    }),

    createdAt: z.date().meta({ showInForm: false, listVisibility: 'never' }),
    updatedAt: z.date().meta({ showInForm: false, listVisibility: 'never' }),
  }),
  {
    label:       'Planejamento',
    labelPlural: 'Planejamentos',
    nameField:   'status',
    icon:        'LayoutList',
    defaultSort: { field: 'generatedAt', order: 'desc' },
    rowActions: [
      {
        action:     'duplicate',
        label:      'Duplicar',
        icon:       'Copy',
        permission: 'create',
        method:     'POST',
        endpoint:   (row) => `/transit/vehicle-plan/${row.id}/duplicate`,
      },
      {
        action:      'import',
        label:       'Importar',
        icon:        'Upload',
        permission:  'update',
        visibleWhen: { field: 'status', value: 'DRAFT' },
      },
      {
        action:      'delete',
        label:       'Excluir',
        icon:        'Trash2',
        variant:     'destructive',
        permission:  'delete',
        visibleWhen: { field: 'status', value: 'DRAFT' },
      },
    ],
  },
)

export const createVehiclePlanSchema = vehiclePlanSchema.omit({ id: true, createdAt: true, updatedAt: true })
export const updateVehiclePlanSchema  = createVehiclePlanSchema.partial()

export type VehiclePlan          = z.infer<typeof vehiclePlanSchema>
export type CreateVehiclePlanDto = z.infer<typeof createVehiclePlanSchema>
export type UpdateVehiclePlanDto = z.infer<typeof updateVehiclePlanSchema>
