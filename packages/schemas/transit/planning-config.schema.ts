import { z } from 'zod'
import '../zod-meta'
import { withMeta } from '../with-meta'

export const planningConfigSchema = withMeta(
  z.object({
    // trips that depart between 00:00 and this hour belong to the previous operational day
    operationalDayStartHour: z.number().int().min(0).max(6).default(4).meta({
      label:    'Início do Dia Operacional (h)',
      helpText: 'Viagens entre 00:00 e este horário pertencem ao dia operacional anterior',
      widget:   'stepper',
      min:      0,
      max:      6,
    }),

    minLayoverMinutes: z.number().int().min(0).max(120).default(5).meta({
      label:    'Espera Mínima entre Viagens (min)',
      helpText: 'Intervalo mínimo entre o fim de uma viagem e o início da próxima no mesmo bloco',
      widget:   'stepper',
      min:      0,
      max:      120,
    }),

    maxLayoverMinutes: z.number().int().min(0).max(240).default(30).meta({
      label:    'Espera Máxima entre Viagens (min)',
      helpText: 'Intervalo acima deste valor penaliza a pontuação do candidato',
      widget:   'stepper',
      min:      0,
      max:      240,
    }),

    maxDeadrunSoftMinutes: z.number().int().min(0).max(120).default(20).meta({
      label:    'Km em Vazio — Alerta (min)',
      helpText: 'Deslocamentos em vazio acima deste valor penalizam a pontuação',
      widget:   'stepper',
      min:      0,
      max:      120,
    }),

    maxDeadrunHardMinutes: z.number().int().min(0).max(180).default(45).meta({
      label:    'Km em Vazio — Limite (min)',
      helpText: 'Deslocamentos em vazio acima deste valor descartam o candidato',
      widget:   'stepper',
      min:      0,
      max:      180,
    }),

    blockDurationMinMinutes: z.number().int().min(0).max(720).default(360).meta({
      label:    'Duração Mínima do Bloco (min)',
      helpText: 'Blocos abaixo deste valor são descartados',
      widget:   'stepper',
      min:      0,
      max:      720,
    }),

    blockDurationIdealMinMinutes: z.number().int().min(0).max(720).default(420).meta({
      label:    'Duração Ideal — Início (min)',
      helpText: 'Início da faixa ideal de duração',
      widget:   'stepper',
      min:      0,
      max:      720,
    }),

    blockDurationIdealMaxMinutes: z.number().int().min(0).max(720).default(480).meta({
      label:    'Duração Ideal — Fim (min)',
      helpText: 'Fim da faixa ideal de duração',
      widget:   'stepper',
      min:      0,
      max:      720,
    }),

    blockDurationMaxMinutes: z.number().int().min(0).max(720).default(570).meta({
      label:    'Duração Máxima do Bloco (min)',
      helpText: 'Blocos acima deste valor são descartados',
      widget:   'stepper',
      min:      0,
      max:      720,
    }),

    weightMinimizeFleet: z.number().min(0).max(10).default(2).meta({
      label:    'Peso — Minimizar Frota',
      helpText: 'Quanto mais alto, maior a pressão para usar menos veículos',
      widget:   'stepper',
      min:      0,
      max:      10,
    }),

    weightMinimizeDeadrun: z.number().min(0).max(10).default(1).meta({
      label:    'Peso — Minimizar Km em Vazio',
      helpText: 'Quanto mais alto, maior a pressão para reduzir deslocamentos em vazio',
      widget:   'stepper',
      min:      0,
      max:      10,
    }),

    weightBlockDuration: z.number().min(0).max(10).default(1).meta({
      label:    'Peso — Duração do Bloco',
      helpText: 'Quanto mais alto, maior a penalidade por blocos fora da faixa ideal',
      widget:   'stepper',
      min:      0,
      max:      10,
    }),

    stopNoImprovementMinutes: z.number().int().min(1).max(60).default(10).meta({
      label:    'Parar sem Melhora (min)',
      helpText: 'Encerra a geração se nenhuma solução melhor for encontrada neste intervalo',
      widget:   'stepper',
      min:      1,
      max:      60,
    }),

    stopMaxTotalMinutes: z.number().int().min(1).max(240).default(60).meta({
      label:    'Tempo Máximo de Geração (min)',
      helpText: 'Encerra a geração independentemente do resultado após este tempo',
      widget:   'stepper',
      min:      1,
      max:      240,
    }),
  }),
  {
    label:       'Config. de Planejamento',
    labelPlural: 'Config. de Planejamento',
    nameField:   'operationalDayStartHour',
    icon:        'Settings2',
    groups: {
      'Dia Operacional':      ['operationalDayStartHour'],
      'Intervalos':           ['minLayoverMinutes', 'maxLayoverMinutes'],
      'Deslocamento em Vazio': ['maxDeadrunSoftMinutes', 'maxDeadrunHardMinutes'],
      'Duração do Bloco':     ['blockDurationMinMinutes', 'blockDurationIdealMinMinutes', 'blockDurationIdealMaxMinutes', 'blockDurationMaxMinutes'],
      'Pesos de Otimização':  ['weightMinimizeFleet', 'weightMinimizeDeadrun', 'weightBlockDuration'],
      'Critério de Parada':   ['stopNoImprovementMinutes', 'stopMaxTotalMinutes'],
    },
  },
)

export type PlanningConfig          = z.infer<typeof planningConfigSchema>
export type UpsertPlanningConfigDto = z.infer<typeof planningConfigSchema>
