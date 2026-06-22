'use client'

import { useState } from 'react'
import { Button }   from '@/components/ui/button'
import { Icons }    from '@/lib/icons'
import type { GanttBlock, GanttBlockTrip } from '../views/vehicles.view'

interface Props {
  blockTrip:      GanttBlockTrip
  currentBlockId: string
  blocks:         GanttBlock[]
  onConfirm:      (targetBlockId: string) => void
  onClose:        () => void
}

function minutesToHHMM(minutes: number): string {
  const h = Math.floor(minutes / 60) % 24
  const m = minutes % 60
  return `${String(h).padStart(2, '0')}:${String(m).padStart(2, '0')}`
}

export function MoveBlockModal({ blockTrip, currentBlockId, blocks, onConfirm, onClose }: Props) {
  const [targetBlockId, setTargetBlockId] = useState('')

  const otherBlocks = blocks.filter(b => b.id !== currentBlockId)
  const { trip }    = blockTrip

  function handleSubmit(e: React.FormEvent) {
    e.preventDefault()
    if (targetBlockId) onConfirm(targetBlockId)
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center">
      <div className="absolute inset-0 bg-black/40" onClick={onClose} />
      <form
        onSubmit={handleSubmit}
        className="relative z-10 bg-card border border-border rounded-lg shadow-xl w-full max-w-sm mx-4 p-6 space-y-4"
      >
        <h2 className="text-base font-semibold">Mover viagem</h2>

        <p className="text-sm text-muted-foreground">
          {trip.route.line.code} · {minutesToHHMM(trip.departureMinutes)} → {minutesToHHMM(trip.arrivalMinutes)}
        </p>

        <div>
          <label htmlFor="targetBlockId" className="text-sm font-medium">
            Bloco destino <span className="ps-0.5">*</span>
          </label>
          <div className="relative mt-2">
            <select
              id="targetBlockId"
              value={targetBlockId}
              onChange={e => setTargetBlockId(e.target.value)}
              required
              autoFocus
              disabled={otherBlocks.length === 0}
              className="w-full appearance-none border border-input rounded-sm text-sm bg-input-bg px-3 py-2 pe-8 focus:outline-none focus:ring-1 focus:ring-ring disabled:opacity-60"
            >
              <option value="">
                {otherBlocks.length === 0 ? 'Nenhum outro bloco disponível' : 'Selecione…'}
              </option>
              {otherBlocks.map(b => (
                <option key={b.id} value={b.id}>
                  Bloco {b.blockNumber}{b.depot ? ` · ${b.depot.name}` : ''}
                </option>
              ))}
            </select>
            <Icons.ChevronDown className="pointer-events-none absolute right-2 top-1/2 -translate-y-1/2 w-4 h-4 text-muted-foreground" />
          </div>
        </div>

        <div className="flex justify-end gap-2 pt-1">
          <Button type="button" variant="cancel" size="sm" onClick={onClose}>
            Cancelar
          </Button>
          <Button type="submit" size="sm" disabled={!targetBlockId || otherBlocks.length === 0}>
            Mover
          </Button>
        </div>
      </form>
    </div>
  )
}
