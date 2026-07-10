'use client'

import { Button } from '@/components/ui/button'
import { PointDetails } from './PointDetails'
import type { RouteLocality } from './types'

interface Props {
  rl: RouteLocality
  position: number
  onClose: () => void
}

export function PointDetailModal({ rl, position, onClose }: Props) {
  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40" onClick={onClose}>
      <div
        className="bg-background border border-border rounded-md shadow-lg w-full max-w-xs p-4 space-y-3"
        onClick={(e) => e.stopPropagation()}
      >
        <h3 className="text-sm font-semibold">{rl.locality?.abbr || rl.locality?.name || 'Waypoint'}</h3>
        <PointDetails rl={rl} position={position} />
        <div className="flex justify-end pt-1">
          <Button type="button" variant="cancel" size="sm" onClick={onClose}>Fechar</Button>
        </div>
      </div>
    </div>
  )
}
