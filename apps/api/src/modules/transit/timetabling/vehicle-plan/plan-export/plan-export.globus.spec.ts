import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import { EXPORT_LAYOUTS, formatExport, type ExportCarro, type ExportPreview } from '@nyx/schemas'
import { cutTrecho, type Direction, type Relief, type Trecho, type TrechoEnd, type TrechoGap, type TrechoTrip } from './plan-export.cuts'
import { buildGlobusCarro } from './profiles/globus.profile'

const ROOT = '410'
const code = (c: string) => ({ code: c, fallback: false })
const min  = (t: string) => { const [h, m] = t.split(':').map(Number); return h * 60 + m }

// "I 05:00 05:21" | "I 05:20 05:45 57 A22B" — origin defaults to 20 (ida) / 61 (volta)
function trips(spec: string): TrechoTrip[] {
  return spec.split(',').map(s => s.trim()).map((s, i) => {
    const [d, dep, arr, origin, line] = s.split(' ')
    const direction: Direction = d === 'I' ? 'OUTBOUND' : d === 'V' ? 'INBOUND' : 'CIRCULAR'
    let arrMin = min(arr)
    if (arrMin < min(dep)) arrMin += 1440
    return {
      tripId: `t${i}`, lineId: line ?? ROOT, line: code(line ?? ROOT), direction,
      dep: min(dep), arr: arrMin, origin: code(origin ?? (d === 'V' ? '61' : '20')),
    }
  })
}

function trecho(tr: TrechoTrip[], opts: { gaps?: Record<number, Partial<TrechoGap>>; access?: number; end?: TrechoEnd; reliefs?: Relief[] } = {}): Trecho {
  return {
    trips:   tr,
    gaps:    tr.slice(1).map((_, i) => ({ displacements: [], ...opts.gaps?.[i] })),
    access:  opts.access,
    end:     opts.end ?? { kind: 'RETURN', arr: tr[tr.length - 1].arr + 22 },
    reliefs: opts.reliefs ?? [],
  }
}

function carro(number: number, t: Trecho): ExportCarro {
  return buildGlobusCarro(
    { blockId: `b${number}`, blockNumber: number, number, depot: code('51'), segments: cutTrecho(t), issues: [] },
    { rootLineId: ROOT, prepMinutes: 5 },
  )
}

function file(...carros: ExportCarro[]): string {
  const preview: ExportPreview = {
    system: 'GLOBUS', issues: [],
    programs: [{ lineId: ROOT, lineCode: ROOT, fields: { 'COD_PROGRAMAÇÃO': '410U07' }, carros }],
  }
  return formatExport(EXPORT_LAYOUTS.GLOBUS, preview)
}

const lines = (...cs: ExportCarro[]) => file(...cs).split('\r\n').map(l => l.slice(8))

describe('Globus profile — legacy sample (importacaoV6.xlsx, carros 1 e 2)', () => {
  const carro1 = trips('I 05:00 05:21, V 05:21 06:20, I 06:20 06:56, V 06:56 07:50, I 07:50 08:26, V 08:26 09:21, I 09:21 09:57, V 09:57 10:52, I 10:52 11:28, V 11:28 12:23, I 12:23 12:59, V 12:59 13:49, I 15:35 16:17, V 16:17 17:23, I 17:23 18:11, V 18:11 19:18, I 19:18 19:54, V 19:54 20:40, I 20:40 21:15, V 21:15 22:00, I 22:00 22:35, V 22:35 23:10')
  const carro2 = trips('I 05:20 05:45 57 A22B, V 05:45 06:50, I 06:50 07:26, V 07:26 08:29, I 08:29 09:05, V 09:05 10:00, I 10:00 10:36, V 10:36 11:31, I 11:31 12:07, V 12:07 13:02, I 13:02 13:38, V 13:38 14:33, I 14:33 15:09, V 15:09 16:23, I 16:23 17:11, V 17:11 18:14, I 18:14 18:50, V 18:50 19:34, I 19:34 20:10, V 20:10 21:05, I 21:05 21:40, V 21:40 22:30, I 22:30 23:05, V 23:05 23:40')

  it('reproduces the script output byte by byte', () => {
    const expected = readFileSync(join(__dirname, '__fixtures__/globus-sample.txt'), 'utf8').replace(/\r?\n$/, '')
    const out = file(
      carro(1, trecho(carro1, {
        access: min('04:38'),
        gaps:   { 11: { interval: { dep: min('13:49'), arr: min('15:35') } } },
        end:    { kind: 'RETURN', arr: min('23:32') },
      })),
      carro(2, trecho(carro2, {
        access:  min('04:50'),
        reliefs: [{ at: min('11:31'), locality: code('20') }, { at: min('16:23'), locality: code('20') }],
        end:     { kind: 'RETURN', arr: 1440 + 2 },
      })),
    )
    expect(out).toBe(expected)
  })
})

