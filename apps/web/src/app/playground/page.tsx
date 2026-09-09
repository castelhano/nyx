'use client'

import { useEffect, useRef } from 'react'

// Prototype for stopPattern (LOCAL/LIMITED/EXPRESS) visual variants in the Gantt.
// Draw primitives below mirror apps/web/src/app/transit/vehicle-plan/[id]/engine/renderer.ts
// exactly (colors, radius, indicator sizes) so this reads as a faithful preview, not a mockup.

type StopPattern = 'LOCAL' | 'LIMITED' | 'EXPRESS'

const SEG_W    = 170
const SEG_H    = 38
const GAP      = 16
const RADIUS   = 3
const CANVAS_H = SEG_H + 16

const LINE_COLOR      = '#3b82f6' // PALETTE[0] in vehicles.view.ts
const LOCK_DOT_COLOR  = '#0f172a'
const DRIFT_COLOR     = '#f43f5e'
const MARK_COLOR      = '#ffffff'

// ── shared chrome — identical to renderer.ts's existing passes ─────────────────

function roundRectPath(ctx: CanvasRenderingContext2D, x: number, y: number, w: number, h: number, r: number) {
  ctx.beginPath()
  ctx.roundRect(x, y, w, h, r)
}

function drawBase(ctx: CanvasRenderingContext2D, x: number, y: number, w: number, h: number) {
  roundRectPath(ctx, x, y, w, h, RADIUS)
  ctx.fillStyle = LINE_COLOR
  ctx.fill()
}

function drawLock(ctx: CanvasRenderingContext2D, x: number, y: number, w: number) {
  ctx.fillStyle = LOCK_DOT_COLOR
  ctx.beginPath()
  ctx.arc(x + w - 6, y + 6, 3, 0, Math.PI * 2)
  ctx.fill()
}

function drawDrift(ctx: CanvasRenderingContext2D, x: number, y: number, w: number, h: number) {
  ctx.save()
  ctx.fillStyle = DRIFT_COLOR
  roundRectPath(ctx, x, y, w, h, RADIUS)
  ctx.clip()
  ctx.beginPath()
  ctx.moveTo(x + w, y + h - 10)
  ctx.lineTo(x + w, y + h)
  ctx.lineTo(x + w - 10, y + h)
  ctx.closePath()
  ctx.fill()
  ctx.restore()
}

function drawMarked(ctx: CanvasRenderingContext2D, x: number, y: number, h: number) {
  ctx.fillStyle = MARK_COLOR
  ctx.beginPath()
  ctx.roundRect(x + 3, y + h - 6, 8, 3, 1.5)
  ctx.fill()
}

function drawLabel(ctx: CanvasRenderingContext2D, x: number, y: number, w: number, h: number, text: string) {
  ctx.fillStyle = '#fff'
  ctx.font = '11px Inter, system-ui, sans-serif'
  // textBaseline 'middle' centers on the font's em-box (which reserves room for
  // descenders like g/y/p), not the glyphs actually drawn — text with no descenders
  // (e.g. "107") ends up looking shifted up. Measuring the real ink box and centering
  // on that instead fixes it regardless of what the label happens to contain.
  ctx.textBaseline = 'alphabetic'
  const metrics  = ctx.measureText(text)
  const optical  = (metrics.actualBoundingBoxAscent - metrics.actualBoundingBoxDescent) / 2
  ctx.fillText(text, x + 8, y + h / 2 + optical, w - 16)
}

// ── Proposal 1 — top-left chevron glyph (uses the one corner still free today) ──

function drawP1Indicator(ctx: CanvasRenderingContext2D, x: number, y: number, pattern: StopPattern) {
  if (pattern === 'LOCAL') return
  ctx.save()
  ctx.strokeStyle = 'rgba(255,255,255,0.95)'
  ctx.lineWidth = 1.4
  ctx.lineCap = 'round'
  ctx.lineJoin = 'round'
  const cy = y + 8
  const chevron = (cx: number) => {
    ctx.beginPath()
    ctx.moveTo(cx, cy - 3)
    ctx.lineTo(cx + 3, cy)
    ctx.lineTo(cx, cy + 3)
    ctx.stroke()
  }
  chevron(x + 6)
  if (pattern === 'EXPRESS') chevron(x + 10)
  ctx.restore()
}

// ── Proposal 2 — outline stroke on the block itself (solid/dashed, no new corner) ──

