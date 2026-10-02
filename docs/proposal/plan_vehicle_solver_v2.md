# Proposta — Otimizar › Solver de veículos (v2)

Objetivo: reescrever o solver do `VehiclePlan` seguindo a mesma abordagem do solver de escala
(`docs/proposal/plan_crew_solver_v1.md`): modal com configurações do plano (herdadas ou
customizadas), geração que pertence ao plano e sobrevive à tela, um único modo (construção +
melhoria contínua) e score idêntico ao que a tela mostra.

Substitui o modelo descrito em `docs/architecture/transit/solver.md` (modos Rápido/Expandido),
que será reescrito ao final da implementação.

Status: **implementado** (2026-10-01) — fases 0–5. Referência atual:
`docs/architecture/transit/solver.md`. Ajustes feitos durante a implementação em
"Decisões da implementação", no fim.

---

## Princípios

1. **O solver otimiza o que a tela mostra.** O score vem do mesmo cálculo do `recalculate()`
   (`BlockAggregate` / `scoreFromAggregates`, `computeLineSummary`) — deixa de existir o
   `scoreBlocks` à parte (`solver.scoring.ts`). Hoje a nota da proposta não é a nota que aparece
   depois de assumir; isso acaba.
2. **O solver produz blocos completos**: viagens, acesso/recolhe (`BlockDeadrun`), intervalos
   (`BlockInterval`), garagem, empresa e tipo de veículo. Um bloco gerado não pode sair com
   pendência de modelagem (`validateBlock`) que o próprio solver poderia ter evitado.
3. **Um modo só.** A construção gulosa (etapas do atual `solver.deterministic.worker`) gera a
   primeira proposta em segundos; a melhoria contínua (SA) segue até parar, não haver melhora ou
   atingir o tempo limite. Some a escolha Rápido/Expandido.
4. **Opera sobre todas as linhas do plano**, nunca sobre a seleção da tela — a participação das
   empresas só faz sentido sobre o plano inteiro. Para resolver só uma parte, o usuário **trava
   blocos** (`VehicleBlock.constraints.locked`).
5. **Regras rígidas × critérios.** Tudo que é físico ou contratual é regra de viabilidade (movimento
   que viola é descartado); preferência é critério de score. Novas restrições futuras entram como
   dado + regra ou critério, sem reescrever o motor.
6. **Empresa e garagem são decisões do solver**, não detalhes resolvidos ao gravar.

---

## Escopo e permissões

- Só roda em plano **`DRAFT`** (como hoje). Para otimizar um plano ativo, o usuário duplica e roda
  na cópia — um `VehiclePlan` não tem N versões paralelas como a escala.
- Aplicar a proposta substitui **no próprio plano** os blocos não travados.
- Só pode rodar quem tem acesso a **todas as empresas do Scope** do plano (ou ADMIN). Sem isso,
  `start` responde 403 com mensagem clara. Isso elimina o caso atual em que um não-admin
  sobrescreve blocos de outras empresas.
- Blocos travados entram como estão: não são alterados, mas **contam** na participação das
  empresas e na capacidade das garagens.

---

## Mudanças de dados

### 1. Settings de planejamento por Scope

`transit.planning` passa do escopo `branch` para **`transitScope`** (como `transit.crew`).
Não há dados a migrar — pode ser reescrito do zero.

`VehiclePlan.settings` passa a guardar uma **cópia completa** validada por
`planningSettingsSchema` (não mais `Partial` com merge raso). Resolução:

```
VehiclePlan.settings ?? Settings(transit.planning, Scope) ?? global
```

A página `transit/settings` troca o seletor de empresa por Scope na seção de planejamento.

Novos critérios em `planningSettingsSchema.range`:

| Critério | Valor medido | Observação |
|---|---|---|
| `operatorShareFleet` | desvio (p.p.) entre a participação de cada empresa na frota e `ScopeOperator.share` | inativo se o Scope tem 1 empresa ou nenhum `share` |
| `operatorShareKm` | idem, sobre km total | idem |
| `preferredVehicleType` | % de viagens rodando fora do tipo preferido da linha | substitui `specialFleetUsage` |

A prioridade frota × km da participação é dada pelos `modifier` de cada critério.
`specialFleetUsage` sai: a exigência de tipo vira regra rígida.

### 2. Participação das empresas — `ScopeOperator.share`

