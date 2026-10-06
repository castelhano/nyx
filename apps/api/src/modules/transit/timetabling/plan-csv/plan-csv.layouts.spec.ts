import { describe, expect, it } from 'vitest'
import {
  dutyDetailed, dutySummary, vehicleDetailed, vehicleSummary, vehicleTimeline, vehicleWindows,
  type BlockEvent, type CsvBlock, type CsvDuty,
} from './plan-csv.layouts'

const h = (hh: number, mm = 0) => hh * 60 + mm

const trip = (start: number, end: number, line: string, from = 'A', to = 'B'): BlockEvent =>
  ({ kind: 'TRIP', start, end, from, to, line, direction: 'Ida', km: 10 })
const dr = (kind: 'ACCESS' | 'RETURN' | 'DISPLACEMENT', start: number, end: number, from: string, to: string): BlockEvent =>
  ({ kind, start, end, from, to, km: 5 })

// peak vehicle: 05:00–09:00 on 101, back to the garage, 14:00–18:00 on 101
const peak: CsvBlock = {
  id: 'b1', blockNumber: 140, company: 'VIX', depot: 'G1', vehicleType: 'Convencional', issues: [],
  events: [
    dr('ACCESS', h(4, 40), h(5), 'G1', 'A'),
    trip(h(5), h(7), '101'), trip(h(7), h(9), '101', 'B', 'A'),
    dr('RETURN', h(9), h(9, 20), 'A', 'G1'),
    dr('ACCESS', h(13, 40), h(14), 'G1', 'A'),
    trip(h(14), h(16), '101'), trip(h(16), h(18), '101', 'B', 'A'),
    dr('RETURN', h(18), h(18, 25), 'A', 'G1'),
  ],
}

// all-day vehicle: an interval at 11:30, a stand at the terminal, a line change
const allDay: CsvBlock = {
  id: 'b2', blockNumber: 12, company: 'VIX', depot: 'G1', vehicleType: 'Convencional', issues: ['Bloco sem empresa'],
  events: [
    dr('ACCESS', h(5, 20), h(5, 40), 'G1', 'A'),
    trip(h(5, 40), h(7), '101'), trip(h(7, 10), h(8, 30), '101', 'B', 'A'),
    { kind: 'INTERVAL', start: h(8, 30), end: h(9, 30), from: null, to: null, code: 'PAUSA', name: 'Pausa Planejada' },
    trip(h(9, 30), h(11), '102'),
    dr('RETURN', h(11), h(11, 20), 'B', 'G1'),
  ],
}

const duty = (over: Partial<CsvDuty>): CsvDuty => ({
  label: 'D1', role: 'Motorista', kind: 'STRAIGHT', kindLabel: 'Corrida', company: 'VIX',
  summary: null, issues: [], pieces: [], activities: [], ...over,
})

describe('vehicle timeline', () => {
  it('turns the gaps into OCIOSO, or GARAGEM after a RETURN', () => {
    const rows = vehicleTimeline(peak)
    expect(rows.map(r => r.event)).toEqual(['ACESSO', 'VIAGEM', 'VIAGEM', 'RECOLHE', 'GARAGEM', 'ACESSO', 'VIAGEM', 'VIAGEM', 'RECOLHE'])
    const idle = vehicleTimeline(allDay).find(r => r.event === 'OCIOSO')!
    expect([idle.start, idle.end, idle.from]).toEqual([h(7), h(7, 10), 'B'])
  })

  it('places an interval where the vehicle is', () => {
    const interval = vehicleTimeline(allDay).find(r => r.event === 'INTERVALO')!
    expect([interval.from, interval.obs]).toEqual(['A', 'Pausa Planejada'])
  })
})

describe('vehicle windows', () => {
  it('cuts at garage visits and at intervals, not at terminal stands', () => {
    expect(vehicleWindows(peak)).toEqual([
      { stop: null,  start: h(5),  end: h(9),  lines: ['101'], trips: 2 },
      { stop: 'GAR', start: h(14), end: h(18), lines: ['101'], trips: 2 },
    ])
    expect(vehicleWindows(allDay)).toEqual([
      { stop: null,    start: h(5, 40), end: h(8, 30), lines: ['101'], trips: 2 },
      { stop: 'PAUSA', start: h(9, 30), end: h(11),    lines: ['102'], trips: 1 },
    ])
  })
})

