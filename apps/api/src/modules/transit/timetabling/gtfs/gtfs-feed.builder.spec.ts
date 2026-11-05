import { describe, expect, it } from 'vitest'
import { gtfsCsv } from './gtfs-csv'
import { buildGtfsFeed, type GtfsFeedInput, type GtfsRoute, type GtfsRouteStop } from './gtfs-feed.builder'
import { gtfsTime, localityTimes } from './gtfs-times'

const leg = (...coordinates: [number, number][]) => ({ coordinates })

function stop(sequence: number, code: string | null, deltaMinutes: number | null, geometry: GtfsRouteStop['geometry'] = null): GtfsRouteStop {
  return { sequence, deltaMinutes, geometry, locality: code ? { code, name: `Local ${code}`, lat: -15, lng: -56 } : null }
}

function route(id: string, overrides: Partial<GtfsRoute> = {}): GtfsRoute {
  return {
    id, name: `Rota ${id}`, direction: 'OUTBOUND',
    line: { code: 'A20', name: 'Vila da Serra', externalCodes: null },
    stops: [stop(1, 'A', null), stop(2, null, 5, leg([-56, -15], [-56.01, -15])), stop(3, 'B', 5, leg([-56.01, -15], [-56.02, -15]))],
    ...overrides,
  }
}

function input(overrides: Partial<GtfsFeedInput> = {}): GtfsFeedInput {
  return {
    agency: { id: '1045', name: 'MTU', url: 'https://mtu', timezone: 'America/Cuiaba' },
    routeType: 3, operatorAbbr: 'RAPIDO', version: 12, periodStart: '2026-11-03', periodEnd: '2026-11-30', includeBlocks: false,
    routes: new Map([['r1', route('r1')]]),
    services: [{
      dayType: { code: 'U', name: 'UTIL', pattern: { type: 'weekdays', days: [1, 2, 3, 4, 5] } }, dates: [], otherOperatorTrips: {},
      blocks: [{ blockNumber: 7, trips: [{ routeId: 'r1', departureMinutes: 600, arrivalMinutes: 620 }] }],
    }],
    ...overrides,
  }
}

const rows = (feed: ReturnType<typeof buildGtfsFeed>, file: string) => feed.files[file].rows

describe('localityTimes', () => {
  const stops = (...deltas: (number | null)[]) => deltas.map((deltaMinutes, i) => ({ isLocality: true, deltaMinutes: i ? deltaMinutes : null }))

  it('keeps departure and arrival and scales the middle by the deltas', () => {
    expect(localityTimes(stops(null, 10, 30), 600, 680)).toEqual([36000, 37200, 40800])
  })

  it('counts waypoints in the share without returning them', () => {
    const route = [{ isLocality: true, deltaMinutes: null }, { isLocality: false, deltaMinutes: 10 }, { isLocality: true, deltaMinutes: 10 }, { isLocality: true, deltaMinutes: 20 }]
    expect(localityTimes(route, 0, 40)).toEqual([0, 1200, 2400])
  })

  it('stretches free-flow deltas to the planned duration, not onto the last leg', () => {
    expect(localityTimes(stops(null, 5, 5), 0, 60)).toEqual([0, 1800, 3600])
  })

  it('gives up when the deltas are all zero', () => {
    expect(localityTimes(stops(null, 0, 0), 0, 60)).toBeNull()
  })
})

describe('gtfsTime', () => {
  it('goes past 24h for trips after midnight', () => {
    expect(gtfsTime(1650 * 60)).toBe('27:30:00')
    expect(gtfsTime(30 * 60 + 5)).toBe('00:30:05')
  })
})

