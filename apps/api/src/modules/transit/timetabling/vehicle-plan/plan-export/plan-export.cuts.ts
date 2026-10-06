import type { ExportIssue } from '@nyx/schemas'

// Layer 2 of the plan export (docs/proposal/plan_globus_export_v1.md §3.3) — splits one
// carro's trecho into segments (the future tables) at intervals, garage visits and shift
// changes. Pure: no codes, names or formatting, those belong to the system's profile.

export type Direction = 'OUTBOUND' | 'INBOUND' | 'CIRCULAR'

export interface CodeRef {
  code:     string
  fallback: boolean
}

export interface TrechoTrip {
  tripId:    string
  lineId:    string
  line:      CodeRef
  direction: Direction
  dep:       number
  arr:       number
  origin:    CodeRef
}

export interface Span {
  dep: number
  arr: number
}

// what the vehicle does between trips[i] and trips[i + 1]
export interface TrechoGap {
  displacements: Span[]
  interval?:     Span
  // RETURN + ACCESS pair: the vehicle goes back to the depot and out again
  garage?:       { returnDep: number; returnArr: number; accessDep: number }
}

// what follows the trecho's last trip
export type TrechoEnd =
  | { kind: 'RETURN'; arr: number }
  | { kind: 'BREAK'; at: number; nextDirection: Direction }
  | { kind: 'END' }

export interface Relief {
  at:       number
  locality: CodeRef
}

export interface Trecho {
  // chronological, at least one
  trips:   TrechoTrip[]
  // gaps[i] sits between trips[i] and trips[i + 1]
  gaps:    TrechoGap[]
  // departure of the ACCESS deadrun right before trips[0], if any
  access?: number
  end:     TrechoEnd
  // instants a new driver takes over the vehicle
  reliefs: Relief[]
}

export type SegmentItem =
  | { kind: 'trip'; trip: TrechoTrip; dep: number; arr: number; origin: CodeRef }
  | { kind: 'displacement'; dep: number; arr: number; nextDirection: Direction }

export type SegmentClose =
  | { kind: 'BREAK'; at: number; nextDirection: Direction }
  | { kind: 'SHIFT_CHANGE'; at: number; nextDirection: Direction }
  // nextDirection only when the trecho goes on after the garage visit
  | { kind: 'RETURN'; from: number; to: number; nextDirection?: Direction }
  | { kind: 'END'; at: number }

export interface Segment {
  access?:    number
  afterBreak: boolean
  items:      SegmentItem[]
  close:      SegmentClose
  issues:     ExportIssue[]
}

type GapCut = { at: number; issue?: ExportIssue }

export function cutTrecho(trecho: Trecho): Segment[] {
  const { trips, gaps } = trecho
  const first = trips[0]
  const last  = trips[trips.length - 1]

  // where each relief lands: inside a trip (split) or in a gap (cut between trips)
  const splits  = new Map<number, Relief[]>()
  const gapCuts = new Map<number, GapCut>()
  for (const relief of [...trecho.reliefs].sort((a, b) => a.at - b.at)) {
    const t = relief.at
    if (t <= first.dep || t >= last.arr) continue
    const inTrip = trips.findIndex(tr => tr.dep < t && t < tr.arr)
    if (inTrip >= 0) {
      splits.set(inTrip, [...(splits.get(inTrip) ?? []), relief])
      continue
    }
    const g = trips.findIndex((tr, i) => i < trips.length - 1 && tr.arr <= t && t <= trips[i + 1].dep)
    if (g < 0 || gapCuts.has(g)) continue
    const gap = gaps[g]
    // an interval or a garage visit already cuts there
    if (gap.interval || gap.garage) continue
    const inDisplacement = gap.displacements.find(d => d.dep < t && t < d.arr)
    gapCuts.set(g, inDisplacement
      ? { at: inDisplacement.dep, issue: { code: 'SHIFT_CHANGE_IN_DISPLACEMENT', message: `Troca às ${hhmm(t)} durante deslocamento — corte antes do deslocamento` } }
      : { at: t })
  }

  const segments: Segment[] = []
  let cur: Omit<Segment, 'close'> = { access: trecho.access, afterBreak: false, items: [], issues: [] }
  const close = (c: SegmentClose, next: { access?: number; afterBreak: boolean }) => {
    segments.push({ ...cur, close: c })
    cur = { access: next.access, afterBreak: next.afterBreak, items: [], issues: [] }
  }
  const lastItemEnd = () => {
    const it = cur.items[cur.items.length - 1]
    return it ? it.arr : -Infinity
  }

  trips.forEach((trip, i) => {
    let from   = trip.dep
    let origin = trip.origin
    for (const relief of splits.get(i) ?? []) {
      cur.items.push({ kind: 'trip', trip, dep: from, arr: relief.at, origin })
      cur.issues.push({ code: 'SHIFT_CHANGE_MID_TRIP', message: `Troca às ${hhmm(relief.at)} no meio da viagem das ${hhmm(trip.dep)} — viagem dividida` })
      close({ kind: 'SHIFT_CHANGE', at: relief.at, nextDirection: trip.direction }, { afterBreak: false })
      from   = relief.at
      origin = relief.locality
    }
    cur.items.push({ kind: 'trip', trip, dep: from, arr: trip.arr, origin })

    if (i === trips.length - 1) return
    const gap     = gaps[i]
    const nextDir = trips[i + 1].direction
    const displacements = gap.displacements.map(d => ({ kind: 'displacement' as const, ...d, nextDirection: nextDir }))
    const pushBefore = (at: number) => cur.items.push(...displacements.filter(d => d.dep < at))
    const pushFrom   = (at: number) => cur.items.push(...displacements.filter(d => d.dep >= at))

    if (gap.garage) {
      pushBefore(gap.garage.returnDep)
      close({ kind: 'RETURN', from: trip.arr, to: gap.garage.returnArr, nextDirection: nextDir }, { access: gap.garage.accessDep, afterBreak: true })
      pushFrom(gap.garage.returnDep)
    } else if (gap.interval) {
      pushBefore(gap.interval.dep)
      close({ kind: 'BREAK', at: gap.interval.dep, nextDirection: nextDir }, { afterBreak: true })
      pushFrom(gap.interval.dep)
    } else if (gapCuts.has(i)) {
      const cut = gapCuts.get(i)!
      pushBefore(cut.at)
      if (cut.issue) cur.issues.push(cut.issue)
      close({ kind: 'SHIFT_CHANGE', at: Math.max(trip.arr, lastItemEnd()), nextDirection: nextDir }, { afterBreak: false })
      pushFrom(cut.at)
    } else {
      cur.items.push(...displacements)
    }
  })

  const end = trecho.end
  if (end.kind === 'RETURN')     close({ kind: 'RETURN', from: last.arr, to: end.arr }, { afterBreak: false })
  else if (end.kind === 'BREAK') close({ kind: 'BREAK', at: end.at, nextDirection: end.nextDirection }, { afterBreak: false })
  else                           close({ kind: 'END', at: last.arr }, { afterBreak: false })

  return segments
}

export function hhmm(minutes: number): string {
  const m = ((minutes % 1440) + 1440) % 1440
  return `${String(Math.floor(m / 60)).padStart(2, '0')}:${String(m % 60).padStart(2, '0')}`
}