Já existe (`Float?`, 0–100, no form de ScopeOperator). Passa a ser usado pelo solver. Validação
nova no Scope: a soma dos `share` preenchidos não pode passar de 100.

A participação é medida **sobre o plano inteiro**, incluindo blocos travados.

### 3. Garagem — `TransitLocality.depot`

Novo campo `depot Json?` (nulo quando `isDepot = false`), validado por schema Zod:

```ts
depot: {
  operators: string[]                // branchIds que podem usar; vazio = qualquer empresa
  capacity: {
    vehicleType: VehicleType | null  // null = total da garagem
    max:         number
  }[]                                // vazio = sem limite
}
```

- Uma garagem pode servir várias empresas (ex.: Gar Rapido → Rapido e Vpar).
- Capacidade é física: total e/ou por tipo de veículo. Todas as linhas valem ao mesmo tempo.
- `branchId` desconhecido (empresa removida) é ignorado na leitura.
- Form: a página custom `transit/transit-locality/[id]` mostra uma seção "Garagem" quando
  `isDepot` está marcado.

### 4. Tipo de veículo na linha — `TransitLine.vehicleTypes`

Novo campo na linha (sempre linha, independente da rota):

```ts
vehicleTypes: {
  allowed:   VehicleType[] | null    // null = qualquer tipo
  preferred: VehicleType | null
}
```

| Caso | Configuração | Efeito |
|---|---|---|
| Linha **deve** operar com micro (itinerário exige) | `allowed: [MICRO_BUS]` | regra rígida |
| Linha **pode** operar com micro (demanda baixa) | `allowed: null, preferred: MICRO_BUS` | critério `preferredVehicleType` |
| Exceção numa partida | `TransitTrip.requiredVehicleType` | regra rígida, prevalece sobre a linha |

O `demandMatch` (critério de linha, usa a capacidade do tipo) já penaliza naturalmente um micro
em linha de demanda alta.

### 5. (futuro) Linha associada a empresa — `VehiclePlanLine.branchId`

Fora desta fase. O motor já nasce com a empresa do bloco como decisão; quando entrar, é o campo
+ uma regra rígida (viagens da linha só em blocos daquela empresa).

---

## Modelo do solver

### Decisões por bloco

- sequência de viagens;
- **garagem** (`depotId`) — a mesma para acesso e recolhe;
- **empresa** (`branchId`);
- **tipo de veículo** (`vehicleType`).

### Regras rígidas (viabilidade)

| Regra | Descrição |
|---|---|
| Encadeamento | `dep(i) ≥ arr(i-1) + deadrun(dest(i-1) → orig(i))`, pela matriz; par sem entrada na matriz é inviável |
| Acesso / recolhe | garagem → 1ª viagem e última viagem → garagem precisam existir na matriz |
| Tipo de veículo | o tipo do bloco precisa ser aceito por todas as viagens (`requiredVehicleType` da viagem, senão `allowed` da linha); interseção vazia = inviável |
| Garagem × empresa | a empresa do bloco precisa constar em `depot.operators` (ou a lista vazia) |
| Capacidade | nº de blocos por garagem (total e por tipo) ≤ `capacity.max` — contando os travados |
| Política de parada | ver abaixo |
| Travados | blocos travados e suas viagens não entram nos movimentos |

### Política de parada (layover)

Para cada parada entre duas viagens consecutivas:

- **limite** = `maxStandMinutes` do tipo de intervalo padrão (`defaultIntervalMaxMinutes`); na
  ausência, **120 min**;
- parada ≤ limite → layover normal no ponto;
- parada > limite → aplica o `layoverPolicy` da **rota da viagem que chega** (o destino dela é
  onde o carro fica); `DEFAULT` herda `defaultLayoverPolicy` das settings gerais:
  - `HOLD` → `BlockInterval` no ponto;
  - `DEPOT` → recolhe para a garagem do bloco e novo acesso; só viável se houver tempo para ida e
    volta pela matriz.

### Score

Os mesmos critérios do `recalculate()` (plano + linhas), mais os três novos acima. Para o SA, o
cálculo é feito sobre um **agregado incremental** (como `CrewScoreAggregate` na escala):
um movimento atualiza só os blocos tocados, com ressincronização periódica para evitar drift.

### Construção (primeira proposta)

Reaproveita as etapas do worker determinístico atual, adaptadas às regras rígidas:

