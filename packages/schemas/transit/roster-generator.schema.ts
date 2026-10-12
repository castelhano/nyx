import { z } from 'zod'
import { CREW_ROLES } from './duty.schema'

// "Gerar escala" — the real roster generator of one empresa and role over a horizon of days
// (docs/proposal/brainchild/plan_crew_rostering_impl_v2.md §5).

const isoDay = z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'Data inválida')

export const ROSTER_MAX_HORIZON_DAYS = 31

export const rosterGeneratorParamsSchema = z.object({
  branchId: z.uuid(),
  role:     z.enum(CREW_ROLES).default('DRIVER'),
  from:     isoDay,
  to:       isoDay,
  // the period load drives who works (loadDeficit); off: overtime vs. preference (overtimePref)
  ensureMonthlyLoad:     z.boolean().default(true),
  // duty signature changes per crew member in the load period
  maxChanges:            z.number().int().min(0).max(31).default(4),
  // only duties whose lines the empresa operates
  restrictToBranchLines: z.boolean().default(true),
  // fills the days' vehicles (blocks still without one) after the crew
  vehicles:              z.boolean().default(true),
  // also redo the PUBLISHED days (never the CLOSED ones) — changing as little as it can
  // (range.publishedChanges); each change is logged on the day
  includePublished:      z.boolean().default(false),
}).refine(p => p.from <= p.to, { message: 'O fim do período deve ser depois do início', path: ['to'] })

export type RosterGeneratorParams = z.infer<typeof rosterGeneratorParamsSchema>

// one crew member's figures in a proposal
export interface RosterMemberStat {
  crewMemberId: string
  code:         string
  name:         string
  // days with a duty in the horizon (fixed ones included)
  workedDays:   number
  dayOffs:      number
  // load window = load period start .. horizon end
  workedMinutes: number
  targetMinutes: number
  changes:      number
  // % of the trip minutes on preferred lines (graded) — null without preferred lines
  prefShare:    number | null
  warnings:     number
}

export interface RosterProposalSummary {
  score:      number
  // unfloored, what the search compares
  rawScore:   number
  duties:     number
  assigned:   number
  unassigned: number
  // assignments that break a WARN rule
  warnings:   number
  dayOffs:    number
  days:       { date: string; duties: number; assigned: number; free: number }[]
  members:    RosterMemberStat[]
  // the most duties the crew can cover (per day, by the fixed rules) — coverage can't go above
  bound:      number
  // why the duties without a crew member have none, grouped
  shortage:   RosterShortage[]
  // includePublished: the crew members whose duty changes on a PUBLISHED day
  publishedChanges: RosterPublishedChange[]
}

export interface RosterPublishedChange {
  crewMemberId: string
  code:         string
  name:         string
  date:         string
}

// duties left without a crew member for the same reason (and shift)
export interface RosterShortage {
  reason:   string
  shift:    string | null
  dutyIds:  string[]
  // crew members who could take them but are on their rest pattern's day off ("1234 Fulano")
  couldCover: string[]
}
