import type { ViewportSnapshot } from '../engine/gantt.types'

interface Props {
  viewport: ViewportSnapshot
  className?: string
}

function gridInterval(ppm: number): number {
  if (ppm >= 4)   return 15
  if (ppm >= 1.5) return 30
  if (ppm >= 0.8) return 60
  return 120
}

function formatMinute(m: number): string {
  const h   = Math.floor(m / 60) % 24
  const min = m % 60
  return `${String(h).padStart(2, '0')}:${String(min).padStart(2, '0')}`
}

function minuteToX(m: number, vp: ViewportSnapshot): number {
  return (m - vp.dayStartMinute) * vp.pixelsPerMinute - vp.scrollX
}

export function TimeRuler({ viewport, className }: Props) {
  const interval     = gridInterval(viewport.pixelsPerMinute)
  const visibleEnd   = viewport.dayStartMinute + (viewport.width + viewport.scrollX) / viewport.pixelsPerMinute
  const startM       = Math.floor(
    (viewport.dayStartMinute + viewport.scrollX / viewport.pixelsPerMinute) / interval,
  ) * interval

  const ticks: { m: number; x: number }[] = []
  for (let m = startM; m <= visibleEnd + interval; m += interval) {
    const x = minuteToX(m, viewport)
    if (x < -60 || x > viewport.width + 60) continue
    ticks.push({ m, x })
  }

  return (
    <div
      className={`relative h-10 shrink-0 border-b bg-background overflow-hidden select-none ${className ?? ''}`}
      style={{ minWidth: 0 }}
    >
      {ticks.map(({ m, x }) => (
        <div
          key={m}
          className="absolute top-0 flex flex-col items-center"
          style={{ left: x, transform: 'translateX(-50%)' }}
        >
          <div className="w-px h-2 bg-border mt-2" />
          <span className="text-[10px] text-muted-foreground leading-none mt-0.5 whitespace-nowrap">
            {formatMinute(m)}
          </span>
        </div>
      ))}
    </div>
  )
}
