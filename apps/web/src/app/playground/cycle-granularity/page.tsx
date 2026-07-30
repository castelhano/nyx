'use client'

import { useCallback, useMemo, useState } from 'react'
import { Switch } from '@/components/ui/switch'
import { CycleCanvasProto } from './Canvas'
import { buildHourClusters, generateSyntheticTrips } from './data'
import type { DotCluster } from './data'

// Rota de teste (sem link no menu). Prototipagem visual: canvas sempre com
// pontos agrupados por hora cheia (eixo X sempre 5 | 6 | 7...), igual à
// produção. A novidade é um segundo tipo de corte — um marcador no centro da
// coluna, cor diferente, indicando um corte de 30min dentro daquela hora —
// sem re-bucketizar os pontos e sem tocar em computeWindows() nem no que é
// persistido, que continua em base horária.

export default function CycleGranularityPlayground() {
  const trips = useMemo(() => generateSyntheticTrips(), [])

  const [includeEdited,    setIncludeEdited]    = useState(true)
  const [cuts,              setCuts]             = useState<number[]>([7])
  const [subCuts,           setSubCuts]          = useState<number[]>([7])
  const [overrideClusters,  setOverrideClusters] = useState<Map<number, DotCluster[]> | null>(null)

  const baseClusters = useMemo(
    () => buildHourClusters(trips, includeEdited),
    [trips, includeEdited],
  )

  // toggling a dot (desativar/reativar) edits on top of the base clustering;
  // any change to the inputs that produced baseClusters resets the override
  const slotClusters = overrideClusters ?? baseClusters

  const handleSlotClustersChange = useCallback((updated: Map<number, DotCluster[]>) => {
    setOverrideClusters(updated)
  }, [])

  function toggleIncludeEdited() {
    setIncludeEdited(v => !v)
    setOverrideClusters(null)
  }

  return (
    <div className="p-8 max-w-5xl mx-auto space-y-6">
      <header>
        <h1 className="text-xl font-semibold">Playground — corte de 30min no canvas de ciclo</h1>
        <p className="text-sm text-muted-foreground mt-1">
          Rota de teste (sem link no menu). O eixo X sempre mostra a faixa horária cheia (5 | 6 | 7…) — os pontos
          continuam agrupados por hora, igual à produção hoje. O que muda é um segundo tipo de corte: um marcador
          em <span className="text-violet-600 font-medium">losango violeta</span> no centro da coluna, indicando que
          aquela hora deveria ser dividida ao meio (30min). <strong className="text-foreground">É só exibição</strong> —
          não recalcula médias nem altera o que seria persistido; a ideia aqui é só avaliar visual e interação.
        </p>
      </header>

      <div className="flex flex-wrap items-center gap-4">
        <label className="flex items-center gap-2 text-sm cursor-pointer select-none">
          <Switch checked={includeEdited} onToggle={toggleIncludeEdited} />
          Considerar editadas
        </label>

        <span className="text-xs text-muted-foreground ml-auto">
          {cuts.length} corte{cuts.length !== 1 ? 's' : ''} cheio{cuts.length !== 1 ? 's' : ''} ·{' '}
          <span className="text-violet-600">{subCuts.length} corte{subCuts.length !== 1 ? 's' : ''} de 30min</span>
        </span>
      </div>

      <CycleCanvasProto
        slotClusters={slotClusters}
        cuts={cuts}
        subCuts={subCuts}
        onCutsChange={setCuts}
        onSubCutsChange={setSubCuts}
        onSlotClustersChange={handleSlotClustersChange}
      />

      <section className="border border-border rounded-md bg-card p-6 space-y-2">
        <h2 className="text-sm font-semibold">Observações</h2>
        <ul className="text-xs text-muted-foreground space-y-1.5 list-disc pl-4">
          <li>
            A coluna das 7h já vem com o corte de 30min marcado por padrão — é justamente onde o dataset sintético
            tem a quebra forte (07:00–07:29 bem mais alto que 07:30–07:59), o caso concreto que motivou a ideia.
            O marcador fica logo acima do rótulo "7", nunca entra na área de plotagem dos pontos.
          </li>
          <li>
            A faixa inferior de cada coluna foi dividida em três zonas de clique: ~25% perto de cada borda (corte
            cheio, igual hoje — arrasta ou clica pra remover) e o ~50% central (corte de 30min — clique alterna
            liga/desliga). Não precisou crescer a área reservada do eixo X para caber isso.
          </li>
          <li>
            Corte de 30min não é arrastável nesta versão — é um toggle fixo no centro da coluna (só existe uma
            posição possível: a metade da hora). Se fizer sentido permitir mover o "meio" pra outro minuto dentro
            da hora, isso precisaria de um tratamento à parte.
          </li>
          <li>
            Nada aqui foi ligado a <code>computeWindows()</code> — os cortes de 30min não têm efeito nas médias
            exibidas nem em nada persistido. Se a direção visual aprovar, o próximo passo seria decidir como esse
            corte se traduz em janelas de fato (ex.: window com <code>from</code>/<code>to</code> em minutos, ou
            um campo separado tipo <code>splitAt: 30</code> por janela horária).
          </li>
        </ul>
      </section>
    </div>
  )
}
