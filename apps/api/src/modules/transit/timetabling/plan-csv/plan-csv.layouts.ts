import type { DutyKind, DutySummary, PlanCsvFile } from '@nyx/schemas'

// CSV layouts of the plan export (Exportar Plano / Exportar Escala): M1 Detalhado — one row
// per event of the vehicle or duty, idle time included as its own rows — and M2 Resumo — one
// row per vehicle or duty with its operating windows as repeated column groups. Pure: the
// data comes in already resolved to names (plan-csv.loader.ts).

// ── input ────────────────────────────────────────────────────────────────────

export type BlockEventKind = 'TRIP' | 'ACCESS' | 'RETURN' | 'DISPLACEMENT' | 'INTERVAL'

export interface BlockEvent {
  kind:       BlockEventKind
  start:      number
  end:        number
  // locality names — null on intervals, which sit wherever the vehicle is
  from:       string | null
  to:         string | null
  line?:      string
  direction?: string
  km?:        number | null
  // interval type (INTERVAL)
  code?:      string
  name?:      string
}

export interface CsvBlock {
  id:          string
  blockNumber: number
  company:     string
  depot:       string
  vehicleType: string
  issues:      string[]
  events:      BlockEvent[]
}

export interface CsvPiece {
  blockId:    string | null
  start:      number
  end:        number
  from:       string
  to:         string
  // label of the stale reason — the piece no longer fits its block
  stale:      string | null
}

export type DutyActivityKind = 'SIGN_ON' | 'SIGN_OFF' | 'BREAK' | 'TRAVEL' | 'STANDBY'

export interface CsvActivity {
  type:  DutyActivityKind
  start: number
  end:   number
  from:  string | null
  to:    string | null
  // interval type (BREAK)
  code:  string | null
  name:  string | null
}

export interface CsvDuty {
  label:      string
  role:       string
  kind:       DutyKind
  kindLabel:  string
  company:    string
  summary:    DutySummary | null
  issues:     string[]
  pieces:     CsvPiece[]
  activities: CsvActivity[]
}

// ── formatting ───────────────────────────────────────────────────────────────

// HH:MM without wrapping past midnight (25:10) — sorts right and reads as [h]:mm in Excel
export function clock(m: number): string {
  return `${String(Math.floor(m / 60)).padStart(2, '0')}:${String(m % 60).padStart(2, '0')}`
}

const opt  = (m: number | null | undefined) => m == null ? '' : clock(m)
const km   = (v: number | null | undefined) => v == null ? '' : v.toFixed(1).replace('.', ',')
const list = (items: (string | number)[]) => [...new Set(items)].join('/')

const EVENT: Record<BlockEventKind, string> = {
  TRIP:         'VIAGEM',
  ACCESS:       'ACESSO',
  RETURN:       'RECOLHE',
  DISPLACEMENT: 'DESLOCAMENTO',
  INTERVAL:     'INTERVALO',
}

const ACTIVITY_EVENT: Record<DutyActivityKind, string> = {
  SIGN_ON:  'PEGADA',
  SIGN_OFF: 'LARGADA',
  BREAK:    'INTERVALO',
  TRAVEL:   'TRANSLADO',
  STANDBY:  'RESERVA',
}

// ── vehicle timeline ─────────────────────────────────────────────────────────

export interface TimelineRow {
  event:      string
  start:      number
  end:        number
  from:       string
  to:         string
  line:       string
  direction:  string
  km:         number | null
  obs:        string
  // the source event — null on the gaps (OCIOSO / GARAGEM)
  kind:       BlockEventKind | null
}

// The block's events in order, with the gaps between them as their own rows: GARAGEM after a
// RETURN (the vehicle is parked at the depot), OCIOSO anywhere else (standing at a terminal).
export function vehicleTimeline(block: CsvBlock): TimelineRow[] {
  const events = [...block.events].sort((a, b) => a.start - b.start || a.end - b.end)
  const rows: TimelineRow[] = []
  let place   = block.depot
  let prevEnd: number | null = null
  let prevKind: BlockEventKind | null = null

  for (const e of events) {
    if (prevEnd != null && e.start > prevEnd) {
      rows.push({
        event: prevKind === 'RETURN' ? 'GARAGEM' : 'OCIOSO',
        start: prevEnd, end: e.start, from: place, to: place,
        line: '', direction: '', km: null, obs: '', kind: null,
      })
    }
    rows.push({
      event:     EVENT[e.kind],
      start:     e.start,
      end:       e.end,
      from:      e.from ?? place,
      to:        e.to ?? place,
      line:      e.line ?? '',
      direction: e.direction ?? '',
      km:        e.km ?? null,
      obs:       e.name ?? '',
      kind:      e.kind,
    })
    place    = e.to ?? place
    prevEnd  = Math.max(prevEnd ?? e.end, e.end)
    prevKind = e.kind
  }
  return rows
}

