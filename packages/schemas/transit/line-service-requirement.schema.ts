import { z } from 'zod'
import '../zod-meta'
import { withMeta } from '../with-meta'
import { ROUTE_DIRECTION_LABEL } from './route.schema'

export const SERVICE_REQUIREMENT_KIND_LABEL: Record<string, string> = {
  BOARDING:  'Embarque',
  ALIGHTING: 'Desembarque',
}

// A departure the line must cover on a day type / direction — see
// docs/proposal/plan_line_service_requirement_v1.md. earliest ≤ latest and the
// direction/locality checks against the line's routes live in LineServiceRequirementService
// (a refine here would break the .omit() below).
export const lineServiceRequirementSchema = withMeta(
  z.object({
    id: z.uuid().meta({ listVisibility: 'hidden' }),

    lineId: z.uuid().meta({
      label:          'Linha',
      showInForm:     false,
      listVisibility: 'hidden',
    }),

    label: z.string().min(2).meta({
      label:          'Descrição',
      placeholder:    'Ex.: Saída E.E. Fulano',
      listVisibility: 'visible',
      className:      'md:w-1/2',
      keybind:        's',
    }),

    dayTypeId: z.uuid().meta({
      label:          'Tipo de Dia',
      widget:         'select',
      resource:       'day-type',
      domain:         'transit',
      labelField:     'name',
      listVisibility: 'visible',
      filter:         { type: 'relation', endpoint: 'transit/day-type', labelField: 'name' },
      className:      'md:w-1/3',
      keybind:        't',
    }),

    direction: z.enum(['OUTBOUND', 'INBOUND', 'CIRCULAR']).meta({
      label:          'Sentido',
      listVisibility: 'visible',
      filter:         true,
      className:      'md:w-50',
      keybind:        'd',
      optionLabels:   ROUTE_DIRECTION_LABEL,
    }),

    kind: z.enum(['BOARDING', 'ALIGHTING']).meta({
      label:          'Dinâmica',
      helpText:       'Embarque: viagem passando pelo ponto na janela. Desembarque: viagem chegando no ponto na janela.',
      listVisibility: 'visible',
      filter:         true,
      className:      'md:w-50',
      keybind:        'n',
      optionLabels:   SERVICE_REQUIREMENT_KIND_LABEL,
    }),

    localityId: z.uuid().nullable().optional().meta({
      label:          'Ponto de Referência',
      helpText:       'Vazio: origem do sentido (embarque) ou destino (desembarque).',
      widget:         'select',
      resource:       'transit-locality',
      domain:         'transit',
      labelField:     'name',
      listVisibility: 'visible',
      className:      'md:w-1/3',
      keybind:        'p',
    }),

    earliestMinutes: z.number().int().min(0).meta({
      label:          'Janela — de',
      widget:         'time',
      listVisibility: 'visible',
      className:      'md:w-28',
      keybind:        'i',
    }),

    latestMinutes: z.number().int().min(0).meta({
      label:          'Janela — até',
      widget:         'time',
      listVisibility: 'visible',
      className:      'md:w-28',
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
    label:         'Atendimento',
    labelPlural:   'Atendimentos',
    nameField:     'label',
    nameFirstWord: false,
    icon:          'Clock',
    defaultSort:   { field: 'earliestMinutes', order: 'asc' },
    breadcrumb:    [
      { resource: 'transit-line', contextField: 'lineId', listLabel: 'Linhas', nameField: 'code', keybind: 'f8', overflow: true },
    ],
  },
)

export const createLineServiceRequirementSchema = lineServiceRequirementSchema.omit({ id: true, createdAt: true, updatedAt: true })
export const updateLineServiceRequirementSchema  = createLineServiceRequirementSchema.partial()

export type LineServiceRequirement          = z.infer<typeof lineServiceRequirementSchema>
export type CreateLineServiceRequirementDto = z.infer<typeof createLineServiceRequirementSchema>
export type UpdateLineServiceRequirementDto = z.infer<typeof updateLineServiceRequirementSchema>