function drawP2Indicator(ctx: CanvasRenderingContext2D, x: number, y: number, w: number, h: number, pattern: StopPattern) {
  if (pattern === 'LOCAL') return
  ctx.save()
  ctx.strokeStyle = 'rgba(255,255,255,0.9)'
  ctx.lineWidth = pattern === 'EXPRESS' ? 1.75 : 1.1
  ctx.setLineDash(pattern === 'LIMITED' ? [3, 2] : [])
  roundRectPath(ctx, x + 1.25, y + 1.25, w - 2.5, h - 2.5, RADIUS - 1)
  ctx.stroke()
  ctx.restore()
}

// ── Proposal 3 — shape silhouette (biggest departure: changes the block's own outline) ──

function drawP3Base(ctx: CanvasRenderingContext2D, x: number, y: number, w: number, h: number, pattern: StopPattern) {
  ctx.beginPath()
  if (pattern === 'LIMITED') {
    const midX = x + w / 2
    ctx.moveTo(x + RADIUS, y)
    ctx.lineTo(midX - 5, y)
    ctx.lineTo(midX, y + 5)
    ctx.lineTo(midX + 5, y)
    ctx.lineTo(x + w - RADIUS, y)
    ctx.arcTo(x + w, y, x + w, y + RADIUS, RADIUS)
    ctx.lineTo(x + w, y + h - RADIUS)
    ctx.arcTo(x + w, y + h, x + w - RADIUS, y + h, RADIUS)
    ctx.lineTo(x + RADIUS, y + h)
    ctx.arcTo(x, y + h, x, y + h - RADIUS, RADIUS)
    ctx.lineTo(x, y + RADIUS)
    ctx.arcTo(x, y, x + RADIUS, y, RADIUS)
  } else if (pattern === 'EXPRESS') {
    ctx.moveTo(x + RADIUS, y)
    ctx.lineTo(x + w - 9, y)
    ctx.lineTo(x + w, y + h / 2)
    ctx.lineTo(x + w - 9, y + h)
    ctx.lineTo(x + RADIUS, y + h)
    ctx.arcTo(x, y + h, x, y + h - RADIUS, RADIUS)
    ctx.lineTo(x, y + RADIUS)
    ctx.arcTo(x, y, x + RADIUS, y, RADIUS)
  } else {
    ctx.roundRect(x, y, w, h, RADIUS)
  }
  ctx.closePath()
  ctx.fillStyle = LINE_COLOR
  ctx.fill()
}

// ── Proposal 4 — stop-density ticks along the top edge (literal metaphor) ──

function drawP4Indicator(ctx: CanvasRenderingContext2D, x: number, y: number, w: number, pattern: StopPattern) {
  const spacing = pattern === 'LOCAL' ? 12 : pattern === 'LIMITED' ? 26 : 0
  if (spacing === 0) return
  ctx.save()
  ctx.strokeStyle = 'rgba(255,255,255,0.65)'
  ctx.lineWidth = 1
  ctx.beginPath()
  for (let tx = x + spacing; tx < x + w - 3; tx += spacing) {
    ctx.moveTo(tx, y + 2)
    ctx.lineTo(tx, y + 6)
  }
  ctx.stroke()
  ctx.restore()
}

// ── demo row: 4 slots — LOCAL, LIMITED, EXPRESS, EXPRESS+lock+drift+marked (stress test) ──

type DrawFn = (ctx: CanvasRenderingContext2D, x: number, y: number, pattern: StopPattern, stress: boolean) => void

function useDemoCanvas(draw: DrawFn) {
  const ref = useRef<HTMLCanvasElement>(null)

  useEffect(() => {
    const canvas = ref.current
    if (!canvas) return
    const ctx = canvas.getContext('2d')
    if (!ctx) return

    const dpr = window.devicePixelRatio || 1
    const width = (SEG_W + GAP) * 4 - GAP
    canvas.width  = width * dpr
    canvas.height = CANVAS_H * dpr
    canvas.style.width  = `${width}px`
    canvas.style.height = `${CANVAS_H}px`
    ctx.scale(dpr, dpr)
    ctx.clearRect(0, 0, width, CANVAS_H)

    const slots: [StopPattern, boolean][] = [
      ['LOCAL', false], ['LIMITED', false], ['EXPRESS', false], ['EXPRESS', true],
    ]
    slots.forEach(([pattern, stress], i) => {
      const x = i * (SEG_W + GAP)
      const y = 8
      draw(ctx, x, y, pattern, stress)
    })
  }, [draw])

  return ref
}

