import type { CSSProperties } from 'react'
import { swatchColor, lineIndexByCode } from '@/lib/palette'
import type { CrewPlanSummary, DutySummary, DutyIssue, ReliefPoint, CrewRole } from '@nyx/schemas'

// Shape of GET /transit/crew-plan/:id/board (CrewPlanService.getBoard)

export interface BoardPiece {
  id:              string
  vehicleBlockId:  string | null
  sequence:        number
  startMinutes:    number
  endMinutes:      number
  startLocalityId: string
  endLocalityId:   string
  isStale:         boolean
  staleReason:     'BLOCK_REMOVED' | 'OUT_OF_BLOCK_WINDOW' | 'INVALID_RELIEF_POINT' | null
}

export interface BoardActivity {
  id:               string
  type:             'SIGN_ON' | 'SIGN_OFF' | 'BREAK' | 'TRAVEL' | 'STANDBY'
  intervalTypeId:   string | null
  intervalTypeName: string | null
  isPaidBreak:      boolean
  startMinutes:     number
  endMinutes:       number
}

export interface BoardDuty {
  id:         string
  role:       CrewRole
  dutyNumber: number
  kind:       'STRAIGHT' | 'SPLIT' | 'TRIPPER' | 'STANDBY'
  branchId:   string | null
  notes:      string | null
  summary:    DutySummary | null
  issues:     DutyIssue[]
  isStale:    boolean
  hasIssues:  boolean
  // Duty.constraints.locked — the crew solver leaves it alone
  locked:     boolean
  pieces:     BoardPiece[]
  activities: BoardActivity[]
}

export interface BoardBlock {
  id:          string
  blockNumber: number
  branchId:    string | null
  window:      { startMinutes: number; endMinutes: number } | null
  // where the vehicle needs a driver (window minus its own intervals and depot time)
  serviceSpans: { startMinutes: number; endMinutes: number }[]
  points:      ReliefPoint[]
  trips:       { id: string; departureMinutes: number; arrivalMinutes: number; lineCode: string; direction: string }[]
  deadruns:    { id: string; type: string; departureMinutes: number; arrivalMinutes: number }[]
  intervals:   { id: string; departureMinutes: number; arrivalMinutes: number; intervalTypeId: string; intervalTypeName: string }[]
}

export interface CrewBoardData {
  plan: {
    id: string; description: string | null; status: 'DRAFT' | 'ACTIVE' | 'SUPERSEDED'
    validFrom: string | null; validTo: string | null; notes: string | null
    summary: CrewPlanSummary | null
    isCustomSettings: boolean
    signOnMinutes:    number
    signOffMinutes:   number
  }
  vehiclePlan: { id: string; description: string | null; status: string; scopeName: string; dayTypeName: string }
  versions:    { id: string; description: string | null; status: 'DRAFT' | 'ACTIVE' | 'SUPERSEDED'; createdAt: string }[]
  operators:   { branchId: string; abbr: string; name: string }[]
  lineCodes:   string[]
  localities:  { id: string; name: string; abbr: string | null }[]
  blocks:      BoardBlock[]
  duties:      BoardDuty[]
}

// ── display helpers ──────────────────────────────────────────────────────────

export const ROLE_LABEL: Record<CrewRole, string> = {
  DRIVER:         'Motorista',
  FARE_COLLECTOR: 'Cobrador',
  ASSISTANT:      'Auxiliar',
}

export const KIND_LABEL: Record<BoardDuty['kind'], string> = {
  STRAIGHT: 'Corrida',
  SPLIT:    'Dupla pegada',
  TRIPPER:  'Meia jornada',
  STANDBY:  'Reserva',
}

export const ACTIVITY_LABEL: Record<BoardActivity['type'], string> = {
  SIGN_ON:  'Apresentação',
  SIGN_OFF: 'Encerramento',
  BREAK:    'Intervalo',
  TRAVEL:   'Deslocamento',
  STANDBY:  'Reserva',
}

export const ISSUE_LABEL: Record<DutyIssue['code'], string> = {
  WORK_TIME:          'Duração da jornada',
  SPREAD:             'Amplitude',
  MEAL_BREAK:         'Intervalo intrajornada',
  SPLIT_INTERVAL:     'Intervalo da dupla pegada',
  WALK_DISTANCE:      'Deslocamento a pé acima do permitido',
  MEAL_REQUIRED:      'Intrajornada não cumprida',
  CONTINUOUS_DRIVING: 'Direção contínua',
  MIN_PIECE:          'Pegada curta',
  TRAVEL_GAP:         'Deslocamento entre pegadas',
  BRANCH_MISMATCH:    'Bloco de outro operador',
  MEAL_LOCATION:      'Refeição fora de local permitido',
}

