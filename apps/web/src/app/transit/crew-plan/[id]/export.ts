import { formatDutyNumber } from '@nyx/schemas'
import { downloadCsvRows } from '@/lib/csv'
import type { CrewBoardData, BoardBlock, BoardDuty, BoardPiece } from './board.types'
import { fmtTime, subtract, ROLE_LABEL, KIND_LABEL, ISSUE_LABEL } from './board.types'

// CSV export, one row per duty / vehicle. Each row lists its segments as numbered
// linhas_N;inicio_N;fim_N groups, padded to the widest row.

interface Segment { startMinutes: number; endMinutes: number; lines: string[] }

const SEP = '-'

function segmentColumns(rows: Segment[][]): string[] {
  const max = Math.max(0, ...rows.map(r => r.length))
  return Array.from({ length: max }, (_, i) => [`linhas_${i + 1}`, `inicio_${i + 1}`, `fim_${i + 1}`]).flat()
}

function segmentCells(segments: Segment[], width: number): string[] {
  const cells = segments.flatMap(s => [s.lines.join(SEP), fmtTime(s.startMinutes), fmtTime(s.endMinutes)])
  return [...cells, ...Array<string>(width - cells.length).fill('')]
}

function distinctLines(block: BoardBlock | undefined, from: number, to: number): string[] {
  if (!block) return []
  const trips = block.trips.filter(t => t.departureMinutes < to && t.arrivalMinutes > from)
  return [...new Set(trips.sort((a, b) => a.departureMinutes - b.departureMinutes).map(t => t.lineCode))]
}

// Cuts at unpaid breaks, at vehicle changes and at gaps between pieces no activity covers.
function dutySegments(duty: BoardDuty, blockById: Map<string, BoardBlock>): Segment[] {
  const unpaid = duty.activities.filter(a => a.type === 'BREAK' && !a.isPaidBreak)
  const fillers = duty.activities.filter(a => !(a.type === 'BREAK' && !a.isPaidBreak))
  const pieces = duty.pieces.filter(p => !p.isStale).sort((a, b) => a.startMinutes - b.startMinutes)

  const spans = pieces.flatMap(p => subtract(p, unpaid).map(s => ({ ...s, piece: p })))
  const groups: { startMinutes: number; endMinutes: number; piece: BoardPiece }[] = []
  for (const s of spans) {
    const cur = groups.at(-1)
    const joins = cur
      && cur.piece !== s.piece
      && cur.piece.vehicleBlockId === s.piece.vehicleBlockId
      && (s.startMinutes <= cur.endMinutes
        || subtract({ startMinutes: cur.endMinutes, endMinutes: s.startMinutes }, fillers).length === 0)
    if (cur && joins) { cur.endMinutes = s.endMinutes; cur.piece = s.piece }
    else groups.push({ ...s })
  }
  return groups.map(g => ({
    startMinutes: g.startMinutes,
    endMinutes:   g.endMinutes,
    lines:        distinctLines(g.piece.vehicleBlockId ? blockById.get(g.piece.vehicleBlockId) : undefined, g.startMinutes, g.endMinutes),
  }))
}

// Trips and deadruns, cut at the vehicle's own intervals.
function blockSegments(block: BoardBlock): Segment[] {
  const items = [
    ...block.trips.map(t => ({ start: t.departureMinutes, end: t.arrivalMinutes, line: t.lineCode as string | null })),
    ...block.deadruns.map(d => ({ start: d.departureMinutes, end: d.arrivalMinutes, line: null })),
  ].sort((a, b) => a.start - b.start)

  const segments: Segment[] = []
  for (const it of items) {
    const cur = segments.at(-1)
    const cut = !cur || block.intervals.some(i => i.departureMinutes >= cur.endMinutes && i.departureMinutes < it.start)
    if (cut) segments.push({ startMinutes: it.start, endMinutes: it.end, lines: [] })
    const seg = segments.at(-1)!
    seg.endMinutes = Math.max(seg.endMinutes, it.end)
    if (it.line && !seg.lines.includes(it.line)) seg.lines.push(it.line)
  }
  return segments
}

function filename(data: CrewBoardData, suffix: string) {
  return [data.vehiclePlan.scopeName, data.vehiclePlan.dayTypeName, data.plan.description, suffix].filter(Boolean).join('-')
}

