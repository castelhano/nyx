import type { LayoutSegment } from '../engine/layout/layout.types'
import type { GanttBlockTrip } from '../views/vehicles.view'

interface Props {
  segment:    LayoutSegment
  rect:       DOMRect
  containerW: number
  containerH: number
}

const GAP          = 8
const EST_HEIGHT   = 76
const EST_WIDTH    = 220

function formatMinute(m: number): string {
  const h   = Math.floor(m / 60) % 24
  const min = m % 60
  return `${String(h).padStart(2, '0')}:${String(min).padStart(2, '0')}`
}

export function SegmentTooltip({ segment, rect, containerW, containerH }: Props) {
  const bt   = segment.data as GanttBlockTrip
  const trip = bt.trip

  // vertical: prefer below the segment, flip above if not enough space
  const spaceBelow = containerH - (rect.bottom + GAP)
  const top = spaceBelow >= EST_HEIGHT
    ? rect.bottom + GAP
    : rect.top - EST_HEIGHT - GAP

  // horizontal: center on segment, but anchor to left/right near edges
  const centerX = rect.left + rect.width / 2
  let left:      number
  let transform: string

  if (centerX < containerW * 0.25) {
    left      = Math.max(GAP, rect.left)
    transform = 'none'
  } else if (centerX > containerW * 0.75) {
    left      = Math.min(rect.right, containerW - EST_WIDTH - GAP)
    transform = 'translateX(-100%)'
  } else {
    left      = centerX
    transform = 'translateX(-50%)'
  }

  return (
    <div
      className="absolute z-50 pointer-events-none"
      style={{ top, left, transform }}
    >
      <div className="bg-popover border border-border rounded-lg shadow-lg px-3 py-2 text-sm min-w-[160px]">
        {segment.isDeadhead ? (
          <p className="font-medium text-muted-foreground">Dead run</p>
        ) : (
          <>
            <p className="font-semibold">{trip.route.line.code} — {trip.route.line.name}</p>
            <p className="text-muted-foreground text-xs mt-0.5">
              <span className="font-medium text-foreground">
                {trip.route.direction === 'OUTBOUND' ? 'IDA' : 'VOLTA'}
              </span>
              {' '}{trip.route.originLocality.name} → {trip.route.destinationLocality.name}
            </p>
          </>
        )}
        <p className="text-xs text-muted-foreground mt-1">
          {formatMinute(segment.startMinute)} – {formatMinute(segment.endMinute)}
        </p>
      </div>
    </div>
  )
}
