import { describe, expect, it } from 'vitest'
import type { OsoCarro, OsoEvent, OsoTripEvent } from './oso-assembler'
import { assignOrdinals, mergeContinuations } from './oso-carro-roles'

const trip = (departureMinutes: number, arrivalMinutes: number, originLocalityId: string, destinationLocalityId: string): OsoTripEvent => ({
  kind: 'trip', tripId: `t${departureMinutes}`, routeId: 'r', lineId: 'l', direction: 'OUTBOUND',
  departureMinutes, arrivalMinutes, originLocalityId, destinationLocalityId,
})
const reco = (at: number): OsoEvent => ({ kind: 'deadrun', id: `r${at}`, type: 'RETURN', departureMinutes: at, arrivalMinutes: at })
const carro = (blockId: string, events: OsoEvent[], operatorLabel = 'VPAR'): OsoCarro => ({
  blockId, blockNumber: 0, ordinal: null, operatorLabel, operatorFullName: null, events,
})

describe('mergeContinuations', () => {
  it('joins a block starting where another left, dropping the RECO and positioning between them', () => {
    const displacement: OsoEvent = { kind: 'deadrun', id: 'd', type: 'DISPLACEMENT', departureMinutes: 1261, arrivalMinutes: 1275 }
    const [merged, ...rest] = mergeContinuations([
      carro('a', [trip(1282, 1302, 'S', 'V'), reco(1302)]),
      carro('b', [displacement, trip(1302, 1324, 'V', 'S'), reco(1421)]),
    ])
    expect(rest).toEqual([])
    expect(merged.blockId).toBe('a')
    expect(merged.events.map(e => e.departureMinutes)).toEqual([1282, 1302, 1421])
  })

  it('accepts a layover up to 5 minutes and nothing past it', () => {
    const head = carro('a', [trip(0, 100, 'S', 'V')])
    expect(mergeContinuations([head, carro('b', [trip(105, 130, 'V', 'S')])])).toHaveLength(1)
    expect(mergeContinuations([head, carro('b', [trip(106, 130, 'V', 'S')])])).toHaveLength(2)
  })

  it('keeps blocks apart on a different place, company or an overlap', () => {
    const head = carro('a', [trip(0, 100, 'S', 'V')])
    expect(mergeContinuations([head, carro('b', [trip(100, 130, 'X', 'S')])])).toHaveLength(2)
    expect(mergeContinuations([head, carro('b', [trip(100, 130, 'V', 'S')], 'RAPIDO')])).toHaveLength(2)
    expect(mergeContinuations([head, carro('b', [trip(99, 130, 'V', 'S')])])).toHaveLength(2)
  })

  it('follows a chain and gives each tail to one head only, the closest', () => {
    const merged = mergeContinuations([
      carro('far', [trip(0, 95, 'A', 'V')]),
      carro('near', [trip(10, 99, 'B', 'V')]),
      carro('next', [trip(100, 120, 'V', 'C')]),
      carro('last', [trip(120, 140, 'C', 'D')]),
    ])
    expect(merged.map(c => c.blockId)).toEqual(['far', 'near'])
    expect(merged[0].events).toHaveLength(3)
    expect(merged[1].events).toHaveLength(1)
  })
})

describe('assignOrdinals', () => {
  it('numbers carros in order, skipping a single trip as REFORÇO', () => {
    const numbered = assignOrdinals([
      carro('a', [trip(0, 10, 'S', 'V'), trip(15, 25, 'V', 'S')]),
      carro('b', [trip(5, 20, 'S', 'V'), reco(20)]),
      carro('c', [trip(30, 40, 'S', 'V'), trip(45, 55, 'V', 'S')]),
    ])
    expect(numbered.map(c => c.ordinal)).toEqual([1, null, 2])
  })

  it('judges a joined carro as a whole, so a lone trip that continues is not REFORÇO', () => {
    const [joined] = assignOrdinals(mergeContinuations([
      carro('a', [trip(0, 10, 'S', 'V')]),
      carro('b', [trip(10, 20, 'V', 'S')]),
    ]))
    expect(joined.ordinal).toBe(1)
  })
})
