# Proposta — Otimizar › Solver de escala

Objetivo: gerar automaticamente as jornadas de uma escala lógica sobre os carros de um
`VehiclePlan` — **os carros são fixos**: o solver só decide quem dirige cada trecho, nunca move
viagens. Reduzir trocas de carro redistribuindo viagens é um processo posterior e separado
("Otimizar › Reduzir trocas de carro", já implementado).

Pré-requisitos: escala lógica (já implementada) e arquitetura do solver de veículos
(`docs/architecture/transit/solver.md`), que é o modelo a seguir.

Status: **consolidado** — decisões fechadas (2026-09-26); implementação futura.

---

## Princípios

1. **O solver otimiza o que a tela mostra.** Score e pendências vêm de `computeCrewPlan`
   (`crew-scoring.calc.ts`), a mesma função do recálculo da escala — não existe um "score do
   solver" à parte.
2. **Mesma infraestrutura do solver de veículos**: worker thread (não bloqueia a API), progresso
   por SSE, propostas emitidas ao longo do tempo, botão parar. **Um modo só**: a construção gulosa é
   o ponto de partida (primeira proposta em segundos) e a melhoria contínua segue até o usuário
   parar, não haver melhora ou atingir o tempo limite. Sem escolha de modo — em troca, duas execuções
   podem dar resultados diferentes.
3. **Resultado é sempre uma nova versão `DRAFT`** do `CrewPlan` — nunca sobrescreve a ativa. O
   usuário compara as versões e ativa pelo fluxo normal.
4. **Decomposição por operador**: pegada em carro de outro operador é erro (`BRANCH_MISMATCH`),
   então o problema se separa por `branchId` — pedaços menores, resolvidos em paralelo.
5. **Intervalos são sempre explícitos**: o solver lança atividades `BREAK` como o usuário faria;
   nada é deduzido do carro no cálculo.

---

## Mudanças prévias (fase 0) — implementada (2026-09-27)

Independentes do solver — valem também para a montagem manual.

### Tipo de intervalo de refeição (settings de escala, por Scope)

Novo campo em `transit.crew` (Scope → global): **`mealBreakIntervalTypeId`** — o `IntervalType`
lançado como refeição (intrajornada). A faixa que decide se um tempo parado vira refeição é a do
próprio tipo (`IntervalType.minMinutes`/`maxMinutes`). O critério `range.mealBreak` da escala
continua servindo **só para pontuação/pendência**; se o cadastro do tipo e o critério forem
incoerentes, cabe ao usuário revisar.

### Intervalo remunerado conta como jornada

Hoje intervalo nunca conta como trabalhado; `IntervalType.isPaid` só soma no pago. Passa a ser:

- **trabalhado** = pegadas − intervalos **não remunerados** dentro delas + atividades não-intervalo
  + intervalos **remunerados** + apresentação/encerramento;
- **pago** = trabalhado (o remunerado já está dentro);
- extra, `WORK_TIME` e noturno seguem o trabalhado;
- o intervalo remunerado **continua sendo descanso**: interrompe a direção contínua e conta em
  `breakMinutes` / `MEAL_BREAK`.

### Local de refeição

Nova flag em `RouteLocality`: **`allowsMealBreak`** (default `false`), ao lado de
`allowsCrewChange` — por rota, porque o mesmo local pode permitir refeição numa linha e não em
outra. Editada no ponto da rota e no modal de editar sentido (origem e destino).

Intervalo do tipo refeição fora de local marcado vira pendência, na mesma arquitetura das demais
(`DutyIssue`, jornada com `hasIssues`, confirmação ao ativar): código novo **`MEAL_LOCATION`**,
severidade `warning`. O intervalo não guarda local, então o cálculo deriva onde ele acontece:

- dentro de uma pegada → onde o carro está parado (sua última chegada);
- entre pegadas → fim da pegada anterior.

Quem manda é a **linha que chega**: vale se o local for `allowsMealBreak` na rota da última viagem
que chegou ali (chegada por deslocamento, sem linha → pendência).

Na tela, ao lançar o intervalo, um toast de aviso quando o local não é marcado (o intervalo é
gravado mesmo assim). `DutyIssue` ganha `activityId?` para apontar o intervalo.

