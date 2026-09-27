import { z } from 'zod'
import '../zod-meta'
import { withMeta } from '../with-meta'

// Logical crew schedule of a VehiclePlan.

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
  // each active criterion that entered the score: its weight and value (0–1) — the points it
  // cost are 9999 × weight × (1 − value) ÷ Σ weights. `raw` is the same value without the
  // floor at 0: past floor/ceiling it keeps falling (negative) — see rawScore
  criteria: z.array(z.object({ key: z.string(), weight: z.number(), value: z.number(), raw: z.number().optional() })).default([]),
  // the score from the raw values — what the crew solver optimizes (a criterion already past its
  // ceiling still rewards getting closer to it); may go below 0
  rawScore: z.number().optional(),
  // distinct DRIVER duties per vehicle, mean over the vehicles with a driver
  driversPerVehicle: z.number().optional(),
  // DRIVER-covered minutes of the blocks' service spans (the efficiency criterion's base)
  coveredMinutes:   z.number(),
  // same, split by the block's branch
  coveredByBranch:  z.array(z.object({ branchId: z.string().nullable(), minutes: z.number() })),
  // each duty split across the lines it operates, in proportion to its trip minutes on each;
  // lineId null = duties with no trip
  byLine: z.array(z.object({
    lineId:          z.string().nullable(),
    role:            z.string(),
    branchId:        z.string().nullable(),
    dutyShare:       z.number(),
    workMinutes:     z.number(),
    paidMinutes:     z.number(),
    overtimeMinutes: z.number(),
    nightMinutes:    z.number(),
  })),
  byBranch: z.array(z.object({
    branchId:        z.string().nullable(),
    role:            z.string(),
    dutyCount:       z.number(),
    paidMinutes:     z.number(),
    overtimeMinutes: z.number(),
    nightMinutes:    z.number(),
  })),
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
    status: z.enum(['DRAFT', 'ACTIVE', 'SUPERSEDED']).default('DRAFT').meta({
      label:          'Status',
      listVisibility: 'visible',
      filter:         true,
      showInForm:     false,
      widget:         'badge',
      optionLabels: {
        DRAFT:      'Rascunho',
        ACTIVE:     'Ativo',
        SUPERSEDED: 'Substituído',
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
