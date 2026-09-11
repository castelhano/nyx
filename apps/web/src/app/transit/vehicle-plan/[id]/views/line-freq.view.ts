// Data shaping for LineFreqPanel — the read-only sidebar that mirrors the
// trip focused on the Gantt, showing that trip's whole line/direction running
// schedule (frequency behavior) alongside it. One pass over the same
// VehiclePlanGanttData the Gantt reads: groups trips by line+direction,
// computes headway inline (no re-sort per trip, unlike the old
// trips-table.view.ts this replaces), and indexes every trip id so the panel
// can locate a focusedSegId's line/direction/position in O(1) — no scan.

import { DIRECTION_LABELS, type VehiclePlanGanttData } from './vehicles.view'
import type { Direction } from '../line-generator-logic'

export interface FreqTrip {
  id:        string
  dep:       number
  headway:   number | null
  // Set only on the combined ("Multilinha") group's rows — which line this
  // departure belongs to, since that group merges trips from 2+ lines.
  lineCode?: string
}

// A delta group (Fase 4) whose membership is already resolved to the full set
// of currently plotted lines, with each member's crossing-instant offset —
// see useDeltaGroups.ts, which is the only place that decides whether a group
// qualifies (this file trusts whatever it's given).
export interface ResolvedDeltaGroup {
  direction:         Direction
  lineIds:           string[]
  offsetByLineId:    Map<string, number>
  deltaLocalityId:   string
  deltaLocalityName: string
}

export const COMBINED_GROUP_KEY = '__combined__'

// One direction's worth of delta info for the combined group's info tooltip —
// a group can qualify on both IDA and VOLTA independently (possibly at
// different localities), so this is a list, not a single value.
export interface FreqDeltaInfo {
  direction:    Direction
  localityName: string
  perLine:      { lineCode: string; offsetMinutes: number }[]
}

export interface FreqLineGroup {
  lineId:         string
  lineCode:       string
  mode:           'both' | 'single'
  outbound:       FreqTrip[] // sentido primário (OUTBOUND, ou o único sentido existente)
  inbound:        FreqTrip[] // INBOUND — vazio quando mode === 'single'
  outboundAbbrev: string     // 'I' / 'C'
  inboundAbbrev:  string     // 'V' — '' quando mode === 'single'
  // Set only on the combined ("Multilinha") entry.
  deltaInfo?:     FreqDeltaInfo[]
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

export function buildLineFreqIndex(data: VehiclePlanGanttData, combinedGroups: ResolvedDeltaGroup[] = []): LineFreqIndex {
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

  // Combined "Multilinha" entry — merges trips from every line in a resolved
  // group, sorted by crossing instant at the delta (not raw departure) rather
  // than each line's own printed time, so the headway shown is the real
  // combined trunk frequency. Placed first so it's the default view (per
  // Fase 4 — see plan_generate_multiline_delta_v1.md). Trips keep their own
  // segIndex entry from the per-line pass above; this is purely an additional
  // lens over the same ids, not a second canonical location for them.
  if (combinedGroups.length > 0) {
    const outboundGroup = combinedGroups.find(g => g.direction !== 'INBOUND')
    const inboundGroup  = combinedGroups.find(g => g.direction === 'INBOUND')

    function toCombinedTrips(g: ResolvedDeltaGroup | undefined): FreqTrip[] {
      if (!g) return []
      const raw: { id: string; dep: number; lineCode: string }[] = []
      for (const lineId of g.lineIds) {
        const entry  = byLine.get(lineId)
        const offset = g.offsetByLineId.get(lineId)
        if (!entry || offset == null) continue
        for (const t of entry.byDir.get(g.direction) ?? []) raw.push({ id: t.id, dep: t.dep + offset, lineCode: entry.code })
      }
      raw.sort((a, b) => a.dep - b.dep)
      return raw.map((t, i) => ({
        id: t.id, dep: t.dep, lineCode: t.lineCode,
        headway: i === 0 ? null : t.dep - raw[i - 1].dep,
      }))
    }

    let primary       = toCombinedTrips(outboundGroup)
    let secondary      = toCombinedTrips(inboundGroup)
    let primaryAbbrev   = outboundGroup ? (DIRECTION_LABELS[outboundGroup.direction] ?? outboundGroup.direction)[0] : ''
    let secondaryAbbrev = secondary.length > 0 ? 'V' : ''

    // A group can qualify on INBOUND alone (no OUTBOUND match) — shown as the
    // single populated column instead of leaving outbound empty next to it.
    if (primary.length === 0 && secondary.length > 0) {
      primary = secondary
      primaryAbbrev = inboundGroup ? (DIRECTION_LABELS[inboundGroup.direction] ?? inboundGroup.direction)[0] : 'V'
      secondary = []
      secondaryAbbrev = ''
    }

    if (primary.length > 0) {
      const codes = [...new Set([...(outboundGroup?.lineIds ?? []), ...(inboundGroup?.lineIds ?? [])])]
        .map(id => byLine.get(id)?.code ?? '?')

      const deltaInfo: FreqDeltaInfo[] = [outboundGroup, inboundGroup]
        .filter((g): g is ResolvedDeltaGroup => !!g)
        .map(g => ({
          direction:    g.direction,
          localityName: g.deltaLocalityName,
          perLine:      g.lineIds.map(lineId => ({
            lineCode:      byLine.get(lineId)?.code ?? '?',
            offsetMinutes: g.offsetByLineId.get(lineId) ?? 0,
          })),
        }))

      groups.set(COMBINED_GROUP_KEY, {
        lineId:         COMBINED_GROUP_KEY,
        lineCode:       codes.join('+'),
        mode:           secondary.length > 0 ? 'both' : 'single',
        outbound:       primary,
        inbound:        secondary,
        outboundAbbrev: primaryAbbrev,
        inboundAbbrev:  secondaryAbbrev,
        deltaInfo,
      })
      lineOrder.unshift(COMBINED_GROUP_KEY)
    }
  }

  return { groups, segIndex, lineOrder }
}