// ── vehicle windows ──────────────────────────────────────────────────────────

export interface Window {
  // what separated it from the previous window — GAR (garage visit) or the interval type's
  // code; null on the first window
  stop:  string | null
  start: number
  end:   number
  lines: string[]
  trips: number
}

// Runs of trips cut at garage visits and at the vehicle's own intervals. A long stand at the
// terminal with no interval doesn't cut — it shows as idle time (and as LONG_STAND).
export function vehicleWindows(block: CsvBlock): Window[] {
  const events = [...block.events].sort((a, b) => a.start - b.start || a.end - b.end)
  const windows: Window[] = []
  let cut: string | null = null

  for (const e of events) {
    if (e.kind === 'RETURN') cut = 'GAR'
    else if (e.kind === 'INTERVAL') cut = cut === 'GAR' ? cut : e.code ?? 'INT'
    else if (e.kind === 'TRIP') {
      const cur = windows.at(-1)
      if (!cur || cut) windows.push({ stop: cur ? cut : null, start: e.start, end: e.end, lines: [], trips: 0 })
      const w = windows.at(-1)!
      w.end = Math.max(w.end, e.end)
      w.trips++
      if (e.line && !w.lines.includes(e.line)) w.lines.push(e.line)
      cut = null
    }
  }
  return windows
}

// ── crew coverage of a block ─────────────────────────────────────────────────

interface Coverage { duty: string; start: number; end: number; from: string }

function coverageByBlock(duties: CsvDuty[]): Map<string, Coverage[]> {
  const out = new Map<string, Coverage[]>()
  for (const d of duties) for (const p of d.pieces) {
    if (!p.blockId || p.stale) continue
    if (!out.has(p.blockId)) out.set(p.blockId, [])
    out.get(p.blockId)!.push({ duty: d.label, start: p.start, end: p.end, from: p.from })
  }
  for (const list of out.values()) list.sort((a, b) => a.start - b.start)
  return out
}

const covering = (cov: Coverage[], start: number, end: number) =>
  list(cov.filter(c => start === end ? c.start <= start && c.end >= end : c.start < end && c.end > start).map(c => c.duty))

// ── M1 / M2 — vehicles ───────────────────────────────────────────────────────

export function vehicleDetailed(blocks: CsvBlock[], duties: CsvDuty[]): Omit<PlanCsvFile, 'filename'> {
  const coverage = coverageByBlock(duties)
  const headers  = ['Carro', 'Seq', 'Evento', 'Início', 'Fim', 'Duração', 'Origem', 'Destino', 'Linha', 'Sentido', 'Km', 'Condutor', 'Obs']
  const rows: (string | number)[][] = []

  for (const b of blocks) {
    const cov = coverage.get(b.id) ?? []
    const timeline: TimelineRow[] = vehicleTimeline(b)

    // driver changes — instant rows where the next piece on the vehicle belongs to another duty
    for (let i = 1; i < cov.length; i++) {
      if (cov[i].duty === cov[i - 1].duty) continue
      timeline.push({
        event: 'TROCA_CONDUTOR', start: cov[i].start, end: cov[i].start, from: cov[i].from, to: cov[i].from,
        line: '', direction: '', km: null, obs: `${cov[i - 1].duty} → ${cov[i].duty}`, kind: null,
      })
    }
    // stable: an instant row goes after what ends at its time, before what starts at it
    timeline.sort((x, y) => x.start - y.start || Number(x.start !== x.end) - Number(y.start !== y.end))

    timeline.forEach((r, i) => rows.push([
      b.blockNumber, i + 1, r.event, clock(r.start), clock(r.end), clock(r.end - r.start),
      r.from, r.to, r.line, r.direction, km(r.km),
      r.event === 'TROCA_CONDUTOR' ? '' : covering(cov, r.start, r.end),
      r.obs,
    ]))
  }
  return { headers, rows }
}

