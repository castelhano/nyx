'use client'

import { useEffect } from 'react'
import { useMap } from 'react-leaflet'
import L from 'leaflet'
import 'leaflet-polylinedecorator'

interface Props {
  coordinates: [number, number][]  // GeoJSON order: [lng, lat]
  color:       string
  opacity:     number
}

// draws repeated arrowheads along a leg's OSRM geometry so the route's
// direction of travel is visible regardless of zoom level
export function DirectionArrows({ coordinates, color, opacity }: Props) {
  const map = useMap()

  useEffect(() => {
    if (coordinates.length < 2) return
    const positions = coordinates.map(([lng, lat]) => L.latLng(lat, lng))

    const decorator = new L.PolylineDecorator(positions, {
      patterns: [{
        offset: '5%',
        repeat: '100px',
        symbol: L.Symbol.arrowHead({
          pixelSize:   10,
          polygon:     true,
          pathOptions: { color: '#fff', weight: 1, fillColor: color, fillOpacity: opacity, opacity },
        }),
      }],
    }).addTo(map)

    return () => { decorator.remove() }
  }, [map, coordinates, color, opacity])

  return null
}
