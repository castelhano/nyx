import { gtfsServiceId, resolveExternalCode, type GtfsLineSummary, type GtfsReport } from '@nyx/schemas'
import { ROUTE_COLOR_PALETTE } from '@nyx/types'
import type { GtfsTable } from './gtfs-csv'
import { gtfsTime, localityTimes } from './gtfs-times'

export type GtfsDirection = 'OUTBOUND' | 'INBOUND' | 'CIRCULAR'
export type GtfsPattern = { type: 'weekdays'; days: number[] } | { type: 'month_window' }

export interface GtfsRouteStop {
  sequence:     number
  deltaMinutes: number | null
  geometry:     { coordinates: [number, number][] } | null
  // null = routing waypoint: shapes the trace, never becomes a stop
  locality:     { code: string; name: string; lat: number | null; lng: number | null } | null
}

export interface GtfsRoute {
  id:        string
  name:      string
  direction: GtfsDirection
  line:      { code: string; name: string; externalCodes: unknown }
  stops:     GtfsRouteStop[]
}

export interface GtfsService {
  dayType: { code: string; name: string; pattern: GtfsPattern }
  // month_window day types: their days in the period (YYYY-MM-DD)
  dates:   string[]
  blocks:  { blockNumber: number; trips: { routeId: string; departureMinutes: number; arrivalMinutes: number }[] }[]
  // line code → trips of the line run by other operators in this plan
  otherOperatorTrips: Record<string, number>
}

export interface GtfsFeedInput {
  agency:        { id: string; name: string; url: string; timezone: string }
  routeType:     number
  operatorAbbr:  string
  version:       number
  periodStart:   string
  periodEnd:     string
  includeBlocks: boolean
  services:      GtfsService[]
  routes:        Map<string, GtfsRoute>
}

export interface GtfsFeed {
  files:  Record<string, GtfsTable>
  lines:  GtfsLineSummary[]
  report: GtfsReport
}

const WEEK = ['monday', 'tuesday', 'wednesday', 'thursday', 'friday', 'saturday', 'sunday']
const DIRECTION_ID: Record<GtfsDirection, string> = { OUTBOUND: '0', CIRCULAR: '0', INBOUND: '1' }

const compactDay = (day: string) => day.replaceAll('-', '')

function haversineKm([lng1, lat1]: [number, number], [lng2, lat2]: [number, number]): number {
  const rad = Math.PI / 180
  const a   = Math.sin(((lat2 - lat1) * rad) / 2) ** 2
    + Math.cos(lat1 * rad) * Math.cos(lat2 * rad) * Math.sin(((lng2 - lng1) * rad) / 2) ** 2
  return 2 * 6371 * Math.asin(Math.sqrt(a))
}

interface CompiledRoute {
  route:  GtfsRoute
  routeId: string
  stops:  GtfsRouteStop[]
  shape:  [number, number][]
  km:     number
}

// null when the route can't be exported — the reason goes to the report
function compileRoute(route: GtfsRoute, report: GtfsReport): CompiledRoute | null {
  const label = `Rota ${route.line.code} ${route.name}`
  const stops = [...route.stops].sort((a, b) => a.sequence - b.sequence)
  const fail  = (reason: string) => { report.errors.push(`${label}: ${reason}`); return null }

  if (stops.filter(s => s.locality).length < 2) return fail('menos de duas localidades')
  const noCoords = stops.find(s => s.locality && (s.locality.lat == null || s.locality.lng == null))
  if (noCoords) return fail(`localidade ${noCoords.locality!.code} sem coordenadas`)

  const shape: [number, number][] = []
  for (const stop of stops.slice(1)) {
    const coordinates = stop.geometry?.coordinates
    if (!coordinates || coordinates.length < 2) return fail('trecho sem traçado')
    // legs share their junction point
    shape.push(...(shape.length ? coordinates.slice(1) : coordinates))
  }

  const km = shape.slice(1).reduce((sum, point, i) => sum + haversineKm(shape[i], point), 0)
  return { route, routeId: resolveExternalCode(route.line, 'GOAL').code, stops, shape, km }
}

function routesTable(input: GtfsFeedInput, usedLines: Map<string, GtfsRoute['line']>): GtfsTable {
  const rows = [...usedLines.entries()]
    .sort(([a], [b]) => a.localeCompare(b, undefined, { numeric: true }))
    .map(([routeId, line], i) => ({
      route_id:         routeId,
      agency_id:        input.agency.id,
      route_short_name: routeId,
      route_long_name:  `${routeId} - ${line.name}`,
      route_type:       String(input.routeType),
      route_color:      ROUTE_COLOR_PALETTE[i % ROUTE_COLOR_PALETTE.length].value.slice(1).toUpperCase(),
    }))
  return { fields: ['route_id', 'agency_id', 'route_short_name', 'route_long_name', 'route_type', 'route_color'], rows }
}

function calendarTables(input: GtfsFeedInput): Record<string, GtfsTable> {
  const calendar: Record<string, string>[] = []
  const dates:    Record<string, string>[] = []

  for (const service of input.services) {
    const serviceId = gtfsServiceId(input.operatorAbbr, service.dayType.name, input.version)
    const { pattern } = service.dayType
    if (pattern.type === 'weekdays') {
      calendar.push({
        service_id: serviceId,
        ...Object.fromEntries(WEEK.map((day, i) => [day, pattern.days.includes(i + 1) ? '1' : '0'])),
        start_date: compactDay(input.periodStart),
        end_date:   compactDay(input.periodEnd),
      })
    } else {
      for (const date of service.dates) dates.push({ service_id: serviceId, date: compactDay(date), exception_type: '1' })
    }
  }

  return {
    ...(calendar.length ? { calendar: { fields: ['service_id', ...WEEK, 'start_date', 'end_date'], rows: calendar } } : {}),
    ...(dates.length ? { calendar_dates: { fields: ['service_id', 'date', 'exception_type'], rows: dates } } : {}),
  }
}

