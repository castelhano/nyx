'use client'

import { Button } from '@/components/ui/button'

export interface SolverScenario {
  fleetCount:   number
  score:        number
  deadrunKm:    number
  productiveKm: number
  totalKm:      number
}

export interface SolverBaseline {
  fleetCount: number
  deadrunKm:  number
}

interface Props {
  baseline:     SolverBaseline | null
  proposal:     SolverScenario | null
  proposalCount: number
  onClose:      () => void
}

function fmtInt(val: number): string {
  return val.toLocaleString('pt-BR')
}

function fmtKm(val: number): string {
  return val.toLocaleString('pt-BR', { maximumFractionDigits: 1, minimumFractionDigits: 1 })
}

export function SolverProposalDialog({ baseline, proposal, proposalCount, onClose }: Props) {
  if (!proposal) return null

  const fleetDelta    = baseline != null ? proposal.fleetCount - baseline.fleetCount : null
  const deadrunDelta  = baseline != null ? proposal.deadrunKm  - baseline.deadrunKm  : null

  function deltaClass(delta: number | null, lowerBetter: boolean): string {
    if (delta == null || delta === 0) return 'text-muted-foreground'
    const isGood = lowerBetter ? delta < 0 : delta > 0
    return isGood ? 'text-green-600 font-medium' : 'text-red-600 font-medium'
  }

  function fmtDelta(delta: number | null, useInt = false): string {
    if (delta == null) return '—'
    const abs = useInt ? fmtInt(Math.abs(delta)) : fmtKm(Math.abs(delta))
    return `${delta > 0 ? '+' : delta < 0 ? '−' : ''}${abs}`
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center">
      <div className="absolute inset-0 bg-black/40" onClick={onClose} />
      <div className="relative z-10 bg-card border border-border rounded-lg shadow-xl w-full max-w-lg mx-4 p-6">
        <div className="flex items-center justify-between mb-4">
          <h2 className="text-base font-semibold">Detalhes da Geração</h2>
          <span className="text-xs text-muted-foreground">
            {proposalCount} proposta{proposalCount !== 1 ? 's' : ''} melhor{proposalCount !== 1 ? 'es' : ''}
          </span>
        </div>

        <table className="w-full text-sm">
          <thead>
            <tr className="text-xs font-medium text-muted-foreground uppercase tracking-wider border-b border-border">
              <th className="text-left pb-2 font-medium">Métrica</th>
              <th className="text-right pb-2 font-medium">Plano atual</th>
              <th className="text-right pb-2 font-medium">Melhor proposta</th>
              <th className="text-right pb-2 font-medium">Δ</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-border/50">
            <tr>
              <td className="py-2.5 text-muted-foreground">Frota</td>
              <td className="py-2.5 text-right font-mono tabular-nums">
                {baseline != null ? fmtInt(baseline.fleetCount) : <span className="opacity-40">—</span>}
              </td>
              <td className="py-2.5 text-right font-mono tabular-nums">{fmtInt(proposal.fleetCount)}</td>
              <td className={`py-2.5 text-right font-mono tabular-nums ${deltaClass(fleetDelta, true)}`}>
                {fmtDelta(fleetDelta, true)}
              </td>
            </tr>
            <tr>
              <td className="py-2.5 text-muted-foreground">Km vazio</td>
              <td className="py-2.5 text-right font-mono tabular-nums">
                {baseline != null ? fmtKm(baseline.deadrunKm) : <span className="opacity-40">—</span>}
              </td>
              <td className="py-2.5 text-right font-mono tabular-nums">{fmtKm(proposal.deadrunKm)}</td>
              <td className={`py-2.5 text-right font-mono tabular-nums ${deltaClass(deadrunDelta, true)}`}>
                {fmtDelta(deadrunDelta)}
              </td>
            </tr>
            <tr>
              <td className="py-2.5 text-muted-foreground">Km produtivo</td>
              <td className="py-2.5 text-right font-mono tabular-nums opacity-40">—</td>
              <td className="py-2.5 text-right font-mono tabular-nums">{fmtKm(proposal.productiveKm)}</td>
              <td className="py-2.5 text-right font-mono tabular-nums opacity-40">—</td>
            </tr>
            <tr>
              <td className="py-2.5 text-muted-foreground">Km total</td>
              <td className="py-2.5 text-right font-mono tabular-nums opacity-40">—</td>
              <td className="py-2.5 text-right font-mono tabular-nums">{fmtKm(proposal.totalKm)}</td>
              <td className="py-2.5 text-right font-mono tabular-nums opacity-40">—</td>
            </tr>
            <tr>
              <td className="py-2.5 text-muted-foreground">Score</td>
              <td className="py-2.5 text-right font-mono tabular-nums opacity-40">—</td>
              <td className="py-2.5 text-right font-mono tabular-nums">{fmtKm(proposal.score)}</td>
              <td className="py-2.5 text-right font-mono tabular-nums opacity-40">—</td>
            </tr>
          </tbody>
        </table>

        <div className="mt-5 flex justify-end">
          <Button type="button" variant="cancel" size="sm" onClick={onClose}>
            Fechar
          </Button>
        </div>
      </div>
    </div>
  )
}
