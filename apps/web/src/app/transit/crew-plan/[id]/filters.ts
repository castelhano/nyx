import type { CrewRole } from '@nyx/schemas'
import type { BoardBlock, BoardDuty } from './board.types'

// Crew plan filters (same idea as the vehicle plan's BlockFilterBar): criteria combine with
// AND; pinned rows stay visible regardless. Criteria that don't apply to the current view
// are ignored (e.g. role on the vehicle view). withIssues/staleOnly apply to both: on the
// vehicle view they keep the vehicles carrying pieces of such duties.

// start/end: time of day; duration: duties' summary.workMinutes, vehicles' window length
export type ConditionField = 'start' | 'end' | 'duration'

export interface FilterCondition {
  field:   ConditionField
  op:      'gt' | 'lt'
  minutes: number
}

export interface CrewFilter {
  // all must hold (AND)
  conditions:    FilterCondition[]
  branchId:      string | null
  // vehicles running / duties operating this line
  lineCode:      string | null
  // vehicle view
  uncoveredOnly: boolean
  // both views
  withIssues:    boolean
  staleOnly:     boolean
  // duty view
  role:          CrewRole | null
  kind:          BoardDuty['kind'] | null
  multiLine:     boolean
}

export const EMPTY_FILTER: CrewFilter = {
  conditions: [], branchId: null, lineCode: null,
  uncoveredOnly: false, role: null, kind: null, withIssues: false, staleOnly: false, multiLine: false,
}

export type CrewView = 'vehicles' | 'duties'

export function isFilterActive(f: CrewFilter, view: CrewView): boolean {
  if (f.conditions.length || f.branchId || f.lineCode) return true
  if (f.withIssues || f.staleOnly) return true
  return view === 'vehicles'
    ? f.uncoveredOnly
    : !!f.role || !!f.kind || f.multiLine
}

// same field + same relation replaces; the opposite relation is kept (a range: > 6h and < 8h)
export function addCondition(list: FilterCondition[], c: FilterCondition): FilterCondition[] {
  return [...list.filter(x => !(x.field === c.field && x.op === c.op)), c]
}

function matchesConditions(f: CrewFilter, values: Record<ConditionField, number | null>): boolean {
  return f.conditions.every(c => {
    const value = values[c.field]
    if (value == null) return false
    return c.op === 'gt' ? value > c.minutes : value < c.minutes
  })
}

// carried: whether this block holds pieces of a stale duty / of a duty with issues
export function blockMatches(f: CrewFilter, block: BoardBlock, hasUncovered: boolean, carried: { stale: boolean; issues: boolean }): boolean {
  const w = block.window
  if (!matchesConditions(f, { start: w?.startMinutes ?? null, end: w?.endMinutes ?? null, duration: w ? w.endMinutes - w.startMinutes : null })) return false
  if (f.branchId && block.branchId !== f.branchId) return false
  if (f.lineCode && !block.trips.some(t => t.lineCode === f.lineCode)) return false
  if (f.uncoveredOnly && !hasUncovered) return false
  if (f.staleOnly && !carried.stale) return false
  if (f.withIssues && !carried.issues) return false
  return true
}

// lineCodes: the lines the duty operates (dutyLineCodes)
export function dutyMatches(f: CrewFilter, duty: BoardDuty, lineCodes: string[]): boolean {
  const events = [...duty.pieces, ...duty.activities]
  const start  = events.length ? Math.min(...events.map(e => e.startMinutes)) : null
  const end    = events.length ? Math.max(...events.map(e => e.endMinutes)) : null
  if (!matchesConditions(f, { start, end, duration: duty.summary?.workMinutes ?? null })) return false
  if (f.branchId && duty.branchId !== f.branchId) return false
  if (f.role && duty.role !== f.role) return false
  if (f.kind && duty.kind !== f.kind) return false
  if (f.withIssues && !duty.hasIssues) return false
  if (f.staleOnly && !duty.isStale) return false
  if (f.lineCode && !lineCodes.includes(f.lineCode)) return false
  if (f.multiLine && lineCodes.length < 2) return false
  return true
}