export function vehicleSummary(blocks: CsvBlock[], duties: CsvDuty[]): Omit<PlanCsvFile, 'filename'> {
  const coverage = coverageByBlock(duties)
  const built = blocks.map(b => ({ b, timeline: vehicleTimeline(b), windows: vehicleWindows(b) }))
  const width = Math.max(0, ...built.map(x => x.windows.length))

  const headers = [
    'Carro', 'Empresa', 'Garagem', 'Tipo veículo', 'Perfil', 'Saída garagem', 'Chegada garagem', 'Jornada', 'Operação',
    'Viagens', 'Ocioso', 'Km total', 'Condutores', 'Pendências',
    ...Array.from({ length: width }, (_, i) => [
      ...(i > 0 ? [`J${i + 1} Parada`] : []),
      `J${i + 1} Início`, `J${i + 1} Fim`, `J${i + 1} Duração`, `J${i + 1} Linhas`, `J${i + 1} Viagens`,
    ]).flat(),
  ]

  const rows = built.map(({ b, timeline, windows }) => {
    const access  = b.events.filter(e => e.kind === 'ACCESS')
    const ret     = b.events.filter(e => e.kind === 'RETURN')
    const first   = timeline[0]?.start ?? null
    const last    = timeline.length ? Math.max(...timeline.map(r => r.end)) : null
    const out     = access.length ? Math.min(...access.map(e => e.start)) : first
    const back    = ret.length ? Math.max(...ret.map(e => e.end)) : last
    // a garage visit between two windows — the vehicle runs the peaks only
    const peak    = windows.some(w => w.stop === 'GAR')
    const kmTotal = b.events.reduce((s, e) => s + (e.km ?? 0), 0)

    const windowCells = windows.flatMap((w, i) => [
      ...(i > 0 ? [w.stop ?? ''] : []),
      clock(w.start), clock(w.end), clock(w.end - w.start), w.lines.join('/'), w.trips,
    ])
    const groupWidth = (i: number) => i > 0 ? 6 : 5
    const pad = Array.from({ length: width - windows.length }, (_, k) => groupWidth(windows.length + k)).reduce((s, n) => s + n, 0)

    return [
      b.blockNumber, b.company, b.depot, b.vehicleType, peak ? 'Pico' : 'Integral',
      opt(out), opt(back), out != null && back != null ? clock(back - out) : '',
      clock(windows.reduce((s, w) => s + w.end - w.start, 0)),
      windows.reduce((s, w) => s + w.trips, 0),
      clock(timeline.filter(r => r.event === 'OCIOSO').reduce((s, r) => s + r.end - r.start, 0)),
      km(kmTotal),
      list((coverage.get(b.id) ?? []).map(c => c.duty)),
      b.issues.join(' - '),
      ...windowCells,
      ...Array<string>(pad).fill(''),
    ]
  })
  return { headers, rows }
}

// ── duty helpers ─────────────────────────────────────────────────────────────

interface Span { start: number; end: number }

function subtract(from: Span, cuts: Span[]): Span[] {
  const out: Span[] = []
  let cursor = from.start
  for (const c of [...cuts].sort((a, b) => a.start - b.start)) {
    if (c.end <= cursor || c.start >= from.end) continue
    if (c.start > cursor) out.push({ start: cursor, end: c.start })
    cursor = Math.max(cursor, c.end)
  }
  if (cursor < from.end) out.push({ start: cursor, end: from.end })
  return out
}

const livePieces = (d: CsvDuty) => d.pieces.filter(p => !p.stale && p.blockId).sort((a, b) => a.start - b.start)

// In a split duty the longest gap between pieces is the split interval (crew-scoring.calc.ts);
// returns where it starts (the end of the piece before it)
function splitGapStart(duty: CsvDuty, spans: Span[]): number | null {
  if (duty.kind !== 'SPLIT') return null
  let best: Span | null = null
  for (let i = 1; i < spans.length; i++) {
    const gap = { start: spans[i - 1].end, end: spans[i].start }
    if (gap.end > gap.start && (!best || gap.end - gap.start > best.end - best.start)) best = gap
  }
  return best?.start ?? null
}

// ── M1 / M2 — duties ─────────────────────────────────────────────────────────