describe('Globus profile — cases the spreadsheet did not have', () => {
  const base = () => trips('I 06:00 07:00, V 07:00 08:00, I 08:00 09:00')

  it('splits a trip on a mid-trip shift change at the relief point', () => {
    const c = carro(1, trecho(base(), { access: min('05:40'), reliefs: [{ at: min('07:30'), locality: code('33') }] }))
    expect(lines(c)).toEqual([
      '01A  106:0007:300000510505:40I1006:0007:0001000020    ',
      '01A  106:0007:300000510505:40V1107:0007:3001000061    ',
      '01A  106:0007:300000510505:40V1207:3007:3010000010    ',
      '01B  107:3009:2200003305     V1007:3008:0001000033    ',
      '01B  107:3009:2200003305     I1108:0009:0001000020    ',
      '01B  107:3009:2200003305     V1209:0009:2211000011    ',
    ])
    expect(c.tables[0].issues?.map(i => i.code)).toEqual(['SHIFT_CHANGE_MID_TRIP'])
  })

  it('ends the table at the arrival and starts the next at the departure when there is slack', () => {
    const tr = trips('I 06:00 06:49, V 06:55 08:00')
    const c  = carro(1, trecho(tr, { reliefs: [{ at: min('06:49'), locality: code('61') }] }))
    expect(lines(c)).toEqual([
      '01A  106:0006:4900002005     I1006:0006:4901000020    ',
      '01A  106:0006:4900002005     V1106:4906:4910000010    ',
      '01B  106:5508:2200006105     V1006:5508:0001000061    ',
      '01B  106:5508:2200006105     I1108:0008:2211000011    ',
    ])
  })

  it('ignores a relief inside an interval and inside the trecho edges', () => {
    const c = carro(1, trecho(base(), {
      gaps:    { 0: { interval: { dep: min('07:00'), arr: min('07:00') } } },
      reliefs: [{ at: min('07:00'), locality: code('61') }, { at: min('06:00'), locality: code('20') }, { at: min('09:00'), locality: code('20') }],
    }))
    expect(c.tables.map(t => t.fields.SERVICO_TAB)).toEqual(['01A', '01C'])
  })

  it('keeps a displacement in the table it falls in, with the next trip direction and seq', () => {
    const tr = trips('I 06:00 07:00, I 08:00 09:00')
    const c  = carro(1, trecho(tr, { gaps: { 0: { displacements: [{ dep: min('07:01'), arr: min('07:20') }], interval: { dep: min('07:20'), arr: min('08:00') } } } }))
    expect(lines(c)).toEqual([
      '01A  106:0007:2000002005     I1006:0007:0001000020    ',
      '01A  106:0007:2000002005     I1107:0107:2098000098    ',
      '01A  106:0007:2000002005     I1207:2007:2007000007    ',
      '01C  108:0009:2200002005     I1008:0009:0001000020    ',
      '01C  108:0009:2200002005     V1109:0009:2211000011    ',
    ])
  })

  it('cuts a shift change inside a displacement before the displacement', () => {
    const tr = trips('I 06:00 07:00, I 08:00 09:00')
    const c  = carro(1, trecho(tr, {
      gaps:    { 0: { displacements: [{ dep: min('07:40'), arr: min('07:59') }] } },
      reliefs: [{ at: min('07:50'), locality: code('20') }],
    }))
    expect(c.tables.map(t => t.rows.map(r => r.kind))).toEqual([['TRIP', 'SHIFT_CHANGE'], ['DISPLACEMENT', 'TRIP', 'RETURN']])
    expect(c.tables[0].rows[1].fields.HORARIO_SAIDA).toBe('07:00')
    expect(c.tables[0].issues?.map(i => i.code)).toEqual(['SHIFT_CHANGE_IN_DISPLACEMENT'])
  })

  it('always cuts at a garage visit: recolhe, then access and garage exit', () => {
    const c = carro(1, trecho(base(), {
      access: min('05:40'),
      gaps:   { 0: { garage: { returnDep: min('07:01'), returnArr: min('07:20'), accessDep: min('07:40') } } },
    }))
    expect(lines(c)).toEqual([
      '01A  106:0007:200000510505:40I1006:0007:0001000020    ',
      '01A  106:0007:200000510505:40V1107:0007:2011000011    ',
      '01C  107:0009:220000510507:40V1007:0008:0001000061    ',
      '01C  107:0009:220000510507:40I1108:0009:0001000020    ',
      '01C  107:0009:220000510507:40V1209:0009:2211000011    ',
    ])
  })

  it('closes a trecho that goes straight on to another line with a shift change', () => {
    const c = carro(1, trecho(base(), { end: { kind: 'END' } }))
    expect(lines(c).at(-1)).toBe('01A  106:0009:0000002005     V1309:0009:0010000010    ')
  })

  it('closes a trecho followed by an interval with the interval code', () => {
    const c = carro(1, trecho(base(), { end: { kind: 'BREAK', at: min('09:00'), nextDirection: 'OUTBOUND' } }))
    expect(lines(c).at(-1)).toBe('01A  106:0009:0000002005     I1309:0009:0007000007    ')
  })

  it('marks trips of other lines with COD_LINHA and flags code fallbacks', () => {
    const tr = trips('I 06:00 07:00, V 07:00 08:00 61 308')
    tr[0].origin = { code: '20', fallback: true }
    const c = carro(1, trecho(tr))
    expect(c.tables[0].rows.map(r => r.fields.COD_LINHA)).toEqual(['', '308', ''])
    expect(c.tables[0].rows[0].fallback).toEqual(['COD_LOCALIDADE'])
  })

  it('names tables after a break and after shift changes from their own sequences', () => {
    const tr = trips('I 05:00 06:00, V 06:00 07:00, I 07:00 08:00, V 08:00 09:00, I 09:00 10:00, V 10:00 11:00, I 11:00 12:00')
    const c  = carro(3, trecho(tr, {
      gaps:    { 1: { interval: { dep: min('07:00'), arr: min('07:00') } } },
      reliefs: ['06:00', '08:00', '09:00', '10:00', '11:00'].map(t => ({ at: min(t), locality: code('20') })),
    }))
    expect(c.tables.map(t => t.fields.SERVICO_TAB)).toEqual(['03A', '03B', '03C', '03D', '03E', '03F', '03?'])
    expect(c.tables.at(-1)!.issues?.map(i => i.code)).toEqual(['LETTERS_EXHAUSTED'])
  })
})
