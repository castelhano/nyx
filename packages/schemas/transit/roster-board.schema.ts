import type { DailyIssue } from './daily-operation.schema'

// The "Escala" screen's data for one empresa/role over a period — GET /transit/roster-board
// (one request: days, duties, operators, their days, requests and pendências).

export interface RosterBoardDay {
  date:       string
  // one per Scope the empresa operates that has the day — none: not created yet
  // outdated: why the copy is no longer what's in force on the date (a plan activated after the
  // day was created) — null when it is
  operations: { id: string; scopeId: string; scope: string; status: 'PLANNED' | 'PUBLISHED' | 'CLOSED'; outdated: string | null }[]
  duties:     number
  assigned:   number
  // duties with a pendência
  issues:     number
}

export interface RosterBoardPiece {
  start: number
  end:   number
  // the line with most trip minutes in the piece
  line:  string | null
  blockId: string | null
}

export interface RosterBoardDuty {
  id:          string
  operationId: string
  date:        string
  // Scope name — shown when the empresa operates more than one
  scope:       string
  number:      number
  kind:        string
  shiftId:     string | null
  start:       number | null
  end:         number | null
  paid:        number
  lines:       string[]
  pieces:      RosterBoardPiece[]
  // its blocks and their vehicles
  blocks:      { id: string; number: number; vehicleId: string | null; vehicleCode: string | null; issues: DailyIssue[] }[]
  issues:      DailyIssue[]
  crewMemberId: string | null
  locked:      boolean
  isStale:     boolean
}

export interface RosterBoardMember {
  id:        string
  code:      string
  name:      string
  shiftId:   string | null
  // "Sáb-Dom alternado · A"
  rest:      string | null
  rosterable: boolean
  // holds a duty here but belongs to another empresa / role
  foreign:   boolean
  // the load window (load period start .. period end), as the generator counts it
  stats:     { workedMinutes: number; targetMinutes: number; changes: number; prefShare: number | null } | null
}

export interface RosterBoardCell {
  crewMemberId: string
  date:         string
  patternOff:   boolean
  holiday:      boolean
  // changed after the day was published (DailyChangeLog) — who gets notified
  changed:      boolean
  // absenceTypeId: a day off's type
  entries:      { kind: 'DUTY' | 'STANDBY' | 'DAY_OFF' | 'COMP_OFF'; dailyDutyId: string | null; locked: boolean; absenceTypeId: string | null }[]
  requests:     { id: string; kind: 'ABSENCE' | 'TIME_WINDOW'; status: 'REQUESTED' | 'APPROVED'; label: string; startNotBefore: number | null; endNotAfter: number | null }[]
}

export interface RosterBoard {
  from:     string
  to:       string
  // more than one Scope: duties carry their Scope name
  multiScope: boolean
  days:     RosterBoardDay[]
  shifts:   { id: string; code: string }[]
  duties:   RosterBoardDuty[]
  members:  RosterBoardMember[]
  cells:    RosterBoardCell[]
  vehicles: { id: string; code: string; vehicleType: string }[]
  // the absence types that are days off (system ones first) — what a day off can be launched as
  offTypes: { id: string; code: string; name: string; effect: 'DAY_OFF' | 'COMP_OFF'; system: boolean }[]
}
