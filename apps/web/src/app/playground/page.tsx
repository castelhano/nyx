'use client'

import { useState } from 'react'
import { Button } from '@/components/ui/button'
import { LineScheduleGeneratorModal } from './LineScheduleGeneratorModal'
import { TripsGridPrototype } from './TripsGridPrototype'

// Rota de teste — não linkada no menu. Protótipo do modal de geração de
// proposta de atendimento por linha (ver
// docs/proposal/vehicle-plan-line-schedule-generator.md, Fase 1). Dados
// mockados em ./mock-data.ts — sem geração real nem persistência ainda.

export default function PlaygroundPage() {
  const [open,      setOpen]      = useState(false)
  const [tripsOpen, setTripsOpen] = useState(false)

  return (
    <div className="p-8 max-w-3xl mx-auto space-y-8">
      <header>
        <h1 className="text-xl font-semibold">Playground — Gerador de Proposta de Atendimento por Linha</h1>
        <p className="text-sm text-muted-foreground mt-1">
          Protótipo de UX do modal discutido em{' '}
          <code className="text-xs bg-muted px-1 py-0.5 rounded">docs/proposal/vehicle-plan-line-schedule-generator.md</code>.
          Janelas de geração (merge/split), frota &amp; depósitos, intervalo, acesso/recolhida e o gráfico
          oferta×demanda são todos interativos — dados mockados, sem wiring com a linha real nem persistência.
        </p>
        <Button className="mt-3" onClick={() => setOpen(true)}>Abrir gerador</Button>
      </header>

      <header className="border-t border-border pt-6">
        <h1 className="text-xl font-semibold">Playground — Tabela de Horários Corridos</h1>
        <p className="text-sm text-muted-foreground mt-1">
          Protótipo da tabela de viagens por linha/sentido (Ida/Volta), com headway acima da Ida e
          abaixo da Volta — colunas são ordem da viagem, não tempo, então não há régua nem
          correspondência entre colunas de sentidos/linhas diferentes. Setas navegam entre viagens
          (nunca pelos headways); Shift+seta seleciona um intervalo. Dados mockados, múltiplas linhas.
        </p>
        <Button className="mt-3" onClick={() => setTripsOpen(true)}>Abrir grade de viagens</Button>
      </header>

      {open      && <LineScheduleGeneratorModal onClose={() => setOpen(false)} />}
      {tripsOpen && <TripsGridPrototype onClose={() => setTripsOpen(false)} />}
    </div>
  )
}
