import { z } from 'zod'
import '../zod-meta'
import { withMeta } from '../with-meta'

// Logical crew schedule of a VehiclePlan — see docs/proposal/plan_crew_plan_v1.md.

export const crewPlanSummarySchema = z.object({
  dutyCount:        z.number(),
  byRole:           z.record(z.string(), z.number()),
  byKind:           z.record(z.string(), z.number()),
  workMinutes:      z.number(),
  paidMinutes:      z.number(),
  overtimeMinutes:  z.number(),
  nightMinutes:     z.number(),
  uncoveredMinutes: z.number(),
  // block spans with no DRIVER piece (stale pieces don't count as coverage)
  uncovered: z.array(z.object({
    vehicleBlockId: z.string(),
    startMinutes:   z.number(),
    endMinutes:     z.number(),
  })),
  staleDutyCount:   z.number(),
  issueDutyCount:   z.number(),
  score:            z.number(),
})
export type CrewPlanSummary = z.infer<typeof crewPlanSummarySchema>

export const crewPlanSchema = withMeta(
  z.object({
    id: z.uuid().meta({ listVisibility: 'hidden' }),

    vehiclePlanId: z.uuid().meta({
      label:          'Planejamento',
      showInForm:     false,
      listVisibility: 'hidden',
    }),

    description: z.string().optional().meta({
      label:          'Descrição',
      listVisibility: 'visible',
      className:      'md:w-1/3',
      keybind:        'e',
    }),

    // only changes through activation/closing — never via PATCH (see CrewPlanService.update)
    status: z.enum(['DRAFT', 'ACTIVE']).default('DRAFT').meta({
      label:          'Status',
      listVisibility: 'visible',
      filter:         true,
      showInForm:     false,
      widget:         'badge',
      optionLabels: {
        DRAFT:  'Rascunho',
        ACTIVE: 'Ativo',
      },
      optionColors: {
        ACTIVE: 'success',
      },
    }),

    validFrom: z.date().optional().nullable().meta({
      label:          'Vigência Início',
      showInForm:     false,
      listVisibility: 'visible',
    }),

    validTo: z.date().optional().nullable().meta({
      label:          'Vigência Fim',
      showInForm:     false,
      listVisibility: 'visible',
    }),

    summary: z.record(z.string(), z.unknown()).optional().meta({
      label:          'Resumo',
      listVisibility: 'never',
      showInForm:     false,
    }),

    // full CrewSettings when customized — null inherits Scope/global live
    settings: z.record(z.string(), z.unknown()).optional().nullable().meta({
      label:          'Configuração personalizada',
      listVisibility: 'never',
      showInForm:     false,
    }),

    constraints: z.record(z.string(), z.unknown()).optional().meta({
      label:          'Restrições',
      listVisibility: 'never',
      showInForm:     false,
    }),

    generatedAt: z.date().optional().nullable().meta({
      label:          'Gerado em',
      listVisibility: 'never',
      showInForm:     false,
    }),

    notes: z.string().optional().meta({
      label:          'Observações',
      listVisibility: 'hidden',
      widget:         'textarea',
      keybind:        'o',
    }),

    createdAt: z.date().meta({ showInForm: false, listVisibility: 'never' }),
    updatedAt: z.date().meta({ showInForm: false, listVisibility: 'never' }),
  }),
  {
    label:       'Escala',
    labelPlural: 'Escalas',
    nameField:   'description',
    icon:        'Users',
    defaultSort: { field: 'createdAt', order: 'desc' },
    breadcrumb:  [
      { resource: 'vehicle-plan', contextField: 'vehiclePlanId', listLabel: 'Planejamentos', nameField: 'description' },
    ],
  },
)

export const createCrewPlanSchema = crewPlanSchema.omit({ id: true, createdAt: true, updatedAt: true })
export const updateCrewPlanSchema  = createCrewPlanSchema.partial()

export type CrewPlan          = z.infer<typeof crewPlanSchema>
export type CreateCrewPlanDto = z.infer<typeof createCrewPlanSchema>
export type UpdateCrewPlanDto = z.infer<typeof updateCrewPlanSchema>
