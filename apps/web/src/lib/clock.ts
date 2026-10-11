// Clock times stored as minutes since 00:00 of the operational day, shown as HH:MM.
// Hours may pass 24 (25:30 = 01:30 of the next day) — callers cap with max.

export function formatClock(minutes: number): string {
  const m = Math.round(minutes)
  return `${String(Math.floor(m / 60)).padStart(2, '0')}:${String(m % 60).padStart(2, '0')}`
}

// "7:20" / "07:20" / "7h20" / "7h" → as typed; digits only, same shorthand as the OSO times
// field: 1–2 digits are hours ("7" → 07:00), 3–4 digits end in the minutes ("720" → 07:20,
// "1830" → 18:30). Null when unreadable or minutes ≥ 60.
export function parseClock(text: string): number | null {
  const s = text.trim().toLowerCase()
  if (!s) return null

  let h: string, mm: string
  const digits = s.match(/^(\d{1,4})$/)
  const split  = s.match(/^(\d{1,2})\s*[:h]\s*(\d{0,2})$/)
  if (digits) {
    const d = digits[1]
    ;[h, mm] = d.length <= 2 ? [d, '0'] : [d.slice(0, -2), d.slice(-2)]
  } else if (split) {
    ;[h, mm] = [split[1], split[2] || '0']
  } else {
    return null
  }

  const minutes = parseInt(mm, 10)
  if (minutes >= 60) return null
  return parseInt(h, 10) * 60 + minutes
}