export function dutyDetailed(duties: CsvDuty[], blocks: CsvBlock[]): Omit<PlanCsvFile, 'filename'> {
  const blockById = new Map(blocks.map(b => [b.id, { b, timeline: vehicleTimeline(b) }]))
  const headers   = ['Tabela', 'Seq', 'Evento', 'Início', 'Fim', 'Duração', 'Origem', 'Destino', 'Carro', 'Linha', 'Sentido', 'Km', 'Obs']
  const rows: (string | number)[][] = []

  for (const d of duties) {
    type Row = { event: string; start: number; end: number; from: string; to: string; carro: string | number; line: string; direction: string; km: number | null; obs: string }
    const out: Row[] = []
    const live = livePieces(d)

    // the vehicle's events inside each piece, clipped to it (a mid-trip relief cuts the trip)
    for (const p of d.pieces) {
      const block = p.blockId ? blockById.get(p.blockId) : undefined
      if (p.stale || !block) {
        out.push({ event: 'PEDAÇO', start: p.start, end: p.end, from: p.from, to: p.to, carro: block?.b.blockNumber ?? '', line: '', direction: '', km: null, obs: p.stale ?? '' })
        continue
      }
      for (const r of block.timeline) {
        if (!(r.start < p.end && r.end > p.start)) continue
        const start   = Math.max(r.start, p.start)
        const end     = Math.min(r.end, p.end)
        const partial = start !== r.start || end !== r.end
        out.push({
          event: r.event, start, end,
          from:  start === r.start ? r.from : p.from,
          to:    end === r.end ? r.to : p.to,
          carro: block.b.blockNumber, line: r.line, direction: r.direction,
          km:    r.km != null && partial ? r.km * (end - start) / (r.end - r.start) : r.km,
          obs:   [r.obs, partial ? 'parcial' : ''].filter(Boolean).join(' - '),
        })
      }
    }

    for (const a of d.activities) {
      out.push({ event: ACTIVITY_EVENT[a.type], start: a.start, end: a.end, from: a.from ?? '', to: a.to ?? '', carro: '', line: '', direction: '', km: null, obs: a.name ?? '' })
    }

    // implicit sign-on / sign-off (settings minutes) when there's no explicit activity
    const signOn  = d.summary?.startMinutes
    const signOff = d.summary?.endMinutes
    if (live.length && signOn != null && signOn < live[0].start && !d.activities.some(a => a.type === 'SIGN_ON')) {
      out.push({ event: 'PEGADA', start: signOn, end: live[0].start, from: live[0].from, to: live[0].from, carro: '', line: '', direction: '', km: null, obs: '' })
    }
    if (live.length && signOff != null && signOff > live.at(-1)!.end && !d.activities.some(a => a.type === 'SIGN_OFF')) {
      out.push({ event: 'LARGADA', start: live.at(-1)!.end, end: signOff, from: live.at(-1)!.to, to: live.at(-1)!.to, carro: '', line: '', direction: '', km: null, obs: '' })
    }

    // what's left between pieces: the split interval, or time at the employer's disposal
    const splitAt = splitGapStart(d, live)
    const busy    = [...live, ...d.activities]
    for (let i = 1; i < live.length; i++) {
      const prev = live[i - 1], next = live[i]
      for (const gap of subtract({ start: prev.end, end: next.start }, busy)) {
        const isSplit = splitAt === prev.end
        out.push({
          event: isSplit ? 'INTERVALO_DUPLA' : 'OCIOSO', start: gap.start, end: gap.end,
          from: prev.to, to: next.from, carro: '', line: '', direction: '', km: null,
          obs: !isSplit && prev.blockId !== next.blockId ? 'troca de carro' : '',
        })
      }
    }

    out.sort((x, y) => x.start - y.start || x.end - y.end)
    out.forEach((r, i) => rows.push([
      d.label, i + 1, r.event, clock(r.start), clock(r.end), clock(r.end - r.start),
      r.from, r.to, r.carro, r.line, r.direction, km(r.km), r.obs,
    ]))
  }
  return { headers, rows }
}

interface DutyWindow { stop: string | null; start: number; end: number; carros: number[]; lines: string[] }

