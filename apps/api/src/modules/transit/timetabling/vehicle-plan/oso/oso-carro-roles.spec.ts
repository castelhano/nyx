import { describe, expect, it } from 'vitest'
import type { OsoCarro, OsoEvent, OsoTripEvent } from './oso-assembler'
import { assignOrdinals, mergeContinuations, operatingMinutes } from './oso-carro-roles'

const trip = (departureMinutes: number, arrivalMinutes: number, originLocalityId: string, destinationLocalityId: string): OsoTripEvent => ({
  kind: 'trip', tripId: `t${departureMinutes}`, routeId: 'r', lineId: 'l', direction: 'OUTBOUND', sheetDirection: 'OUTBOUND',
  departureMinutes, arrivalMinutes, originLocalityId, destinationLocalityId,
})
const reco = (at: number): OsoEvent => ({ kind: 'deadrun', id: `r${at}`, type: 'RETURN', departureMinutes: at, arrivalMinutes: at })
const carro = (blockId: string, events: OsoEvent[], operatorLabel = 'VPAR'): OsoCarro => ({
  blockId, blockNumber: 0, ordinal: null, operatorLabel, operatorFullName: null, leavesForOtherLine: false, comesFromOtherLine: false, events,
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

describe('mergeContinuations across a pause', () => {
  const morning = (over: Partial<OsoCarro> = {}) => ({ ...carro('am', [trip(400, 460, 'V', 'S'), trip(470, 530, 'S', 'V'), reco(530)]), leavesForOtherLine: true, ...over })
  const afternoon = (over: Partial<OsoCarro> = {}) => ({ ...carro('pm', [trip(970, 1030, 'V', 'S'), trip(1040, 1100, 'S', 'V'), reco(1100)]), comesFromOtherLine: true, ...over })

  it('joins a morning block leaving for another line with an afternoon one coming from it, stopping at a RECO', () => {
    const [joined, ...rest] = mergeContinuations([morning(), afternoon()])
    expect(rest).toEqual([])
    expect(joined.events.filter(e => e.kind === 'deadrun')).toHaveLength(2)
    expect(operatingMinutes(joined)).toBe(130 + 130)
  })

  it('needs both blocks swapping lines', () => {
    expect(mergeContinuations([morning({ leavesForOtherLine: false }), afternoon()])).toHaveLength(2)
    expect(mergeContinuations([morning(), afternoon({ comesFromOtherLine: false })])).toHaveLength(2)
  })

  it('leaves a lone trip apart, it stays a REFORÇO', () => {
    const lone = { ...carro('lone', [trip(400, 460, 'V', 'S')]), leavesForOtherLine: true }
    expect(mergeContinuations([lone, afternoon()])).toHaveLength(2)
  })

  it('needs the same terminal', () => {
    const elsewhere = afternoon({ events: [trip(970, 1030, 'X', 'S'), trip(1040, 1100, 'S', 'V')] })
    expect(mergeContinuations([morning(), elsewhere])).toHaveLength(2)
  })

  it('stays off for a line with several routes per direction', () => {
    const otherRoute = morning({ events: [{ ...trip(400, 460, 'V', 'S'), routeId: 'r2' }, trip(470, 530, 'S', 'V')] })
    expect(mergeContinuations([otherRoute, afternoon()])).toHaveLength(2)
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

describe('operatingMinutes', () => {
  it('stops at a RECO and restarts on the next trip', () => {
    const c = carro('a', [trip(333, 518, 'V', 'I'), reco(518), trip(1040, 1133, 'V', 'I'), reco(1133)])
    expect(operatingMinutes(c)).toBe(278)
  })

  it('keeps counting through an INTERV, which leaves the carro out', () => {
    const interval: OsoEvent = { kind: 'interval', id: 'i', intervalTypeId: 't', departureMinutes: 100, arrivalMinutes: 200 }
    expect(operatingMinutes(carro('a', [trip(0, 100, 'V', 'I'), interval, trip(200, 300, 'I', 'V')]))).toBe(300)
  })

  it('counts a carro with no closing RECO up to its last arrival', () => {
    expect(operatingMinutes(carro('a', [trip(0, 19, 'S', 'V')]))).toBe(19)
  })

  it('runs across a continuation, whose RECO was dropped', () => {
    const [joined] = mergeContinuations([
      carro('a', [trip(0, 100, 'S', 'V'), reco(100)]),
      carro('b', [trip(100, 200, 'V', 'S'), reco(200)]),
    ])
    expect(operatingMinutes(joined)).toBe(200)
  })
})
