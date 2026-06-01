import { useEffect, useRef } from 'react'
import { Icons } from '@/lib/icons'
import type { GanttBlock } from '../views/vehicles.view'

interface Props {
  block:    GanttBlock
  screenY:  number
  screenX:  number
  onClose:  () => void
}

function fmtMinutes(m: number): string {
  const h = Math.floor(m / 60)
  const r = m % 60
  return r > 0 ? `${h}h${String(r).padStart(2, '0')}` : `${h}h`
}

function fmtKm(km: number): string {
  return km.toFixed(1) + ' km'
}

const VEHICLE_LABELS: Record<string, string> = {
  BUS:       'Ônibus',
  MICRO_BUS: 'Micro-ônibus',
  MINIBUS:   'Miniônibus',
  VAN:       'Van',
}

export function BlockDetailPopover({ block, screenY, screenX, onClose }: Props) {
  const ref = useRef<HTMLDivElement>(null)

  useEffect(() => {
    function handleClick(e: MouseEvent) {
      if (ref.current && !ref.current.contains(e.target as Node)) onClose()
    }
    document.addEventListener('mousedown', handleClick)
    return () => document.removeEventListener('mousedown', handleClick)
  }, [onClose])

  const s = block.summary

  return (
    <div
      ref={ref}
      className="absolute z-50 bg-popover border border-border rounded-lg shadow-lg w-52 text-sm"
      style={{ top: screenY, left: screenX }}
    >
      {/* header */}
      <div className="flex items-center justify-between px-3 py-2 border-b border-border">
        <span className="font-semibold text-sm">Bloco {block.blockNumber}</span>
        <button
          onClick={onClose}
          className="p-0.5 rounded hover:bg-accent text-muted-foreground hover:text-foreground"
        >
          <Icons.X className="w-3.5 h-3.5" />
        </button>
      </div>

      <div className="px-3 py-2 space-y-1.5 text-xs">
        {/* vehicle type */}
        <div className="flex justify-between">
          <span className="text-muted-foreground">Tipo</span>
          <span className="font-medium">{VEHICLE_LABELS[block.vehicleType] ?? block.vehicleType}</span>
        </div>

        {/* trip count */}
        <div className="flex justify-between">
          <span className="text-muted-foreground">Viagens</span>
          <span className="font-medium">{block.blockTrips.length}</span>
        </div>

        {s ? (
          <>
            <div className="border-t border-border/60 pt-1.5 space-y-1.5">
              <div className="flex justify-between">
                <span className="text-muted-foreground">Jornada total</span>
                <span className="font-medium">{fmtMinutes(s.totalMinutes)}</span>
              </div>
              <div className="flex justify-between">
                <span className="text-muted-foreground">Produtivo</span>
                <span className="font-medium">{fmtMinutes(s.productiveMinutes)}</span>
              </div>
              <div className="flex justify-between">
                <span className="text-muted-foreground">Deadrun</span>
                <span className="font-medium">{fmtMinutes(s.deadrunMinutes)}</span>
              </div>
            </div>
            <div className="border-t border-border/60 pt-1.5 space-y-1.5">
              <div className="flex justify-between">
                <span className="text-muted-foreground">KM total</span>
                <span className="font-medium">{fmtKm(s.totalKm)}</span>
              </div>
              <div className="flex justify-between">
                <span className="text-muted-foreground">KM produtivo</span>
                <span className="font-medium">{fmtKm(s.productiveKm)}</span>
              </div>
              <div className="flex justify-between">
                <span className="text-muted-foreground">KM garagem</span>
                <span className="font-medium">{fmtKm(s.deadrunKm)}</span>
              </div>
            </div>
          </>
        ) : (
          <p className="text-muted-foreground italic">Resumo indisponível</p>
        )}
      </div>
    </div>
  )
}
