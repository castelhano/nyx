// Data shaping for LineFreqPanel — the read-only sidebar that mirrors the
// trip focused on the Gantt, showing that trip's whole line/direction running
// schedule (frequency behavior) alongside it. One pass over the same
// VehiclePlanGanttData the Gantt reads: groups trips by line+direction,
// computes headway inline (no re-sort per trip, unlike the old
// trips-table.view.ts this replaces), and indexes every trip id so the panel
// can locate a focusedSegId's line/direction/position in O(1) — no scan.

import { DIRECTION_LABELS, type VehiclePlanGanttData } from './vehicles.view'

export interface FreqTrip {
  id:      string
  dep:     number
  headway: number | null
}

export interface FreqLineGroup {
  lineId:         string
  lineCode:       string
  mode:           'both' | 'single'
  outbound:       FreqTrip[] // sentido primário (OUTBOUND, ou o único sentido existente)
  inbound:        FreqTrip[] // INBOUND — vazio quando mode === 'single'
  outboundAbbrev: string     // 'I' / 'C'
  inboundAbbrev:  string     // 'V' — '' quando mode === 'single'
}

export interface FreqSegLocation {
  lineId:    string
  direction: 'outbound' | 'inbound'
  idx:       number
}

export interface LineFreqIndex {
  groups:    Map<string, FreqLineGroup>
  segIndex:  Map<string, FreqSegLocation>
  lineOrder: string[] // ordenado por código de linha — usado pelas setas de navegação
}

// OUTBOUND é sempre o sentido primário quando presente; CIRCULAR (sentido
// único) também vira "primário" pra cair na mesma coluna.
const PRIMARY_DIRECTIONS = new Set(['OUTBOUND', 'CIRCULAR'])

export function buildLineFreqIndex(data: VehiclePlanGanttData): LineFreqIndex {
  const byLine = new Map<string, { code: string; byDir: Map<string, { id: string; dep: number }[]> }>()

  for (const block of data.blocks) {
    for (const bt of block.blockTrips) {
      const line = bt.trip.route.line
      let entry = byLine.get(line.id)
      if (!entry) {
        entry = { code: line.code, byDir: new Map() }
        byLine.set(line.id, entry)
      }
      const dir = bt.trip.route.direction
      if (!entry.byDir.has(dir)) entry.byDir.set(dir, [])
      entry.byDir.get(dir)!.push({ id: bt.id, dep: bt.trip.departureMinutes })
    }
  }

  const groups   = new Map<string, FreqLineGroup>()
  const segIndex = new Map<string, FreqSegLocation>()
  const lineOrder = [...byLine.entries()]
    .sort((a, b) => a[1].code.localeCompare(b[1].code))
    .map(([lineId]) => lineId)

  for (const lineId of lineOrder) {
    const entry = byLine.get(lineId)!
    const dirs  = [...entry.byDir.keys()]
    const primaryDir   = dirs.find(d => PRIMARY_DIRECTIONS.has(d)) ?? dirs[0]
    const secondaryDir = dirs.find(d => d !== primaryDir && d === 'INBOUND')

    function toFreqTrips(dir: string | undefined, kind: 'outbound' | 'inbound'): FreqTrip[] {
      if (!dir) return []
      const sorted = entry!.byDir.get(dir)!.slice().sort((a, b) => a.dep - b.dep)
      return sorted.map((t, i) => {
        segIndex.set(t.id, { lineId, direction: kind, idx: i })
        return { id: t.id, dep: t.dep, headway: i === 0 ? null : t.dep - sorted[i - 1].dep }
      })
    }

    groups.set(lineId, {
      lineId,
      lineCode:       entry.code,
      mode:           secondaryDir ? 'both' : 'single',
      outbound:       toFreqTrips(primaryDir, 'outbound'),
      inbound:        toFreqTrips(secondaryDir, 'inbound'),
      outboundAbbrev: (DIRECTION_LABELS[primaryDir ?? ''] ?? primaryDir ?? '?')[0],
      inboundAbbrev:  secondaryDir ? (DIRECTION_LABELS[secondaryDir] ?? secondaryDir)[0] : '',
    })
  }

  return { groups, segIndex, lineOrder }
}
