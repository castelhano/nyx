'use client'

import type { CrewCostSettings, CrewRoleCost } from '@nyx/schemas'
import { cn } from '@/lib/utils'
import { SectionHeader } from './criteria-tables'

const ROLES: { key: keyof CrewCostSettings['byRole']; label: string }[] = [
  { key: 'DRIVER',         label: 'Motorista' },
  { key: 'FARE_COLLECTOR', label: 'Cobrador' },
  { key: 'ASSISTANT',      label: 'Auxiliar' },
]

const FIELDS: { key: keyof CrewRoleCost; label: string; unit: string; hint: string; step: number; min: number }[] = [
  { key: 'baseSalary',          label: 'Salário base',          unit: 'R$/mês',  hint: 'Salário mensal da CCT',                                          step: 0.01, min: 0 },
  { key: 'monthlyHours',        label: 'Carga horária mensal',  unit: 'h/mês',   hint: 'Divisor do valor da hora (salário ÷ carga)',                     step: 1,    min: 1 },
  { key: 'chargesPercent',      label: 'Encargos',              unit: '%',       hint: 'Tudo incluso (INSS, FGTS, 13º, férias…), sobre salário + variáveis', step: 0.1,  min: 0 },
  { key: 'benefitsPerEmployee', label: 'Benefícios',            unit: 'R$/func.', hint: 'Soma dos benefícios por funcionário/mês, sem encargos',        step: 0.01, min: 0 },
]

export function CrewCostEditor({ value, reference, onChange }: {
  value:     CrewCostSettings
  // global values when editing a Scope — differences are flagged
  reference: CrewCostSettings | null
  onChange:  (next: CrewCostSettings) => void
}) {
  function set(role: keyof CrewCostSettings['byRole'], field: keyof CrewRoleCost, v: number) {
    onChange({ ...value, byRole: { ...value.byRole, [role]: { ...value.byRole[role], [field]: v } } })
  }

  return (
    <div className="flex flex-col gap-3">
      <SectionHeader label="Custos de Pessoal" sub="Base do custo estimado da escala no DOP — sempre os valores atuais. Hora extra +50% e adicional noturno 20% (hora reduzida) são fixos." />
      <div className="rounded-lg border border-border overflow-hidden">
        <table className="w-full text-sm">
          <thead>
            <tr className="border-b border-border text-xs text-muted-foreground">
              <th className="text-left font-medium px-4 py-2">Parâmetro</th>
              {ROLES.map(r => <th key={r.key} className="text-center font-medium px-4 py-2">{r.label}</th>)}
            </tr>
          </thead>
          <tbody className="divide-y divide-border">
            {FIELDS.map(f => (
              <tr key={f.key}>
                <td className="px-4 py-2">
                  <p className="font-medium">{f.label} <span className="text-xs text-muted-foreground font-normal">({f.unit})</span></p>
                  <p className="text-xs text-muted-foreground">{f.hint}</p>
                </td>
                {ROLES.map(r => {
                  const v       = value.byRole[r.key][f.key]
                  const changed = reference != null && reference.byRole[r.key][f.key] !== v
                  return (
                    <td key={r.key} className="px-4 py-2 text-center">
                      <input
                        type="number"
                        value={v}
                        min={f.min}
                        step={f.step}
                        title={changed ? `Global: ${reference.byRole[r.key][f.key]}` : undefined}
                        onChange={(e) => {
                          const n = parseFloat(e.target.value)
                          if (!isNaN(n)) set(r.key, f.key, Math.max(f.min, n))
                        }}
                        className={cn(
                          'h-8 w-28 rounded-sm border bg-input-bg text-center text-sm tabular-nums focus:outline-none focus:ring-1 focus:ring-ring',
                          changed ? 'border-amber-600' : 'border-input',
                        )}
                      />
                    </td>
                  )
                })}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  )
}