function Proposal({ title, description, draw }: { title: string; description: string; draw: DrawFn }) {
  const ref = useDemoCanvas(draw)
  return (
    <section className="space-y-2">
      <div>
        <h2 className="text-sm font-semibold text-foreground">{title}</h2>
        <p className="text-xs text-muted-foreground max-w-2xl">{description}</p>
      </div>
      <canvas ref={ref} className="rounded-md" />
      <div className="flex text-[11px] text-muted-foreground" style={{ gap: GAP }}>
        {['Paradora', 'Semiexpressa', 'Expressa', 'Expressa + lock/drift/marcação'].map((label, i) => (
          <span key={i} style={{ width: SEG_W }}>{label}</span>
        ))}
      </div>
    </section>
  )
}

// Stand-in for seg.label — a real trip shows its line code/name here (short, e.g.
// "301"), never the stopPattern word itself. Using the real shape of that text (not
// "Semiexpressa"/"Expressa") is what actually tells us if the indicator crowds it.
const DEMO_LINE_LABEL = '301 - IPIRAN'

export default function PlaygroundPage() {
  const drawChrome = (ctx: CanvasRenderingContext2D, x: number, y: number, stress: boolean) => {
    if (stress) {
      drawLock(ctx, x, y, SEG_W)
      drawDrift(ctx, x, y, SEG_W, SEG_H)
      drawMarked(ctx, x, y, SEG_H)
    }
    drawLabel(ctx, x, y, SEG_W, SEG_H, DEMO_LINE_LABEL)
  }

  const p1: DrawFn = (ctx, x, y, pattern, stress) => {
    drawBase(ctx, x, y, SEG_W, SEG_H)
    drawP1Indicator(ctx, x, y, pattern)
    drawChrome(ctx, x, y, stress)
  }

  const p2: DrawFn = (ctx, x, y, pattern, stress) => {
    drawBase(ctx, x, y, SEG_W, SEG_H)
    drawP2Indicator(ctx, x, y, SEG_W, SEG_H, pattern)
    drawChrome(ctx, x, y, stress)
  }

  const p3: DrawFn = (ctx, x, y, pattern, stress) => {
    drawP3Base(ctx, x, y, SEG_W, SEG_H, pattern)
    drawChrome(ctx, x, y, stress)
  }

  const p4: DrawFn = (ctx, x, y, pattern, stress) => {
    drawBase(ctx, x, y, SEG_W, SEG_H)
    drawP4Indicator(ctx, x, y, SEG_W, pattern)
    drawChrome(ctx, x, y, stress)
  }

  return (
    <div className="p-6 space-y-10 max-w-4xl">
      <div className="space-y-1">
        <h1 className="text-base font-semibold">stopPattern — variações visuais no Gantt</h1>
        <p className="text-sm text-muted-foreground">
          Sem cor (paleta de linha já tem semântica própria). Cada bloco usa exatamente as
          mesmas constantes de <code>engine/renderer.ts</code> (raio, cor do dot de lock,
          da fita de drift, do traço de marcação) — a 4ª coluna de cada linha ativa lock +
          drift + marcação junto, pra provar que não colide com o indicador novo.
        </p>
      </div>

      <Proposal
        title="1 — Chevron no canto livre (top-left)"
        description="Reaproveita o único canto ainda livre hoje (lock=top-right, drift=bottom-right, marcação=bottom-left). Paradora sem marca (estado mais comum, sem poluir); semiexpressa = 1 chevron; expressa = 2 chevrons. Mais barato de implementar, mesmo vocabulário visual dos indicadores existentes."
        draw={p1}
      />

      <Proposal
        title="2 — Contorno do próprio bloco (sólido/tracejado)"
        description="Paradora = sem contorno extra (igual hoje); semiexpressa = contorno tracejado; expressa = contorno sólido mais grosso. Não disputa espaço com nenhum canto — os 3 indicadores existentes continuam livres. Reaproveita a mesma linguagem de sólido/tracejado que o bracket de intervalo já usa (remunerado/não remunerado)."
        draw={p2}
      />

      <Proposal
        title="3 — Silhueta do bloco (abordagem nova, mexe na forma)"
        description="Paradora = retângulo padrão; semiexpressa = entalhe triangular no topo; expressa = ponta/seta na borda direita, sugerindo velocidade. Mais distintivo à distância (não depende de detalhe pequeno), mas é mudança de forma, não incremento — maior custo de implementação e de familiarização do usuário."
        draw={p3}
      />

      <Proposal
        title="4 — Traços de densidade de parada (metáfora literal)"
        description="Traços finos na borda superior, espaçamento variável: paradora = traços próximos (muitas paradas), semiexpressa = mais espaçados, expressa = nenhum traço (não para). Reaproveita a estética de tick marks já usada no bracket de intervalo. Risco: pode ficar sutil demais em blocos estreitos."
        draw={p4}
      />
    </div>
  )
}
