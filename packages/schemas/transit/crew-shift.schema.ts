import { z } from 'zod'
import '../zod-meta'
import { withMeta } from '../with-meta'

// A work shift ("turno"), shared by the branches that use it — see CrewShift in transit.prisma. Each window is a band in
// minutes of the operational day: a duty's sign-on/sign-off inside [floor, ceiling] fits;
// outside [idealMin, idealMax] it still fits, only further from the ideal. floor ≤ idealMin ≤
// idealMax ≤ ceiling is checked in CrewShiftService (a refine here would break the .omit() below).

const timeField = (row: string, label: string, keybind?: string) => z.number().int().min(0).max(2880).meta({
  label,
  row,
  widget:         'time',
  listVisibility: 'hidden',
  className:      'md:w-32',
  ...(keybind ? { keybind } : {}),
})

export const crewShiftSchema = withMeta(
  z.object({
    id: z.uuid().meta({ listVisibility: 'hidden' }),

    code: z.string().min(1).max(10).meta({
      label:          'Código',
      row:            'Turno',
      listVisibility: 'visible',
      className:      'md:w-32',
      keybind:        'c',
    }),

    name: z.string().min(2).meta({
      label:          'Nome',
      row:            'Turno',
      listVisibility: 'visible',
      // two columns of the rows below (2 × w-32 + gap-x-3)
      className:      'md:w-[16.75rem]',
      keybind:        'n',
    }),

    priority: z.number().int().min(0).default(0).meta({
      label:          'Prioridade',
      row:            'Turno',
      listVisibility: 'visible',
      className:      'md:w-32',
      defaultValue:   0,
    }),

    startFloor:    timeField('Início', 'Mínimo', 'i'),
    startIdealMin: timeField('Início', 'Ideal de'),
    startIdealMax: timeField('Início', 'Ideal até'),
    startCeiling:  timeField('Início', 'Máximo'),

    endFloor:      timeField('Término', 'Mínimo', 't'),
    endIdealMin:   timeField('Término', 'Ideal de'),
    endIdealMax:   timeField('Término', 'Ideal até'),
    endCeiling:    timeField('Término', 'Máximo'),

    // default day-off cycle of the shift's crew — CrewMember.restPatternId overrides it
    restPatternId: z.uuid().optional().nullable().meta({
      label:          'Regime de folga',
      helpText:       'Padrão de quem está no turno; o operador pode ter um próprio.',
      widget:         'select',
      resource:       'rest-pattern',
      domain:         'transit',
      labelField:     'name',
      listVisibility: 'visible',
      className:      'md:w-[16.75rem]',
    }),

    allowSplit: z.boolean().default(false).meta({
      label:          'Dupla pegada',
      row:            'Opções',
      widget:         'switch',
      listVisibility: 'visible',
      defaultValue:   false,
    }),

    isActive: z.boolean().default(true).meta({
      label:          'Ativo',
      row:            'Opções',
      widget:         'switch',
      listVisibility: 'visible',
      filter:         true,
      defaultValue:   true,
    }),

    // CrewShiftBranch — the empresas using the shift
    branchIds: z.array(z.uuid()).min(1, 'Selecione ao menos uma empresa').meta({
      label:          'Empresas',
      widget:         'multi-select',
      resource:       'branch',
      domain:         'core',
      labelField:     'name',
      listVisibility: 'hidden',
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
    label:       'Turno',
    labelPlural: 'Turnos',
    nameField:   'code',
    icon:        'Sunrise',
    defaultSort: { field: 'priority', order: 'asc' },
  },
)

export const createCrewShiftSchema = crewShiftSchema.omit({ id: true, createdAt: true, updatedAt: true })
export const updateCrewShiftSchema  = createCrewShiftSchema.partial()

export type CrewShift          = z.infer<typeof crewShiftSchema>
export type CreateCrewShiftDto = z.infer<typeof createCrewShiftSchema>
export type UpdateCrewShiftDto = z.infer<typeof updateCrewShiftSchema>

// ── fit ───────────────────────────────────────────────────────────────────────

// what the fit reads from a shift
export type ShiftWindow = Pick<CrewShift,
  'id' | 'priority' | 'allowSplit'
  | 'startFloor' | 'startIdealMin' | 'startIdealMax' | 'startCeiling'
  | 'endFloor' | 'endIdealMin' | 'endIdealMax' | 'endCeiling'>

export const SHIFT_BAND_KEYS = [
  ['startFloor', 'startIdealMin', 'startIdealMax', 'startCeiling'],
  ['endFloor', 'endIdealMin', 'endIdealMax', 'endCeiling'],
] as const

// minutes outside [lo, hi] — 0 inside
const outside = (v: number, lo: number, hi: number) => Math.max(0, lo - v, v - hi)

// whether a duty starting/ending at these minutes fits the shift (hard band)
export function shiftFits(s: ShiftWindow, startMinutes: number, endMinutes: number, kind: string): boolean {
  if (kind === 'SPLIT' && !s.allowSplit) return false
  return outside(startMinutes, s.startFloor, s.startCeiling) === 0 && outside(endMinutes, s.endFloor, s.endCeiling) === 0
}

// minutes away from the shift's ideal windows (start + end) — 0 when both are ideal
export function shiftIdealDistance(s: ShiftWindow, startMinutes: number, endMinutes: number): number {
  return outside(startMinutes, s.startIdealMin, s.startIdealMax) + outside(endMinutes, s.endIdealMin, s.endIdealMax)
}

// The shift a duty gets: among the ones it fits, the lowest priority, then the closest to the
// ideal. null when it fits none.
export function bestShift<S extends ShiftWindow>(shifts: S[], startMinutes: number, endMinutes: number, kind: string): S | null {
  let best: S | null = null
  let bestDistance = Infinity
  for (const s of shifts) {
    if (!shiftFits(s, startMinutes, endMinutes, kind)) continue
    const d = shiftIdealDistance(s, startMinutes, endMinutes)
    if (!best || s.priority < best.priority || (s.priority === best.priority && d < bestDistance)) {
      best = s
      bestDistance = d
    }
  }
  return best
}