// Work runs cut at breaks and at the split interval — a vehicle or line change doesn't cut,
// the crew member keeps working.
export function dutyWindows(duty: CsvDuty, blocks: Map<string, CsvBlock>): DutyWindow[] {
  const breaks = duty.activities.filter(a => a.type === 'BREAK')
  const live   = livePieces(duty)
  const spans  = live.flatMap(p => subtract(p, breaks).map(s => ({ ...s, blockId: p.blockId! })))
  const splitAt = splitGapStart(duty, live)

  const windows: DutyWindow[] = []
  for (const s of spans) {
    const cur = windows.at(-1)
    const brk = cur && breaks.find(b => b.start < s.start && b.end > cur.end)
    const stop = !cur ? null : brk ? brk.code ?? 'INT' : splitAt === cur.end ? 'DUPLA' : null
    if (!cur || stop) windows.push({ stop, start: s.start, end: s.end, carros: [], lines: [] })
    const w = windows.at(-1)!
    w.end = Math.max(w.end, s.end)
    const block = blocks.get(s.blockId)
    if (!block) continue
    if (!w.carros.includes(block.blockNumber)) w.carros.push(block.blockNumber)
    for (const e of block.events) {
      if (e.kind === 'TRIP' && e.line && e.start < s.end && e.end > s.start && !w.lines.includes(e.line)) w.lines.push(e.line)
    }
  }
  return windows
}

const MEAL_FORM: Record<NonNullable<DutySummary['mealForm']>, string> = { CONTINUOUS: 'Contínua', FRACTIONED: 'Fracionada' }

// Time without work. Paid: the stops (vehicle standing within the pieces, idle gaps between
// them) + paid breaks. Unpaid: the other breaks + the split interval. Null on a summary
// written before paidBreakMinutes/splitMinutes existed — the crew plan screen recalculates on open.
function inactivity(s: DutySummary | null, kind: 'paid' | 'unpaid'): number | null {
  if (!s || s.paidBreakMinutes == null || s.splitMinutes == null) return null
  return kind === 'paid'
    ? (s.stopMinutes ?? 0) + s.paidBreakMinutes
    : s.breakMinutes - s.paidBreakMinutes + s.splitMinutes
}

export function dutySummary(duties: CsvDuty[], blocks: CsvBlock[]): Omit<PlanCsvFile, 'filename'> {
  const blockById = new Map(blocks.map(b => [b.id, b]))
  const built = duties.map(d => ({ d, windows: dutyWindows(d, blockById) }))
  const width = Math.max(0, ...built.map(x => x.windows.length))

  const headers = [
    'Tabela', 'Função', 'Tipo', 'Empresa', 'Pegada', 'Local pegada', 'Largada', 'Local largada', 'Jornada', 'Trabalhada',
    'Paga', 'Hora extra', 'Noturno', 'Inatividade remunerada', 'Inatividade não remunerada', 'Intrajornada',
    'Trocas de carro', 'Trocas de linha', 'Pendências',
    ...Array.from({ length: width }, (_, i) => [
      ...(i > 0 ? [`J${i + 1} Parada`] : []),
      `J${i + 1} Início`, `J${i + 1} Fim`, `J${i + 1} Carros`, `J${i + 1} Linhas`,
    ]).flat(),
  ]

  const rows = built.map(({ d, windows }) => {
    const s    = d.summary
    const live = livePieces(d)
    const windowCells = windows.flatMap((w, i) => [
      ...(i > 0 ? [w.stop ?? ''] : []),
      clock(w.start), clock(w.end), w.carros.join('/'), w.lines.join('/'),
    ])
    const pad = Array.from({ length: width - windows.length }, (_, k) => windows.length + k > 0 ? 5 : 4).reduce((a, n) => a + n, 0)
    return [
      d.label, d.role, d.kindLabel, d.company,
      opt(s?.startMinutes), live[0]?.from ?? '', opt(s?.endMinutes), live.at(-1)?.to ?? '',
      opt(s?.spreadMinutes), opt(s?.workMinutes), opt(s?.paidMinutes), opt(s?.overtimeMinutes), opt(s?.nightMinutes),
      opt(inactivity(s, 'paid')), opt(inactivity(s, 'unpaid')), s?.mealForm ? MEAL_FORM[s.mealForm] : '',
      s?.vehicleChanges ?? '', s?.lineChanges ?? '',
      d.issues.join(' - '),
      ...windowCells,
      ...Array<string>(pad).fill(''),
    ]
  })
  return { headers, rows }
}