1. linha a linha, guloso por horário de partida;
2. junção de blocos de linhas diferentes sem deadrun;
3. junção com deadrun / redistribuição de blocos curtos;
4. atribuição de garagem e empresa: garagem de menor custo de acesso/recolhe entre as permitidas,
   respeitando capacidade; empresa por ordem de déficit em relação ao `share`.

### Melhoria contínua (SA)

Mesma estrutura do `CrewImprover`: temperatura calibrada nos primeiros movimentos ruins, ciclos
com reaquecimento, retorno à melhor solução entre ciclos. Movimentos:

| Movimento | Descrição |
|---|---|
| relocate | uma viagem muda de bloco |
| swap | duas viagens trocam de bloco |
| tail swap | dois blocos trocam suas caudas a partir de um ponto |
| merge | dois blocos viram um |
| split | um bloco se divide em dois |
| depot | o bloco muda de garagem |
| operator | o bloco muda de empresa |

Tipo de veículo não é um movimento: é derivado das viagens (exigência; senão preferido; senão
padrão) e ajustado pela capacidade.

### Encerramento

`stopMaxTotalMinutes` / `stopNoImprovementMinutes` das settings de planejamento; motivos
`finished | user_stopped | max_time | no_improvement`, como na escala.

---

## Infraestrutura (espelha `crew-solver/`)

```
timetabling/vehicle-solver/
  vehicle-solver.types.ts            params, mensagens, proposta
  vehicle-solver.input.ts            carga Prisma → input puro
  vehicle-solver.calc.ts             regras rígidas, construção
  vehicle-solver.improve.ts          SA
  vehicle-solver.worker.ts           orquestração em fatias
  vehicle-solver.service.ts          jobs, stream, accept
  vehicle-solver.controller.ts       transit/vehicle-plan/:id/solver/*
  vehicle-solver-jobs.controller.ts  transit/vehicle-solver/jobs
```

Sai: `vehicle-plan/solver/` (workers determinístico/estocástico, `solver.scoring.ts`) e os
endpoints `optimize`, `stream`, `stop`, `assume` do `VehiclePlanController`.

### Settings do plano

Mesma API da escala, em `VehiclePlanService`:

| Endpoint | Efeito |
|---|---|
| `GET :id/settings` | `{ settings, isCustom, inherited }` |
| `POST :id/settings/customize` | copia as efetivas (Scope/global) para o plano + recalcula |
| `PUT :id/settings` | grava (validado) + recalcula |
| `DELETE :id/settings` | volta a herdar + recalcula |

### Jobs

- Um por plano, em memória; novo `start` substitui o anterior.
- `GET :id/solver/current` — estado para a tela retomar.
- Stream SSE: envia o estado do job (melhor proposta, último progresso, fim) e depois o ao vivo;
  propostas vão sem os blocos.
- `stop` mantém a melhor proposta; `discard` descarta; guarda de 30 min após o fim.
- Aparece no indicador de gerações em segundo plano do topbar (`background-jobs.tsx`).

### Parâmetros (Painel)

```ts
interface VehicleSolverParams {
  base:      'complete' | 'scratch'      // respeita travados | do zero
  direction: 'balanced' | 'fleet' | 'km' // reponderação dos critérios
}
```

Saem: `mode`, `redistributeTrips`, `includeAccessAndCollection` (sempre gera),
`allowSharedOperation` (a empresa é decisão do solver).

### Aplicar proposta

Em uma transação:

1. apaga os blocos não travados (`BlockTrip`, `BlockDeadrun`, `BlockInterval` em cascata);
2. cria os blocos da proposta com viagens, deadruns e intervalos (`block-deadrun.utils`,
   `block-interval.utils`);
3. numeração: travados mantêm o número; os demais recebem os números livres por ordem de saída
   (a numeração não precisa ser preservada).

Depois: `recalculate(planId)`.

Peças de escalas ligadas a blocos apagados ficam `isStale` (`DutyPiece.vehicleBlockId` →
`SetNull`). A aba Cenários avisa antes: "N escalas deste plano terão peças desvinculadas".

---

## Frontend — modal "Otimizar planejamento"

Substitui `OptimizeModal`, `useSolverController` (parte do solver), `useSolverStream` e
`SolverProposalDialog`. Três abas, como `OptimizeCrewModal`:

