import type { CrewRole } from '@nyx/schemas'
import type { BoardBlock, BoardDuty } from './board.types'

// Crew plan filters (same idea as the vehicle plan's BlockFilterBar): criteria combine with
// AND; pinned rows stay visible regardless. Criteria that don't apply to the current view
// are ignored (e.g. role on the vehicle view).

export interface CrewFilter {
  timeField:     'start' | 'end'
  timeRelation:  'after' | 'before'
  minutes:       number | null
  branchId:      string | null
  // vehicles running / duties operating this line
  lineCode:      string | null
  // vehicle view
  uncoveredOnly: boolean
  // duty view
  role:          CrewRole | null
  kind:          BoardDuty['kind'] | null
  withIssues:    boolean
  staleOnly:     boolean
  multiLine:     boolean
}

export const EMPTY_FILTER: CrewFilter = {
  timeField: 'start', timeRelation: 'after', minutes: null, branchId: null, lineCode: null,
  uncoveredOnly: false, role: null, kind: null, withIssues: false, staleOnly: false, multiLine: false,
}

export type CrewView = 'vehicles' | 'duties'

export function isFilterActive(f: CrewFilter, view: CrewView): boolean {
  if (f.minutes != null || f.branchId || f.lineCode) return true
  return view === 'vehicles'
    ? f.uncoveredOnly
    : !!f.role || !!f.kind || f.withIssues || f.staleOnly || f.multiLine
}

function matchesTime(f: CrewFilter, start: number | null, end: number | null): boolean {
  if (f.minutes == null) return true
  const value = f.timeField === 'start' ? start : end
  if (value == null) return false
  return f.timeRelation === 'after' ? value > f.minutes : value < f.minutes
}

export function blockMatches(f: CrewFilter, block: BoardBlock, hasUncovered: boolean): boolean {
  if (!matchesTime(f, block.window?.startMinutes ?? null, block.window?.endMinutes ?? null)) return false
  if (f.branchId && block.branchId !== f.branchId) return false
  if (f.lineCode && !block.trips.some(t => t.lineCode === f.lineCode)) return false
  if (f.uncoveredOnly && !hasUncovered) return false
  return true
}

// lineCodes: the lines the duty operates (dutyLineCodes)
export function dutyMatches(f: CrewFilter, duty: BoardDuty, lineCodes: string[]): boolean {
  const events = [...duty.pieces, ...duty.activities]
  const start  = events.length ? Math.min(...events.map(e => e.startMinutes)) : null
  const end    = events.length ? Math.max(...events.map(e => e.endMinutes)) : null
  if (!matchesTime(f, start, end)) return false
  if (f.branchId && duty.branchId !== f.branchId) return false
  if (f.role && duty.role !== f.role) return false
  if (f.kind && duty.kind !== f.kind) return false
  if (f.withIssues && !duty.hasIssues) return false
  if (f.staleOnly && !duty.isStale) return false
  if (f.lineCode && !lineCodes.includes(f.lineCode)) return false
  if (f.multiLine && lineCodes.length < 2) return false
  return true
}
