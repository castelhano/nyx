// Cycle windows of a line (TransitLine.metrics.windows) and their lookup by departure time —
// shared by the plan editor, the per-line schedule generator and the goal planning analysis.

export interface CycleWindow {
  from:            number
  to:              number
  minutes:         number
  intervalMinutes: number
  isDerived?:      boolean
}

export interface LineMetrics {
  extensionKm?: Record<string, number>
  // keyed by dayTypeCode first (see LineService.applyWindows / cycle-map) — then by direction
  windows?:     Record<string, Record<string, CycleWindow[]>>
}

/** Returns the full cycle window for a trip given the line metrics, dayType,
 *  direction, and departure time. Falls back to 'U' (dia útil) when the given
 *  dayType has no cycle data imported yet, then to OUTBOUND when direction has
 *  no windows. `to` marks the last half-hour slot included (whole hour → +0.5,
 *  truncated by a 30min sub-cut → bare hour), so departure time is compared at
 *  the same half-hour resolution rather than truncated to the hour. */
export function resolveCycleWindow(
  metrics:          LineMetrics | null | undefined,
  dayTypeCode:      string,
  direction:        string,
  departureMinutes: number,
): CycleWindow | null {
  const forDayType = metrics?.windows?.[dayTypeCode] ?? metrics?.windows?.['U']
  if (!forDayType) return null
  const windows = forDayType[direction] ?? forDayType['OUTBOUND'] ?? []
  const slot    = Math.floor(departureMinutes / 30) / 2 % 24
  return windows.find(w => slot >= w.from && slot <= w.to) ?? null
}

export function resolveCycleMinutes(
  metrics:          LineMetrics | null | undefined,
  dayTypeCode:      string,
  direction:        string,
  departureMinutes: number,
): number | null {
  return resolveCycleWindow(metrics, dayTypeCode, direction, departureMinutes)?.minutes ?? null
}
