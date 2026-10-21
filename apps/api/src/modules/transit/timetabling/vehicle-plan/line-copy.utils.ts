// "Copiar de outro planejamento" (VehiclePlanService.copyLineFrom) — what of a source block
// comes along when only one line's part of it is copied:
// - trips: only the line's own
// - deadruns/intervals: only those between two of the line's trips, or between the depot and
//   one of them — by time, never by sequence (not chronological after Gantt moves), and per
//   pull-out, since a block can go back to the depot and out again: an ACCESS comes along when
//   the trip right after it is the line's, a RETURN when the one right before it is; those
//   touching another line's trip stay behind
// - groups: kept as long as what comes along is still one unbroken run of the group's members
//   (at least one trip); otherwise dissolved and reported
// The holes left by the other lines' trips aren't patched — the block's issues flag them.

interface CopySpan { id: string; departureMinutes: number; arrivalMinutes: number; bundleId: string | null }

export interface LineCopySourceBlock {
  trips:     (CopySpan & { lineId: string })[]
  deadruns:  (CopySpan & { type: string })[]
  intervals: CopySpan[]
}

export interface LineCopySelection {
  tripIds:       Set<string>
  deadrunIds:    Set<string>
  intervalIds:   Set<string>
  // groups copied (whole or the line's unbroken part of them)
  keptBundleIds: Set<string>
  // groups dissolved — start of the part that came along
  dissolved:     { bundleId: string; start: number }[]
}

export function selectLineCopy(block: LineCopySourceBlock, lineId: string): LineCopySelection {
  const byTime = [...block.trips].sort((a, b) => a.departureMinutes - b.departureMinutes)
  const ofLine = (t: { lineId: string } | undefined) => !t || t.lineId === lineId

  const tripIds = new Set(block.trips.filter(t => t.lineId === lineId).map(t => t.id))
  if (tripIds.size === 0) return { tripIds, deadrunIds: new Set(), intervalIds: new Set(), keptBundleIds: new Set(), dissolved: [] }

  // the nearest trips before and after it — none on a side means the depot
  const prevOf = (r: CopySpan) => byTime.filter(t => t.arrivalMinutes <= r.departureMinutes).at(-1)
  const nextOf = (r: CopySpan) => byTime.find(t => t.departureMinutes >= r.arrivalMinutes)
  const between = (r: CopySpan) => ofLine(prevOf(r)) && ofLine(nextOf(r))
  const deadrunIds = new Set(block.deadruns.filter(d =>
    d.type === 'ACCESS' ? ofLine(nextOf(d)) : d.type === 'RETURN' ? ofLine(prevOf(d)) : between(d),
  ).map(d => d.id))
  const intervalIds = new Set(block.intervals.filter(between).map(i => i.id))

  const kept = new Set([...tripIds, ...deadrunIds, ...intervalIds])
  const members = new Map<string, (CopySpan & { trip: boolean })[]>()
  for (const m of [
    ...block.trips.map(t => ({ ...t, trip: true })),
    ...block.deadruns.map(d => ({ ...d, trip: false })),
    ...block.intervals.map(i => ({ ...i, trip: false })),
  ]) {
    if (m.bundleId) members.set(m.bundleId, [...(members.get(m.bundleId) ?? []), m])
  }

  const keptBundleIds = new Set<string>()
  const dissolved: LineCopySelection['dissolved'] = []
  for (const [bundleId, group] of members) {
    group.sort((a, b) => a.departureMinutes - b.departureMinutes)
    const idx = group.flatMap((m, i) => (kept.has(m.id) ? [i] : []))
    if (idx.length === 0) continue
    const unbroken = idx.at(-1)! - idx[0] === idx.length - 1
    if (unbroken && idx.some(i => group[i].trip)) keptBundleIds.add(bundleId)
    else dissolved.push({ bundleId, start: group[idx[0]].departureMinutes })
  }

  return { tripIds, deadrunIds, intervalIds, keptBundleIds, dissolved }
}
