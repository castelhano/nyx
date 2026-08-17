export type RouteDirection = 'OUTBOUND' | 'INBOUND' | 'CIRCULAR'

export interface RouteLocalityLocality {
  id: string
  name: string
  code: string
  abbr: string | null
  lat: number | null
  lng: number | null
}

export interface RouteLocality {
  id: string
  routeId: string
  localityId: string | null
  lat: number | null
  lng: number | null
  sequence: number
  deltaMinutes: number | null
  deltaKm: number | null
  deltaSource: 'OSRM' | 'MANUAL'
  geometry: GeoJSONLineString | null
  allowsCrewChange: boolean
  updatedAt: string
  locality: RouteLocalityLocality | null
}

export interface TransitRoute {
  id: string
  lineId: string
  direction: RouteDirection
  name: string
  originLocalityId: string
  destinationLocalityId: string
  isActive: boolean
  isPrimary: boolean
  // manual override for the trajectory color — null inherits DIR_COLOR[direction],
  // used when a line has more than one sentido in the same direction
  color: string | null
}

export interface GeoJSONLineString {
  type: 'LineString'
  coordinates: [number, number][]
}

export interface SuggestedLocality {
  id: string
  name: string
  code: string
  lat: number
  lng: number
  distanceM: number
  insertAfterSequence: number
}

// Pending point not yet persisted
export interface PendingPoint {
  _pendingId: string   // client-only uuid
  localityId: string | null
  localityName: string | null
  code: string | null   // set when a new TransitLocality must be created on save
  abbr: string | null
  lat: number
  lng: number
  isWaypoint: boolean
  allowsCrewChange: boolean
  // RouteLocality.id or another pending point's _pendingId to insert after;
  // null = insert as the very first stop, before the origin
  insertAfterKey: string | null
}

// Curated, colorblind-safe swatches offered to override a sentido's trajectory
// color (CreateRouteModal) — needed when a line has more than one sentido in the
// same direction, since they'd otherwise share DIR_COLOR. `mark` is the paired
// darker shade for points/waypoints/arrows, same relationship as DIR_MARK_COLOR.
export const ROUTE_COLOR_PALETTE: { value: string; mark: string }[] = [
  { value: '#2a78d6', mark: '#1a569e' }, // blue
  { value: '#eb6834', mark: '#c0410e' }, // orange
  { value: '#1baf7a', mark: '#118159' }, // aqua
  { value: '#eda100', mark: '#ab7400' }, // yellow
  { value: '#e87ba4', mark: '#de2168' }, // magenta
  { value: '#008300', mark: '#005e00' }, // green
  { value: '#4a3aa7', mark: '#33277b' }, // violet
  { value: '#e34948', mark: '#bf1918' }, // red
]

// Direction defaults reuse ROUTE_COLOR_PALETTE hues exactly (not just similar tones)
// so the "Automático" swatch can be matched by value and excluded from the palette
// grid — otherwise the current direction's color would appear twice.
export const DIR_COLOR: Record<RouteDirection, string> = {
  OUTBOUND: ROUTE_COLOR_PALETTE[0].value, // blue
  INBOUND:  ROUTE_COLOR_PALETTE[7].value, // red
  CIRCULAR: ROUTE_COLOR_PALETTE[5].value, // green
}

export const DIR_LABEL: Record<RouteDirection, string> = {
  OUTBOUND: 'Ida',
  INBOUND:  'Volta',
  CIRCULAR: 'Circular',
}

// darker shade of DIR_COLOR used for points/waypoints/arrows on the map — same hue as
// the trace so it still reads as "this route", but distinct enough to stand out over it
export const DIR_MARK_COLOR: Record<RouteDirection, string> = {
  OUTBOUND: ROUTE_COLOR_PALETTE[0].mark,
  INBOUND:  ROUTE_COLOR_PALETTE[7].mark,
  CIRCULAR: ROUTE_COLOR_PALETTE[5].mark,
}

export function getRouteColor(route: { direction: RouteDirection; color?: string | null }): string {
  return route.color ?? DIR_COLOR[route.direction]
}

export function getRouteMarkColor(route: { direction: RouteDirection; color?: string | null }): string {
  if (route.color) {
    const match = ROUTE_COLOR_PALETTE.find((c) => c.value === route.color)
    if (match) return match.mark
  }
  return DIR_MARK_COLOR[route.direction]
}

// highlight color for a point selected for repositioning — same amber used for pending points
export const REPOSITION_COLOR = '#f59e0b'

// color for suggested-but-not-yet-persisted points plotted on the map
export const SUGGEST_COLOR = '#8b5cf6'

export function getCoord(rl: RouteLocality): { lat: number; lng: number } | null {
  if (rl.localityId && rl.locality?.lat != null && rl.locality?.lng != null) {
    return { lat: rl.locality.lat, lng: rl.locality.lng }
  }
  if (!rl.localityId && rl.lat != null && rl.lng != null) {
    return { lat: rl.lat, lng: rl.lng }
  }
  return null
}
