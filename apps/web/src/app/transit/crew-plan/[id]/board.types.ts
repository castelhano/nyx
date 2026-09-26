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
  intervals:   { id: string; departureMinutes: number; arrivalMinutes: number }[]
}

export interface CrewBoardData {
  plan: {
    id: string; description: string | null; status: 'DRAFT' | 'ACTIVE'
    validFrom: string | null; validTo: string | null; notes: string | null
    summary: CrewPlanSummary | null
    isCustomSettings: boolean
    signOnMinutes:    number
    signOffMinutes:   number
  }
  vehiclePlan: { id: string; description: string | null; status: string; scopeName: string; dayTypeName: string }
  versions:    { id: string; description: string | null; status: 'DRAFT' | 'ACTIVE'; createdAt: string }[]
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
  CONTINUOUS_DRIVING: 'Direção contínua',
  MIN_PIECE:          'Pegada curta',
  TRAVEL_GAP:         'Deslocamento entre pegadas',
  BRANCH_MISMATCH:    'Bloco de outro operador',
}

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
