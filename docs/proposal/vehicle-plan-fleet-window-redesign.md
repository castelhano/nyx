# Redesenho das janelas de geração — frota deve seguir demanda, não ciclo

Escopo: `apps/web/src/app/transit/vehicle-plan/[id]/line-generator-logic.ts` +
`components/LineScheduleGeneratorModal.tsx` (aba "Janelas"). Não relacionado às Fases 0–3
recém-implementadas (Otimizar/layoverPolicy/algoritmo de geração) — bug de design pré-existente,
identificado ao validar o resultado da Fase 3.

---

## O problema, com exemplo real

Observado: uma linha com ciclo estável das 06:00 às 17:00 gera **uma única janela** cobrindo
essas 11 horas, com frota dimensionada para o pico de demanda dentro desse intervalo — e essa
mesma frota "cheia" é aplicada às 11 horas inteiras, mesmo que a demanda real caia bastante fora
do pico (ex.: pico às 07h-08h, vale às 13h-15h).

Isso super-provisiona frota fora do horário de pico: o gerador está otimizando a forma das janelas
pelo **ciclo**, quando o que deveria decidir a forma é a **demanda** — o ciclo só deveria ser
respeitado como restrição (uma janela de frota não pode atravessar uma mudança de ciclo sem
recalcular), não como critério primário de corte.

---

## Como funciona hoje (pipeline atual)

Chamado em `LineScheduleGeneratorModal.seedWindows()`
([LineScheduleGeneratorModal.tsx:248-257](../../apps/web/src/app/transit/vehicle-plan/[id]/components/LineScheduleGeneratorModal.tsx)):

```
buildUnifiedWindows(outbound, inbound)   // line-generator-logic.ts:79
  → absorbPartialGaps(base)              // line-generator-logic.ts:121
  → mergeByTolerance(absorbed, tol)      // line-generator-logic.ts:198
  → estimateFleetCounts(toleranced, ...) // line-generator-logic.ts:269
```

1. **`buildUnifiedWindows`** (linha 79): varre o dia em slots de 30min (`SLOT_STEP`) e funde os
   registros de ciclo ida/volta (`TransitLine.metrics.windows`) em linhas (`GenWindow`),
   coalescendo slots consecutivos com o **mesmo par (ciclo ida, ciclo volta)** numa única linha.
   `fleetCount` começa como placeholder `1`.
2. **`absorbPartialGaps`** (linha 121): funde linhas com um lado (ida/volta) desconhecido no
   vizinho conhecido compatível — ainda 100% guiado por ciclo.
3. **`mergeByTolerance`** (linha 198): funde linhas consecutivas cujo ciclo (ida+volta) difere até
   `toleranceMinutes` (controle "tolerância" na UI) — reduz ainda mais o número de janelas, sempre
   por **similaridade de ciclo**.
