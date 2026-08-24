import type { RawTrip, DotCluster } from './types'

const CLUSTER_TOLERANCE = 3

export function clusterTrips(trips: RawTrip[]): DotCluster[] {
  if (trips.length === 0) return []
  const sorted = [...trips].sort((a, b) => a.cycleMinutes - b.cycleMinutes)

  const groups: RawTrip[][] = []
  let current: RawTrip[] = [sorted[0]]
  for (let i = 1; i < sorted.length; i++) {
    if (sorted[i].cycleMinutes - current[0].cycleMinutes <= CLUSTER_TOLERANCE) {
      current.push(sorted[i])
    } else {
      groups.push(current)
      current = [sorted[i]]
    }
  }
  groups.push(current)

  return groups.map(g => {
    const freq = new Map<number, number>()
    for (const t of g) freq.set(t.cycleMinutes, (freq.get(t.cycleMinutes) ?? 0) + 1)
    const center = [...freq.entries()].sort((a, b) => b[1] - a[1])[0][0]
    return {
      minutes:    center,
      count:      g.length,
      trips:      g,
      isOutlier:  false,
      isDisabled: false,
      hasEdited:  g.some(t => t.edited),
    }
  })
}

function quantile(sorted: number[], q: number): number {
  const pos = (sorted.length - 1) * q
  const lo  = Math.floor(pos)
  const hi  = Math.ceil(pos)
  return sorted[lo] + (sorted[hi] - sorted[lo]) * (pos - lo)
}

export function markOutliers(clusters: DotCluster[]): DotCluster[] {
  // collect individual trip values from active clusters for robust IQR
  const active   = clusters.filter(c => !c.isDisabled)
  const allVals  = active.flatMap(c => c.trips.map(t => t.cycleMinutes)).sort((a, b) => a - b)

  if (allVals.length < 4) {
    return clusters.map(c => ({ ...c, isOutlier: false }))
  }

  const q1  = quantile(allVals, 0.25)
  const q3  = quantile(allVals, 0.75)
  const iqr = q3 - q1
  const lo  = q1 - 1.5 * iqr
  const hi  = q3 + 1.5 * iqr

  const result = clusters.map(c => ({
    ...c,
    isOutlier: !c.isDisabled && (c.minutes < lo || c.minutes > hi),
  }))

  return result
}

export function buildHourClusters(
  trips: RawTrip[],
  includeEdited: boolean,
): Map<number, DotCluster[]> {
  const filtered = includeEdited ? trips : trips.filter(t => !t.edited)

  const byHour = new Map<number, RawTrip[]>()
  for (const t of filtered) {
    if (!byHour.has(t.departureHour)) byHour.set(t.departureHour, [])
    byHour.get(t.departureHour)!.push(t)
  }

  const result = new Map<number, DotCluster[]>()
  for (const [h, ts] of byHour) {
    result.set(h, markOutliers(clusterTrips(ts)))
  }
  return result
}

export function suggestCuts(trips: RawTrip[]): number[] {
  const byHour = new Map<number, number[]>()
  for (const t of trips) {
    if (!byHour.has(t.departureHour)) byHour.set(t.departureHour, [])
    byHour.get(t.departureHour)!.push(t.cycleMinutes)
  }

  const hours = Array.from(byHour.keys()).sort((a, b) => a - b)
  if (hours.length < 2) return []

  const avg = (vals: number[]) => vals.reduce((s, v) => s + v, 0) / vals.length
  const cuts: number[] = []

  for (let i = 1; i < hours.length; i++) {
    const prev = avg(byHour.get(hours[i - 1])!)
    const curr = avg(byHour.get(hours[i])!)
    if (prev > 0 && Math.abs(curr - prev) / prev >= 0.15) {
      cuts.push(hours[i - 1])
    }
  }
  return cuts
}

export function calcWindowAverage(clusters: DotCluster[]): number {
  const active = clusters.filter(c => !c.isOutlier && !c.isDisabled)
  if (active.length === 0) return 0
  const totalMin   = active.reduce((s, c) => s + c.minutes * c.count, 0)
  const totalCount = active.reduce((s, c) => s + c.count, 0)
  return Math.round(totalMin / totalCount)
}

function minuteOfTrip(t: RawTrip): number {
  return parseInt(t.departureTime.split(':')[1] ?? '0', 10) || 0
}

