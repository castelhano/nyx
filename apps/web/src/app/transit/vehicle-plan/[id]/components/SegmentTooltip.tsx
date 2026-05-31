import type { LayoutSegment } from '../engine/layout/layout.types'
import type { GanttBlockTrip } from '../views/vehicles.view'

interface Props {
  segment: LayoutSegment
  rect:    DOMRect
}

function formatMinute(m: number): string {
  const h   = Math.floor(m / 60) % 24
  const min = m % 60
  return `${String(h).padStart(2, '0')}:${String(min).padStart(2, '0')}`
}

export function SegmentTooltip({ segment, rect }: Props) {
  const bt   = segment.data as GanttBlockTrip
  const trip = bt.trip

  // position: prefer below, fallback to above
  const top  = rect.bottom + 6
  const left = rect.left + rect.width / 2

  return (
    <div
      className="absolute z-50 pointer-events-none"
      style={{ top, left, transform: 'translateX(-50%)' }}
    >
      <div className="bg-popover border border-border rounded-lg shadow-lg px-3 py-2 text-sm min-w-[160px]">
        {segment.isDeadhead ? (
          <p className="font-medium text-muted-foreground">Dead run</p>
        ) : (
          <>
            <p className="font-semibold">{trip.route.line.code} — {trip.route.line.name}</p>
            <p className="text-muted-foreground text-xs mt-0.5">
              {trip.route.originLocality.name} → {trip.route.destinationLocality.name}
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
