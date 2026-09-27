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

// by day: a plan activated at any time of the day is in force on that day
export function inForce(p: { validFrom: Date | null; validTo: Date | null }, date: Date): boolean {
  const nextDay = new Date(date.getFullYear(), date.getMonth(), date.getDate() + 1)
  return (!p.validFrom || p.validFrom < nextDay) && (!p.validTo || p.validTo >= date)
}

// VehiclePlan ACTIVE for (dayType, line) in force on the date
export function findActivePlan<P extends { dayTypeId: string; validFrom: Date | null; validTo: Date | null; lines: { lineId: string }[] }>(
  plans: P[], dayTypeId: string, lineId: string, date: Date,
): P | null {
  return plans.find(p => p.dayTypeId === dayTypeId && inForce(p, date) && p.lines.some(l => l.lineId === lineId)) ?? null
}
