// Durations stored as minutes, shown as H:MM (a length of time, not a clock time — 1440 is 24:00).

export function formatDuration(minutes: number): string {
  const m = Math.round(minutes)
  return `${Math.floor(m / 60)}:${String(m % 60).padStart(2, '0')}`
}

// "7:20" / "7h20" / "7h" → hours; a bare number or "45m" / "45min" → minutes. Null when unreadable.
export function parseDuration(text: string): number | null {
  const s = text.trim().toLowerCase()
  if (!s) return null

  const minutes = s.match(/^(\d+)\s*(m|min)?$/)
  if (minutes) return parseInt(minutes[1], 10)

  const hours = s.match(/^(\d+)\s*[:h]\s*(\d{0,2})$/)
  if (hours) {
    const m = hours[2] ? parseInt(hours[2], 10) : 0
    if (m >= 60) return null
    return parseInt(hours[1], 10) * 60 + m
  }
  return null
}
