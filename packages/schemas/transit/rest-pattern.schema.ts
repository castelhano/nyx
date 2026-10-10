import { z } from 'zod'
import '../zod-meta'
import { withMeta } from '../with-meta'

// Day-off cycle ("regime de folga") — see RestPattern in transit.prisma.
// pattern: one char per day, T = works, F = day off; day 0 is anchorDate.
export const REST_PATTERN_RE = /^[TF]+$/

export const restPatternSchema = withMeta(
  z.object({
    id: z.uuid().meta({ listVisibility: 'hidden' }),

    name: z.string().min(2).meta({
      label:          'Nome',
      placeholder:    'Ex.: 6x1 revezamento sáb/dom',
      listVisibility: 'visible',
      className:      'md:w-1/2',
      keybind:        'n',
    }),

    pattern: z.string().regex(REST_PATTERN_RE, 'Use só T (trabalha) e F (folga)').refine(p => p.includes('F'), 'O ciclo precisa de ao menos uma folga').meta({
      label:          'Ciclo',
      placeholder:    'Ex.: TTTTTFTTTTTTTF',
      helpText:       'Um caractere por dia a partir da data base: T = trabalha, F = folga. 5x2 = TTTTTFF; 6x1 revezando sábado/domingo (base numa segunda) = TTTTTFTTTTTTTF.',
      listVisibility: 'visible',
      className:      'md:w-1/2',
      keybind:        'c',
    }),

    anchorDate: z.date().meta({
      label:          'Data base',
      helpText:       'Dia 0 do ciclo. Condutores do mesmo regime em grupos diferentes ficam deslocados dela.',
      listVisibility: 'visible',
      className:      'md:w-1/4',
      keybind:        'b',
    }),

    offOnHolidays: z.boolean().default(false).meta({
      label:          'Folga também nos feriados',
      widget:         'switch',
      listVisibility: 'visible',
      defaultValue:   'false',
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
    label:       'Regime de Folga',
    labelPlural: 'Regimes de Folga',
    nameField:   'name',
    icon:        'CalendarRange',
  },
)

export const createRestPatternSchema = restPatternSchema.omit({ id: true, createdAt: true, updatedAt: true })
export const updateRestPatternSchema  = createRestPatternSchema.partial()

export type RestPattern          = z.infer<typeof restPatternSchema>
export type CreateRestPatternDto = z.infer<typeof createRestPatternSchema>
export type UpdateRestPatternDto = z.infer<typeof updateRestPatternSchema>

// whether the crew member works on `day` (YYYY-MM-DD) under the pattern — day off when the
// cycle says F, or when the pattern is offOnHolidays and the day is a holiday
export function restPatternWorks(
  p: Pick<RestPattern, 'pattern' | 'anchorDate' | 'offOnHolidays'>, offset: number, day: string, isHoliday = false,
): boolean {
  if (p.offOnHolidays && isHoliday) return false
  const days = Math.round((Date.parse(`${day}T00:00:00Z`) - Date.parse(`${new Date(p.anchorDate).toISOString().slice(0, 10)}T00:00:00Z`)) / 86_400_000)
  const n = p.pattern.length
  return p.pattern[(((days + offset) % n) + n) % n] === 'T'
}
