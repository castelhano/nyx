import fs from 'fs'
import path from 'path'
import ExcelJS from 'exceljs'
import { PrismaService } from '../../../../../prisma/prisma.service'
import type { OsoAssembled, OsoCarro, OsoTripEvent } from './oso-assembler'
import type { OsoBand } from './oso-banding'
import type { OsoCarroLayout, OsoColumn } from './oso-layout.resolver'
import type { OsoSummary } from './oso-summary'
import type { OsoObservations } from './oso-observations'
import type { TripMarking, TripMarkingFontStyle, TripMarkingBgColor } from '@nyx/schemas'

// Layer 6 of the OSO export pipeline (docs/proposal/plan_oso_export_v1.md) — the only layer
// that touches exceljs. Structure reverse-engineered from the real legacy workbook (sheet
// "250" of OSOs_U.xlsx): fixed A1:U print area (col A = row ordinal, B:U = 20 data columns
// shared by every carro slot regardless of how many are actually used), a 23-row block per
// band (20 trip rows + E/V/H), a fixed-position RESUMO block (18 rows, 2-operator template —
// the legacy sheet itself has no 3rd operator row, so a 3rd+ operator would need a template
// change, not just more data) starting right after the last band, and signatures 5 rows below
// that. Column/row positions below are literal offsets from that reference sheet, not
// estimates — cross-checked to land on rows 30 (RESUMO) and 53 (signatures) for a single-band
// line, matching the real file exactly.
//
// Deliberate simplification vs. the legacy file: grid cells use a uniform thin border instead
// of replicating its medium/hair transitions cell-by-cell — that level of fidelity has to be
// tuned against a printed side-by-side comparison (Fase 2 of the plan doc), not guessed here.

export interface OsoScopeConfig {
  name:       string
  logoUrl?:   string | null
  organName?: string
  signatures: { role: string; name: string }[]
}

export interface RenderOsoSheetInput {
  lineCode:      string
  lineName:      string
  assembled:     OsoAssembled
  layouts:       Map<string, OsoCarroLayout>
  bands:         OsoBand[]
  summary:       OsoSummary
  observations:  OsoObservations
  scope:         OsoScopeConfig
}

const FONT_NAME    = 'Arial'
const TAN_FILL: ExcelJS.Fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FFDDD9C3' } }
// the real workbook highlights these via conditional formatting (cellIs "RECO"/"INTERV") on
// B7:U26 — same visual result applied as a static style instead, since we already know which
// cells hold which literal value at generation time (colors read straight from its dxf rules)
const RECO_FILL:   ExcelJS.Fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FFFFFF00' } }
const INTERV_FILL: ExcelJS.Fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FFFFCC66' } }

