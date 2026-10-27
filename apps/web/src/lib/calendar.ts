// Day strings (YYYY-MM-DD, UTC) for the month calendars — crew occurrences, holidays

export const WEEK   = ['Seg', 'Ter', 'Qua', 'Qui', 'Sex', 'Sáb', 'Dom']
export const MONTHS = ['Janeiro', 'Fevereiro', 'Março', 'Abril', 'Maio', 'Junho', 'Julho', 'Agosto', 'Setembro', 'Outubro', 'Novembro', 'Dezembro']

export function addDays(day: string, n: number): string {
  const d = new Date(`${day}T00:00:00Z`)
  d.setUTCDate(d.getUTCDate() + n)
  return d.toISOString().slice(0, 10)
}

// Monday-first weeks covering the month (YYYY-MM)
export function monthGrid(month: string): string[] {
  const first = `${month}-01`
  const start = addDays(first, -((new Date(`${first}T00:00:00Z`).getUTCDay() + 6) % 7))
  const next  = new Date(`${first}T00:00:00Z`); next.setUTCMonth(next.getUTCMonth() + 1)
  const last  = addDays(next.toISOString().slice(0, 10), -1)
  const days: string[] = []
  for (let d = start; d <= last || days.length % 7; d = addDays(d, 1)) days.push(d)
  return days
}
