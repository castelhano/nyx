'use client'

import { useState } from 'react'
import { Button } from '@/components/ui/button'
import { LineScheduleGeneratorModal } from './LineScheduleGeneratorModal'

// Rota de teste — não linkada no menu. Protótipo do modal de geração de
// proposta de atendimento por linha (ver
// docs/proposal/vehicle-plan-line-schedule-generator.md, Fase 1). Dados
// mockados em ./mock-data.ts — sem geração real nem persistência ainda.

export default function PlaygroundPage() {
  const [open, setOpen] = useState(true)

  return (
    <div className="p-8 max-w-3xl mx-auto space-y-4">
      <header>
        <h1 className="text-xl font-semibold">Playground — Gerador de Proposta de Atendimento por Linha</h1>
        <p className="text-sm text-muted-foreground mt-1">
          Protótipo de UX do modal discutido em{' '}
          <code className="text-xs bg-muted px-1 py-0.5 rounded">docs/proposal/vehicle-plan-line-schedule-generator.md</code>.
          Janelas de geração (merge/split), frota &amp; depósitos, intervalo, acesso/recolhida e o gráfico
          oferta×demanda são todos interativos — dados mockados, sem wiring com a linha real nem persistência.
        </p>
      </header>

      <Button onClick={() => setOpen(true)}>Abrir gerador</Button>

      {open && <LineScheduleGeneratorModal onClose={() => setOpen(false)} />}
    </div>
  )
}
