# Vehicle Plan Solver V2 — Proposta e TODO

## Contexto

O solver atual usa **random restart greedy**: embaralha viagens aleatoriamente, ordena por horário e faz atribuição greedy em loop infinito, parando por timeout. Problemas identificados:

- Se os horários de partida são todos únicos, `shuffle + sort` sempre produz a **mesma ordem** → cada iteração gera o resultado idêntico → 1M+ iterações sem nenhum ganho real.
- Não há critério de parada inteligente — apenas timeouts em minutos, inadequados para instâncias pequenas.
- Não explora a estrutura natural do problema (mesma linha, pontos compartilhados, deadrun).

---

## Abordagem Proposta: Engine Determinístico por Escopos

Em vez de reiniciar aleatoriamente, o engine percorre **uma única passagem ordenada cronologicamente**, avaliando candidatos em ordem de escopo (custo crescente). Uma segunda passagem só faria sentido com um algoritmo de melhoria explícito (swap entre blocos) — etapa futura.

### Escopo 1 — Mesma Linha

- Tenta encadear a viagem em um bloco ativo da **mesma linha** (e mesmo sentido, quando aplicável).
- Custo de transição: zero (ou apenas o layover mínimo entre chegada e próxima partida).
- O engine deve priorizar ao máximo esse encadeamento antes de avaliar qualquer outro.
- O número de candidatos é polinomial: cada viagem tem poucas sucessoras viáveis dentro da janela de layover.

### Escopo 2 — Ponto Compartilhado, Linha Diferente

- Nenhum deadrun necessário: o veículo já está no ponto de origem da próxima viagem.
- Custo de transição: **penalização de troca de linha** (configurável em minutos-equivalentes).
- Justificativa da penalização: trocar um carro de linha tem custo operacional real mesmo sem perda de tempo —
  motorista não gosta de trocar de linha, fiscal tem maior dificuldade de acompanhar, maior risco de erro operacional.
  A penalização garante que a troca só ocorra quando o ganho (redução de frota, redução de horas) supera o atrito.

### Escopo 3 — Deadrun entre Pontos (Linhas Diferentes)

- Requer consulta à matrix de tempo/km entre o ponto de destino do bloco e o ponto de origem da próxima viagem.
- Custo de transição: **penalização de troca de linha + tempo ocioso (deadrun)**.
- Raramente vale a pena — só compensa quando reduz significativamente a frota ou elimina um bloco ocioso.
- O deadrun gerado já entra como viagem `isDeadhead: true` no bloco.

---

## Critérios de Parada

| # | Critério | Comportamento |
|---|---|---|
| 1 | Sem melhora por N minutos | Já existe — `stopNoImprovementMinutes` |
| 2 | Tempo máximo de geração | Já existe — `stopMaxTotalMinutes` |
| 3 | Todas as possibilidades tentadas | Natural no engine determinístico: uma passagem completa = todas as combinações avaliadas na ordem de escopo |

No engine determinístico o critério 3 é implícito: quando a passagem termina, todas as viagens foram atribuídas ao melhor bloco disponível em cada escopo. Não há reinício.

---

## Penalização de Troca de Linha — Settings

Adicionar ao `PlanningConfig`:

| Campo | Tipo | Default sugerido | Descrição |
|---|---|---|---|
| `lineSwitchPenaltyMinutes` | `number` | `15` | Minutos fictícios adicionados ao custo de qualquer transição entre linhas diferentes, mesmo sem deadrun real. |

Dessa forma a penalização entra diretamente na função de custo já existente (minutos-equivalentes), sem precisar de uma dimensão separada de score. O engine avalia: *"vale a pena mudar de linha se isso me economiza X minutos de deadrun ou Y blocos extras?"*

---

## TODO de Implementação

### 1. Settings
- [ ] Adicionar `lineSwitchPenaltyMinutes` ao schema `planning-config.schema.ts`
- [ ] Expor no form de settings de planejamento

### 2. Tipos (`solver.types.ts`)
- [ ] Remover campos relacionados a random restart (não haverá `attempt`, `stopNoImprovementMinutes` pode permanecer como fallback)
- [ ] Adicionar `lineSwitchPenaltyMinutes` ao `SolverPlanningConfig`
- [ ] Revisar `SolverMessage` — o `progress` pode passar a reportar escopo atual em vez de `attempt`

### 3. Engine (`solver.worker.ts`)
- [ ] Remover o loop de random restart (`setImmediate(runIteration)`)
- [ ] Implementar `solveOnce(cfg)`:
  - Ordenar viagens por `departureMinutes`
  - Para cada viagem, avaliar blocos ativos em ordem: Escopo 1 → Escopo 2 → Escopo 3
  - Critério de seleção: menor custo total (deadrun + penalização de linha, se aplicável)
  - Se nenhum bloco aceita a viagem, abrir bloco novo a partir do melhor depósito
- [ ] Critério de aceitação por escopo:
  - **E1:** mesmo `lineId` na última trip do bloco + layover válido
  - **E2:** mesmo `destinationLocalityId` do bloco = `originLocalityId` da viagem + layover válido + custo ≤ `lineSwitchPenaltyMinutes`
  - **E3:** deadrun via matrix + penalização de linha ≤ `maxDeadrunHardMinutes + lineSwitchPenaltyMinutes`
- [ ] Postar `done` ao final da única passagem (`stopReason: 'exhausted'`)

### 4. Dados para o Worker (`vehicle-plan.service.ts`)
- [ ] Incluir `lineId` em cada `SolverTrip` (atualmente não enviado)
- [ ] Incluir `lineSwitchPenaltyMinutes` no `SolverConfig` vindo do `planningConfig`

### 5. Melhoria Local (etapa futura, não implementar agora)
- [ ] Após a passagem inicial, executar **swap local**: tentar mover a última viagem de cada bloco para outro bloco e ver se o score melhora
- [ ] Critério de parada para melhoria local: sem melhora em uma passagem completa de swaps = solução estável

---

## Notas

- A lógica de scoping **ainda precisa ser detalhada** — o usuário irá especificar os critérios exatos de cada escopo antes da implementação.
- O `clearLineForDayType` e a lógica de import são independentes do solver — não há impacto aqui.
- A matrix de distâncias/tempo já existe em `SolverConfig.matrix` — apenas precisa ser consultada no escopo 3.
