import { describe, expect, it } from 'vitest'
import type { OsoCarro, OsoEvent, OsoTripEvent } from './oso-assembler'
import { computeCycleTimes } from './oso-summary'

const ida = (departureMinutes: number, arrivalMinutes: number, routeId = 'ida'): OsoTripEvent => ({
  kind: 'trip', tripId: `t${departureMinutes}`, routeId, lineId: 'l', direction: 'OUTBOUND', sheetDirection: 'OUTBOUND',
  departureMinutes, arrivalMinutes, originLocalityId: 'A', destinationLocalityId: 'M',
})
const volta = (departureMinutes: number, arrivalMinutes: number, routeId = 'volta'): OsoTripEvent => ({
  ...ida(departureMinutes, arrivalMinutes, routeId), direction: 'INBOUND', sheetDirection: 'INBOUND', originLocalityId: 'M', destinationLocalityId: 'A',
})
const reco = (at: number): OsoEvent => ({ kind: 'deadrun', id: `r${at}`, type: 'RETURN', departureMinutes: at, arrivalMinutes: at })
const interv = (from: number, to: number): OsoEvent => ({ kind: 'interval', id: `i${from}`, intervalTypeId: 't', departureMinutes: from, arrivalMinutes: to })
const carro = (events: OsoEvent[]): OsoCarro => ({
  blockId: 'b', blockNumber: 0, ordinal: 1, operatorLabel: 'VPAR', operatorFullName: null, leavesForOtherLine: false, comesFromOtherLine: false, events,
})
// a round trip starting at t: 40' ida, 5' folga, 40' volta — 90' to the next departure
const cycle = (t: number) => [ida(t, t + 40), volta(t + 45, t + 85)]

describe('computeCycleTimes', () => {
  it('measures each cycle up to the next departure', () => {
    expect(computeCycleTimes([carro([...cycle(0), ...cycle(90), ...cycle(180), ...cycle(270)])])).toEqual([90])
  })

  it('does not measure a cycle across a RECO or an INTERV', () => {
    const c = carro([
      ...cycle(0), ...cycle(90), ...cycle(180), reco(265),
      ...cycle(600), interv(685, 900), ...cycle(900), ...cycle(990), ...cycle(1080),
    ])
    expect(computeCycleTimes([c])).toEqual([90])
  })

  it('falls back to the mode of every sample when nothing reaches a cluster (R03)', () => {
    const r03 = carro([
      ida(300, 380), volta(385, 470), reco(471),
      ida(660, 740), volta(745, 830), reco(831),
      ida(1080, 1160), volta(1165, 1250), reco(1251),
    ])
    expect(computeCycleTimes([r03])).toEqual([170])
  })

  it('leaves a line with several routes per direction blank on the fallback (F01)', () => {
    const f01 = carro([ida(0, 40), volta(45, 85), ida(90, 130, 'ida2'), volta(135, 175)])
    expect(computeCycleTimes([f01])).toEqual([])
  })

  it('keeps no fallback when a cluster exists', () => {
    const c = carro([...cycle(0), ...cycle(90), ...cycle(180), ...cycle(270), reco(355), ...cycle(600), reco(685)])
    expect(computeCycleTimes([c])).toEqual([90])
  })
})
