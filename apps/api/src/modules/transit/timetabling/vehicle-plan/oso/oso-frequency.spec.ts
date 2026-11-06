import { describe, expect, it } from 'vitest'
import type { OsoAssembled, OsoCarro, OsoDirection, OsoTripEvent } from './oso-assembler'
import { buildFrequencyPanels } from './oso-frequency'

const trip = (lineId: string, direction: OsoDirection, departureMinutes: number, routeId = `${lineId}-${direction}`): OsoTripEvent => ({
  kind: 'trip', tripId: `${lineId}${departureMinutes}`, routeId, lineId, direction, sheetDirection: direction,
  departureMinutes, arrivalMinutes: departureMinutes + 30, originLocalityId: 'a', destinationLocalityId: 'b',
})
const carro = (blockId: string, events: OsoTripEvent[]): OsoCarro => ({
  blockId, blockNumber: 0, ordinal: 1, operatorLabel: 'X', operatorFullName: null, leavesForOtherLine: false, comesFromOtherLine: false, events,
})
const assembled = (carros: OsoCarro[], baseLineId = 'base'): OsoAssembled => ({
  vehiclePlanId: 'p', scopeId: 's', baseLineId, carros,
  family: [{ id: 'base', code: '206' }, { id: 'child', code: '206B' }],
})

describe('buildFrequencyPanels', () => {
  it('sorts each direction on its own, across carros', () => {
    const [panel] = buildFrequencyPanels(assembled([
      carro('a', [trip('base', 'OUTBOUND', 400), trip('base', 'INBOUND', 450)]),
      carro('b', [trip('base', 'OUTBOUND', 300), trip('base', 'INBOUND', 340)]),
    ]))
    expect(panel.columns.map(c => c.departures)).toEqual([[300, 400], [340, 450]])
    expect(panel.trips).toBe(2)
    expect(panel.title).toBeNull()
  })

  it('gives each variant its own panel, with only the directions it runs', () => {
    const panels = buildFrequencyPanels(assembled([
      carro('a', [trip('base', 'OUTBOUND', 400), trip('child', 'OUTBOUND', 300), trip('child', 'OUTBOUND', 330), trip('child', 'OUTBOUND', 360)]),
    ]))
    expect(panels.map(p => p.title)).toEqual([null, '206B'])
    expect(panels[1].columns).toEqual([{ direction: 'OUTBOUND', departures: [300, 330, 360] }])
    expect(panels[1].trips).toBe(1.5)
  })

  it('keeps a trip past midnight at the end', () => {
    const [panel] = buildFrequencyPanels(assembled([carro('a', [trip('base', 'OUTBOUND', 1450), trip('base', 'OUTBOUND', 1400)])]))
    expect(panel.columns[0].departures).toEqual([1400, 1450])
  })

  it('skips a line with several routes per direction', () => {
    expect(buildFrequencyPanels(assembled([
      carro('a', [trip('base', 'OUTBOUND', 300, 'r1'), trip('base', 'OUTBOUND', 400, 'r2')]),
    ]))).toEqual([])
  })
})
