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
  fleetCount:   number
  score:        number
  deadrunKm:    number
  productiveKm: number
  totalKm:      number
}

interface Props {
  baseline:      SolverBaseline | null
  proposal:      SolverScenario | null
  proposalCount: number
  isPending:     boolean
  onClose:       () => void
  onAssume:      () => void
  onDiscard:     () => void
}

function fmtInt(val: number): string {
  return val.toLocaleString('pt-BR')
}

function fmtKm(val: number): string {
  return val.toLocaleString('pt-BR', { maximumFractionDigits: 1, minimumFractionDigits: 1 })
}

export function SolverProposalDialog({ baseline, proposal, proposalCount, isPending, onClose, onAssume, onDiscard }: Props) {
  const fleetDelta      = baseline != null && proposal != null ? proposal.fleetCount   - baseline.fleetCount   : null
  const deadrunDelta    = baseline != null && proposal != null ? proposal.deadrunKm    - baseline.deadrunKm    : null
  const productiveDelta = baseline != null && proposal != null ? proposal.productiveKm - baseline.productiveKm : null
  const totalDelta      = baseline != null && proposal != null ? proposal.totalKm      - baseline.totalKm      : null
  const scoreDelta      = baseline != null && proposal != null ? proposal.score        - baseline.score        : null

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

  const baselineCell = (val: number | null | undefined, fmt: (n: number) => string = fmtKm) =>
    baseline != null && val != null
      ? <span className="font-mono tabular-nums">{fmt(val)}</span>
      : <span className="opacity-40">—</span>

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

        {proposal ? (
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
                <td className="py-2.5 text-right">{baselineCell(baseline?.fleetCount, fmtInt)}</td>
                <td className="py-2.5 text-right font-mono tabular-nums">{fmtInt(proposal.fleetCount)}</td>
                <td className={`py-2.5 text-right font-mono tabular-nums ${deltaClass(fleetDelta, true)}`}>
                  {fmtDelta(fleetDelta, true)}
                </td>
              </tr>
              <tr>
                <td className="py-2.5 text-muted-foreground">Km vazio</td>
                <td className="py-2.5 text-right">{baselineCell(baseline?.deadrunKm)}</td>
                <td className="py-2.5 text-right font-mono tabular-nums">{fmtKm(proposal.deadrunKm)}</td>
                <td className={`py-2.5 text-right font-mono tabular-nums ${deltaClass(deadrunDelta, true)}`}>
                  {fmtDelta(deadrunDelta)}
                </td>
              </tr>
              <tr>
                <td className="py-2.5 text-muted-foreground">Km produtivo</td>
                <td className="py-2.5 text-right">{baselineCell(baseline?.productiveKm)}</td>
                <td className="py-2.5 text-right font-mono tabular-nums">{fmtKm(proposal.productiveKm)}</td>
                <td className={`py-2.5 text-right font-mono tabular-nums ${deltaClass(productiveDelta, false)}`}>
                  {fmtDelta(productiveDelta)}
                </td>
              </tr>
              <tr>
                <td className="py-2.5 text-muted-foreground">Km total</td>
                <td className="py-2.5 text-right">{baselineCell(baseline?.totalKm)}</td>
                <td className="py-2.5 text-right font-mono tabular-nums">{fmtKm(proposal.totalKm)}</td>
                <td className={`py-2.5 text-right font-mono tabular-nums ${deltaClass(totalDelta, true)}`}>
                  {fmtDelta(totalDelta)}
                </td>
              </tr>
              <tr>
                <td className="py-2.5 text-muted-foreground">Score</td>
                <td className="py-2.5 text-right">{baselineCell(baseline?.score)}</td>
                <td className="py-2.5 text-right font-mono tabular-nums">{fmtKm(proposal.score)}</td>
                <td className={`py-2.5 text-right font-mono tabular-nums ${deltaClass(scoreDelta, false)}`}>
                  {fmtDelta(scoreDelta)}
                </td>
              </tr>
            </tbody>
          </table>
        ) : (
          <p className="text-sm text-muted-foreground py-4 text-center">
            Nenhuma proposta melhor encontrada até o momento.
          </p>
        )}

        <div className="mt-5 flex items-center justify-between">
          <div>
            {proposal && (
              <Button type="button" size="sm" onClick={onAssume} disabled={isPending}>
                Assumir Melhor
              </Button>
            )}
          </div>
          <div className="flex gap-2">
            <Button type="button" variant="cancel" size="sm" onClick={onDiscard} disabled={isPending}>
              Descartar
            </Button>
            <Button type="button" variant="cancel" size="sm" onClick={onClose} disabled={isPending}>
              Fechar
            </Button>
          </div>
        </div>
      </div>
    </div>
  )
}
