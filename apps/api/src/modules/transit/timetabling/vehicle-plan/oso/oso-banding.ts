import type { OsoAssembled } from './oso-assembler'
import type { OsoCarroLayout } from './oso-layout.resolver'

// Layer 3 of the OSO export pipeline (docs/proposal/plan_oso_export_v1.md) — groups carros
// into bands by actual column width (rule 5), not a fixed carro count: narrow carros pack
// many per band, a single wide/dense one can fill most of a band by itself. Carros stay in
// the order the assembler already numbered them (rule 6); banding never reorders them.

export interface OsoBand {
  blockIds: string[]
}

// column budget per band — matches the legacy sheets' print area (A1:U54 -> B:U = 20 data
// columns); revisit alongside MAX_ROWS_PER_BAND once the renderer (layer 6) fixes real page
// geometry (font size, margins).
const MAX_COLUMNS_PER_BAND = 20

function widthOf(layout: OsoCarroLayout): number {
  return layout.columns.length * layout.tripsPerRow
}

export function bandCarros(
  assembled: OsoAssembled,
  layouts:   Map<string, OsoCarroLayout>,
): OsoBand[] {
  const bands: OsoBand[] = []
  let current: string[] = []
  let currentWidth = 0

  for (const carro of assembled.carros) {
    const width = widthOf(layouts.get(carro.blockId)!)

    // a lone carro wider than the whole budget still gets its own band — it can't split
    // any further (tripsPerRow is capped at 2, rule 4)
    if (current.length > 0 && currentWidth + width > MAX_COLUMNS_PER_BAND) {
      bands.push({ blockIds: current })
      current = []
      currentWidth = 0
    }

    current.push(carro.blockId)
    currentWidth += width
  }

  if (current.length > 0) bands.push({ blockIds: current })

  return bands
}