function clusterWeightedSum(clusters: DotCluster[]): { total: number; count: number } {
  const active = clusters.filter(c => !c.isOutlier && !c.isDisabled)
  return {
    total: active.reduce((s, c) => s + c.minutes * c.count, 0),
    count: active.reduce((s, c) => s + c.count, 0),
  }
}

function halfWeightedSum(clusters: DotCluster[], wantSecondHalf: boolean): { total: number; count: number } {
  const active = clusters.filter(c => !c.isOutlier && !c.isDisabled)
  let total = 0, count = 0
  for (const c of active) {
    for (const t of c.trips) {
      if ((minuteOfTrip(t) >= 30) === wantSecondHalf) { total += c.minutes; count++ }
    }
  }
  return { total, count }
}

/** Split an hour's active trips at the 30min mark and average each half
 *  separately (same cluster-center weighting as calcWindowAverage). Used by
 *  the canvas to preview what a 30min sub-cut would look like. */
export function calcHalfWindowAverages(clusters: DotCluster[]): { first: number; second: number } {
  const first  = halfWeightedSum(clusters, false)
  const second = halfWeightedSum(clusters, true)
  return {
    first:  first.count  > 0 ? Math.round(first.total  / first.count)  : 0,
    second: second.count > 0 ? Math.round(second.total / second.count) : 0,
  }
}

export type Window = {
  from:            number
  to:              number
  minutes:         number
  intervalMinutes: number
  isDerived?:      boolean
}

type Candidate = { from: number; to: number; minutes: number }

/** Builds the raw (pre-fill) window candidates from hour clusters, full cuts
 *  and 30min sub-cuts. `to` always marks the last half-hour slot included:
 *  a whole, un-split hour extends `to` by 0.5 (e.g. hour 7 fully included →
 *  to=7.5); a sub-cut truncates it at the bare hour instead (to=6 means "up
 *  to but not including 6:30"), and the other half starts a new candidate at
 *  from=6.5. This is shared by computeWindows() (persisted) and the canvas
 *  live preview so both always agree. */
export function buildRawWindowCandidates(
  hourClusters: Map<number, DotCluster[]>,
  cuts:         number[],
  subCuts:      number[],
): Candidate[] {
  const hours = Array.from(hourClusters.keys()).sort((a, b) => a - b)
  if (hours.length === 0) return []

  const minH      = hours[0]
  const maxH      = hours[hours.length - 1]
  const sortedCuts = [...cuts].filter(c => c >= minH && c < maxH).sort((a, b) => a - b)
  const groupBounds = [minH, ...sortedCuts.map(c => c + 1), maxH + 1]
  const subCutSet  = new Set(subCuts.filter(h => h >= minH && h <= maxH))

  const candidates: Candidate[] = []

  for (let i = 0; i < groupBounds.length - 1; i++) {
    const groupFrom = groupBounds[i]
    const groupTo   = groupBounds[i + 1] - 1

    let runFrom: number | null = null
    let runTotal = 0
    let runCount = 0
    let runEnd   = groupFrom

    const flush = () => {
      if (runFrom === null) return
      candidates.push({ from: runFrom, to: runEnd, minutes: runCount > 0 ? Math.round(runTotal / runCount) : 0 })
      runFrom = null
      runTotal = 0
      runCount = 0
    }

    for (let h = groupFrom; h <= groupTo; h++) {
      // an hour with zero trips has no column on the canvas at all — it must
      // never become a run boundary (from/to), or the pill ends up pointing
      // at an hour that doesn't exist and gets mispositioned; skip it as if
      // it simply weren't part of the range
      if (!hourClusters.has(h)) continue
      const cs = hourClusters.get(h)!

      if (subCutSet.has(h)) {
        // first half extends whatever run was already in progress, then hard-breaks
        if (runFrom === null) runFrom = h
        const firstSum = halfWeightedSum(cs, false)
        runTotal += firstSum.total
        runCount += firstSum.count
        runEnd    = h
        flush()

        // second half always starts a fresh run
        const secondSum = halfWeightedSum(cs, true)
        runFrom  = h + 0.5
        runTotal = secondSum.total
        runCount = secondSum.count
        runEnd   = h + 0.5
      } else {
        if (runFrom === null) runFrom = h
        const { total, count } = clusterWeightedSum(cs)
        runTotal += total
        runCount += count
        runEnd    = h + 0.5
      }
    }
    flush()
  }

  return candidates
}

