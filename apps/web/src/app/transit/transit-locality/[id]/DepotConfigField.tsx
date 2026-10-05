'use client'

import { useQuery } from '@tanstack/react-query'
import { Controller, useWatch, type Control } from 'react-hook-form'
import { VEHICLE_TYPES, VEHICLE_TYPE_LABELS, type DepotConfig, type VehicleTypeValue } from '@nyx/schemas'
import { Button } from '@/components/ui/button'
import { Select } from '@/components/ui/select'
import { Icons } from '@/lib/icons'
import { apiFetch } from '@/lib/auth'
import { cn } from '@/lib/utils'

// TransitLocality.depot — which operators may base vehicles here and the depot's physical
// capacity (total and/or per vehicle type). Only shown while isDepot; read by the vehicle
// solver (docs/architecture/transit/solver.md).

interface Branch { id: string; name: string }

const EMPTY: DepotConfig = { operators: [], capacity: [] }

export function DepotConfigField({ control, readonly }: { control: Control<any>; readonly: boolean }) {
  const isDepot = useWatch({ control, name: 'isDepot' })

  const { data: branches = [] } = useQuery<Branch[]>({
    queryKey: ['core', 'branch', 'all'],
    queryFn:  async () => {
      const res = await apiFetch('/core/branch?pageSize=999')
      if (!res.ok) throw new Error()
      const json = await res.json()
      return json.data ?? json
    },
    enabled: !!isDepot,
  })

  if (!isDepot) return null

  return (
    <Controller
      name="depot"
      control={control}
      render={({ field }) => {
        const value: DepotConfig = { ...EMPTY, ...(field.value as DepotConfig | null | undefined) }
        const set = (next: Partial<DepotConfig>) => field.onChange({ ...value, ...next })

        const toggleOperator = (id: string) => set({
          operators: value.operators.includes(id) ? value.operators.filter(o => o !== id) : [...value.operators, id],
        })
        const updateCapacity = (i: number, next: Partial<DepotConfig['capacity'][number]>) =>
          set({ capacity: value.capacity.map((c, idx) => idx === i ? { ...c, ...next } : c) })

        return (
          <div className="space-y-2">
            <p className="text-sm font-medium">Garagem</p>
            <div className="rounded-lg border border-border p-4 space-y-5">
              <div className="space-y-2">
                <div>
                  <p className="text-xs font-semibold text-muted-foreground">Operadores</p>
                  <p className="text-xs text-muted-foreground">
                    Empresas que podem ter carros baseados nesta garagem. Nenhuma marcada = qualquer empresa.
                  </p>
                </div>
                <div className="flex flex-wrap gap-2">
                  {branches.map(b => {
                    const on = value.operators.includes(b.id)
                    return (
                      <button
                        key={b.id}
                        type="button"
                        disabled={readonly}
                        onClick={() => toggleOperator(b.id)}
                        className={cn(
                          'rounded-full border px-2.5 py-1 text-xs font-medium transition-colors disabled:opacity-60 disabled:cursor-not-allowed',
                          on ? 'border-ring bg-accent text-foreground' : 'border-border text-muted-foreground hover:bg-muted',
                        )}
                      >
                        {b.name}
                      </button>
                    )
                  })}
                </div>
              </div>

              <div className="space-y-2">
                <div className="flex items-center justify-between">
                  <div>
                    <p className="text-xs font-semibold text-muted-foreground">Capacidade</p>
                    <p className="text-xs text-muted-foreground">
                      Limite físico de carros, total e/ou por tipo — todos valem ao mesmo tempo. Sem linhas = sem limite.
                    </p>
                  </div>
                  {!readonly && (
                    <Button type="button" variant="ghost" size="sm" onClick={() => set({ capacity: [...value.capacity, { vehicleType: null, max: 0 }] })}>
                      <Icons.Plus className="w-3.5 h-3.5 me-1" /> Adicionar
                    </Button>
                  )}
                </div>
                {value.capacity.length > 0 && (
                  <div className="space-y-1.5">
                    {value.capacity.map((c, i) => (
                      <div key={i} className="flex items-center gap-2">
                        <Select
                          value={c.vehicleType ?? ''}
                          onChange={e => updateCapacity(i, { vehicleType: (e.target.value || null) as VehicleTypeValue | null })}
                          size="sm"
                          wrapperClassName="w-48"
                          disabled={readonly}
                        >
                          <option value="">Total da garagem</option>
                          {VEHICLE_TYPES.map(t => <option key={t} value={t}>{VEHICLE_TYPE_LABELS[t]}</option>)}
                        </Select>
                        <input
                          type="number"
                          min={0}
                          value={c.max}
                          disabled={readonly}
                          onChange={e => updateCapacity(i, { max: Math.max(0, Math.round(Number(e.target.value) || 0)) })}
                          className="h-8 w-24 rounded-sm border border-input bg-input-bg text-center text-sm focus:outline-none focus:ring-1 focus:ring-ring disabled:opacity-60"
                        />
                        <span className="text-xs text-muted-foreground">carros</span>
                        {!readonly && (
                          <button
                            type="button"
                            title="Remover"
                            onClick={() => set({ capacity: value.capacity.filter((_, idx) => idx !== i) })}
                            className="text-muted-foreground hover:text-destructive"
                          >
                            <Icons.X className="w-3.5 h-3.5" />
                          </button>
                        )}
                      </div>
                    ))}
                  </div>
                )}
              </div>
            </div>
          </div>
        )
      }}
    />
  )
}