### Travar jornada

`Duty.constraints` (hoje "reservado para o solver") passa a aceitar `{ locked: true }`, como
`VehicleBlock.constraints`. Toggle no painel da jornada; o solver nunca altera jornada travada.

---

## Como funciona

### 1. Trechos mínimos

Os `serviceSpans` de cada carro (onde ele precisa de motorista — `relief-points.ts`) são cortados
em **todos os pontos de troca**. Cada trecho mínimo tem que ser coberto por exatamente uma
jornada de motorista. Mais pontos de troca = mais flexibilidade e problema maior.

### 2. Pegadas candidatas

Sequências de trechos consecutivos no mesmo carro, com duração entre `minPieceMinutes` e
`maxContinuousDrivingMinutes`. O layover no terminal pode ficar dentro da pegada.

### 3. Intervalos

Para cada tempo parado candidato (entre pegadas, ou dentro de uma pegada no tempo parado do carro):

| Duração | Resultado |
|---|---|
| Dentro da faixa do tipo de refeição e em parada `allowsMealBreak` da rota | `BREAK` do tipo de refeição |
| Acima do máximo da refeição | intervalo de **dupla pegada**: jornada `SPLIT`, respeitando `range.splitInterval` (vão entre pegadas, sem `BREAK`) |
| `range.splitInterval.active = false` | dupla pegada não é gerada |

`range.splitInterval.active = false` passa a significar também "o solver não gera dupla pegada".
Na montagem manual continua possível (só não avaliada).

Os intervalos do plano de veículos (`BlockInterval`) são candidatos naturais — o planejador
costuma colocá-los justamente para a refeição —, mas são só preferência, nunca dedução.

### 4. Jornadas candidatas

Por tipo: **corrida** (pegada + refeição + pegada), **dupla pegada** (duas pegadas com o vão
longo) e **meia jornada** (uma pegada curta). Cada combinação passa pelas regras de severidade
`error` de `computeCrewPlan` (tetos de trabalho e amplitude, refeição mínima, direção contínua,
`TRAVEL_GAP` pela matriz). Apresentação/encerramento pelos settings.

### 5. Escolha

Conjunto de jornadas que cobre cada trecho exatamente uma vez com o melhor score, numa execução só:

1. **Construção**: gulosa (carro a carro, da esquerda para a direita, encadeando pegadas) +
   melhoria local (trocar/fundir/mover pegadas entre jornadas) → primeira proposta.
2. **Melhoria contínua**: destruir e reconstruir (remove algumas jornadas e recobre), em ciclos,
   emitindo cada proposta melhor que a anterior.

Solução exata (programação inteira / geração de colunas) fica para depois, se a heurística não
bastar — exigiria uma biblioteca de otimização.

---

## Núcleo — como ficou

- **Cadeias**: por carro, os trechos em serviço ainda sem motorista (descontadas as jornadas
  travadas), unidos através dos intervalos do próprio carro — nunca através de estadia na garagem.
- **Jornada num carro só primeiro**: em cada cadeia, da esquerda para a direita, tenta-se uma jornada
  inteira em volta de um tempo parado do carro — **corrida** com a refeição dentro da pegada quando o
  tempo parado cabe na faixa do tipo de refeição (em parada de refeição da linha que chega), **dupla
  pegada** no mesmo carro quando é maior e cabe em `range.splitInterval` (se ativo).
- **Pegadas soltas** no restante: ~metade de uma jornada ideal (`(workTime.idealMax − apresentação −
  encerramento) / 2`), dentro da direção contínua, sem atravessar intervalos do carro e sem deixar
  sobra menor que a pegada mínima.
- **Pareamento** das soltas (mesmo operador): corrida (refeição entre as pegadas, tempo de
  deslocamento pela matriz) ou dupla pegada; o que sobra vira meia jornada. Reserva não é gerada.
- **Limites duros**: tetos de trabalho e amplitude só dos critérios **ativos**.
- **Completar**: jornadas travadas ficam intactas; o solver cobre o que resta em volta delas.
- **Avaliação**: `computeCrewPlan` sobre travadas + geradas. No plano de dev (192 carros) roda em
  ~30 ms e cobre 100%.

