export type StopGlyphKind = 'origin' | 'destination' | 'stop' | 'waypoint'

// single source of truth for the origin/destination/stop/waypoint markers —
// rendered as plain divs (RulerCanvas, SeqModal) or serialized into a Leaflet divIcon (MapCanvas)
export function stopGlyphMarkup(kind: StopGlyphKind, color: string, size = 14): string {
  const half = size / 2
  if (kind === 'destination') {
    const inset = size * 0.1
    return `<svg width="${size}" height="${size}" viewBox="0 0 ${size} ${size}" xmlns="http://www.w3.org/2000/svg"><polygon points="${inset},${inset} ${size - inset},${inset} ${half},${size - inset}" fill="${color}" stroke="#fff" stroke-width="1.5"/></svg>`
  }
  if (kind === 'waypoint') {
    const r = size * 0.26
    return `<svg width="${size}" height="${size}" viewBox="0 0 ${size} ${size}" xmlns="http://www.w3.org/2000/svg"><circle cx="${half}" cy="${half}" r="${r}" fill="${color}" stroke="#fff" stroke-width="1" stroke-dasharray="2,2"/></svg>`
  }
  const r = kind === 'origin' ? size * 0.42 : size * 0.3
  return `<svg width="${size}" height="${size}" viewBox="0 0 ${size} ${size}" xmlns="http://www.w3.org/2000/svg"><circle cx="${half}" cy="${half}" r="${r}" fill="${color}" stroke="#fff" stroke-width="1.5"/></svg>`
}

export function StopGlyph({ kind, color, size = 14 }: { kind: StopGlyphKind; color: string; size?: number }) {
  return (
    <span
      className="inline-block shrink-0"
      style={{ width: size, height: size }}
      dangerouslySetInnerHTML={{ __html: stopGlyphMarkup(kind, color, size) }}
    />
  )
}
