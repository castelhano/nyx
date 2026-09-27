import { inForceOn, type Window } from '../plan-validity'

// Shared by both DOP views: the days of the period and "which plan is in force on this day".
// Days are local midnights — DayType resolution reads local date parts, so a 'YYYY-MM-DD'
// parsed as UTC would shift every day back by one west of Greenwich.

export function parseDay(s: string): Date | null {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(s)
  return m ? new Date(Number(m[1]), Number(m[2]) - 1, Number(m[3])) : null
}

export function formatDay(d: Date): string {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`
}

export function periodDates(from: Date, to: Date): Date[] {
  const dates: Date[] = []
  for (let d = new Date(from); d <= to; d.setDate(d.getDate() + 1)) dates.push(new Date(d))
  return dates
}

// `date` is a local midnight of the period; validity columns are @db.Date
export function inForce(p: Window, date: Date): boolean {
  return inForceOn(p, formatDay(date))
}

// non-DRAFT VehiclePlan for (dayType, line) in force on the date
export function findActivePlan<P extends { dayTypeId: string; validFrom: Date | null; validTo: Date | null; lines: { lineId: string }[] }>(
  plans: P[], dayTypeId: string, lineId: string, date: Date,
): P | null {
  return plans.find(p => p.dayTypeId === dayTypeId && inForce(p, date) && p.lines.some(l => l.lineId === lineId)) ?? null
}
