import { DAILY_ISSUE_LABEL, DUTY_ISSUE_LABEL, VEHICLE_BLOCK_ISSUE_LABEL, formatDutyNumber } from '@nyx/schemas'
import type { CrewRole, DailySummary, DutySummary } from '@nyx/schemas'

// Shape of GET /transit/daily-operation/:id/board (DailyOperationService.getBoard)

export interface DayIssue { code: string; severity?: 'warning' | 'error'; value?: number; minutes?: number }

export interface DayEvent {
  id: string; kind: 'TRIP' | 'DEADRUN' | 'INTERVAL'; deadrunType: string | null; lineCode: string | null
  startMinutes: number; endMinutes: number; isCancelled: boolean
}

export interface DayBlock {
  id: string; blockNumber: number; branchId: string | null; vehicleType: string; vehicleId: string | null
  issues: DayIssue[]; hasIssues: boolean; events: DayEvent[]
}

export interface DayDuty {
  id: string; role: CrewRole; dutyNumber: number; kind: string; branchId: string | null; shiftId: string | null
  summary: DutySummary | null; issues: DayIssue[]; isStale: boolean; hasIssues: boolean; crewMemberId: string | null; locked: boolean
  pieces: { id: string; dailyBlockId: string | null; startMinutes: number; endMinutes: number; isStale: boolean }[]
  activities: { id: string; type: string; startMinutes: number; endMinutes: number }[]
}

export interface DayCrew {
  id: string; code: string; name: string; branchId: string; role: CrewRole; shiftId: string | null
  dutyIds: string[]; elsewhere: number; dayOff: 'DAY_OFF' | 'COMP_OFF' | null; absence: string | null; patternOff: boolean
}

export interface DayVehicle { id: string; code: string; branchId: string; vehicleType: string; unavailable: string | null }

export interface DailyBoardData {
  operation: {
    id: string; scopeId: string; scopeName: string; date: string; dayTypeName: string
    status: 'PLANNED' | 'PUBLISHED' | 'CLOSED'; summary: DailySummary | null
    sources: { vehiclePlanId: string; vehiclePlanLabel: string | null; dayTypeName: string | null; lineCodes: string[] }[]
  }
  operators:  { branchId: string; abbr: string; name: string }[]
  shifts:     { id: string; code: string; name: string }[]
  lineCodes:  string[]
  localities: { id: string; name: string; abbr: string | null }[]
  blocks:     DayBlock[]
  uncoveredTrips: { id: string; lineCode: string; startMinutes: number; endMinutes: number; isCancelled: boolean }[]
  duties:     DayDuty[]
  crew:       DayCrew[]
  vehicles:   DayVehicle[]
}

export const ISSUE_LABEL: Record<string, string> = { ...VEHICLE_BLOCK_ISSUE_LABEL, ...DUTY_ISSUE_LABEL, ...DAILY_ISSUE_LABEL }

// < 0 (a sign-on before 00:00) wraps to the previous day: −2 → 23:58
export const fmtTime = (m: number) => {
  if (m < 0) m = ((m % 1440) + 1440) % 1440
  return `${String(Math.floor(m / 60)).padStart(2, '0')}:${String(m % 60).padStart(2, '0')}`
}

export const dutyLabel = (d: Pick<DayDuty, 'role' | 'dutyNumber'>) => formatDutyNumber(d.role, d.dutyNumber)

// what the crew member does on the day, in a word
export function crewSituation(c: DayCrew, dutyById: Map<string, DayDuty>): { label: string; tone: 'ok' | 'off' | 'warn' | 'free' } {
  if (c.dutyIds.length) return { label: c.dutyIds.map(id => { const d = dutyById.get(id); return d ? dutyLabel(d) : '?' }).join(', '), tone: c.absence || c.dayOff || c.patternOff ? 'warn' : 'ok' }
  if (c.absence)  return { label: c.absence, tone: 'off' }
  if (c.dayOff === 'COMP_OFF') return { label: 'Folga compensada', tone: 'off' }
  if (c.dayOff)   return { label: 'Folga', tone: 'off' }
  if (c.patternOff) return { label: 'Folga (regime)', tone: 'off' }
  if (c.elsewhere) return { label: 'Escalado em outro escopo', tone: 'ok' }
  return { label: 'Disponível', tone: 'free' }
}
