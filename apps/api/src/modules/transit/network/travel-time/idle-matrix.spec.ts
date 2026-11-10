import { describe, expect, it } from 'vitest'
import { buildIdleMatrix, type IdleMatrixInputLocality } from './idle-matrix'

const loc = (code: string, isDepot = false, external?: string): IdleMatrixInputLocality =>
  ({ code, name: `Local ${code}`, isDepot, externalCodes: external ? { GOAL: external } : null })

const entry = (originId: string, destinationId: string, baseMinutes = 22, distanceKm = 8.744, speedRatio = 1.3) =>
  ({ originId, destinationId, baseMinutes, distanceKm, speedRatio })

const lines = (csv: string) => csv.trim().split('\n')

describe('buildIdleMatrix', () => {
  it('writes the idle matrix layout', () => {
    const matrix = buildIdleMatrix([entry('a', 'b')], new Map([['a', loc('A')], ['b', loc('B')]]), new Set(['a', 'b']))
    expect(lines(matrix.csv)).toEqual([
      'Departure;Destination;Distance;Slot start time;Slot end time;Time',
      'A;B;8.74;00:00;36:00;00:29:00',
    ])
  })

  it('leaves out localities no trip starts or ends at, and names them', () => {
    const localities = new Map([['a', loc('A')], ['b', loc('B')], ['x', loc('X')]])
    const matrix = buildIdleMatrix([entry('a', 'b'), entry('a', 'x'), entry('x', 'b')], localities, new Set(['a', 'b']))
    expect(matrix.rows).toBe(1)
    expect(matrix.omitted).toEqual([{ code: 'X', name: 'Local X' }])
  })

  it('exports a depot under the nyx code when no code system is given', () => {
    const localities = new Map([['a', loc('A')], ['g', loc('G0001', true, 'G1')]])
    const matrix = buildIdleMatrix([entry('g', 'a')], localities, new Set(['a']))
    expect(lines(matrix.csv)[1]).toMatch(/^G0001;A;/)
    expect(matrix.depotsWithoutCode).toEqual([])
  })

  it('exports a depot under its external code even without trips', () => {
    const localities = new Map([['a', loc('A')], ['g', loc('G0001', true, 'G1')]])
    const matrix = buildIdleMatrix([entry('g', 'a')], localities, new Set(['a']), 'GOAL')
    expect(lines(matrix.csv)[1]).toMatch(/^G1;A;/)
    expect(matrix.depotsWithoutCode).toEqual([])
  })

  it('exports a depot that is also a trip endpoint under both codes', () => {
    const localities = new Map([['a', loc('A')], ['g', loc('G0001', true, 'G1')]])
    const matrix = buildIdleMatrix([entry('g', 'a'), entry('a', 'g')], localities, new Set(['a', 'g']), 'GOAL')
    expect(lines(matrix.csv).slice(1).map(l => l.split(';').slice(0, 2).join('>'))).toEqual(['A>G0001', 'A>G1', 'G0001>A', 'G1>A'])
  })

  it('flags a depot without an external code', () => {
    const matrix = buildIdleMatrix([entry('g', 'a')], new Map([['a', loc('A')], ['g', loc('G0001', true)]]), new Set(['a']), 'GOAL')
    expect(matrix.depotsWithoutCode).toEqual([{ code: 'G0001', name: 'Local G0001' }])
    expect(lines(matrix.csv)[1]).toMatch(/^G0001;A;/)
  })

  it('rounds the adjusted time to whole minutes', () => {
    const matrix = buildIdleMatrix([entry('a', 'b', 100, 1, 1.3)], new Map([['a', loc('A')], ['b', loc('B')]]), new Set(['a', 'b']))
    expect(lines(matrix.csv)[1]).toBe('A;B;1;00:00;36:00;02:10:00')
  })
})
