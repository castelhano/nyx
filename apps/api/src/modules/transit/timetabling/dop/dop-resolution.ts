// Shared by both DOP views: the days of the period and "which plan is in force on this day".

export function periodDates(from: Date, to: Date): Date[] {
  const dates: Date[] = []
  for (let d = new Date(from); d <= to; d.setDate(d.getDate() + 1)) dates.push(new Date(d))
  return dates
}

export function inForce(p: { validFrom: Date | null; validTo: Date | null }, date: Date): boolean {
  return (!p.validFrom || p.validFrom <= date) && (!p.validTo || p.validTo >= date)
}

// VehiclePlan ACTIVE for (dayType, line) in force on the date
export function findActivePlan<P extends { dayTypeId: string; validFrom: Date | null; validTo: Date | null; lines: { lineId: string }[] }>(
  plans: P[], dayTypeId: string, lineId: string, date: Date,
): P | null {
  return plans.find(p => p.dayTypeId === dayTypeId && inForce(p, date) && p.lines.some(l => l.lineId === lineId)) ?? null
}
