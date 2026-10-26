import { z } from 'zod'

// Painel de Escala — the crew adjustments: suggestion → editable list → impact → apply. The server
// recalculates the impact and revalidates on apply; it never trusts figures sent back.

// shifts: move crew between shifts · groups: rest groups (and pattern) by demand, within a shift ·
// lines: enable a line for crew of a shift · priority: make it their priority line · profiles: create
// the crew profile of employees whose job title is crew of the role
export const CONSOLE_ACTION_KINDS = ['shifts', 'groups', 'lines', 'priority', 'profiles'] as const
export type ConsoleActionKind = typeof CONSOLE_ACTION_KINDS[number]

export const CONSOLE_ACTION_LABEL: Record<ConsoleActionKind, string> = {
  shifts:   'Balancear turnos',
  groups:   'Grupos de folga',
  lines:    'Habilitar linha',
  priority: 'Linha prioritária',
  profiles: 'Criar perfis de operador',
}

// what each action takes a date for — shifts: when the new shift starts; the rest are records
// without a date (rest groups reach the next generation; access and priority lines and new
// profiles are in force at once — a profile's first shift starts on the date)
export const CONSOLE_ACTION_DATED: Record<ConsoleActionKind, boolean> = {
  shifts: true, groups: false, lines: false, priority: false, profiles: true,
}

// one crew member's change (profiles: crewMemberId is the employee's id)
export interface ConsoleMove {
  crewMemberId: string
  code:     string
  name:     string
  // shift ids
  from:     string
  to:       string
  // rest group (restOffset) in the destination; null: no rest pattern
  offset:   number | null
  // labels for the list: "B · folga Dom", the pattern's name
  groupLabel:  string | null
  patternName: string | null
  // the groups he may get in the destination (his own pattern, else the shift's)
  groupOptions: { offset: number; label: string }[]
  // groups: the pattern he ends up with (his own, set by the adjustment) — null: as it is
  patternId?: string | null
  // lines / priority: the line
  lineId?:  string | null
  // the change in words: "Manhã → Tarde", "A · folga Seg → C · folga Dom", "habilitar 310"…
  change:   string
  reasons:  string[]
}

export interface ConsoleSuggestion {
  kind:     ConsoleActionKind
  title:    string
  summary:  string
  moves:    ConsoleMove[]
  // eligible crew members not picked, per `${from}>${to}` — what a swap in the list chooses from
  bench:    Record<string, ConsoleMove[]>
  // left out by the fixed filters, with the reason
  excluded: { crewMemberId: string; code: string; name: string; reason: string }[]
  // groups: the rest patterns a row may switch to, with their groups
  patterns?: { id: string; name: string; groupOptions: { offset: number; label: string }[] }[]
}

// what a suggestion is about — groups: the shift; lines / priority: the shift and the line
export const consoleSuggestSchema = z.object({
  branchId: z.uuid(),
  role:     z.enum(['DRIVER', 'FARE_COLLECTOR', 'ASSISTANT']).default('DRIVER'),
  scopeId:  z.uuid().optional().nullable(),
  shiftId:  z.uuid().optional().nullable(),
  lineId:   z.uuid().optional().nullable(),
})
export type ConsoleSuggestDto = z.infer<typeof consoleSuggestSchema>

const day = z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'Data inválida')

export const consoleActionSchema = z.object({
  branchId:  z.uuid(),
  role:      z.enum(['DRIVER', 'FARE_COLLECTOR', 'ASSISTANT']).default('DRIVER'),
  scopeId:   z.uuid().optional().nullable(),
  effective: day,
  items: z.array(z.object({
    crewMemberId: z.uuid(),
    from:   z.uuid(),
    to:     z.uuid(),
    offset: z.number().int().nullable(),
    patternId: z.uuid().nullable().optional(),
    lineId:    z.uuid().nullable().optional(),
  })).min(1, 'Nenhum operador selecionado'),
})
export type ConsoleActionDto = z.infer<typeof consoleActionSchema>

export interface ConsoleImpact {
  // per shift × day type: the balance before → after
  rows:   { shiftId: string; cells: Record<string, { before: number; after: number }> }[]
  // per day type: duties covered before → after, of the demand
  totals: Record<string, { before: number; after: number; demand: number }>
  warnings: string[]
  notes:    string[]
}

// RosterAdjustment.items
export interface RosterAdjustmentItem {
  crewMemberId: string
  code:   string
  name:   string
  before: RosterAdjustmentState
  after:  RosterAdjustmentState
}

// the touched fields of a crew member — lines: the line's access / priority
export interface RosterAdjustmentState {
  shiftId:       string | null
  restOffset:    number
  restPatternId: string | null
  line?:         { lineId: string; code: string; access: string | null; priority: boolean }
}

export interface RosterAdjustmentRow {
  id:        string
  kind:      string
  effective: string
  createdAt: string
  user:      string | null
  items:     RosterAdjustmentItem[]
}