Ajustes no cálculo da escala feitos junto (valem também para a montagem manual):

- `serviceSpans`: o intervalo do carro se estende sobre o tempo parado colado nele (da última
  chegada à próxima saída) — antes sobravam minutos "sem motorista" onde nenhuma pegada consegue
  começar/terminar.
- Direção contínua: na dupla pegada, o vão entre as pegadas (≥ `splitInterval.floor`) é descanso.
- Regra da refeição ("linha que chega") numa função única, `mealStopAt`, usada pelo cálculo e pelo
  solver.

---

## Parâmetros ao gerar

| Parâmetro | Default | Efeito |
|---|---|---|
| Tempo limite | settings | teto da melhoria contínua (parar manualmente continua possível) |
| Base | Completar | **Completar**: parte de uma cópia da escala atual, mantém as jornadas travadas e cobre o que está sem motorista. **Do zero**: só os carros |
| Direção | Equilibrado | Equilibrado, menos jornadas, menos horas pagas |
| Gerar cobrador | ✗ | replica as jornadas de motorista com papel `FARE_COLLECTOR` |
| Gerar auxiliar | ✗ | replica com papel `ASSISTANT` |

A análise roda **uma vez**, para motorista; ao concluir, as jornadas são replicadas para os papéis
marcados (mesmas pegadas e intervalos, numeração própria por papel: D1 → C1 → A1).

A direção ajusta os pesos dos critérios existentes (`anchored.dutyCount`, `anchored.efficiency`,
`range.overtimeRatio`…), como no solver de veículos.

---

## Tela

Topbar da escala: **Otimizar** vira split button — ação principal **Gerar escala** (modal de
parâmetros → progresso por SSE → lista de propostas com score e resumo → "Criar versão"), e no menu
o **Reduzir trocas de carro** que já existe.

---

## Fases

1. **Fase 0** — mudanças prévias: tipo de refeição por Scope, intervalo remunerado conta como
   jornada, `RouteLocality.allowsMealBreak` + `MEAL_LOCATION`, travar jornada.
2. **Núcleo puro** — trechos, pegadas, intervalos, jornadas candidatas e construção, testável
   isoladamente como `crew-scoring.calc.ts`. *Implementado (2026-09-27)*:
   `timetabling/crew-solver/crew-solver.calc.ts` (`solveCrewPlan`) + `crew-solver.input.ts`
   (`loadCrewSolverInput`). Ver "Núcleo — como ficou".
3. **Worker + SSE + modal** — execução, progresso, propostas, criação da versão, Completar,
   replicação de papéis. *Implementado (2026-09-27)*: `crew-solver.worker.ts`,
   `CrewSolverService`/`CrewSolverController` (`POST /transit/crew-plan/:id/solver/start |
   stop | accept`, SSE `…/solver/stream?jobId=`), `OptimizeCrewModal.tsx`. Detalhes:
   - o job guarda as mensagens (replay) — a construção leva milissegundos e o SSE do cliente
     pode conectar depois do fim; o SSE não leva as jornadas da proposta, só o resumo;
   - "Criar versão" grava a nova escala em 3 inserts em lote (ids gerados no servidor) e
     recalcula: travadas mantêm o número, as geradas pegam os números livres por ordem de
     início, a réplica de cobrador/auxiliar pega o número do motorista quando livre;
   - direção: "menos jornadas" dobra `anchored.dutyCount.weight`; "menos horas pagas" dobra
     `anchored.efficiency.weight` e `range.overtimeRatio.modifier`;
   - topbar: **Otimizar** é split button — clique principal abre "Gerar escala"; no menu, "Gerar
     escala" e "Reduzir trocas de carro".
   - Sem tipo de refeição configurado a geração é recusada (mensagem no modal).
4. **Melhoria contínua** (destruir e reconstruir).

---

## Fora de escopo

- Mover viagens entre carros (é o "Reduzir trocas de carro").
- Escala nominal (pessoas, rodízios, folgas).
- Lógica própria para cobrador/auxiliar (hoje só replicação).
- Solução exata por programação inteira.
