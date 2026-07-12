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

export const DIR_COLOR: Record<RouteDirection, string> = {
  OUTBOUND: '#3b82f6',
  INBOUND:  '#ef4444',
  CIRCULAR: '#22c55e',
}

export const DIR_LABEL: Record<RouteDirection, string> = {
  OUTBOUND: 'Ida',
  INBOUND:  'Volta',
  CIRCULAR: 'Circular',
}

export function getCoord(rl: RouteLocality): { lat: number; lng: number } | null {
  if (rl.localityId && rl.locality?.lat != null && rl.locality?.lng != null) {
    return { lat: rl.locality.lat, lng: rl.locality.lng }
  }
  if (!rl.localityId && rl.lat != null && rl.lng != null) {
    return { lat: rl.lat, lng: rl.lng }
  }
  return null
}
