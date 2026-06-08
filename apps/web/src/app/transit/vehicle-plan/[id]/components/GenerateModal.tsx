'use client'

import { useState } from 'react'
import { Button } from '@/components/ui/button'

export interface SolverParams {
  mode:                       'quick' | 'expanded'
  redistributeTrips:          boolean
  allowSharedOperation:       boolean
  includeAccessAndCollection: boolean
  direction:                  'automatic' | 'optimize_fleet' | 'optimize_drivers' | 'optimize_overtime'
}

const DEFAULT_PARAMS: SolverParams = {
  mode:                       'quick',
  redistributeTrips:          true,
  allowSharedOperation:       false,
  includeAccessAndCollection: true,
  direction:                  'automatic',
}

interface Props {
  hasCustomMetrics: boolean
  onConfirm:        (params: SolverParams) => void
  onClearMetrics:   () => void
  onClose:          () => void
}

export function GenerateModal({ hasCustomMetrics, onConfirm, onClearMetrics, onClose }: Props) {
  const [params, setParams] = useState<SolverParams>(DEFAULT_PARAMS)

  function set<K extends keyof SolverParams>(key: K, value: SolverParams[K]) {
    setParams(p => ({ ...p, [key]: value }))
  }

  function handleSubmit(e: React.FormEvent) {
    e.preventDefault()
    onConfirm(params)
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center">
      <div className="absolute inset-0 bg-black/40" onClick={onClose} />
      <form
        onSubmit={handleSubmit}
        className="relative z-10 bg-card border border-border rounded-lg shadow-xl w-full max-w-md mx-4 p-6 space-y-5"
      >
        <h2 className="text-base font-semibold">Gerar Planejamento</h2>

        {/* type */}
        <div className="space-y-2">
          <p className="text-xs font-medium text-muted-foreground uppercase tracking-wider">Tipo</p>
          <div className="grid grid-cols-2 gap-2">
            {([
              { value: 'quick',    label: 'Rápido',    desc: 'Determinístico, resultado imediato' },
              { value: 'expanded', label: 'Expandido', desc: 'Exploração estocástica, pode demorar' },
            ] as const).map(opt => (
              <label
                key={opt.value}
                className={`flex flex-col gap-1 rounded-md border p-3 cursor-pointer transition-colors ${
                  params.mode === opt.value
                    ? 'border-ring bg-accent'
                    : 'border-border hover:bg-muted/40'
                }`}
              >
                <input
                  type="radio"
                  name="mode"
                  value={opt.value}
                  checked={params.mode === opt.value}
                  onChange={() => set('mode', opt.value)}
                  className="sr-only"
                />
                <span className="text-sm font-medium">{opt.label}</span>
                <span className="text-xs text-muted-foreground leading-snug">{opt.desc}</span>
              </label>
            ))}
          </div>
        </div>

        {/* checkboxes */}
        <div className="space-y-2">
          <p className="text-xs font-medium text-muted-foreground uppercase tracking-wider">Opções</p>
          <div className="space-y-2">
            {([
              { key: 'redistributeTrips',          label: 'Redistribuir viagens',           disabled: false },
              { key: 'includeAccessAndCollection',  label: 'Incluir acesso e recolha',       disabled: false },
              { key: 'allowSharedOperation',        label: 'Permitir operação compartilhada', disabled: true },
            ] as const).map(opt => (
              <label
                key={opt.key}
                className={`flex items-center gap-2.5 text-sm cursor-pointer ${opt.disabled ? 'opacity-40 cursor-not-allowed' : ''}`}
              >
                <input
                  type="checkbox"
                  checked={params[opt.key]}
                  disabled={opt.disabled}
                  onChange={e => set(opt.key, e.target.checked)}
                  className="rounded border-input w-4 h-4 accent-ring"
                />
                {opt.label}
                {opt.disabled && <span className="text-xs text-muted-foreground">(em breve)</span>}
              </label>
            ))}
          </div>
        </div>

        {/* direction */}
        <div className="space-y-2">
          <p className="text-xs font-medium text-muted-foreground uppercase tracking-wider">Direção</p>
          <div className="space-y-1.5">
            {([
              { value: 'automatic',        label: 'Automático',            disabled: false },
              { value: 'optimize_fleet',   label: 'Otimizar frota',        disabled: false },
              { value: 'optimize_drivers', label: 'Otimizar motoristas',   disabled: true  },
              { value: 'optimize_overtime',label: 'Otimizar horas extras', disabled: true  },
            ] as const).map(opt => (
              <label
                key={opt.value}
                className={`flex items-center gap-2.5 text-sm cursor-pointer ${opt.disabled ? 'opacity-40 cursor-not-allowed' : ''}`}
              >
                <input
                  type="radio"
                  name="direction"
                  value={opt.value}
                  checked={params.direction === opt.value}
                  disabled={opt.disabled}
                  onChange={() => set('direction', opt.value)}
                  className="accent-ring"
                />
                {opt.label}
                {opt.disabled && <span className="text-xs text-muted-foreground">(em breve)</span>}
              </label>
            ))}
          </div>
        </div>

        {/* custom metrics notice */}
        {hasCustomMetrics && (
          <div className="flex items-center justify-between rounded-md bg-amber-50 border border-amber-200 px-3 py-2 text-xs text-amber-800">
            <span>Configuração personalizada ativa — ignorando padrão global</span>
            <button
              type="button"
              onClick={onClearMetrics}
              className="ml-2 underline underline-offset-2 hover:no-underline whitespace-nowrap"
            >
              Limpar
            </button>
          </div>
        )}

        {/* actions */}
        <div className="flex justify-end gap-2 pt-1">
          <Button type="button" variant="cancel" size="sm" onClick={onClose}>
            Cancelar
          </Button>
          <Button type="submit" size="sm">
            Gerar
          </Button>
        </div>
      </form>
    </div>
  )
}