4. **`estimateFleetCounts`** (linha 269): **só agora** a demanda entra. Para cada linha já fechada
   (forma 100% decidida nos passos 1-3), busca o pior valor de demanda dentro de `[row.from,
   row.to)` (`peakDemandByDirection`, linha 239 — "*a band can span several hours ... keeps the
   worst one*") e dimensiona a frota da linha inteira por esse pico.

**A causa raiz**: a forma da janela (seus limites `from`/`to`) é decidida inteiramente nos passos
1-3, olhando só para ciclo. A demanda só é consultada no passo 4, depois que os limites já estão
congelados — e nesse ponto o único grau de liberdade que resta é "qual pico pego dentro do
intervalo que já existe", nunca "onde deveria haver um corte por causa da demanda". Um ciclo
estável de 11 horas sempre vira uma janela de 11 horas, não importa o quanto a demanda oscile
dentro dela.

---

## Proposta: frota primeiro (por demanda), ciclo depois (como restrição)

Inverter a ordem conceitual — sem descartar a lógica de ciclo já existente, que continua
necessária (frequência depende do ciclo, não só da frota):

```
buildUnifiedWindows(outbound, inbound)     // mantém — timeline base de ciclo
  → absorbPartialGaps(base)                // mantém — ainda serve pra fechar buracos de registro
  → mergeByTolerance(absorbed, tol)        // mantém — reduz ruído de ciclo, mesmo papel de hoje
  → deriveFleetBands(cycleRows, demand, …) // NOVO — substitui estimateFleetCounts
```

`deriveFleetBands` funde os dois eixos (ciclo e frota) numa única passada:

### 1. Série contínua de frota necessária, resolução de 30min

Para cada slot de 30min, calcula a frota necessária **naquele instante** (mesma matemática de hoje
— `tripsPerHourNeeded` a partir do pico de demanda da hora, `TARGET_OCCUPANCY`, `renewalIndex` —
mas aplicada por slot, não por banda já fechada), usando o ciclo vigente naquele slot (buscado nas
`cycleRows` do passo 3 acima) para converter viagens/hora em veículos.

### 2. Bandas candidatas (sem suavização ainda)

Agrupa slots consecutivos onde **nem o ciclo nem a frota necessária mudam** — produz o número
máximo de cortes possível (uma banda nova a cada mudança de qualquer um dos dois eixos). Ainda não
é o resultado final: sozinho, isso fragmentaria demais (qualquer oscilação de 1 passageiro na
demanda pode virar um corte de banda).

### 3. Histerese — só corta banda quando a queda é sustentada

Este é o mecanismo que evita explosão de janelas, pedido explicitamente. Regra: uma banda só
assume uma frota **menor** que a anterior se essa frota mais baixa **persistir por pelo menos
`stabilizationMinutes`** (novo parâmetro, proposta de default: 60min). Um vale de demanda mais
curto que isso é absorvido pela banda vizinha de frota mais alta (nunca o contrário — nunca reduz
frota "por engano" por uma queda breve; o princípio espelha o já existente "never assume a shorter
cycle" de `mergeWithNext`/`closeFrequency`, aplicado agora a frota em vez de ciclo).

Subida de frota (pico) **nunca** é suavizada/absorvida — um pico breve de demanda ainda precisa da
frota cheia enquanto durar; só quedas são candidatas a absorção. Isso responde diretamente à ideia
do usuário: "identificar a frota necessária no pico mais forte, e a partir daí ver se as outras
faixas podem ter diminuição" — a banda do pico nunca é apagada, só as bandas ao redor é que
precisam "provar" (com duração mínima) que realmente merecem frota menor antes de virar um corte
separado.

### 4. Nunca atravessa fronteira de ciclo

Uma banda de frota nunca pode se espalhar por cima de uma mudança de ciclo (isso já é garantido
naturalmente pelo passo 2, já que ciclo é um dos dois eixos usados pra abrir banda nova) — a
frequência (`totalCycleMinutes(w) / fleetCount`) depende do ciclo, então misturar dois ciclos numa
banda só de frota tornaria a frequência resultante sem sentido.

### 5. Recoalescer

Depois da histerese absorver vales curtos, linhas adjacentes podem ter ficado com o mesmo par
(ciclo, frota) — funde de novo (mesma função de coalescência do passo 2/`buildUnifiedWindows`).

### Pseudocódigo

```
function deriveFleetBands(cycleRows, demand, vehicleCapacity, renewalIndex, stabilizationMinutes):
  slots = []
  for slot in 0..24 step 0.5:
    band       = findCycleRow(cycleRows, slot)
    cycleTotal = totalCycleMinutes(band)
    peak       = peakDemandAtHour(floor(slot), demand)          // mesmo cálculo de hoje, por hora
    fleet      = fleetForPeak(peak, cycleTotal, vehicleCapacity, renewalIndex)  // mesma fórmula de hoje
    slots.push({ slot, cycleRowId: band.id, fleet, cycleFields: band })

  raw      = coalesce(slots, (a, b) => a.cycleRowId === b.cycleRowId && a.fleet === b.fleet)
  smoothed = applyHysteresis(raw, stabilizationMinutes)   // só absorve QUEDAS curtas, nunca picos
  final    = coalesce(smoothed, sameRule)
  return final.map(toGenWindowRow)
```

---

## Impacto no código

| Função | Ação |
|---|---|
| `buildUnifiedWindows`, `absorbPartialGaps` | mantém, sem mudança — ainda produzem a timeline de ciclo que `deriveFleetBands` consome |
| `mergeByTolerance` | mantém, sem mudança de papel — continua reduzindo ruído de ciclo antes da análise de frota |
| `estimateFleetCounts` | **removida/substituída** por `deriveFleetBands` — a assinatura muda de "dado um conjunto de bandas já fechadas, calcula frota" para "dado uma timeline de ciclo, decide bandas E frota juntas" |
| `peakDemandByDirection` | reaproveitada internamente por `deriveFleetBands`, mas chamada por hora/slot em vez de por banda inteira |
| `applyHysteresis` (nova) | novo helper puro, testável isoladamente — é o coração do critério "não gerar número muito elevado de janelas" |
| `LineScheduleGeneratorModal.seedWindows()` | troca a chamada final de `estimateFleetCounts` por `deriveFleetBands`, passando o novo parâmetro de estabilização |

Funções que **operam sobre o resultado** (`updateWindowBoundary`, `computeBoundaryFlags`,
`mergeWithNext`, `splitWindow`, `closeFrequency`, e a Fase 3 inteira —
`generateRounds`/`assignRoundsToBlocks`) não mudam: continuam recebendo `GenWindow[]`, sem saber
se a forma veio de ciclo ou de demanda. O redesenho é isolado no passo de *seeding*.

---

## Impacto na UI (aba "Janelas")

- O controle de tolerância atual (Nenhuma/Baixa/Média/Alta, em minutos) **continua existindo, sem
  mudança de significado** — ainda rege só a fusão por similaridade de ciclo (passo `mergeByTolerance`).
- Novo controle: **janela de estabilização** (minutos, default sugerido 60) — rege a histerese do
  passo 3. Provavelmente cabe como um segundo dial ao lado do de tolerância, ou um campo numérico
  simples na mesma linha.
- O texto de ajuda dos botões "Restaurar do ciclo"/"Arredondar todas" deve deixar claro que agora
  a forma inicial vem de demanda+ciclo, não só de ciclo — pra não confundir quem já usava a
  ferramenta.

---

## O que NÃO muda

- Linhas sem dados de demanda (`peaks.length === 0` em `peakDemandByDirection`) continuam caindo
  no fallback atual (`Math.max(1, Math.round(cycleTotal / 15))`, hoje em `estimateFleetCounts`
  linha 282) — sem demanda, não há o que a histerese possa fazer melhor que hoje. Vale manter esse
  fallback aplicado por banda de ciclo (não por slot), exatamente como hoje.
- `TARGET_OCCUPANCY` (0.8, linha 233) continua hardcoded — fora de escopo deste redesenho.

---

## Riscos e considerações

- **Fragmentação ainda maior que o ideal se `stabilizationMinutes` for pequeno demais** — precisa
  de um default sensato e possivelmente um piso adicional (ex.: nunca gerar banda de frota com
  menos de 30min, independente da histerese) se a demanda por hora for muito ruidosa.
- **Demanda é armazenada por hora inteira** (`metrics.demand` — chaves `"4"`, `"5"`, ...), não por
  meia hora — então a resolução de 30min do passo 1 vai ter os dois slots de uma mesma hora sempre
  com o mesmo valor de demanda; a granularidade real do eixo "frota" é de 1h, não de 30min (o eixo
  "ciclo" continua em 30min). Isso é esperado e não é um problema — só significa que um corte de
  banda por frota nunca vai cair no meio de uma hora, só na fronteira entre horas.
- **`applyHysteresis` como "nunca reduz por engano, sempre soma por segurança"** é uma escolha
  deliberadamente conservadora (prefere super-provisionar um pouco a arriscar sub-provisionar) —
  compatível com o espírito do resto do arquivo (`mergeWithNext`, `absorbPartialGaps` usam a mesma
  filosofia "never assume a shorter cycle/duration").

---

## Dúvidas em aberto

1. **Default de `stabilizationMinutes`**: proponho 60min como ponto de partida — faz sentido, ou
   prefere algo mais agressivo (ex.: 30min) ou mais conservador (ex.: 90min/2h)?
2. **Exposição na UI**: novo dial ao lado da tolerância existente, ou prefere começar com o valor
   fixo (hardcoded) e só expor um controle se a necessidade aparecer na prática?
3. **Fallback sem demanda**: confirma manter o fallback atual (`cycleTotal/15` por banda de ciclo)
   quando não há dados de demanda, sem tentar nenhuma lógica de histerese nesse caso (não há o que
   suavizar sem uma curva real)?
4. Este redesenho é bloqueante para validar a Fase 3 (geração real), ou pode ser tratado como um
   próximo passo independente, já que a Fase 3 consome `GenWindow[]` sem se importar com a origem
   da forma das bandas?
