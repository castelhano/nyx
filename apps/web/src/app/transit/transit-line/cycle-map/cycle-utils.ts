import type { RawTrip, DotCluster } from './types'

const CLUSTER_TOLERANCE = 3

export function clusterTrips(trips: RawTrip[]): DotCluster[] {
  if (trips.length === 0) return []
  const sorted = [...trips].sort((a, b) => a.cycleMinutes - b.cycleMinutes)

  const groups: RawTrip[][] = []
  let current: RawTrip[] = [sorted[0]]
  for (let i = 1; i < sorted.length; i++) {
    if (sorted[i].cycleMinutes - sorted[i - 1].cycleMinutes <= CLUSTER_TOLERANCE) {
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
  const activeVals = clusters.filter(c => !c.isDisabled).map(c => c.minutes).sort((a, b) => a - b)
  if (activeVals.length < 4) return clusters.map(c => ({ ...c, isOutlier: false }))

  const q1  = quantile(activeVals, 0.25)
  const q3  = quantile(activeVals, 0.75)
  const iqr = q3 - q1
  const lo  = q1 - 1.5 * iqr
  const hi  = q3 + 1.5 * iqr

  return clusters.map(c => ({
    ...c,
    isOutlier: !c.isDisabled && (c.minutes < lo || c.minutes > hi),
  }))
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

export function computeWindows(
  hourClusters: Map<number, DotCluster[]>,
  cuts: number[],
  intervalMinutes: number,
): { from: number; to: number; minutes: number; intervalMinutes: number }[] {
  const hours = Array.from(hourClusters.keys()).sort((a, b) => a - b)
  if (hours.length === 0) return []

  const minH   = hours[0]
  const maxH   = hours[hours.length - 1]
  const sorted = [...cuts].filter(c => c >= minH && c < maxH).sort((a, b) => a - b)

  const bounds = [minH, ...sorted.map(c => c + 1), maxH + 1]
  const result: { from: number; to: number; minutes: number; intervalMinutes: number }[] = []

  for (let i = 0; i < bounds.length - 1; i++) {
    const from = bounds[i]
    const to   = bounds[i + 1] - 1
    const all: DotCluster[] = []
    for (let h = from; h <= to; h++) {
      const cs = hourClusters.get(h)
      if (cs) all.push(...cs)
    }
    const avg = calcWindowAverage(all)
    if (avg > 0) result.push({ from, to, minutes: avg, intervalMinutes })
  }
  return result
}
