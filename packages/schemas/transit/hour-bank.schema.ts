import { z } from 'zod'
import '../zod-meta'
import { withMeta } from '../with-meta'

// Banco de horas — served by the custom transit/hour-bank page; registered only for discovery / CASL, like the DOP.
export const hourBankSchema = withMeta(
  z.object({
    id: z.uuid(),
  }),
  {
    label:       'Banco de Horas',
    labelPlural: 'Banco de Horas',
    nameField:   'id',
    icon:        'Hourglass',
    isSingleton: true,
  },
)
export type HourBank = z.infer<typeof hourBankSchema>

// 'YYYY-MM'
export type HourBankMonthKey = string

export type HourBankSource = 'FORECAST' | 'IMPORT' | 'MANUAL'

// One day (or manual launch) into the bank, in minutes
export interface HourBankMovement {
  // HourBankEntry id — manual launches and frozen days; null = read live from the roster / import
  id:             string | null
  date:           string
  kind:           'OPENING' | 'ADJUST' | 'DAY'
  source:         HourBankSource
  // signed, into the bank
  minutes:        number
  // paid apart: the extra's paid half (×1.5) / a worked holiday's extra (×2)
  payMinutes:     number
  holidayMinutes: number
  // what the day was (NOR, F TRB, COMPENSACAO B, DUTY, COMP_OFF...)
  occurrence:     string | null
  notes:          string | null
}

// A crew member's month in the bank (HourBankLot when closed)
export interface HourBankMonth {
  month:    HourBankMonthKey
  closed:   boolean
  // the balance the month started with — the previous month's, after its closing
  opening:  number
  credit:   number
  // ≤ 0
  debit:    number
  pay:      number
  holiday:  number
  // the previous month's credit still unused — expires at this month's closing
  expiring: number
  // the month's own credit still unused — expires at the next month's closing
  lot:      number
  // the previous month's credit that expired at this month's closing (a pagar)
  payout:   number
  // the negative balance forgiven at this closing (even months)
  forgiven: number
  // the negative balance carried (≤ 0)
  negative: number
  // expiring + lot + negative
  balance:  number
}

export interface HourBankMember {
  crewMemberId: string
  code:         string
  name:         string
  // the daily journey (minutes) — weekly hours / work days per week
  journey:      number
  // the hour's value (salary / (weekly × 5)) — informative
  hourValue:    number
}

// The empresa's month: every crew member's position
export interface HourBankOverview {
  branchId: string
  month:    HourBankMonthKey
  // mês de corte — null: no hour bank set up for the empresa
  start:    HourBankMonthKey | null
  closed:   boolean
  // the last closed month (only it may be reopened)
  lastClosed: HourBankMonthKey | null
  // days of the month read from the imported frequency / from the roster forecast
  imported: { from: string; to: string } | null
  rows: (HourBankMember & HourBankMonth)[]
}

export interface HourBankStatement {
  member:    HourBankMember
  months:    HourBankMonth[]
  movements: HourBankMovement[]
  // per month since the start: the net the roster's forecast gives (every day, imported or not) and the net
  // of the days as read (the frequency where imported) — previsto × realizado
  compare:   { month: HourBankMonthKey; forecast: number; actual: number }[]
}

// a manual launch: OPENING (saldo inicial, dated in its lot's month) or ADJUST
export const hourBankEntryInputSchema = z.object({
  crewMemberId: z.uuid(),
  kind:         z.enum(['OPENING', 'ADJUST']),
  date:         z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
  minutes:      z.number().int(),
  notes:        z.string().optional(),
})
export type HourBankEntryInput = z.infer<typeof hourBankEntryInputSchema>

// ── frequency import ─────────────────────────────────────────────────────────

export interface TimesheetImportSummary {
  from:      string
  to:        string
  members:   number
  days:      number
  // days written (new or changed); the rest were the same as the last import
  changed:   number
  // matrículas of the file without a crew member of the empresa
  unknown:   string[]
  // things worth a look — férias in the file without a launch, compensations against the roster...
  divergences: string[]
}
