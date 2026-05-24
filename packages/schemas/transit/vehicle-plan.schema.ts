import { z } from 'zod'
import '../zod-meta'
import { withMeta } from '../with-meta'

// Constraints shape for a generated plan
export interface VehiclePlanConstraints {
  locked?: true    // entire plan is frozen — solver will not touch it in future runs
}

export const vehiclePlanSchema = withMeta(
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

    servicePeriodId: z.uuid().meta({
      label:          'Período',
      widget:         'select',
      resource:       'service-period',
      domain:         'transit',
      labelField:     'name',
      listVisibility: 'visible',
      filter:         { type: 'relation', endpoint: 'transit/service-period', labelField: 'name' },
      lazyEdit:       true,
      keybind:        'e',
    }),

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

    status: z.enum(['DRAFT', 'PROCESSING', 'READY', 'CONFIRMED']).default('DRAFT').meta({
      label:          'Status',
      listVisibility: 'visible',
      filter:         true,
      className:      'md:w-44',
      defaultValue:   'DRAFT',
      keybind:        's',
      optionLabels: {
        DRAFT:      'Rascunho',
        PROCESSING: 'Processando',
        READY:      'Gerado',
        CONFIRMED:  'Confirmado',
      },
    }),

    // populated after generation completes
    fleetCount: z.number().int().optional().meta({
      label:          'Veículos',
      listVisibility: 'visible',
      showInForm:     false,
      className:      'md:w-32',
    }),

    score: z.number().optional().meta({
      label:          'Pontuação',
      listVisibility: 'visible',
      showInForm:     false,
      className:      'md:w-36',
    }),

    deadrunKm: z.number().optional().meta({
      label:          'Km em Vazio',
      listVisibility: 'visible',
      showInForm:     false,
      className:      'md:w-36',
    }),

    generatedAt: z.date().optional().meta({
      label:          'Gerado em',
      listVisibility: 'visible',
      showInForm:     false,
    }),

    constraints: z.record(z.unknown()).optional().meta({
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
  },
)

export const createVehiclePlanSchema = vehiclePlanSchema.omit({ id: true, createdAt: true, updatedAt: true })
export const updateVehiclePlanSchema  = createVehiclePlanSchema.partial()

export type VehiclePlan          = z.infer<typeof vehiclePlanSchema>
export type CreateVehiclePlanDto = z.infer<typeof createVehiclePlanSchema>
export type UpdateVehiclePlanDto = z.infer<typeof updateVehiclePlanSchema>