| Aba | Conteúdo |
|---|---|
| Config | `PlanningSettingsEditor` (extraído de `transit/settings/page.tsx`, como o `CrewSettingsEditor`). Somente leitura enquanto herda; "Customizar" copia; customizado compara com o herdado; "Restaurar padrão"; salvar/descartar antes de sair da aba; somente leitura durante a geração |
| Painel | base, direção; avisos (blocos com pendência, linhas sem garagem permitida, `share` não configurado) |
| Cenários | contadores (cenários analisados, melhorias, tempo, desde a última melhora); atual × proposta: frota, frota por empresa (× `share`), frota por garagem/tipo (× capacidade), km ocioso, km total, blocos com pendência, score; aviso de escalas afetadas; Parar / Descartar / Aplicar |

Atalhos e comportamento de fechar/Esc iguais aos da escala; a geração continua ao fechar o modal.

---

## Fases

| Fase | Conteúdo |
|---|---|
| 0 | Settings de planejamento por Scope; `VehiclePlan.settings` como cópia completa + API de settings do plano; aba Config no novo modal |
| 1 | `TransitLocality.depot` (+ seção no form); `TransitLine.vehicleTypes` (+ form); validação da soma de `share` |
| 2 | Agregado de score compartilhado com `recalculate()` (fim do `scoreBlocks`); novos critérios |
| 3 | `vehicle-solver/`: input, regras rígidas, construção, worker, jobs, aplicar; abas Painel/Cenários; remoção do solver antigo |
| 4 | Melhoria contínua (SA) com agregado incremental |
| 5 | Reescrever `docs/architecture/transit/solver.md` |
| futuro | `VehiclePlanLine.branchId` (linha associada a empresa) |

---

## Decisões da implementação

- **Peso dos critérios por bloco.** A nota do plano somava o `modifier` de cada critério por
  bloco *uma vez por bloco* — com ~180 blocos, frota, km e participação valiam ~0,3% da nota e a
  busca aumentava a frota para melhorar médias por bloco. Passou a ser a regra da escala (e o que
  a tela de configurações já dizia: "Modifier = peso do critério no score final"): cada critério
  entra uma vez com seu peso, o por bloco com a média. **As notas de todos os planejamentos mudam**
  no próximo recálculo (`pnpm vehicle:recalculate` recalcula todos).
- **Nota sem teto limitada.** O solver otimiza a média dos valores "sem teto" (além do
  piso/teto o critério continua caindo), como a escala — mas limitados a −1, para um critério
  que nenhuma solução atende não dominar a busca.
- **`tripInterval` removido.** Media a média dos `BlockInterval` (que só existem a partir do mínimo
  do tipo padrão), não o tempo de terminal que pretendia proteger. Virou a regra
  `minLayoverMinutes` (padrão 5): tempo mínimo parado no terminal entre duas viagens no mesmo
  ponto — regra rígida do solver e alvo da normalização da importação.
- **Numeração.** Ao aplicar, os carros novos ocupam os números livres por linha predominante
  (a com mais viagens no carro; códigos comparados numericamente) e depois pelo início.
- **Temperatura.** Calibrada pela mediana das primeiras pioras e bem fria (≈ mediana ÷ 20): um
  movimento típico mexe em 1/n de uma média por bloco e há muito mais movimentos que pioram do que
  que melhoram — mais quente, a busca escorrega e não volta.
- **Ponto de partida.** Além da construção, os carros atuais do planejamento (quebrados onde um
  encadeamento viola regra) — usa o que tiver nota melhor.
- **Parada do carro (substitui o `layoverPolicy`).** Parada abaixo do mínimo do tipo de intervalo
  padrão (120 min sem tipo) é giro e fica em qualquer terminal. A partir dele é intervalo e só
  fica onde o ponto da rota permite — `RouteLocality.allowsVehicleStand` ("Permite parada
  (carro)", ao lado de Troca turno/Refeição), no ponto de chegada da viagem ou no de partida da
  seguinte; **padrão proibido**. Fora disso o carro recolhe à garagem do bloco e sai de novo; sem
  tempo para isso, as viagens não podem ser encadeadas. `TransitRoute.layoverPolicy` e a
  configuração geral `defaultLayoverPolicy` foram removidas; o gerador de quadro usa a mesma
  regra (com `homeDepot` / garagem mais próxima para o recolhimento).
- **Direção.** Repondera só a cópia das settings que a busca otimiza; a comparação na aba Cenários
  usa as settings do plano (a nota que ele terá).