export function computeWindows(
  hourClusters: Map<number, DotCluster[]>,
  cuts: number[],
  subCuts: number[],
  intervalMinutes: number,
): Window[] {
  const hours = Array.from(hourClusters.keys()).sort((a, b) => a - b)
  if (hours.length === 0) return []

  const minH = hours[0]
  const maxH = hours[hours.length - 1]

  const candidates = buildRawWindowCandidates(hourClusters, cuts, subCuts)
  if (candidates.every(c => c.minutes === 0)) return []

  // measured windows keep their average; windows with no data (e.g. a cut
  // isolating an hour with zero trips) borrow the average of the nearest
  // measured neighbor and are flagged isDerived so real data is never lost
  const result: Window[] = candidates.map((c, i) => {
    if (c.minutes > 0) return { from: c.from, to: c.to, minutes: c.minutes, intervalMinutes }

    let left = i - 1
    while (left >= 0 && candidates[left].minutes === 0) left--
    let right = i + 1
    while (right < candidates.length && candidates[right].minutes === 0) right++

    const leftDist  = left  >= 0                  ? c.from - candidates[left].to   : Infinity
    const rightDist = right < candidates.length   ? candidates[right].from - c.to  : Infinity
    const source    = rightDist < leftDist ? candidates[right] : candidates[left]

    return { from: c.from, to: c.to, minutes: source.minutes, intervalMinutes, isDerived: true }
  })

  // hours outside the measured range (before the first / after the last
  // hour with data) become their own derived windows covering the full day
  if (minH > 0) {
    result.unshift({ from: 0, to: minH - 0.5, minutes: result[0].minutes, intervalMinutes, isDerived: true })
  }
  if (maxH < 23) {
    result.push({ from: maxH + 1, to: 23.5, minutes: result[result.length - 1].minutes, intervalMinutes, isDerived: true })
  }

  return result
}

// ── dayType suggestion ───────────────────────────────────────────────────────

export interface DayTypeOption {
  code:    string
  pattern: unknown
}

/** Parses a CSV "Data" cell (DD/MM/YYYY or YYYY-MM-DD, optionally with a time
 *  part) into an ISO weekday (1=Monday..7=Sunday). Returns null for anything
 *  unparseable — the caller should fall back to no suggestion rather than
 *  guess. Built as UTC to avoid the local-timezone date shift a bare
 *  `new Date("YYYY-MM-DD")` construction is prone to. */
export function parseIsoWeekday(dateStr: string): number | null {
  const datePart = dateStr.trim().split(/\s+/)[0]
  const slash    = datePart.split('/')
  const dash     = datePart.split('-')

  let y: number, m: number, d: number
  if (slash.length === 3) {
    [d, m, y] = slash.map(Number)
  } else if (dash.length === 3) {
    [y, m, d] = dash.map(Number)
  } else {
    return null
  }
  if (y < 100) y += 2000
  if ([y, m, d].some(n => isNaN(n))) return null

  const date = new Date(Date.UTC(y, m - 1, d))
  if (isNaN(date.getTime())) return null

  const jsDay = date.getUTCDay() // 0=Sunday..6=Saturday
  return jsDay === 0 ? 7 : jsDay
}

/** Suggests which registered DayType a CSV import belongs to, from the date of
 *  its first trip — matches against each DayType's own `pattern.days` (ISO
 *  weekday numbers) instead of hardcoding day-type codes, so it works with
 *  whatever day types this system has configured. DayTypes with no pattern
 *  (e.g. "Especial"/"Férias") can never match — there's nothing in a date
 *  alone to tell those apart from a regular weekday. Returns null (no
 *  suggestion) when the date can't be parsed or no configured pattern covers
 *  its weekday. */
export function suggestDayTypeCode(sampleDate: string | null, dayTypes: DayTypeOption[]): string | null {
  if (!sampleDate) return null
  const isoWeekday = parseIsoWeekday(sampleDate)
  if (isoWeekday == null) return null

  for (const dt of dayTypes) {
    const days = (dt.pattern as { days?: unknown } | null)?.days
    if (Array.isArray(days) && days.includes(isoWeekday)) return dt.code
  }
  return null
}
