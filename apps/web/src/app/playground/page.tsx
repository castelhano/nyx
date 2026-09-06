'use client'

// Prototype: mark-dash color comparison (violet vs. white) against the REAL trip-block
// palette (engine/renderer.ts + views/vehicles.view.ts) — including the lightened INBOUND
// variant (lightenHex(base, 0.45)) and the white trip label, to check two concrete risks
// with white: (1) low contrast on the already-pale INBOUND color, (2) same hex as the
// label text, which could read as one blended element instead of two.

const PALETTE = [
  '#3b82f6', '#10b981', '#f59e0b', '#ef4444', '#8b5cf6',
]

function lightenHex(hex: string, amount = 0.45): string {
  const r  = parseInt(hex.slice(1, 3), 16)
  const g  = parseInt(hex.slice(3, 5), 16)
  const b  = parseInt(hex.slice(5, 7), 16)
  const lr = Math.round(r + (255 - r) * amount)
  const lg = Math.round(g + (255 - g) * amount)
  const lb = Math.round(b + (255 - b) * amount)
  return `#${lr.toString(16).padStart(2, '0')}${lg.toString(16).padStart(2, '0')}${lb.toString(16).padStart(2, '0')}`
}

const DASH_COLORS = [
  { key: 'violet', label: 'Violeta (#7c3aed) — atual', color: '#7c3aed' },
  { key: 'white',  label: 'Branco (#FFFFFF)',          color: '#FFFFFF' },
]

function TripBlock({ bg, dashColor, width = 90 }: { bg: string; dashColor: string; width?: number }) {
  return (
    <div
      className="relative shrink-0 rounded-[3px] overflow-hidden flex items-center"
      style={{ width, height: 28, background: bg }}
    >
      <span className="text-white text-[11px] font-medium pl-1.5 select-none" style={{ fontFamily: 'Inter, system-ui, sans-serif' }}>
        105
      </span>
      <span
        className="absolute rounded-full"
        style={{ bottom: 3, left: 3, width: 8, height: 3, background: dashColor }}
      />
    </div>
  )
}

export default function PlaygroundPage() {
  return (
    <div className="min-h-full bg-background text-foreground p-6 space-y-8 max-w-[1000px] mx-auto">
      <div>
        <h1 className="text-lg font-semibold">Dash de marcação — violeta vs. branco</h1>
        <p className="text-sm text-muted-foreground mt-1">
          Mesma paleta de linha real (5 cores do PALETTE em vehicles.view.ts) e sua variante
          clareada de sentido INBOUND (lightenHex 0.45), com o label "105" branco de verdade —
          pra ver se o branco some no claro e/ou se funde com o texto.
        </p>
      </div>

      {DASH_COLORS.map(dc => (
        <div key={dc.key} className="bg-card border border-border rounded-xl p-5">
          <h2 className="text-sm font-semibold mb-4">{dc.label}</h2>
          <div className="space-y-3">
            <div>
              <p className="text-xs text-muted-foreground mb-1.5">OUTBOUND (cor base)</p>
              <div className="flex gap-3 flex-wrap">
                {PALETTE.map(c => (
                  <TripBlock key={c} bg={c} dashColor={dc.color} />
                ))}
              </div>
            </div>
            <div>
              <p className="text-xs text-muted-foreground mb-1.5">INBOUND (clareada 45%)</p>
              <div className="flex gap-3 flex-wrap">
                {PALETTE.map(c => (
                  <TripBlock key={c} bg={lightenHex(c)} dashColor={dc.color} />
                ))}
              </div>
            </div>
          </div>
        </div>
      ))}
    </div>
  )
}
