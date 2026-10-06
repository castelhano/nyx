import type { ExportCarro, ExportIssue, ExportRow, ExportTable } from '@nyx/schemas'
import { hhmm, type CodeRef, type Direction, type Segment, type SegmentClose } from '../plan-export.cuts'

// Globus profile (docs/proposal/plan_globus_export_v1.md §3.4–3.5) — turns a carro's
// segments into the Globus tables and rows. Codes, letters and the shift map are fixed in
// code on purpose (v1 has no settings for them).

const ACTIVITY = {
  trip:         '01',
  break:        { code: '07', locality: '07' },
  shiftChange:  { code: '10', locality: '10' },
  return:       { code: '11', locality: '11' },
  displacement: { code: '98', locality: '98' },
}

const LETTERS_NORMAL      = ['A', 'B', 'D', 'E', 'F']
const LETTERS_AFTER_BREAK = ['C', 'V', 'X', 'Z']
const FIRST_SEQ           = 10
// tables starting before 09:00 are period 1, the rest period 2
const SECOND_PERIOD_FROM  = 9 * 60

const DIRECTION: Record<Direction, string> = { OUTBOUND: 'I', INBOUND: 'V', CIRCULAR: 'C' }
const OPPOSITE:  Record<Direction, Direction> = { OUTBOUND: 'INBOUND', INBOUND: 'OUTBOUND', CIRCULAR: 'CIRCULAR' }

export interface GlobusCarroInput {
  blockId:     string
  blockNumber: number
  number:      number
  depot:       CodeRef
  segments:    Segment[]
  issues:      ExportIssue[]
}

export interface GlobusContext {
  // the program's root line — trips of any other line carry COD_LINHA
  rootLineId:  string
  prepMinutes: number
}

export function buildGlobusCarro(carro: GlobusCarroInput, ctx: GlobusContext): ExportCarro {
  const used: string[] = []
  const tables = carro.segments.map((segment, idx) => {
    const letter = idx === 0
      ? LETTERS_NORMAL[0]
      : (segment.afterBreak ? LETTERS_AFTER_BREAK : LETTERS_NORMAL).find(l => !used.includes(l))
    const issues = [...segment.issues]
    if (letter) used.push(letter)
    else issues.push({ code: 'LETTERS_EXHAUSTED', message: 'Letras de tabela esgotadas — renomeie a tabela' })
    return buildTable(segment, `${String(carro.number).padStart(2, '0')}${letter ?? '?'}`, issues, carro.depot, ctx)
  })
  return {
    blockId:     carro.blockId,
    blockNumber: carro.blockNumber,
    number:      carro.number,
    tables,
    ...(carro.issues.length ? { issues: carro.issues } : {}),
  }
}

function buildTable(segment: Segment, name: string, issues: ExportIssue[], depot: CodeRef, ctx: GlobusContext): ExportTable {
  const trips     = segment.items.filter(it => it.kind === 'trip')
  const firstTrip = trips[0]
  const lastTrip  = trips[trips.length - 1]
  const pickup    = segment.access != null ? depot : firstTrip.origin
  const closing   = closeTimes(segment.close, lastTrip.trip.direction)

  const rows: ExportRow[] = []
  let seq = FIRST_SEQ
  for (const it of segment.items) {
    if (it.kind === 'trip') {
      const otherLine = it.trip.lineId !== ctx.rootLineId
      rows.push(withFallback<ExportRow>({
        kind:   'TRIP',
        fields: {
          SENTIDO:         DIRECTION[it.trip.direction],
          COD_VIAGENS:     String(seq++),
          HORARIO_SAIDA:   hhmm(it.dep),
          HORARIO_CHEGADA: hhmm(it.arr),
          COD_ATIVIDADE:   ACTIVITY.trip,
          COD_LOCALIDADE:  it.origin.code,
          COD_LINHA:       otherLine ? it.trip.line.code : '',
        },
      }, [
        ['COD_LOCALIDADE', it.origin.fallback],
        ['COD_LINHA', otherLine && it.trip.line.fallback],
      ]))
    } else {
      rows.push({
        kind:   'DISPLACEMENT',
        fields: {
          SENTIDO:         DIRECTION[it.nextDirection],
          COD_VIAGENS:     String(seq++),
          HORARIO_SAIDA:   hhmm(it.dep),
          HORARIO_CHEGADA: hhmm(it.arr),
          COD_ATIVIDADE:   ACTIVITY.displacement.code,
          COD_LOCALIDADE:  ACTIVITY.displacement.locality,
          COD_LINHA:       '',
        },
      })
    }
  }
  rows.push({
    kind:   segment.close.kind,
    fields: {
      SENTIDO:         DIRECTION[closing.direction],
      COD_VIAGENS:     String(seq),
      HORARIO_SAIDA:   hhmm(closing.from),
      HORARIO_CHEGADA: hhmm(closing.to),
      COD_ATIVIDADE:   closing.activity.code,
      COD_LOCALIDADE:  closing.activity.locality,
      COD_LINHA:       '',
    },
  })

  return withFallback<ExportTable>({
    fields: {
      SERVICO_TAB:    name,
      TURNO:          firstTrip.dep < SECOND_PERIOD_FROM ? '1' : '2',
      INICIO_SERVICO: hhmm(firstTrip.dep),
      FIM_SERVICO:    hhmm(closing.to),
      COD_LOCAL_MOT:  pickup.code,
      PREPARO_MOT:    String(ctx.prepMinutes),
      SAIDA_GAR:      segment.access != null ? hhmm(segment.access) : '',
    },
    rows,
    ...(issues.length ? { issues } : {}),
  }, [['COD_LOCAL_MOT', pickup.fallback]])
}

function closeTimes(close: SegmentClose, lastDirection: Direction) {
  switch (close.kind) {
    case 'BREAK':
      return { from: close.at, to: close.at, direction: close.nextDirection, activity: ACTIVITY.break }
    case 'SHIFT_CHANGE':
      return { from: close.at, to: close.at, direction: close.nextDirection, activity: ACTIVITY.shiftChange }
    case 'RETURN':
      return { from: close.from, to: close.to, direction: close.nextDirection ?? OPPOSITE[lastDirection], activity: ACTIVITY.return }
    case 'END':
      return { from: close.at, to: close.at, direction: OPPOSITE[lastDirection], activity: ACTIVITY.shiftChange }
  }
}

function withFallback<T extends { fallback?: string[] }>(target: T, flags: [string, boolean][]): T {
  const fallback = flags.filter(([, on]) => on).map(([field]) => field)
  return fallback.length ? { ...target, fallback } : target
}
