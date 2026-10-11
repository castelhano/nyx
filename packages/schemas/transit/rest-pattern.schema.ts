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

    anchorDate: z.date().meta({
      label:          'Data base',
      helpText:       'Primeiro dia do ciclo do grupo A.',
      listVisibility: 'visible',
      className:      'md:w-44',
      keybind:        'b',
    }),

    offOnHolidays: z.boolean().default(false).meta({
      label:          'Folga também nos feriados',
      row:            'Opções',
      widget:         'switch',
      listVisibility: 'visible',
      defaultValue:   false,
    }),

    staggered: z.boolean().default(false).meta({
      label:          'Folga escalonada',
      helpText:       'Desligado: os grupos ficam uma semana deslocados e folgam nos mesmos dias da semana (ex.: sábado/domingo alternado). Ligado: um dia deslocados — cada grupo folga num dia diferente.',
      row:            'Opções',
      widget:         'switch',
      listVisibility: 'hidden',
      defaultValue:   false,
    }),

    // edited as a weekly grid (widget 'rest-cycle'), with the groups' preview and balance
    pattern: z.string().regex(REST_PATTERN_RE, 'Use só T (trabalha) e F (folga)').refine(p => p.includes('F'), 'O ciclo precisa de ao menos uma folga').meta({
      label:          'Ciclo',
      widget:         'rest-cycle',
      defaultValue:   'TTTTTTF',
      listVisibility: 'visible',
      keybind:        'c',
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
// what the day calculation reads — anchorDate as a Date (API) or a YYYY-MM-DD string (forms)
export type RestCycle = Pick<RestPattern, 'pattern' | 'offOnHolidays'> & { anchorDate: Date | string }

export function restPatternWorks(
  p: RestCycle, offset: number, day: string, isHoliday = false,
): boolean {
  if (p.offOnHolidays && isHoliday) return false
  const days = Math.round((Date.parse(`${day}T00:00:00Z`) - Date.parse(`${new Date(p.anchorDate).toISOString().slice(0, 10)}T00:00:00Z`)) / 86_400_000)
  const n = p.pattern.length
  return p.pattern[(((days + offset) % n) + n) % n] === 'T'
}

// ── groups ────────────────────────────────────────────────────────────────────
// Crew members of one pattern take turns through groups: CrewMember.restOffset is the group's
// shift from the anchor. Not staggered and a cycle of whole weeks → groups a week apart (same
// weekdays off); otherwise a day apart.

export function restGroupStep(p: Pick<RestPattern, 'pattern' | 'staggered'>): number {
  return !p.staggered && p.pattern.length % 7 === 0 ? 7 : 1
}

// the groups' offsets: 0, step, 2·step… up to the cycle length
export function restGroupOffsets(p: Pick<RestPattern, 'pattern' | 'staggered'>): number[] {
  const step = restGroupStep(p)
  return Array.from({ length: Math.max(1, Math.floor(p.pattern.length / step)) }, (_, i) => i * step)
}

// A, B… Z, AA, AB…
export function restGroupLabel(index: number): string {
  let s = '', n = index
  do { s = String.fromCharCode(65 + (n % 26)) + s; n = Math.floor(n / 26) - 1 } while (n >= 0)
  return s
}

// the group index of an offset — null when it falls between groups (set by hand)
export function restGroupIndex(p: Pick<RestPattern, 'pattern' | 'staggered'>, offset: number): number | null {
  const n = p.pattern.length, step = restGroupStep(p)
  const o = ((offset % n) + n) % n
  return o % step === 0 ? o / step : null
}

// the first day off on/after `from` (YYYY-MM-DD), within one cycle; null without days off
export function nextRestDay(p: RestCycle, offset: number, from: string): string | null {
  for (let i = 0; i < p.pattern.length; i++) {
    const d = new Date(`${from}T00:00:00Z`)
    d.setUTCDate(d.getUTCDate() + i)
    const day = d.toISOString().slice(0, 10)
    if (!restPatternWorks(p, offset, day)) return day
  }
  return null
}
