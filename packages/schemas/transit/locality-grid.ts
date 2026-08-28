// Quadrant grid for suggesting a TransitLocality `code` from lat/lng.
//
// Core box (anchored on real points of the network, with room to grow):
// North = Bandeira, South/East/West = the outer reference points the user provided.
export const LOCALITY_GRID_BOUNDS = {
  // exact value of "Bandeira" (not rounded) — otherwise the very point anchoring the
  // north edge falls "outside" due to floating-point drift.
  north: -15.5099055,
  south: -15.699610,
  west:  -56.232420,
  east:  -55.921120,
}

export const LOCALITY_GRID_CELL_KM = 1

const KM_PER_DEG_LAT = 111.32
const KM_PER_DEG_LNG = KM_PER_DEG_LAT * Math.cos(
  ((LOCALITY_GRID_BOUNDS.north + LOCALITY_GRID_BOUNDS.south) / 2) * Math.PI / 180,
)

const CELL_DEG_LAT = LOCALITY_GRID_CELL_KM / KM_PER_DEG_LAT
const CELL_DEG_LNG = LOCALITY_GRID_CELL_KM / KM_PER_DEG_LNG

const GRID_ROWS = Math.ceil((LOCALITY_GRID_BOUNDS.north - LOCALITY_GRID_BOUNDS.south) / CELL_DEG_LAT)
const GRID_COLS = Math.ceil((LOCALITY_GRID_BOUNDS.east - LOCALITY_GRID_BOUNDS.west) / CELL_DEG_LNG)

// Geometric center of the core box — only decides the A-D letter (purely redundant for
// human readability), doesn't affect row/col, which are always global from the NW corner.
const GRID_CENTER = {
  lat: (LOCALITY_GRID_BOUNDS.north + LOCALITY_GRID_BOUNDS.south) / 2,
  lng: (LOCALITY_GRID_BOUNDS.west + LOCALITY_GRID_BOUNDS.east) / 2,
}

export interface LocalityQuadrant {
  letter: string
  row:    number // 0 for points outside the core box (RR/CC don't represent a real cell)
  col:    number
  prefix: string // fixed part of the code, without the sequence — e.g. "A1401" or "E0000"
}

function pad2(n: number): string {
  return String(n).padStart(2, '0')
}

// When a point exceeds more than one side of the box at once (e.g. outside to the north
// and to the east), break the tie by whichever axis has the larger excess in km.
function classifyOutside(lat: number, lng: number): string {
  const { north, south, west, east } = LOCALITY_GRID_BOUNDS
  const candidates: [string, number][] = [
    ['E', lat > north ? (lat - north) * KM_PER_DEG_LAT : -1],
    ['F', lat < south ? (south - lat) * KM_PER_DEG_LAT : -1],
    ['G', lng > east  ? (lng - east)  * KM_PER_DEG_LNG : -1],
    ['H', lng < west  ? (west - lng)  * KM_PER_DEG_LNG : -1],
  ]
  return candidates.reduce((best, cur) => (cur[1] > best[1] ? cur : best))[0]
}

export function localityQuadrant(lat: number, lng: number): LocalityQuadrant {
  const { north, south, west, east } = LOCALITY_GRID_BOUNDS

  if (lat > north || lat < south || lng < west || lng > east) {
    const letter = classifyOutside(lat, lng)
    return { letter, row: 0, col: 0, prefix: `${letter}0000` }
  }

  const row    = Math.min(Math.floor((north - lat) / CELL_DEG_LAT), GRID_ROWS - 1)
  const col    = Math.min(Math.floor((lng - west) / CELL_DEG_LNG), GRID_COLS - 1)
  const letter = lat >= GRID_CENTER.lat
    ? (lng >= GRID_CENTER.lng ? 'A' : 'B')
    : (lng >= GRID_CENTER.lng ? 'C' : 'D')

  return { letter, row, col, prefix: `${letter}${pad2(row)}${pad2(col)}` }
}