describe('buildGtfsFeed', () => {
  it('names the service with the operator, day type and version', () => {
    const feed = buildGtfsFeed(input())
    expect(rows(feed, 'trips')[0].service_id).toBe('RAPIDO_UTIL_V012')
    expect(rows(feed, 'calendar')[0]).toMatchObject({ service_id: 'RAPIDO_UTIL_V012', monday: '1', saturday: '0', start_date: '20261103', end_date: '20261130' })
  })

  it('exports localities as stops and keeps waypoints in the shape only', () => {
    const feed = buildGtfsFeed(input())
    expect(rows(feed, 'stops').map(s => s.stop_id)).toEqual(['A', 'B'])
    expect(rows(feed, 'stop_times').map(s => s.stop_id)).toEqual(['A', 'B'])
    expect(rows(feed, 'shapes').map(s => s.shape_pt_lon)).toEqual(['-56', '-56.01', '-56.02'])
    expect(rows(feed, 'shapes').map(s => s.shape_pt_sequence)).toEqual(['0', '1', '2'])
  })

  it('uses the Goal code as route_id, falling back to the line code', () => {
    const routes = new Map([['r1', route('r1', { line: { code: '031', name: 'Corujao', externalCodes: { GOAL: '31' } } })]])
    const feed = buildGtfsFeed(input({ routes }))
    expect(rows(feed, 'routes')[0]).toMatchObject({ route_id: '31', route_long_name: '31 - Corujao' })
    expect(rows(feed, 'trips')[0].route_id).toBe('31')
    expect(rows(buildGtfsFeed(input()), 'routes')[0].route_id).toBe('A20')
  })

  it('numbers trips by departure, whatever the order they come in', () => {
    const service = { ...input().services[0], blocks: [{ blockNumber: 7, trips: [
      { routeId: 'r1', departureMinutes: 600, arrivalMinutes: 620 },
      { routeId: 'r1', departureMinutes: 30, arrivalMinutes: 50 },
    ] }] }
    const feed = buildGtfsFeed(input({ services: [service] }))
    expect(rows(feed, 'trips').map(t => t.trip_id)).toEqual(['U_A20_7_1', 'U_A20_7_2'])
    expect(rows(feed, 'stop_times')[0]).toMatchObject({ trip_id: 'U_A20_7_1', arrival_time: '00:30:00' })
  })

  it('leaves block_id out unless asked', () => {
    expect(buildGtfsFeed(input()).files.trips.fields).not.toContain('block_id')
    const feed = buildGtfsFeed(input({ includeBlocks: true }))
    expect(rows(feed, 'trips')[0].block_id).toBe('U_7')
  })

  it('maps directions to 0/1', () => {
    const direction = (d: GtfsRoute['direction']) => rows(buildGtfsFeed(input({ routes: new Map([['r1', route('r1', { direction: d })]]) })), 'trips')[0].direction_id
    expect([direction('OUTBOUND'), direction('INBOUND'), direction('CIRCULAR')]).toEqual(['0', '1', '0'])
  })

  it('reports a route without a trace and leaves its trips out', () => {
    const broken = route('r1', { stops: [stop(1, 'A', null), stop(2, 'B', 5)] })
    const feed = buildGtfsFeed(input({ routes: new Map([['r1', broken]]) }))
    expect(rows(feed, 'trips')).toEqual([])
    expect(feed.report.errors).toEqual(['Rota A20 Rota r1: trecho sem traçado'])
  })

  it('reports a route once, however many trips use it', () => {
    const broken = route('r1', { stops: [stop(1, 'A', null), stop(2, 'B', 5)] })
    const service = { ...input().services[0], blocks: [{ blockNumber: 1, trips: [
      { routeId: 'r1', departureMinutes: 0, arrivalMinutes: 10 }, { routeId: 'r1', departureMinutes: 20, arrivalMinutes: 30 },
    ] }] }
    expect(buildGtfsFeed(input({ routes: new Map([['r1', broken]]), services: [service] })).report.errors).toHaveLength(1)
  })

  it('reports two lines mapped to the same Goal code', () => {
    const other = route('r2', { line: { code: 'B20', name: 'Outra', externalCodes: { GOAL: 'A20' } } })
    const service = { ...input().services[0], blocks: [{ blockNumber: 1, trips: [
      { routeId: 'r1', departureMinutes: 0, arrivalMinutes: 10 }, { routeId: 'r2', departureMinutes: 20, arrivalMinutes: 30 },
    ] }] }
    const feed = buildGtfsFeed(input({ routes: new Map([['r1', route('r1')], ['r2', other]]), services: [service] }))
    expect(feed.report.errors[0]).toContain('mesmo código Goal')
  })

  it('warns about a line split between operators', () => {
    const service = { ...input().services[0], otherOperatorTrips: { A20: 42 } }
    expect(buildGtfsFeed(input({ services: [service] })).report.warnings).toEqual(['Linha A20 (UTIL): 1 viagens neste operador e 42 em outro'])
  })

  it('sends month_window day types to calendar_dates', () => {
    const service = { ...input().services[0], dayType: { code: 'X', name: 'FIM MES', pattern: { type: 'month_window' as const } }, dates: ['2026-11-30'] }
    const feed = buildGtfsFeed(input({ services: [service] }))
    expect(feed.files.calendar).toBeUndefined()
    expect(rows(feed, 'calendar_dates')).toEqual([{ service_id: 'RAPIDO_FIM_MES_V012', date: '20261130', exception_type: '1' }])
  })

  it('sums trips, km and minutes per line', () => {
    const [line] = buildGtfsFeed(input()).lines
    expect(line).toMatchObject({ routeId: 'A20', trips: 1, minutes: 20 })
    expect(line.km).toBeCloseTo(2.15, 1)
  })
})

describe('gtfsCsv', () => {
  it('quotes every value and escapes quotes', () => {
    expect(gtfsCsv({ fields: ['a', 'b'], rows: [{ a: 'x"y', b: '1' }] })).toBe('"a","b"\n"x""y","1"\n')
  })
})
