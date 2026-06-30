import { Icons } from '@/lib/icons'
import { DIRECTION_LABELS } from '../views/vehicles.view'
import type { GanttBlockTrip, GanttBlockDeadrun } from '../views/vehicles.view'

const DEADRUN_TYPE_LABEL: Record<string, string> = {
  ACCESS:       'ACESSO',
  RETURN:       'RECOLHIDA',
  DISPLACEMENT: 'DESLOCAMENTO',
}

interface Props {
  trip?:    GanttBlockTrip    | null
  deadrun?: GanttBlockDeadrun | null
  headway:  number | null
}

function formatMinute(m: number): string {
  const h   = Math.floor(m / 60) % 24
  const min = m % 60
  return `${String(h).padStart(2, '0')}:${String(min).padStart(2, '0')}`
}

export function TripSummaryPanel({ trip, deadrun, headway }: Props) {
  if (!trip && !deadrun) return null

  const dep      = trip ? trip.trip.departureMinutes : deadrun!.departureMinutes
  const arr      = trip ? trip.trip.arrivalMinutes   : deadrun!.arrivalMinutes
  const cycleMin = arr - dep

  return (
    <div className="bg-popover border border-border rounded-lg shadow-lg px-3 py-2 text-sm">
      {/* title row — same fixed height regardless of trip/deadrun content */}
      <div className="h-5 flex items-center gap-1.5">
        {deadrun ? (
          <>
            <Icons.Truck className="w-3.5 h-3.5 text-muted-foreground shrink-0" />
            <span className="text-xs font-semibold text-muted-foreground uppercase tracking-wide">
              Vazio — {DEADRUN_TYPE_LABEL[deadrun.type] ?? deadrun.type}
            </span>
          </>
        ) : (
          <>
            <span className="text-xs font-semibold px-1.5 rounded bg-muted text-foreground leading-5">
              {trip!.trip.route.line.code}
            </span>
            <span className="text-xs font-medium text-muted-foreground">
              {DIRECTION_LABELS[trip!.trip.route.direction] ?? trip!.trip.route.direction}
            </span>
          </>
        )}
      </div>

      <div className="flex items-end gap-3 mt-1">
        <div>
          <div className="text-[10px] text-muted-foreground uppercase tracking-wide leading-none">Início</div>
          <div className="text-base font-semibold tabular-nums leading-tight">{formatMinute(dep)}</div>
        </div>
        <div>
          <div className="text-[10px] text-muted-foreground uppercase tracking-wide leading-none">Fim</div>
          <div className="text-base font-semibold tabular-nums leading-tight">{formatMinute(arr)}</div>
        </div>
        <div>
          <div className="text-[10px] text-muted-foreground uppercase tracking-wide leading-none">Ciclo</div>
          <div className="text-base font-semibold tabular-nums leading-tight">{cycleMin}min</div>
        </div>
        {!deadrun && headway != null && (
          <div className="text-base font-semibold tabular-nums leading-tight">{headway}&apos;</div>
        )}
      </div>
    </div>
  )
}