// score criteria (CrewPlanSummary.criteria keys)
export const CRITERION_LABEL: Record<string, string> = {
  workTime:       'Duração da jornada',
  spread:         'Amplitude',
  mealBreak:      'Intervalo intrajornada',
  splitInterval:  'Intervalo da dupla pegada',
  vehicleChanges: 'Trocas de carro',
  lineChanges:    'Trocas de linha',
  overtimeRatio:  'Horas extras',
  splitRatio:     'Dupla pegada (%)',
  tripperRatio:   'Meias jornadas (%)',
  coverage:       'Cobertura',
  walkDistance:   'Deslocamento a pé',
  dutyCount:      'Nº de jornadas',
  efficiency:     'Eficiência',
}

// issues whose value/limit are meters, not minutes
export const METER_ISSUES = new Set<DutyIssue['code']>(['WALK_DISTANCE'])

// issues with no meaningful value/limit — rendered as the label only
export const VALUELESS_ISSUES = new Set<DutyIssue['code']>(['BRANCH_MISMATCH', 'MEAL_LOCATION'])

export const DIRECTION_LABEL: Record<string, string> = { OUTBOUND: 'Ida', INBOUND: 'Volta', CIRCULAR: 'Circular' }

export const STALE_LABEL: Record<NonNullable<BoardPiece['staleReason']>, string> = {
  BLOCK_REMOVED:        'Bloco removido do planejamento',
  OUT_OF_BLOCK_WINDOW:  'Fora da janela do bloco',
  INVALID_RELIEF_POINT: 'Ponto de troca não existe mais',
}

// minutes past midnight of the operational day — > 1440 stays as 24:xx, 25:xx...
export function fmtTime(m: number): string {
  return `${String(Math.floor(m / 60)).padStart(2, '0')}:${String(m % 60).padStart(2, '0')}`
}

export function fmtDuration(m: number): string {
  return `${String(Math.floor(m / 60)).padStart(2, '0')}h${String(m % 60).padStart(2, '0')}`
}

export function parseTime(s: string): number | null {
  const match = /^(\d{1,2}):(\d{2})$/.exec(s.trim())
  if (!match) return null
  const mm = Number(match[2])
  return mm < 60 ? Number(match[1]) * 60 + mm : null
}

// Swatch colors from the shared muted palette (lib/palette.ts), one tone per theme. Apply
// SWATCH_BG_CLASS together with one of the *ColorVars below. The vehicle view colors
// pieces per duty, the duty view per vehicle (block).
const ROLE_SHIFT: Record<CrewRole, number> = { DRIVER: 0, FARE_COLLECTOR: 4, ASSISTANT: 8 }

export const SWATCH_BG_CLASS = 'bg-(--swatch-bg) dark:bg-(--swatch-bg-dark)'

function swatchVars(index: number): CSSProperties {
  return {
    '--swatch-bg':      swatchColor(index, 'strong', 'light'),
    '--swatch-bg-dark': swatchColor(index, 'strong', 'dark'),
  } as CSSProperties
}

export function dutyColorVars(duty: Pick<BoardDuty, 'role' | 'dutyNumber'>): CSSProperties {
  return swatchVars(duty.dutyNumber - 1 + ROLE_SHIFT[duty.role])
}

export function blockColorVars(blockNumber: number): CSSProperties {
  return swatchVars(blockNumber - 1)
}

// "Exibir › Cores das linhas" — a lighter tone of the same hues, so a trip's line color
// doesn't read as a duty color on the piece right below it. Use with LINE_BG_CLASS and
// dark text (light theme) / light text (dark theme).
export const LINE_BG_CLASS = 'bg-(--line-bg) dark:bg-(--line-bg-dark)'

// line code → color vars; pass every line of the Scope (board lineCodes) so the index —
// and the color — matches the vehicle plan Gantt
export function lineColorMap(lineCodes: string[]): Map<string, CSSProperties> {
  return new Map([...lineIndexByCode(lineCodes)].map(([code, i]) => [code, {
    '--line-bg':      swatchColor(i, 'soft', 'light'),
    '--line-bg-dark': swatchColor(i, 'soft', 'dark'),
  } as CSSProperties]))
}

