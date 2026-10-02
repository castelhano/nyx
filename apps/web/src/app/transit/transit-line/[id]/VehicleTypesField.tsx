'use client'

import { Controller, type Control } from 'react-hook-form'
import { VEHICLE_TYPES, VEHICLE_TYPE_LABELS, type LineVehicleTypes, type VehicleTypeValue } from '@nyx/schemas'
import { Select } from '@/components/ui/select'
import { cn } from '@/lib/utils'

// TransitLine.vehicleTypes — read by the vehicle solver (docs/proposal/plan_vehicle_solver_v2.md):
// allowed types are a hard rule (none marked = any type), the preferred one only scores.

const EMPTY: LineVehicleTypes = { allowed: [], preferred: null }

export function VehicleTypesField({ control, readonly }: { control: Control<any>; readonly: boolean }) {
  return (
    <Controller
      name="vehicleTypes"
      control={control}
      render={({ field }) => {
        const value: LineVehicleTypes = { ...EMPTY, ...(field.value as LineVehicleTypes | null | undefined) }
        const set = (next: Partial<LineVehicleTypes>) => field.onChange({ ...value, ...next })
        const toggle = (t: VehicleTypeValue) => set({
          allowed: value.allowed.includes(t) ? value.allowed.filter(a => a !== t) : [...value.allowed, t],
        })

        return (
          <div className="space-y-2">
            <p className="text-sm font-medium">Tipos de Veículo</p>
            <div className="rounded-lg border border-border p-4 space-y-4">
              <div className="space-y-2">
                <div>
                  <p className="text-xs font-semibold text-muted-foreground">Permitidos</p>
                  <p className="text-xs text-muted-foreground">
                    A linha só opera com estes tipos (ex.: itinerário que exige carro pequeno). Nenhum marcado = qualquer tipo.
                  </p>
                </div>
                <div className="flex flex-wrap gap-2">
                  {VEHICLE_TYPES.map(t => {
                    const on = value.allowed.includes(t)
                    return (
                      <button
                        key={t}
                        type="button"
                        disabled={readonly}
                        onClick={() => toggle(t)}
                        className={cn(
                          'rounded-full border px-2.5 py-1 text-xs font-medium transition-colors disabled:opacity-60 disabled:cursor-not-allowed',
                          on ? 'border-ring bg-accent text-foreground' : 'border-border text-muted-foreground hover:bg-muted',
                        )}
                      >
                        {VEHICLE_TYPE_LABELS[t]}
                      </button>
                    )
                  })}
                </div>
              </div>
              <div className="flex items-center justify-between gap-6">
                <div>
                  <p className="text-xs font-semibold text-muted-foreground">Preferencial</p>
                  <p className="text-xs text-muted-foreground">
                    Tipo que o solver procura usar (ex.: micro em linha de demanda baixa) — outros continuam possíveis.
                  </p>
                </div>
                <Select
                  value={value.preferred ?? ''}
                  onChange={e => set({ preferred: (e.target.value || null) as VehicleTypeValue | null })}
                  size="sm"
                  wrapperClassName="w-48 shrink-0"
                  disabled={readonly}
                >
                  <option value="">Sem preferência</option>
                  {VEHICLE_TYPES
                    .filter(t => !value.allowed.length || value.allowed.includes(t))
                    .map(t => <option key={t} value={t}>{VEHICLE_TYPE_LABELS[t]}</option>)}
                </Select>
              </div>
            </div>
          </div>
        )
      }}
    />
  )
}