// Trip markings palette (docs/proposal/plan_trip_markings_v1.md, regra 5) — fechada, 6
// cores, deliberadamente fora da família amarelo/laranja/bege de RECO_FILL/INTERV_FILL/
// TAN_FILL acima. Hex exatos (tons pastel, legíveis em xerox P&B) a validar visualmente
// contra a grade real na Fase 2 — placeholders até lá.
const BG_COLOR_FILLS: Record<TripMarkingBgColor, ExcelJS.Fill> = {
  AZUL:     { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FFBDD7EE' } },
  VERDE:    { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FFC6E0B4' } },
  ROSA:     { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FFF4B6C2' } },
  ROXO:     { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FFD9C2EC' } },
  CINZA:    { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FFD9D9D9' } },
  VERMELHO: { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FFF2A5A0' } },
}

function markingFontOpts(fontStyle?: TripMarkingFontStyle): Partial<ExcelJS.Font> {
  switch (fontStyle) {
    case 'BOLD':          return { bold: true }
    case 'ITALIC':        return { italic: true }
    case 'BOLD_ITALIC':   return { bold: true, italic: true }
    case 'UNDERLINE':     return { underline: true }
    case 'STRIKETHROUGH': return { strike: true }
    default:              return {}
  }
}

// regra 4 (plan_trip_markings_v1.md) — a marcação é um array de entradas, cada uma podendo
// definir os canais fontStyle/bgColor independentemente; um conflito só existe entre duas
// entradas que reivindicam o MESMO canal, resolvido pela primeira que o define na lista
function resolveMarkingStyle(markings?: TripMarking[]): { fontStyle?: TripMarkingFontStyle; bgColor?: TripMarkingBgColor } {
  let fontStyle: TripMarkingFontStyle | undefined
  let bgColor:   TripMarkingBgColor   | undefined
  for (const m of markings ?? []) {
    if (fontStyle === undefined && m.fontStyle) fontStyle = m.fontStyle
    if (bgColor   === undefined && m.bgColor)   bgColor   = m.bgColor
  }
  return { fontStyle, bgColor }
}

const MEDIUM = { style: 'medium' as const }
const THIN   = { style: 'thin' as const }
const HAIR   = { style: 'hair' as const }
const BOX    = { top: MEDIUM, bottom: MEDIUM, left: MEDIUM, right: MEDIUM }

const FIRST_DATA_COL   = 2  // column B
const LAST_DATA_COL    = 21 // column U — fixed page width regardless of how many carros are used
const GRID_ROWS        = 20 // rows 7..26 — trip rows per band (rule 4's MAX_ROWS_PER_BAND)
const BAND_BLOCK_ROWS  = 23 // grid (20) + E/V/H (3)
const HEADER_ROWS      = 6
const RESUMO_ROWS      = 18
const SIGNATURE_GAP    = 2

function timeOfDay(minutes: number): number {
  return ((minutes % 1440) + 1440) % 1440 / 1440
}

function duration(minutes: number): number {
  return minutes / 1440
}

const CM_TO_PX = 96 / 2.54
const PT_TO_PX = 96 / 72
const MDW      = 7 // Excel's default-font "maximum digit width", used to turn a column's
                    // character-unit width into pixels regardless of that cell's own font

function colWidthPx(chars: number): number {
  return Math.floor(((256 * chars + Math.floor(128 / MDW)) / 256) * MDW)
}

// converts an absolute cm position (measured from the sheet's own top-left corner, i.e. what
// LibreOffice/Excel's "Posição e tamanho" dialog shows in the normal view — not the print
// margin) into a fractional column/row anchor, by walking the same column widths/row heights
// this sheet actually sets. Used for placing the logo image, since ExcelJS anchors images to
// a (possibly fractional) cell position, not an absolute page coordinate.
function cmToFractionalIndex(cm: number, sizesPx: number[]): number {
  const targetPx = cm * CM_TO_PX
  let acc = 0
  for (let i = 0; i < sizesPx.length; i++) {
    if (targetPx < acc + sizesPx[i]) return i + (targetPx - acc) / sizesPx[i]
    acc += sizesPx[i]
  }
  return sizesPx.length
}

function baseFont(opts: Partial<ExcelJS.Font> = {}): Partial<ExcelJS.Font> {
  return { name: FONT_NAME, size: 10, color: { theme: 1 }, ...opts }
}

function setCell(
  ws: ExcelJS.Worksheet,
  addr: string,
  value: ExcelJS.CellValue,
  opts: {
    font?:      Partial<ExcelJS.Font>
    align?:     Partial<ExcelJS.Alignment>
    fill?:      ExcelJS.Fill
    border?:    Partial<ExcelJS.Borders>
    numFmt?:    string
    merge?:     string
  } = {},
) {
  if (opts.merge) ws.mergeCells(opts.merge)
  const cell = ws.getCell(addr)
  cell.value = value
  cell.font = baseFont(opts.font)
  cell.alignment = { horizontal: 'center', vertical: 'bottom', ...opts.align }
  if (opts.fill) cell.fill = opts.fill
  // ExcelJS aliases every cell inside a merge to ONE shared style object — writing a border
  // to any cell in the range (master or not) overwrites it for the whole merge, so a border
  // must be set once, on the anchor, with every edge it needs already included
  if (opts.border) cell.border = opts.border
  if (opts.numFmt) cell.numFmt = opts.numFmt
  return cell
}

// column label = the locality's short code when it has one, matching the printed grid
// ("AMBEV", "CENTRO") — same abbr-first fallback already used for operatorLabel (oso-assembler)
async function loadColumnLabels(
  prisma:  PrismaService,
  layouts: Map<string, OsoCarroLayout>,
): Promise<Map<string, string>> {
  const db = prisma as any
  const referencedIds = new Set<string>()
  for (const layout of layouts.values()) for (const c of layout.columns) referencedIds.add(c.routeLocalityId)
  if (referencedIds.size === 0) return new Map()

  const rows = await db.routeLocality.findMany({
    where:  { id: { in: [...referencedIds] } },
    select: { id: true, localityId: true },
  })
  const localityIds = [...new Set(rows.map((r: any) => r.localityId).filter(Boolean))]
  const localities = await db.transitLocality.findMany({
    where:  { id: { in: localityIds } },
    select: { id: true, name: true, abbr: true },
  })
  const localityLabel = new Map(localities.map((l: any) => [l.id, l.abbr || l.name]))

  return new Map(rows.map((r: any) => [r.id, r.localityId ? (localityLabel.get(r.localityId) ?? '') : '']))
}

// rule 2 — a mid column's time is derived, never stored: minutes from that stop to the
// route's own destination, walking backward through deltaMinutes (TravelTimeMatrix fallback
// for legs missing it), subtracted from the trip's real arrivalMinutes
async function loadMinutesBeforeDestination(
  prisma:  PrismaService,
  layouts: Map<string, OsoCarroLayout>,
): Promise<Map<string, number>> {
  const db = prisma as any
  const midIds = new Set<string>()
  for (const layout of layouts.values()) {
    for (const c of layout.columns) if (!c.timing) midIds.add(c.routeLocalityId)
  }
  if (midIds.size === 0) return new Map()

  const referenced = await db.routeLocality.findMany({
    where:  { id: { in: [...midIds] } },
    select: { routeId: true },
  })
  const routeIds = [...new Set(referenced.map((r: any) => r.routeId))]

  const rows = await db.routeLocality.findMany({
    where:   { routeId: { in: routeIds } },
    orderBy: { sequence: 'asc' },
    select:  { id: true, routeId: true, localityId: true, deltaMinutes: true },
  })
  const byRoute = new Map<string, typeof rows>()
  for (const r of rows) {
    if (!byRoute.has(r.routeId)) byRoute.set(r.routeId, [])
    byRoute.get(r.routeId)!.push(r)
  }

  const missingLegs: { from: string; to: string }[] = []
  for (const list of byRoute.values()) {
    for (let i = 1; i < list.length; i++) {
      if (list[i].deltaMinutes == null && list[i - 1].localityId && list[i].localityId) {
        missingLegs.push({ from: list[i - 1].localityId, to: list[i].localityId })
      }
    }
  }
  const matrix = missingLegs.length > 0
    ? await db.travelTimeMatrix.findMany({
        where:  { OR: missingLegs.map(l => ({ originId: l.from, destinationId: l.to })) },
        select: { originId: true, destinationId: true, baseMinutes: true },
      })
    : []
  const matrixMinutes = new Map<string, number>(matrix.map((m: any) => [`${m.originId}:${m.destinationId}`, m.baseMinutes]))

  const minutesBeforeDestination = new Map<string, number>()
  for (const list of byRoute.values()) {
    let acc = 0
    minutesBeforeDestination.set(list[list.length - 1].id, 0)
    for (let i = list.length - 1; i > 0; i--) {
      const delta = list[i].deltaMinutes ?? matrixMinutes.get(`${list[i - 1].localityId}:${list[i].localityId}`) ?? 0
      acc += delta
      minutesBeforeDestination.set(list[i - 1].id, acc)
    }
  }
  return minutesBeforeDestination
}

function columnValue(col: OsoColumn, e: OsoTripEvent, minutesBeforeDestination: Map<string, number>): number {
  if (col.timing === 'DEPARTURE') return e.departureMinutes
  if (col.timing === 'ARRIVAL') return e.arrivalMinutes
  return e.arrivalMinutes - (minutesBeforeDestination.get(col.routeLocalityId) ?? 0)
}

interface SlotValue {
  minutes:    number
  fontStyle?: TripMarkingFontStyle
  bgColor?:   TripMarkingBgColor
}
type Slot = SlotValue | 'RECO' | 'INTERV' | null

function tripSlot(col: OsoColumn, e: OsoTripEvent, minutesBeforeDestination: Map<string, number>): SlotValue {
  return { minutes: columnValue(col, e, minutesBeforeDestination), ...resolveMarkingStyle(e.markings) }
}

// one row = one full cycle: the carro's own chronological event stream is walked and paired
// ida-then-volta into a row; a RECO/INTERV/DISPLACEMENT that interrupts a pending ida gets its
// own two rows instead — see the pending-branch comment below for why
function buildCarroRows(
  carro:                     OsoCarro,
  layout:                    OsoCarroLayout,
  minutesBeforeDestination:  Map<string, number>,
): Slot[][] {
  const directions = [...new Set(layout.columns.map(c => c.direction))]
  const rows: Slot[][] = []

  if (directions.length <= 1) {
    // CIRCULAR — no pairing, every trip/RECO/INTERV/DISPLACEMENT is its own row
    for (const e of carro.events) {
      const row: Slot[] = new Array(layout.columns.length).fill(null)
      if (e.kind === 'trip') {
        layout.columns.forEach((col, i) => { row[i] = tripSlot(col, e, minutesBeforeDestination) })
      } else if (e.kind === 'interval') {
        row[0] = 'INTERV'
      } else if (e.type === 'DISPLACEMENT') {
        row[0] = { minutes: e.departureMinutes, ...resolveMarkingStyle(e.markings) }
      } else {
        row[0] = 'RECO'
      }
      rows.push(row)
    }
    return rows
  }

  const [firstDir, secondDir] = directions
  const firstCols  = layout.columns.filter(c => c.direction === firstDir)
  const secondCols = layout.columns.filter(c => c.direction === secondDir)
  const G = layout.columns.length

  let cur: Slot[] = new Array(G).fill(null)
  let pending = false
  // last productive trip's arrival, tracked so a RECO/INTERV/DISPLACEMENT always has
  // something to report besides its own label/value
  let lastArrival: number | null = null

  const flush = () => { rows.push(cur); cur = new Array(G).fill(null); pending = false }

  for (const e of carro.events) {
    if (e.kind === 'trip' && e.direction === firstDir) {
      if (pending) flush()
      firstCols.forEach((col, i) => { cur[i] = tripSlot(col, e, minutesBeforeDestination) })
      pending = true
      lastArrival = e.arrivalMinutes
    } else if (e.kind === 'trip' && e.direction === secondDir) {
      secondCols.forEach((col, i) => { cur[firstCols.length + i] = tripSlot(col, e, minutesBeforeDestination) })
      lastArrival = e.arrivalMinutes
      flush()
    } else if (e.kind === 'deadrun' || e.kind === 'interval') {
      const slot: Slot = e.kind === 'interval'
        ? 'INTERV'
        : e.type === 'DISPLACEMENT'
          ? { minutes: e.departureMinutes, ...resolveMarkingStyle(e.markings) }
          : 'RECO'
      if (pending) {
        // a lone ida with no matching volta: the trip must still run to completion before the
        // vehicle garages, so its own arrival goes in the volta slot of THIS row (self-paired,
        // showing the trip's full departure->arrival) — RECO/INTERV/DISPLACEMENT then gets an
        // entirely separate row of its own, rather than overwriting that arrival with its own
        // slot. Confirmed against a real counter-example (line 250's 2nd carro): there, the
        // day's last cycle is a normal COMPLETE ida+volta pair, whose departure already has
        // its own row — nothing left to repeat, so THAT case reports the volta's arrival +
        // RECO together on one row instead (the else branch below), with no second row needed
        if (lastArrival !== null) cur[firstCols.length] = { minutes: lastArrival }
        flush()
        cur[firstCols.length] = slot
        flush()
      } else {
        if (lastArrival !== null) cur[firstCols.length - 1] = { minutes: lastArrival }
        cur[firstCols.length] = slot
        flush()
      }
    }
  }
  if (cur.some(v => v !== null)) rows.push(cur)

  return rows
}

function colLetter(n: number): string {
  let s = ''
  while (n > 0) { const m = (n - 1) % 26; s = String.fromCharCode(65 + m) + s; n = Math.floor((n - m) / 26) }
  return s
}
function addr(col: number, row: number): string { return `${colLetter(col)}${row}` }
function rangeAddr(c1: number, r1: number, c2: number, r2: number): string { return `${addr(c1, r1)}:${addr(c2, r2)}` }

async function renderOsoSheet(
  ws:     ExcelJS.Worksheet,
  input:  RenderOsoSheetInput,
  labelByRouteLocalityId:   Map<string, string>,
  minutesBeforeDestination: Map<string, number>,
): Promise<void> {
  const { lineCode, lineName, assembled, layouts, bands, summary, observations, scope } = input
  const resumoStart   = HEADER_ROWS + 1 + bands.length * BAND_BLOCK_ROWS
  const lastResumoRow = resumoStart + RESUMO_ROWS - 1

  const CM_TO_IN = 1 / 2.54
  ws.pageSetup = {
    orientation: 'landscape', paperSize: 9, fitToPage: true, scale: 100,
    fitToWidth: 1, fitToHeight: 1, showGridLines: false, showRowColHeaders: false,
    margins: { left: 0.5 * CM_TO_IN, right: 0.5 * CM_TO_IN, top: 1 * CM_TO_IN, bottom: 0.5 * CM_TO_IN, header: 0.2, footer: 0.2 },
  }
  ws.views = [{ showGridLines: false }]
  ws.properties.defaultRowHeight = 12.75 // 0.45cm, the reference file's row height everywhere but rows 1 and 4
  ws.getRow(1).height = 13.61 // 0.48cm
  ws.getRow(4).height = 15.87 // 0.56cm
  ws.getColumn(1).width = 3.67
  for (let c = FIRST_DATA_COL; c <= LAST_DATA_COL; c++) ws.getColumn(c).width = 9.11

  // outer perimeter of the whole printed area (A1:U<last RESUMO row>) closed first, as a base
  // layer everything else draws on top of — otherwise any cell no other pass happens to touch
  // (e.g. row 1's title overflow columns, or the RESUMO's unused right-hand columns) has no
  // border at all, leaving gaps in what should read as one closed rectangle
  for (let r = 1; r <= lastResumoRow; r++) {
    for (let c = 1; c <= LAST_DATA_COL; c++) {
      const cell = ws.getCell(addr(c, r))
      cell.font = baseFont()
      const border: Partial<ExcelJS.Borders> = {}
      if (r === 1) border.top = MEDIUM
      if (r === lastResumoRow) border.bottom = MEDIUM
      if (c === 1) border.left = MEDIUM
      if (c === LAST_DATA_COL) border.right = MEDIUM
      if (border.top || border.bottom || border.left || border.right) cell.border = border
    }
  }

  // --- header (rows 1-6, fixed regardless of carro count) ---
  setCell(ws, 'A1', 'ORDEM DE SERVIÇO OPERACIONAL DE TRANSPORTE COLETIVO MUNICIPAL',
    { font: baseFont({ bold: true, size: 11 }), align: { horizontal: 'left' }, border: { left: MEDIUM, top: MEDIUM } })
  const operatorNames = [...new Set(assembled.carros.map(c => c.operatorFullName ?? c.operatorLabel).filter((v): v is string => Boolean(v)))]
  setCell(ws, 'A2', {
    richText: [
      { font: baseFont({ size: 11 }), text: 'Operadora: ' },
      { font: baseFont({ size: 11, bold: true }), text: (operatorNames.join(' / ') || '—').toUpperCase() },
    ],
  } as any, { align: { horizontal: 'left' }, border: { left: MEDIUM } })
  // the underline below "Operadora:" runs the header's full width (through Q, matching row4's
  // own B4:Q4 span), not just the one cell the text sits in
  for (let c = 1; c <= 17; c++) ws.getCell(addr(c, 2)).border = { ...ws.getCell(addr(c, 2)).border, bottom: MEDIUM }

  setCell(ws, 'A3', '', {
    font: baseFont({ bold: true }), align: { horizontal: 'center', vertical: 'middle', textRotation: 90 },
    border: BOX, merge: 'A3:A6',
  })
  setCell(ws, 'B3', 'LINHA:', { font: baseFont(), border: { left: MEDIUM, top: MEDIUM, bottom: THIN } })
  setCell(ws, 'C3', lineCode, { font: baseFont({ bold: true }), border: { top: MEDIUM, bottom: THIN } })
  setCell(ws, 'D3', lineName.toUpperCase(), { align: { horizontal: 'left' }, font: baseFont({ bold: true }), border: { top: MEDIUM, bottom: THIN } })
  setCell(ws, 'B4', 'Horários - DIAS ÚTEIS', { align: { horizontal: 'left' }, font: baseFont({ bold: true }), border: { left: MEDIUM, top: THIN, bottom: MEDIUM }, merge: 'B4:Q4' })

  setCell(ws, 'R1', 'OSO Nº', { font: baseFont({ bold: true }), border: BOX, merge: 'R1:U2' })
  setCell(ws, 'R3', '', { border: BOX, merge: 'R3:U4' })
  if (scope.logoUrl) {
    const relative = scope.logoUrl.startsWith('/api/') ? scope.logoUrl.slice('/api/'.length) : scope.logoUrl
    const filePath = path.join(process.cwd(), relative)
    if (fs.existsSync(filePath)) {
      const ext = path.extname(filePath).slice(1).toLowerCase()
      const imageId = ws.workbook.addImage({
        buffer: fs.readFileSync(filePath) as any,
        extension: (ext === 'jpg' ? 'jpeg' : ext) as 'png' | 'jpeg' | 'gif',
      })
      // target position: X=30.64cm, Y=1.00cm from the sheet's own top-left, per the real doc's
      // "Posição e tamanho" dialog. colWidthPx's formula (MDW=7) doesn't land pixel-exact on
      // however LibreOffice actually renders these columns/rows — confirmed empirically: a
      // request of X=30.72/Y=1.01 rendered at X=31.22/Y=1.04 — so the cm fed into
      // cmToFractionalIndex is pre-corrected by that measured drift ratio (assumed
      // proportional to distance from the sheet's origin, since the error is a compounding
      // per-column/row rounding bias, not a fixed offset) rather than the raw target itself
      const DRIFT_X = 31.22 / 30.72
      const DRIFT_Y = 1.04 / 1.01
      const colWidths = [colWidthPx(3.67), ...Array(LAST_DATA_COL - FIRST_DATA_COL + 1).fill(colWidthPx(9.11))]
      const rowHeights = [13.61 * PT_TO_PX, 12.75 * PT_TO_PX, 12.75 * PT_TO_PX, 15.87 * PT_TO_PX]
      ws.addImage(imageId, {
        tl: { col: cmToFractionalIndex(30.64 / DRIFT_X, colWidths), row: cmToFractionalIndex(1.00 / DRIFT_Y, rowHeights) } as any,
        ext: { width: 4.81 * CM_TO_PX, height: 0.97 * CM_TO_PX },
        editAs: 'oneCell',
      } as any)
    }
  }

  // a full row of borders across the band's whole fixed width (not just the columns a real
  // carro uses) — the legacy sheet closes the whole 20-column page into one rectangle
  // regardless of how many carro slots are actually populated (confirmed against the real
  // "250" sheet/PDF: unused slots still show a bordered, blank grid, not a ragged edge where
  // the last real carro ends)
  function frameRow(row: number, top: Partial<ExcelJS.Border>, bottom: Partial<ExcelJS.Border>) {
    for (let c = FIRST_DATA_COL; c <= LAST_DATA_COL; c++) {
      const cell = ws.getCell(addr(c, row))
      cell.border = {
        top, bottom,
        left:  c === FIRST_DATA_COL ? MEDIUM : THIN,
        right: c === LAST_DATA_COL ? MEDIUM : THIN,
      }
      // otherwise a cell never touched by setCell falls back to Excel's default (Calibri 11)
      // instead of the sheet's actual font
      cell.font = baseFont()
    }
  }

  // --- bands: each is its own 23-row block (20 trip rows + E/V/H), stacked vertically ---
  for (let bandIdx = 0; bandIdx < bands.length; bandIdx++) {
    const band = bands[bandIdx]
    const gridStart = HEADER_ROWS + 1 + bandIdx * BAND_BLOCK_ROWS
    const eRow = gridStart + GRID_ROWS
    const vRow = eRow + 1
    const hRow = eRow + 2

    frameRow(gridStart - 2, MEDIUM, MEDIUM)
    frameRow(gridStart - 1, MEDIUM, MEDIUM)
    for (let i = 0; i < GRID_ROWS; i++) frameRow(gridStart + i, i === 0 ? MEDIUM : THIN, i === GRID_ROWS - 1 ? MEDIUM : THIN)
    frameRow(eRow, THIN, THIN)
    frameRow(vRow, THIN, THIN)
    frameRow(hRow, THIN, MEDIUM)

    for (let i = 0; i < GRID_ROWS; i++) {
      setCell(ws, addr(1, gridStart + i), i + 1, {
        font: baseFont(), align: { horizontal: 'right' }, numFmt: '0º',
        border: { left: MEDIUM, top: i === 0 ? MEDIUM : THIN, bottom: THIN },
      })
    }
    setCell(ws, addr(1, eRow), 'E', { font: baseFont({ bold: true }), border: { left: MEDIUM, right: MEDIUM, top: THIN } })
    setCell(ws, addr(1, vRow), 'V', { font: baseFont({ bold: true }), border: { left: MEDIUM, right: MEDIUM } })
    setCell(ws, addr(1, hRow), 'H', { font: baseFont({ bold: true }), border: { left: MEDIUM, right: MEDIUM, bottom: MEDIUM } })

    let col = FIRST_DATA_COL
    for (const blockId of band.blockIds) {
      const carroIndex = assembled.carros.findIndex(c => c.blockId === blockId)
      const carro       = assembled.carros[carroIndex]
      const layout       = layouts.get(blockId)!
      const G            = layout.columns.length
      const width         = G * layout.tripsPerRow
      const rows          = buildCarroRows(carro, layout, minutesBeforeDestination)

      setCell(ws, addr(col, gridStart - 2), carroIndex + 1, {
        font: baseFont({ bold: true }), numFmt: '0º', fill: TAN_FILL, border: BOX,
        merge: rangeAddr(col, gridStart - 2, col + width - 1, gridStart - 2),
      })

      for (let block = 0; block < layout.tripsPerRow; block++) {
        const blockCol = col + block * G
        for (let j = 0; j < G; j++) {
          setCell(ws, addr(blockCol + j, gridStart - 1), labelByRouteLocalityId.get(layout.columns[j].routeLocalityId) ?? '', {
            font: baseFont({ bold: true, size: 8 }), border: { top: MEDIUM, bottom: MEDIUM, left: j === 0 ? MEDIUM : THIN, right: j === G - 1 ? MEDIUM : THIN },
          })
        }
        for (let i = 0; i < GRID_ROWS; i++) {
          const row = rows[block * GRID_ROWS + i]
          for (let j = 0; j < G; j++) {
            const value = row?.[j] ?? null
            const cellAddr = addr(blockCol + j, gridStart + i)
            if (value === 'RECO' || value === 'INTERV') {
              setCell(ws, cellAddr, value, {
                font: baseFont({ bold: true }), fill: value === 'RECO' ? RECO_FILL : INTERV_FILL,
                border: { left: j === 0 ? MEDIUM : THIN, right: j === G - 1 ? MEDIUM : THIN, top: THIN, bottom: THIN },
              })
            } else if (value !== null) {
              setCell(ws, cellAddr, timeOfDay(value.minutes), {
                font:   markingFontOpts(value.fontStyle),
                numFmt: 'hh:mm',
                fill:   value.bgColor ? BG_COLOR_FILLS[value.bgColor] : undefined,
                border: { left: j === 0 ? MEDIUM : THIN, right: j === G - 1 ? MEDIUM : THIN, top: THIN, bottom: THIN },
              })
            } else {
              const cell = ws.getCell(cellAddr)
              cell.border = { left: j === 0 ? MEDIUM : THIN, right: j === G - 1 ? MEDIUM : THIN, top: THIN, bottom: THIN }
              cell.font = baseFont()
            }
          }
        }
      }

      const tripCount = carro.events.filter(e => e.kind === 'trip').length / 2
      const trips = carro.events.filter((e): e is OsoTripEvent => e.kind === 'trip')
      const operatingMinutes = trips.length > 0
        ? Math.max(...trips.map(e => e.arrivalMinutes)) - Math.min(...trips.map(e => e.departureMinutes))
        : 0

      // each carro's own E/V/H block is boxed off (medium left/right) from its neighbors,
      // not just separated by the band-wide thin gridline frameRow already drew
      setCell(ws, addr(col, eRow), carro.operatorLabel ?? '', { font: baseFont({ bold: true }), border: { top: MEDIUM, bottom: THIN, left: MEDIUM, right: MEDIUM }, merge: rangeAddr(col, eRow, col + width - 1, eRow) })
      setCell(ws, addr(col, vRow), tripCount, { font: baseFont({ bold: true }), numFmt: '0.0', border: { top: THIN, bottom: THIN, left: MEDIUM, right: MEDIUM }, merge: rangeAddr(col, vRow, col + width - 1, vRow) })
      setCell(ws, addr(col, hRow), duration(operatingMinutes), { font: baseFont({ bold: true }), numFmt: '[h]:mm', border: { top: THIN, bottom: MEDIUM, left: MEDIUM, right: MEDIUM }, merge: rangeAddr(col, hRow, col + width - 1, hRow) })

      col += width
    }
  }

  // --- RESUMO block: fixed position right after the last band, family-wide totals ---
  const [op1, op2] = summary.operators.slice(0, 2)

  setCell(ws, addr(1, resumoStart), 'RESUMO', {
    font: baseFont({ bold: true }), align: { horizontal: 'center', vertical: 'middle', wrapText: true, textRotation: 'vertical' },
    fill: TAN_FILL, border: BOX, merge: rangeAddr(1, resumoStart, 1, resumoStart + RESUMO_ROWS - 1),
  })

  // border/fill spec for each of a triplet's 3 rows (op1 / op2+label / Total), replicated
  // column-by-column from the real reference file — the label block (B:D) has no border
  // between its own 3 rows (the label text visually spans all 3), while the operator/value
  // block (E:H) uses hair lines internally and picks up medium only at real group boundaries
  function resumoTriplet(rowOffset: number, label: string, v1: number | undefined, v2: number | undefined, total: number, numFmt: string) {
    const r0 = resumoStart + rowOffset

    setCell(ws, addr(2, r0), '', { border: { top: MEDIUM, left: MEDIUM } })
    setCell(ws, addr(3, r0), '', { border: { top: MEDIUM } })
    setCell(ws, addr(4, r0), '', { border: { top: MEDIUM, right: THIN } })
    setCell(ws, addr(5, r0), op1?.operatorLabel ?? '', { font: baseFont({ bold: true }), align: { horizontal: 'left' }, border: { top: MEDIUM, bottom: HAIR, left: THIN } })
    setCell(ws, addr(6, r0), '', { border: { top: MEDIUM, bottom: HAIR } })
    setCell(ws, addr(7, r0), v1 ?? '', { font: baseFont({ bold: true }), numFmt, border: { top: MEDIUM, bottom: HAIR, left: HAIR, right: MEDIUM }, merge: rangeAddr(7, r0, 8, r0) })

    setCell(ws, addr(2, r0 + 1), label, { font: baseFont({ bold: true }), align: { horizontal: 'left' }, border: { left: MEDIUM } })
    setCell(ws, addr(4, r0 + 1), '', { border: { right: THIN } })
    setCell(ws, addr(5, r0 + 1), op2?.operatorLabel ?? '', { font: baseFont({ bold: true }), align: { horizontal: 'left' }, border: { top: HAIR, bottom: HAIR, left: THIN } })
    setCell(ws, addr(6, r0 + 1), '', { border: { top: HAIR, bottom: HAIR } })
    setCell(ws, addr(7, r0 + 1), v2 ?? 0, { font: baseFont({ bold: true }), numFmt, border: { top: HAIR, bottom: HAIR, left: HAIR, right: MEDIUM }, merge: rangeAddr(7, r0 + 1, 8, r0 + 1) })

    setCell(ws, addr(2, r0 + 2), '', { border: { bottom: THIN, left: MEDIUM } })
    setCell(ws, addr(3, r0 + 2), '', { border: { bottom: THIN } })
    setCell(ws, addr(4, r0 + 2), '', { border: { bottom: THIN, right: THIN } })
    setCell(ws, addr(5, r0 + 2), 'Total', { font: baseFont({ bold: true }), align: { horizontal: 'left' }, fill: TAN_FILL, border: { top: HAIR, bottom: THIN, left: THIN } })
    setCell(ws, addr(6, r0 + 2), '', { fill: TAN_FILL, border: { top: HAIR, bottom: THIN } })
    setCell(ws, addr(7, r0 + 2), total, { font: baseFont({ bold: true }), numFmt, fill: TAN_FILL, border: { top: HAIR, bottom: THIN, left: HAIR, right: MEDIUM }, merge: rangeAddr(7, r0 + 2, 8, r0 + 2) })
  }

  resumoTriplet(0, 'Viagens Programadas', op1?.trips, op2?.trips, summary.totals.trips, '0.0')

  const tvRow = resumoStart + 3
  setCell(ws, addr(2, tvRow), 'Tempo de Viagem (minutos)', { font: baseFont({ bold: true }), align: { horizontal: 'left' }, border: { top: THIN, bottom: THIN, left: MEDIUM } })
  setCell(ws, addr(3, tvRow), '', { border: { top: THIN, bottom: THIN } })
  setCell(ws, addr(4, tvRow), '', { border: { top: THIN, bottom: THIN } })
  setCell(ws, addr(5, tvRow), '', { border: { top: THIN, bottom: THIN, left: THIN } })
  setCell(ws, addr(6, tvRow), '', { border: { top: THIN, bottom: THIN } })
  setCell(ws, addr(7, tvRow), summary.cycleTimesMinutes.map(m => `${m}'`).join(' '), { font: baseFont({ bold: true }), border: { top: THIN, bottom: THIN, left: HAIR, right: MEDIUM }, merge: rangeAddr(7, tvRow, 8, tvRow) })

  resumoTriplet(4, 'Frota Operacional', op1?.fleet, op2?.fleet, summary.totals.fleet, '0')
  resumoTriplet(7, 'Horas Operadas', op1 ? duration(op1.operatingMinutes) : undefined, op2 ? duration(op2.operatingMinutes) : undefined, duration(summary.totals.operatingMinutes), '[h]:mm')
  resumoTriplet(10, 'Quilometragem Rodada (km)', op1?.km, op2?.km, summary.totals.km, '0.0')
  // I:U's own bottom edge at the last triplet's Total row — B:H already gets one from the
  // "EXTENSÃO DA LINHA" header row's top:medium directly below it, but I onward has nothing
  // below to borrow that edge from until row43's own I:K/L cells, which don't reach past L
  for (let c = 9; c <= LAST_DATA_COL; c++) {
    const cell = ws.getCell(addr(c, resumoStart + 12))
    cell.border = { ...cell.border, bottom: MEDIUM }
  }

  const r43 = resumoStart + 13
  setCell(ws, addr(2, r43), 'EXTENSÃO DA LINHA', { font: baseFont({ bold: true }), fill: TAN_FILL, border: { top: MEDIUM, bottom: THIN, left: MEDIUM, right: MEDIUM }, merge: rangeAddr(2, r43, 8, r43) })
  setCell(ws, addr(9, r43), 'OPERAÇÃO', { font: baseFont({ bold: true, size: 8 }), border: { top: MEDIUM, bottom: THIN, left: MEDIUM, right: MEDIUM }, merge: rangeAddr(9, r43, 11, r43) })
  setCell(ws, addr(12, r43), 'OBSERVAÇÃO:', { font: baseFont({ bold: true, size: 8 }), align: { horizontal: 'left', vertical: 'top' }, border: { top: MEDIUM, left: MEDIUM } })
  setCell(ws, addr(20, r43), 'AUTORIZAÇÃO Nº', { font: baseFont({ bold: true, size: 8 }), border: { top: MEDIUM, left: MEDIUM, right: MEDIUM }, merge: rangeAddr(20, r43, 21, r43 + 1) })

  // A small swatch (col 12 alone) carries the marking's own font/fill so it reads as a legend
  // key, while the sentence itself (cols 13-19) always stays in plain readable text — instead
  // of coloring the whole sentence, which either gets cut off by unmerged text overflow or
  // reads as if the sentence itself were the marked cell.
  //
  // There are only 4 fixed one-line slots (r43+1..r43+4, shared with the Extensão Útil/Ociosa
  // rows to their left — growing any of their heights would misalign that grid). The reference
  // OSO does let a long observation spill onto the next line, so instead of growing a row we
  // word-wrap each item and let it consume as many of the 4 slots as it needs; the swatch only
  // repeats on the item's first slot, continuation slots are plain indented text. If every slot
  // is used before an item (or the item list) finishes, the last visible slot is truncated
  // with "…".
  const OBS_SLOTS              = 4
  const OBS_LEGEND_CHARS_PER_LINE = 90

  function wrapObsLegend(text: string): string[] {
    const lines = ['']
    for (const word of text.split(' ')) {
      const current  = lines[lines.length - 1]
      const withWord = current ? `${current} ${word}` : word
      if (withWord.length <= OBS_LEGEND_CHARS_PER_LINE) lines[lines.length - 1] = withWord
      else lines.push(word)
    }
    return lines
  }

  type ObsSlot = { text: string; isFirst: boolean; fontStyle?: TripMarkingFontStyle; bgColor?: TripMarkingBgColor }
  const obsSlots: (ObsSlot | undefined)[] = []
  outer: for (const item of observations.lines) {
    const wrapped = wrapObsLegend(item.legendText)
    for (let i = 0; i < wrapped.length; i++) {
      if (obsSlots.length === OBS_SLOTS) {
        const prev = obsSlots[obsSlots.length - 1]!
        prev.text = prev.text.replace(/…$/, '') + '…'
        break outer
      }
      obsSlots.push({ text: wrapped[i], isFirst: i === 0, fontStyle: item.fontStyle, bgColor: item.bgColor })
    }
  }
  while (obsSlots.length < OBS_SLOTS) obsSlots.push(undefined)

  function obsLine(row: number, slot: ObsSlot | undefined, extraBorder: Partial<ExcelJS.Borders>) {
    setCell(ws, addr(12, row), slot?.isFirst ? 'LEG' : '', {
      font:   { ...markingFontOpts(slot?.fontStyle), size: 7 },
      align:  { horizontal: 'center', vertical: 'top' },
      fill:   slot?.isFirst && slot.bgColor ? BG_COLOR_FILLS[slot.bgColor] : undefined,
      border: extraBorder,
    })
    setCell(ws, addr(13, row), slot?.text ?? '', {
      font:   baseFont({ size: 8 }),
      align:  { horizontal: 'left', vertical: 'top' },
      border: { bottom: extraBorder.bottom },
      merge:  rangeAddr(13, row, 19, row),
    })
  }

  // Extensão Útil (km) — one combined ida+volta figure, unlike the 3-row-per-operator
  // Ociosa block below it: it's a property of the LINE (TransitLine.metrics.extensionKm),
  // not something that varies per operator
  const extensionUtilTotal = (summary.extensionUtilKm.OUTBOUND ?? 0) + (summary.extensionUtilKm.INBOUND ?? 0) + (summary.extensionUtilKm.CIRCULAR ?? 0)
  setCell(ws, addr(2, r43 + 1), 'Extensão Útil (km)', { align: { horizontal: 'left' }, font: baseFont({ bold: true }), border: { top: THIN, bottom: THIN, left: MEDIUM } })
  setCell(ws, addr(3, r43 + 1), '', { border: { top: THIN, bottom: THIN } })
  setCell(ws, addr(4, r43 + 1), '', { border: { top: THIN, bottom: THIN } })
  setCell(ws, addr(5, r43 + 1), '', { border: { top: THIN, bottom: THIN } })
  setCell(ws, addr(6, r43 + 1), '', { border: { top: THIN, bottom: THIN } })
  setCell(ws, addr(7, r43 + 1), extensionUtilTotal, { font: baseFont({ bold: true }), numFmt: '0.00', border: { top: THIN, bottom: THIN, left: HAIR, right: MEDIUM }, merge: rangeAddr(7, r43 + 1, 8, r43 + 1) })
  setCell(ws, addr(9, r43 + 1), 'Início:', { font: baseFont(), align: { horizontal: 'center', vertical: 'middle' }, border: { top: THIN, bottom: HAIR, left: MEDIUM, right: HAIR }, merge: rangeAddr(9, r43 + 1, 9, r43 + 2) })
  setCell(ws, addr(10, r43 + 1), '', { font: baseFont(), align: { horizontal: 'center', vertical: 'middle' }, numFmt: 'd/m/yyyy', border: { top: THIN, bottom: HAIR, left: HAIR, right: MEDIUM }, merge: rangeAddr(10, r43 + 1, 11, r43 + 2) })
  obsLine(r43 + 1, obsSlots[0], { left: MEDIUM })

  // Extensão Ociosa (km) — 3 rows reserved for up to 3 operators running the line, each with
  // its own abbreviated name + figure (rule 9); the label sits on the middle row, same
  // convention as the Viagens/Frota/Horas/Km triplets above
  const [ocA, ocB, ocC] = summary.extensionOciosaKm

  setCell(ws, addr(2, r43 + 2), '', { border: { left: MEDIUM } })
  setCell(ws, addr(4, r43 + 2), '', { border: { right: THIN } })
  setCell(ws, addr(5, r43 + 2), ocA?.operatorLabel ?? '', { font: baseFont({ bold: true }), align: { horizontal: 'left' }, border: { bottom: HAIR, left: THIN } })
  setCell(ws, addr(6, r43 + 2), '', { border: { bottom: HAIR } })
  setCell(ws, addr(7, r43 + 2), ocA?.km ?? '', { font: baseFont({ bold: true }), numFmt: '0.00', border: { bottom: HAIR, left: HAIR, right: MEDIUM }, merge: rangeAddr(7, r43 + 2, 8, r43 + 2) })
  obsLine(r43 + 2, obsSlots[1], { left: MEDIUM })

  setCell(ws, addr(2, r43 + 3), 'Extensão Ociosa (km)', { align: { horizontal: 'left' }, font: baseFont({ bold: true }), border: { left: MEDIUM } })
  setCell(ws, addr(4, r43 + 3), '', { border: { right: THIN } })
  setCell(ws, addr(5, r43 + 3), ocB?.operatorLabel ?? '', { font: baseFont({ bold: true }), align: { horizontal: 'left' }, border: { top: HAIR, left: THIN } })
  setCell(ws, addr(6, r43 + 3), '', { border: { top: HAIR } })
  setCell(ws, addr(7, r43 + 3), ocB?.km ?? '', { font: baseFont({ bold: true }), numFmt: '0.00', border: { top: HAIR, left: HAIR, right: MEDIUM }, merge: rangeAddr(7, r43 + 3, 8, r43 + 3) })
  setCell(ws, addr(9, r43 + 3), 'Término:', { font: baseFont(), align: { horizontal: 'center', vertical: 'middle' }, border: { top: HAIR, bottom: MEDIUM, left: MEDIUM, right: HAIR }, merge: rangeAddr(9, r43 + 3, 9, r43 + 4) })
  setCell(ws, addr(10, r43 + 3), '', { font: baseFont(), align: { horizontal: 'center', vertical: 'middle' }, numFmt: 'd/m/yyyy', border: { top: HAIR, bottom: MEDIUM, left: HAIR, right: MEDIUM }, merge: rangeAddr(10, r43 + 3, 11, r43 + 4) })
  obsLine(r43 + 3, obsSlots[2], { left: MEDIUM })
  setCell(ws, addr(20, r43 + 2), '', { border: { top: THIN, left: MEDIUM, right: MEDIUM, bottom: MEDIUM }, merge: rangeAddr(20, r43 + 2, 21, r43 + 4) })

  setCell(ws, addr(2, r43 + 4), '', { border: { bottom: MEDIUM, left: MEDIUM } })
  setCell(ws, addr(3, r43 + 4), '', { border: { bottom: MEDIUM } })
  setCell(ws, addr(4, r43 + 4), '', { border: { bottom: MEDIUM, right: THIN } })
  setCell(ws, addr(5, r43 + 4), ocC?.operatorLabel ?? '', { font: baseFont({ bold: true }), align: { horizontal: 'left' }, border: { top: HAIR, bottom: MEDIUM, left: THIN } })
  setCell(ws, addr(6, r43 + 4), '', { border: { top: HAIR, bottom: MEDIUM } })
  setCell(ws, addr(7, r43 + 4), ocC?.km ?? '', { font: baseFont({ bold: true }), numFmt: '0.00', border: { top: HAIR, bottom: MEDIUM, left: HAIR } })
  setCell(ws, addr(8, r43 + 4), '', { border: { top: HAIR, bottom: MEDIUM, right: MEDIUM } })
  obsLine(r43 + 4, obsSlots[3], { bottom: MEDIUM, left: MEDIUM })

  // --- signatures (Scope.osoConfig.signatures — rule 11) ---
  const sigRow = resumoStart + RESUMO_ROWS + SIGNATURE_GAP
  const [sig1, sig2] = scope.signatures
  if (sig1) {
    setCell(ws, addr(4, sigRow), sig1.name, { font: baseFont(), border: { top: THIN }, merge: rangeAddr(4, sigRow, 8, sigRow) })
    setCell(ws, addr(4, sigRow + 1), sig1.role, { font: baseFont(), merge: rangeAddr(4, sigRow + 1, 8, sigRow + 1) })
  }
  if (sig2) {
    setCell(ws, addr(14, sigRow), sig2.name, { font: baseFont(), border: { top: THIN }, merge: rangeAddr(14, sigRow, 18, sigRow) })
    setCell(ws, addr(14, sigRow + 1), sig2.role, { font: baseFont(), merge: rangeAddr(14, sigRow + 1, 18, sigRow + 1) })
  }

  ws.pageSetup.printArea = rangeAddr(1, 1, LAST_DATA_COL, sigRow + 1)
}

export async function renderOsoWorkbook(
  prisma: PrismaService,
  sheets: RenderOsoSheetInput[],
): Promise<ExcelJS.Workbook> {
  const workbook = new ExcelJS.Workbook()

  const allLayouts = new Map<string, OsoCarroLayout>()
  for (const sheet of sheets) for (const [k, v] of sheet.layouts) allLayouts.set(k, v)
  const [labelByRouteLocalityId, minutesBeforeDestination] = await Promise.all([
    loadColumnLabels(prisma, allLayouts),
    loadMinutesBeforeDestination(prisma, allLayouts),
  ])

  for (const sheet of sheets) {
    const ws = workbook.addWorksheet(sheet.lineCode.slice(0, 31))
    await renderOsoSheet(ws, sheet, labelByRouteLocalityId, minutesBeforeDestination)
  }

  return workbook
}