describe('vehicle CSV', () => {
  const duties = [
    duty({ label: 'D10', pieces: [{ blockId: 'b2', start: h(5, 20), end: h(8, 30), from: 'G1', to: 'A', stale: null }] }),
    duty({ label: 'D25', pieces: [{ blockId: 'b2', start: h(9, 30), end: h(11, 20), from: 'A', to: 'G1', stale: null }] }),
  ]

  it('summary: one row per vehicle, windows padded to the widest', () => {
    const { headers, rows } = vehicleSummary([peak, allDay], duties)
    expect(headers.slice(14)).toEqual([
      'J1 Início', 'J1 Fim', 'J1 Duração', 'J1 Linhas', 'J1 Viagens',
      'J2 Parada', 'J2 Início', 'J2 Fim', 'J2 Duração', 'J2 Linhas', 'J2 Viagens',
    ])
    expect(rows[0]).toEqual([
      140, 'VIX', 'G1', 'Convencional', 'Pico', '04:40', '18:25', '13:45', '08:00', 4, '00:00', '60,0', '', '',
      '05:00', '09:00', '04:00', '101', 2, 'GAR', '14:00', '18:00', '04:00', '101', 2,
    ])
    expect(rows[1].slice(4, 14)).toEqual(['Integral', '05:20', '11:20', '06:00', '04:20', 3, '00:10', '40,0', 'D10/D25', 'Bloco sem empresa'])
    expect(rows.every(r => r.length === headers.length)).toBe(true)
  })

  it('detailed: driver per event and an instant row at the change', () => {
    const { rows } = vehicleDetailed([allDay], duties)
    const change = rows.find(r => r[2] === 'TROCA_CONDUTOR')!
    expect([change[3], change[12]]).toEqual(['09:30', 'D10 → D25'])
    // after the interval that ends at 09:30, before the trip that starts at it
    expect(rows.map(r => r[2])).toEqual(['ACESSO', 'VIAGEM', 'OCIOSO', 'VIAGEM', 'INTERVALO', 'TROCA_CONDUTOR', 'VIAGEM', 'RECOLHE'])
    expect(rows[1][11]).toBe('D10')
    expect(rows[6][11]).toBe('D25')
  })
})

describe('duty CSV', () => {
  const split = duty({
    label: 'D41', kind: 'SPLIT', kindLabel: 'Dupla pegada',
    summary: { startMinutes: h(4, 30), endMinutes: h(18, 35), spreadMinutes: h(14, 5), stopMinutes: 15, breakMinutes: 0, paidBreakMinutes: 0, splitMinutes: h(4, 20), mealForm: null } as CsvDuty['summary'],
    pieces: [
      { blockId: 'b1', start: h(4, 40), end: h(9, 20),  from: 'G1', to: 'G1', stale: null },
      { blockId: 'b1', start: h(13, 40), end: h(18, 25), from: 'G1', to: 'G1', stale: null },
    ],
  })
  const straight = duty({
    label: 'D10',
    pieces: [
      { blockId: 'b2', start: h(5, 20), end: h(8, 30), from: 'G1', to: 'A', stale: null },
      { blockId: 'b1', start: h(13, 40), end: h(15), from: 'G1', to: 'X', stale: null },
    ],
    activities: [{ type: 'BREAK', start: h(9), end: h(10), from: null, to: null, code: 'REFEI', name: 'Refeição' }],
  })

  it('summary: cuts at the split interval and at breaks', () => {
    const { headers, rows } = dutySummary([split, straight], [peak, allDay])
    expect(headers.slice(19)).toEqual(['J1 Início', 'J1 Fim', 'J1 Carros', 'J1 Linhas', 'J2 Parada', 'J2 Início', 'J2 Fim', 'J2 Carros', 'J2 Linhas'])
    expect(rows[0].slice(19)).toEqual(['04:40', '09:20', '140', '101', 'DUPLA', '13:40', '18:25', '140', '101'])
    expect(rows[1].slice(19)).toEqual(['05:20', '08:30', '12', '101', 'REFEI', '13:40', '15:00', '140', '101'])
    expect(rows[0].slice(4, 9)).toEqual(['04:30', 'G1', '18:35', 'G1', '14:05'])
    expect(rows[0].slice(13, 16)).toEqual(['00:15', '04:20', ''])
    // no summary yet → blank
    expect(rows[1].slice(13, 16)).toEqual(['', '', ''])
  })

  it('detailed: implicit sign-on/off, the split interval, a clipped trip', () => {
    const { rows } = dutyDetailed([split, straight], [peak, allDay])
    const d41 = rows.filter(r => r[0] === 'D41').map(r => r[2])
    expect(d41).toEqual(['PEGADA', 'ACESSO', 'VIAGEM', 'VIAGEM', 'RECOLHE', 'INTERVALO_DUPLA', 'ACESSO', 'VIAGEM', 'VIAGEM', 'RECOLHE', 'LARGADA'])

    const d10 = rows.filter(r => r[0] === 'D10')
    expect(d10.map(r => r[2])).toEqual(['ACESSO', 'VIAGEM', 'OCIOSO', 'VIAGEM', 'OCIOSO', 'INTERVALO', 'OCIOSO', 'ACESSO', 'VIAGEM'])
    // relieved mid-trip at 15:00 — the trip is cut there, km prorated
    const last = d10.at(-1)!
    expect([last[3], last[4], last[7], last[11], last[12]]).toEqual(['14:00', '15:00', 'X', '5,0', 'parcial'])
  })
})
