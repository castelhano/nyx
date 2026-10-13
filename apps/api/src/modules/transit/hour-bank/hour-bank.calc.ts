import type { HourBankMonth, HourBankMovement } from '@nyx/schemas'
import { normalizeOccurrence } from './timesheet-parser'

// The hour bank's rules — pure.
//
// A day into the bank:
//   worked more than the journey   50% of the extra banked, 50% paid apart
//   worked less                    the whole shortfall debited
//   worked holiday                 nothing banked, the extra paid apart (×2)
//   compensatory day off           one journey debited
//   anything else                  neutral (folga, férias, atestado, falta, plantão forecast...)
//
// The lots, month by month (civil month): a positive movement first pays off an inherited
// negative, the rest goes into the month's lot; a negative one consumes the oldest lot first
// (the previous month's, which expires sooner), then the month's own, then becomes negative. At
// each month's closing the previous month's unused lot expires — a pagar; on even months the
// negative balance is forgiven.

export type DayMove = Pick<HourBankMovement, 'minutes' | 'payMinutes' | 'holidayMinutes' | 'occurrence'>

// the extra: half banked, the rest paid apart
const splitExtra = (extra: number) => {
  const banked = Math.floor(extra / 2)
  return { minutes: banked, payMinutes: extra - banked }
}

// a day of the imported frequency (CrewTimesheetDay)
export function importedDay(d: { occurrence: string; extraMinutes: number; shortMinutes: number }, journey: number): DayMove {
  const occurrence = normalizeOccurrence(d.occurrence)
  const none = { minutes: 0, payMinutes: 0, holidayMinutes: 0, occurrence }
  if (occurrence.startsWith('COMPENSACAO')) return { ...none, minutes: -journey }
  if (occurrence === 'F TRB') return { ...none, holidayMinutes: d.extraMinutes }
  // only a normal working day moves the bank — JORJ, folga prêmio, abonado, treinamento,
  // suspensão, faltas, atestados, INSS, acidente... are neutral
  if (occurrence !== 'NOR' && occurrence !== '') return none
  const extra = splitExtra(d.extraMinutes)
  return { ...none, minutes: extra.minutes - d.shortMinutes, payMinutes: extra.payMinutes }
}

// a day of the roster's forecast: what the crew member holds on it
export function forecastDay(
  held: { kind: 'DUTY' | 'STANDBY' | 'DAY_OFF' | 'COMP_OFF'; paid: number }[], journey: number, holiday: boolean,
): DayMove | null {
  const none = { minutes: 0, payMinutes: 0, holidayMinutes: 0 }
  if (held.some(e => e.kind === 'COMP_OFF')) return { ...none, minutes: -journey, occurrence: 'COMP_OFF' }
  const duties = held.filter(e => e.kind === 'DUTY')
  // a plantão alone is neutral in the forecast
  if (!duties.length) return null
  const worked = duties.reduce((n, e) => n + e.paid, 0)
  if (holiday) return { ...none, holidayMinutes: worked, occurrence: 'HOLIDAY' }
  const diff = worked - journey
  if (diff >= 0) return { ...splitExtra(diff), holidayMinutes: 0, occurrence: 'DUTY' }
  return { ...none, minutes: diff, occurrence: 'DUTY' }
}

// 'YYYY-MM' helpers
export const monthOf = (day: string) => day.slice(0, 7)
export function nextMonth(month: string, n = 1): string {
  const [y, m] = month.split('-').map(Number)
  const d = new Date(Date.UTC(y, m - 1 + n, 1))
  return d.toISOString().slice(0, 7)
}
export const lastDayOf = (month: string) => {
  const [y, m] = month.split('-').map(Number)
  return new Date(Date.UTC(y, m, 0)).toISOString().slice(0, 10)
}

// The bank over consecutive months (each with its movements in date order): each month's
// figures — after its closing when closed, as of now when open (the months after an open one
// carry on as if it had closed). A closed month's days are frozen entries, so running it again
// gives what was closed.
export function runBank(months: { month: string; closed: boolean; moves: { minutes: number; payMinutes: number; holidayMinutes: number }[] }[]): HourBankMonth[] {
  const out: HourBankMonth[] = []
  // the previous month's lot still unused, the negative carried
  let old = 0, negative = 0
  for (const { month, closed, moves } of months) {
    const opening = old + negative
    let lot = 0, credit = 0, debit = 0, pay = 0, holiday = 0
    for (const x of moves) {
      pay += x.payMinutes
      holiday += x.holidayMinutes
      if (x.minutes > 0) {
        credit += x.minutes
        const absorb = Math.min(x.minutes, -negative)
        negative += absorb
        lot += x.minutes - absorb
      } else if (x.minutes < 0) {
        debit += x.minutes
        let d = -x.minutes
        const fromOld = Math.min(old, d); old -= fromOld; d -= fromOld
        const fromLot = Math.min(lot, d); lot -= fromLot; d -= fromLot
        negative -= d
      }
    }
    // the closing: the previous month's lot expires; even months forgive the negative. An open
    // month shows what the crew member has now (and what its closing would do).
    const expiring = old, before = negative
    const even = Number(month.slice(5, 7)) % 2 === 0
    const forgiven = even ? Math.max(0, -negative) : 0
    if (even) negative = 0
    out.push({
      month, closed, opening, credit, debit, pay, holiday, expiring, lot, payout: expiring, forgiven,
      negative: closed ? negative : before,
      balance:  closed ? lot + negative : expiring + lot + before,
    })
    old = lot
  }
  return out
}