export function exportDutiesCsv(data: CrewBoardData, duties: BoardDuty[], blockById: Map<string, BoardBlock>) {
  const branchAbbr = new Map(data.operators.map(o => [o.branchId, o.abbr]))
  const { signOnMinutes, signOffMinutes } = data.plan

  const rows = duties.map(duty => {
    const segments = dutySegments(duty, blockById)
    const signOn   = duty.activities.find(a => a.type === 'SIGN_ON')?.startMinutes
      ?? (segments.length ? segments[0].startMinutes - signOnMinutes : null)
    const signOff  = duty.activities.filter(a => a.type === 'SIGN_OFF').at(-1)?.endMinutes
      ?? (segments.length ? segments.at(-1)!.endMinutes + signOffMinutes : null)
    // the first segment opens at sign-on, the last closes at sign-off
    if (segments.length && signOn != null)  segments[0].startMinutes = Math.min(segments[0].startMinutes, signOn)
    if (segments.length && signOff != null) segments.at(-1)!.endMinutes = Math.max(segments.at(-1)!.endMinutes, signOff)
    return { duty, segments, signOn, signOff }
  })

  const segCols = segmentColumns(rows.map(r => r.segments))
  const headers = ['jornada', 'status', 'papel', 'tipo', 'operador', 'trabalhado', 'pago', 'extra', 'noturno', 'pendencias', 'apresentacao', 'encerramento', 'interjornada', ...segCols]

  downloadCsvRows(headers, rows.map(({ duty: d, segments, signOn, signOff }) => [
    formatDutyNumber(d.role, d.dutyNumber),
    d.isStale ? 'STALE' : 'OK',
    ROLE_LABEL[d.role],
    KIND_LABEL[d.kind],
    d.branchId ? branchAbbr.get(d.branchId) ?? '' : '',
    d.summary ? fmtTime(d.summary.workMinutes) : '',
    d.summary ? fmtTime(d.summary.paidMinutes) : '',
    d.summary ? fmtTime(d.summary.overtimeMinutes) : '',
    d.summary ? fmtTime(d.summary.nightMinutes) : '',
    [...new Set(d.issues.map(i => ISSUE_LABEL[i.code]))].join(` ${SEP} `),
    signOn != null ? fmtTime(signOn) : '',
    signOff != null ? fmtTime(signOff) : '',
    // rough estimate: the same duty worked again the next day
    data.vehiclePlan.repeatsNextDay && signOn != null && signOff != null ? fmtTime(signOn + 1440 - signOff) : '',
    ...segmentCells(segments, segCols.length),
  ]), filename(data, 'jornadas'))
}

export function exportBlocksCsv(data: CrewBoardData, blocks: BoardBlock[]) {
  const branchAbbr = new Map(data.operators.map(o => [o.branchId, o.abbr]))

  const uncoveredByBlock = new Map<string, number>()
  for (const u of data.plan.summary?.uncovered ?? []) {
    uncoveredByBlock.set(u.vehicleBlockId, (uncoveredByBlock.get(u.vehicleBlockId) ?? 0) + u.endMinutes - u.startMinutes)
  }
  const piecesByBlock = new Map<string, { duty: BoardDuty; piece: BoardPiece }[]>()
  for (const duty of data.duties) {
    for (const piece of duty.pieces) {
      if (!piece.vehicleBlockId) continue
      if (!piecesByBlock.has(piece.vehicleBlockId)) piecesByBlock.set(piece.vehicleBlockId, [])
      piecesByBlock.get(piece.vehicleBlockId)!.push({ duty, piece })
    }
  }

  const rows = blocks.map(block => ({ block, segments: blockSegments(block) }))
  const segCols = segmentColumns(rows.map(r => r.segments))
  const headers = ['carro', 'status', 'operador', 'jornadas', 'sem_motorista', 'ocioso', ...segCols]

  downloadCsvRows(headers, rows.map(({ block: b, segments }) => {
    const items = piecesByBlock.get(b.id) ?? []
    const live  = items.filter(i => !i.piece.isStale).sort((x, y) => x.piece.startMinutes - y.piece.startMinutes)
    return [
      b.blockNumber,
      items.some(i => i.piece.isStale) ? 'STALE' : 'OK',
      b.branchId ? branchAbbr.get(b.branchId) ?? '' : '',
      [...new Set(live.map(i => formatDutyNumber(i.duty.role, i.duty.dutyNumber)))].join(SEP),
      fmtTime(uncoveredByBlock.get(b.id) ?? 0),
      // parked between segments (the vehicle's own intervals)
      fmtTime(segments.slice(1).reduce((sum, s, i) => sum + s.startMinutes - segments[i].endMinutes, 0)),
      ...segmentCells(segments, segCols.length),
    ]
  }), filename(data, 'carros'))
}
