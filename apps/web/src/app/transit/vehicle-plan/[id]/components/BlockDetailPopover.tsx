'use client'

import { useEffect, useRef, useState } from 'react'
import { useQuery } from '@tanstack/react-query'
import { Icons }    from '@/lib/icons'
import { cn }       from '@/lib/utils'
import { apiFetch } from '@/lib/auth'
import type { GanttBlock } from '../views/vehicles.view'

interface Props {
  block:    GanttBlock
  screenY:  number
  screenX:  number
  onClose:  () => void
  onUpdate: () => void
}

const VEHICLE_OPTIONS = [
  { value: 'STANDARD',  label: 'Ônibus' },
  { value: 'MICRO_BUS', label: 'Micro-ônibus' },
  { value: 'MINIBUS',   label: 'Miniônibus' },
  { value: 'VAN',       label: 'Van' },
]

const selectCls = [
  'flex-1 min-w-0 text-xs bg-background border border-border rounded px-1.5 py-0.5',
  'text-foreground focus:outline-none focus:ring-1 focus:ring-ring disabled:opacity-50',
].join(' ')

function fmtMinutes(m: number): string {
  const h = Math.floor(m / 60)
  const r = m % 60
  return r > 0 ? `${h}h${String(r).padStart(2, '0')}` : `${h}h`
}

function fmtKm(km: number): string {
  return km.toFixed(1) + ' km'
}

export function BlockDetailPopover({ block, screenY, screenX, onClose, onUpdate }: Props) {
  const ref = useRef<HTMLDivElement>(null)
  const [isPending, setIsPending] = useState(false)

  const [vehicleType, setVehicleType] = useState(block.vehicleType)
  const [depotId,     setDepotId]     = useState(block.depotId)
  const [branchId,    setBranchId]    = useState(block.branchId ?? '')
  const [locked,      setLocked]      = useState(block.constraints?.locked === true)

  useEffect(() => {
    setVehicleType(block.vehicleType)
    setDepotId(block.depotId)
    setBranchId(block.branchId ?? '')
    setLocked(block.constraints?.locked === true)
  }, [block.vehicleType, block.depotId, block.branchId, block.constraints])

  const { data: depots } = useQuery<{ id: string; name: string }[]>({
    queryKey: ['transit', 'transit-locality', 'select-list'],
    queryFn:  async () => {
      const r = await apiFetch('/transit/transit-locality?pageSize=999')
      const j = await r.json()
      return (j.data ?? []) as { id: string; name: string }[]
    },
    staleTime: 60_000,
  })

  const { data: branches } = useQuery<{ id: string; name: string }[]>({
    queryKey: ['core', 'branch', 'select-list'],
    queryFn:  async () => {
      const r = await apiFetch('/core/branch?pageSize=999')
      const j = await r.json()
      return (j.data ?? []) as { id: string; name: string }[]
    },
    staleTime: 60_000,
  })

  useEffect(() => {
    function handleClick(e: MouseEvent) {
      if (ref.current && !ref.current.contains(e.target as Node)) onClose()
    }
    document.addEventListener('mousedown', handleClick)
    return () => document.removeEventListener('mousedown', handleClick)
  }, [onClose])

  async function patch(data: Record<string, unknown>) {
    if (isPending) return
    setIsPending(true)
    try {
      await apiFetch(`/transit/vehicle-block/${block.id}`, {
        method:  'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body:    JSON.stringify(data),
      })
      onUpdate()
    } finally {
      setIsPending(false)
    }
  }

  function handleVehicleType(v: string) {
    setVehicleType(v)
    patch({ vehicleType: v })
  }

  function handleDepot(v: string) {
    setDepotId(v)
    patch({ depotId: v })
  }

  function handleBranch(v: string) {
    setBranchId(v)
    patch({ branchId: v || null })
  }

  function handleLock() {
    const next = !locked
    setLocked(next)
    patch({ constraints: next ? { locked: true } : {} })
  }

  const s = block.summary

  return (
    <div
      ref={ref}
      className="absolute z-50 bg-popover border border-border rounded-lg shadow-lg w-56 text-sm"
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

      <div className="px-3 py-2 space-y-2 text-xs">
        {/* Tipo */}
        <div className="flex items-center gap-2">
          <span className="text-muted-foreground w-16 shrink-0">Tipo</span>
          <select
            value={vehicleType}
            onChange={e => handleVehicleType(e.target.value)}
            disabled={isPending}
            className={selectCls}
          >
            {VEHICLE_OPTIONS.map(o => (
              <option key={o.value} value={o.value}>{o.label}</option>
            ))}
          </select>
        </div>

        {/* Garagem */}
        <div className="flex items-center gap-2">
          <span className="text-muted-foreground w-16 shrink-0">Garagem</span>
          <select
            value={depotId}
            onChange={e => handleDepot(e.target.value)}
            disabled={isPending}
            className={selectCls}
          >
            {depots?.map(d => (
              <option key={d.id} value={d.id}>{d.name}</option>
            ))}
          </select>
        </div>

        {/* Operador */}
        <div className="flex items-center gap-2">
          <span className="text-muted-foreground w-16 shrink-0">Operador</span>
          <select
            value={branchId}
            onChange={e => handleBranch(e.target.value)}
            disabled={isPending}
            className={selectCls}
          >
            <option value="">—</option>
            {branches?.map(b => (
              <option key={b.id} value={b.id}>{b.name}</option>
            ))}
          </select>
        </div>

        {/* Viagens */}
        <div className="flex justify-between">
          <span className="text-muted-foreground">Viagens</span>
          <span className="font-medium">{block.blockTrips.length}</span>
        </div>
      </div>

      {/* lock */}
      <div className="px-3 py-1.5 border-t border-border/60">
        <button
          onClick={handleLock}
          disabled={isPending}
          className={cn(
            'flex items-center gap-2 w-full text-xs rounded px-2 py-1.5',
            'hover:bg-accent transition-colors disabled:opacity-50',
            locked ? 'text-amber-500' : 'text-muted-foreground',
          )}
        >
          {locked
            ? <Icons.Lock     className="w-3.5 h-3.5 shrink-0" />
            : <Icons.LockOpen className="w-3.5 h-3.5 shrink-0" />}
          <span>{locked ? 'Bloco travado' : 'Travar bloco'}</span>
        </button>
      </div>

      {/* summary */}
      {s ? (
        <div className="px-3 py-2 border-t border-border/60 space-y-1.5 text-xs">
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
        </div>
      ) : (
        <div className="px-3 pb-2 text-xs text-muted-foreground italic">Resumo indisponível</div>
      )}
    </div>
  )
}