export function buildGtfsFeed(input: GtfsFeedInput): GtfsFeed {
  const report: GtfsReport = { blockers: [], errors: [], warnings: [] }

  const compiled = new Map<string, CompiledRoute | null>()
  const compile  = (routeId: string) => {
    if (!compiled.has(routeId)) compiled.set(routeId, compileRoute(input.routes.get(routeId)!, report))
    return compiled.get(routeId)!
  }

  const trips:     Record<string, string>[] = []
  const stopTimes: Record<string, string>[] = []
  const usedLines  = new Map<string, GtfsRoute['line']>()
  const usedStops  = new Map<string, NonNullable<GtfsRouteStop['locality']>>()
  const usedShapes = new Map<string, CompiledRoute>()
  const lines      = new Map<string, GtfsLineSummary>()

  for (const service of input.services) {
    const serviceId = gtfsServiceId(input.operatorAbbr, service.dayType.name, input.version)
    const tripsByLine = new Map<string, number>()

    for (const block of service.blocks) {
      // departure order, not BlockTrip.sequence: a trip moved between blocks goes to the end of it
      const ordered = [...block.trips].sort((a, b) => a.departureMinutes - b.departureMinutes)

      ordered.forEach((trip, i) => {
        const route = compile(trip.routeId)
        if (!route) return

        const tripId = `${service.dayType.code}_${route.routeId}_${block.blockNumber}_${i + 1}`
        const times  = localityTimes(route.stops.map(s => ({ isLocality: !!s.locality, deltaMinutes: s.deltaMinutes })), trip.departureMinutes, trip.arrivalMinutes)
        if (!times) {
          report.errors.push(`Viagem ${tripId}: rota ${route.route.name} sem tempos entre localidades`)
          return
        }
        if (trip.arrivalMinutes <= trip.departureMinutes) report.warnings.push(`Viagem ${tripId}: duração não positiva`)

        trips.push({
          route_id:        route.routeId,
          service_id:      serviceId,
          trip_id:         tripId,
          trip_short_name: tripId,
          direction_id:    DIRECTION_ID[route.route.direction],
          shape_id:        route.route.id,
          ...(input.includeBlocks ? { block_id: `${service.dayType.code}_${block.blockNumber}` } : {}),
        })

        route.stops.filter(s => s.locality).forEach((stop, position) => {
          const time = gtfsTime(times[position])
          stopTimes.push({ trip_id: tripId, arrival_time: time, departure_time: time, stop_id: stop.locality!.code, stop_sequence: String(position) })
          usedStops.set(stop.locality!.code, stop.locality!)
        })

        usedShapes.set(route.route.id, route)
        const known = usedLines.get(route.routeId)
        if (known && known.code !== route.route.line.code) {
          report.errors.push(`Linhas ${known.code} e ${route.route.line.code} usam o mesmo código Goal ${route.routeId}`)
        }
        usedLines.set(route.routeId, route.route.line)
        tripsByLine.set(route.route.line.code, (tripsByLine.get(route.route.line.code) ?? 0) + 1)

        const summary = lines.get(route.routeId) ?? { routeId: route.routeId, name: route.route.line.name, trips: 0, km: 0, minutes: 0 }
        summary.trips   += 1
        summary.km      += route.km
        summary.minutes += trip.arrivalMinutes - trip.departureMinutes
        lines.set(route.routeId, summary)
      })
    }

    for (const [code, count] of tripsByLine) {
      const others = service.otherOperatorTrips[code]
      if (others) report.warnings.push(`Linha ${code} (${service.dayType.name}): ${count} viagens neste operador e ${others} em outro`)
    }
  }

  const { id: agency_id, name: agency_name, url: agency_url, timezone: agency_timezone } = input.agency

  return {
    report,
    lines: [...lines.values()].sort((a, b) => a.routeId.localeCompare(b.routeId, undefined, { numeric: true })),
    files: {
      agency: { fields: ['agency_id', 'agency_name', 'agency_url', 'agency_timezone'], rows: [{ agency_id, agency_name, agency_url, agency_timezone }] },
      ...calendarTables(input),
      routes: routesTable(input, usedLines),
      shapes: {
        fields: ['shape_id', 'shape_pt_lat', 'shape_pt_lon', 'shape_pt_sequence'],
        rows:   [...usedShapes.values()].flatMap(r => r.shape.map(([lng, lat], i) => ({
          shape_id: r.route.id, shape_pt_lat: String(lat), shape_pt_lon: String(lng), shape_pt_sequence: String(i),
        }))),
      },
      stop_times: { fields: ['trip_id', 'arrival_time', 'departure_time', 'stop_id', 'stop_sequence'], rows: stopTimes },
      stops: {
        fields: ['stop_id', 'stop_code', 'stop_name', 'stop_lat', 'stop_lon'],
        rows:   [...usedStops.values()].sort((a, b) => a.code.localeCompare(b.code)).map(l => ({
          stop_id: l.code, stop_code: l.code, stop_name: l.name, stop_lat: String(l.lat), stop_lon: String(l.lng),
        })),
      },
      trips: {
        fields: ['route_id', 'service_id', 'trip_id', 'trip_short_name', 'direction_id', 'shape_id', ...(input.includeBlocks ? ['block_id'] : [])],
        rows:   trips,
      },
    },
  }
}