// block trips a piece operates — overlap, not containment, since a piece may start/end
// mid-trip at a relief stop; stale pieces operate nothing
export function pieceTrips(piece: BoardPiece, block: BoardBlock | undefined): BoardBlock['trips'] {
  if (!block || piece.isStale) return []
  return block.trips.filter(t => t.departureMinutes < piece.endMinutes && t.arrivalMinutes > piece.startMinutes)
}

// deadruns (trajetos ociosos) a piece overlaps — the driver works them like trips
export function pieceDeadruns(piece: BoardPiece, block: BoardBlock | undefined): BoardBlock['deadruns'] {
  if (!block || piece.isStale) return []
  // a zero-length one (instant displacement) counts when it falls inside the piece
  return block.deadruns.filter(d => d.arrivalMinutes === d.departureMinutes
    ? d.departureMinutes >= piece.startMinutes && d.departureMinutes < piece.endMinutes
    : d.departureMinutes < piece.endMinutes && d.arrivalMinutes > piece.startMinutes)
}

export const DEADRUN_LABEL: Record<string, string> = {
  ACCESS:       'Acesso',
  RETURN:       'Recolhe',
  DISPLACEMENT: 'Deslocamento',
}

// a deadrun in the trips lane: neutral, dashed — reads as "moving, no line"
export const DEADRUN_CLASS = 'bg-slate-100 dark:bg-slate-800 border border-dashed border-slate-400 dark:border-slate-500 text-slate-600 dark:text-slate-300'

// distinct line codes a duty operates, in the Scope's line order (board lineCodes)
export function dutyLineCodes(duty: BoardDuty, blockById: Map<string, BoardBlock>, lineCodes: string[]): string[] {
  const codes = new Set(duty.pieces.flatMap(p =>
    pieceTrips(p, p.vehicleBlockId ? blockById.get(p.vehicleBlockId) : undefined).map(t => t.lineCode)))
  return lineCodes.filter(c => codes.has(c))
}

type Span = { startMinutes: number; endMinutes: number }

export function subtract(from: Span, cut: Span[]): Span[] {
  const out: Span[] = []
  let cursor = from.startMinutes
  for (const c of [...cut].sort((a, b) => a.startMinutes - b.startMinutes)) {
    if (c.endMinutes <= cursor || c.startMinutes >= from.endMinutes) continue
    if (c.startMinutes > cursor) out.push({ startMinutes: cursor, endMinutes: c.startMinutes })
    cursor = Math.max(cursor, c.endMinutes)
  }
  if (cursor < from.endMinutes) out.push({ startMinutes: cursor, endMinutes: from.endMinutes })
  return out
}

export interface BreakSlot extends Span {
  // inside a piece (the vehicle's idle time) or in the gap between two pieces
  inPiece:        boolean
  // the vehicle's own interval type when the slot holds one — only a default for the form
  intervalTypeId: string | null
}

// where a break can be inserted on a duty, minus its existing activities: the idle time of
// each live piece (its window minus the block's trips/deadruns — same rule as the API's
// duty-occupancy.utils.ts) and the gaps between consecutive pieces
export function breakSlots(duty: BoardDuty, blockById: Map<string, BoardBlock>): BreakSlot[] {
  const taken = duty.activities
  const live  = duty.pieces.filter(p => !p.isStale).sort((a, b) => a.startMinutes - b.startMinutes)
  const out: BreakSlot[] = []
  const push = (spans: Span[], inPiece: boolean, block: BoardBlock | undefined) => {
    for (const s of spans) {
      const vehicleInterval = block?.intervals.find(i => i.departureMinutes < s.endMinutes && i.arrivalMinutes > s.startMinutes)
      out.push({ ...s, inPiece, intervalTypeId: vehicleInterval?.intervalTypeId ?? null })
    }
  }
  for (const p of live) {
    const block = p.vehicleBlockId ? blockById.get(p.vehicleBlockId) : undefined
    if (!block) continue
    const busy = [...block.trips, ...block.deadruns].map(e => ({ startMinutes: e.departureMinutes, endMinutes: e.arrivalMinutes }))
    push(subtract(p, [...busy, ...taken]), true, block)
  }
  for (let i = 1; i < live.length; i++) {
    const gap = { startMinutes: live[i - 1].endMinutes, endMinutes: live[i].startMinutes }
    if (gap.endMinutes > gap.startMinutes) push(subtract(gap, taken), false, undefined)
  }
  return out
}
