# Proposta — Solver de escala › Melhoria contínua

Fase 4 do `plan_crew_solver_v1.md`. Hoje o solver faz uma passada gulosa (construção) e para. A
proposta é continuar a partir dela, melhorando a escala até o usuário parar, não haver melhora ou
atingir o tempo limite, e emitir cada proposta melhor que a anterior.

O solver de veículos **não é referência**: está inativo e será revisto depois, com base no que for
definido aqui.

Status: **consolidado** — decisões fechadas (2026-09-27).

---

## Ponto de partida

Geração "AJUSTE_REFEI" (UTIL, 190 carros, depois de marcar os terminais como local de refeição):

| | Qtd | % |
|---|---|---|
| Corrida | 70 | 18% |
| Dupla pegada | 220 | 55% |
| Meia jornada | 109 | 27% |
| **Total** | **399** | |

Trocas de linha por jornada: 0,67 na dupla pegada e 0,81 na corrida. A construção gulosa decide
cada corte e cada par uma vez, da esquerda para a direita, e nunca revisa. Uma escolha ruim no
início fixa tudo o que vem depois.

---

## Fase A — Nota e pendências (pré-requisito)

Vale para a tela, o recálculo e o solver: é a mesma função (`computeCrewPlan`).

### A1. Fórmula da nota

**Problema.** Os critérios por jornada são somados **uma vez por jornada**, e os critérios do
plano **uma vez no total**. Com cerca de 400 jornadas, os por jornada somam uns 36.000 de peso e
os do plano (Nº de jornadas 30, eficiência 20, extra 15, % dupla 10, % meia 10) somam 85, **cerca
de 0,2%**. Na prática:

- **Nº de jornadas e eficiência não pesam nada.**
- **Meia jornada melhora a nota.** Ela não tem o critério de duração, e amplitude e trocas ficam
  no ideal, então entra como uma jornada "perfeita" e puxa a média para cima.

**Nova fórmula.** Cada critério entra **uma vez**, com seu peso:

- **Critério por jornada** (duração, amplitude, refeição, intervalo da dupla, trocas de carro,
  trocas de linha): a **média** do seu valor (0 a 1) nas jornadas a que se aplica.
- **Critério do plano** (extra, % dupla, % meia, Nº de jornadas, eficiência, cobertura): seu
  valor (0 a 1).

```
nota = 9999 × Σ (peso × valor 0–1)  ÷  Σ pesos dos critérios ativos
```

**Escala continua de 0 a 9999**, sem números enormes nem negativos:
- 9999 = todos os critérios no ideal;
- cada critério tira da nota no máximo a sua fatia (`peso ÷ soma dos pesos`);
- com a soma dos pesos em 200, um critério de peso 30 totalmente fora do ideal tira 1.500
  pontos.

**Onde a nota perde.** O resumo do plano passa a guardar o valor (0–1) de cada critério. A tela
pode mostrar a perda de cada critério em pontos, o que ajuda a calibrar os pesos.

O solver compara a nota **sem arredondar**. Com cerca de 400 jornadas, mexer em uma delas muda a
média em menos de 1 ponto, e o arredondamento esconderia a melhora.

Todas as notas mudam. Um script recalcula as escalas existentes.

### A2. Cobertura

Novo critério do plano, **Cobertura** (% dos minutos em serviço com motorista):

| | Valor |
|---|---|
| Piso | 90 |
| Ideal | 100–100 |
| Teto | 100 |
| Peso | 30 |

A tela já mostrava o "Sem motorista", mas ele não entrava na nota; uma escala montada à mão e
incompleta podia ter nota alta. O solver mantém cobertura total por regra, então para ele esse
critério fica sempre no ideal.

### A3. Pendência só fora do piso/teto

Hoje, sair da faixa ideal gera pendência `warning` (`WORK_TIME`, `SPREAD`, `MEAL_BREAK`,
`SPLIT_INTERVAL`). Passa a ser:

- **entre o ideal e o piso/teto**: só perde nota, **sem pendência**;
- **abaixo do piso ou acima do teto**: pendência `error`, como hoje.

As demais pendências (`MIN_PIECE`, `MEAL_LOCATION`, `TRAVEL_GAP` sem matriz etc.) não mudam.

---

## Fase B — Avaliação incremental

A avaliação completa (`computeCrewPlan`) leva cerca de 30 ms no plano de dev, ou seja, uns 30
tentativas por segundo. Isso é pouco para a melhoria contínua.

- **Extrair `evaluateDuty`** de `computeCrewPlan`: resumo, pendências e a contribuição da jornada
  para cada critério. `computeCrewPlan` passa a usá-la, então a tela e o solver continuam com uma
  única regra.
- **Agregado do plano**: acumula, por critério, a soma dos valores e a contagem de jornadas, mais
  os totais (trabalhado, extra, por tipo, pago, cobertura). Tem `add(jornada)` e
  `remove(jornada)`. Um movimento remove as jornadas afetadas, adiciona as novas e lê a nota sem
  percorrer o plano.
- **Proposta emitida** passa pela `computeCrewPlan` completa: a nota mostrada é sempre a oficial.
- **Teste de igualdade**: para as escalas do banco, agregado incremental = `computeCrewPlan`.

---

## Fase C — Melhoria contínua

### Representação

- **Trechos mínimos**: os `serviceSpans` de cada carro cortados em todos os pontos de troca.
- **Jornada**: pegadas ordenadas (carro, início, fim) e intervalos.
- **Invariante**: cada trecho mínimo, fora das jornadas travadas, é coberto por **exatamente uma**
  jornada de motorista. Nenhum movimento pode deixar trecho descoberto.

### Regras duras

Toda jornada gerada respeita:

- **tetos e pisos** dos critérios ativos por jornada (trabalho, amplitude, intervalo da dupla),
  ou seja, nenhuma pendência `error`;
- **operador**: pegadas só em carros do mesmo `branchId`;
- **deslocamento do condutor**: entre pegadas em pontos diferentes, o vão tem que comportar o
  tempo da matriz. O deslocamento **não é gravado** como atividade, só verificado. Sem tempo na
  matriz, o par não é usado;
- **refeição** da corrida só em parada `allowsMealBreak` da linha que chega;
- **no máximo um intervalo grande** por jornada (a refeição da corrida ou o vão da dupla). Os
  demais vãos entre pegadas são só trocas de carro ou de linha;
- **até 3 pegadas** por jornada. O custo da pegada extra vem dos critérios de trocas de carro e de
  linha (hoje teto 3, peso 30): o solver só usa 3 pegadas quando compensa nos demais critérios;
- **interjornada**: garantida pelo teto da amplitude (1440 − 780 = 660 min = 11h).

### Movimentos

| Movimento | O que faz | Ataca |
|---|---|---|
| **Mover rendição** | A fronteira entre duas pegadas consecutivas no mesmo carro (de jornadas diferentes) anda para o ponto de troca anterior ou seguinte. | Duração, extra, troca de linha (cortar na virada de linha do carro) |
| **Trocar pontas** | Duas jornadas trocam a última pegada: A1+B2 e B1+A2. | Troca de carro e de linha, duração |
| **Unir meias jornadas** | Duas meias jornadas viram uma corrida (refeição entre elas) ou uma dupla pegada. | % meia, Nº de jornadas |
| **Absorver pegada** | Uma pegada de meia jornada entra numa jornada existente como 3ª pegada. | % meia, Nº de jornadas |
| **Destruir e reconstruir** | Remove k jornadas de uma vizinhança e recobre os trechos com a construção, com ruído nos custos. Vizinhanças possíveis: janela de horário, mesmo terminal, piores jornadas (maior perda de nota). | Sai de ótimos locais |

Os quatro primeiros são baratos e ficam com a maior parte das tentativas. Destruir e reconstruir
roda com menos frequência, para diversificar. As vizinhanças ficam sempre dentro de um operador.

### Aceitação

**Simulated annealing**: sempre aceita o que melhora; o que piora é aceito com probabilidade
`exp(Δ / T)`, e a temperatura cai de forma geométrica até o tempo limite. A temperatura inicial é
calibrada para que uma piora típica de um movimento seja aceita cerca de 30% das vezes no início.
A calibração se mede nas primeiras tentativas, sem constante fixa. A melhor escala encontrada é
guardada à parte da escala corrente.

### Parada

Dois campos novos na **configuração da escala** (aba Config, global e por Scope), com os mesmos
nomes da configuração do planejamento:

| Campo | Rótulo | Padrão |
|---|---|---|
| `stopMaxTotalMinutes` | Tempo Máximo de Geração | 5 min |
| `stopNoImprovementMinutes` | Parar sem Melhora | 1 min |

| Condição | `stopReason` |
|---|---|
| Usuário clicou em **Parar** | `user_stopped` |
| Tempo máximo | `max_time` |
| Sem melhora pelo tempo configurado | `no_improvement` |

**Parar** força o fim a qualquer momento e **assume a melhor escala encontrada até ali**, que fica
pronta para "Criar versão".

### Emissão

- **Progresso** a cada ~500 ms: tentativas, tempo desde o início, tempo desde a última melhora,
  melhor nota.
- **Proposta** quando a melhor nota sobe, no máximo 1 por segundo, com as jornadas. O host guarda
  a melhor; o SSE leva só o resumo, como hoje.

### Direção

Com a Fase A, a direção passa a ter efeito real: "Menor quadro" dobra o peso do Nº de jornadas e
"Menor jornada" dobra eficiência e extra, como já faz hoje.

---

## Tela (aba Cenários)

- **Andamento**: tentativas, tempo desde o início, tempo desde a última melhora e o status
  (Gerando / motivo da parada: "sem melhora há 1 min", "tempo máximo", "interrompido").
- **Comparativo atual × proposta**, atualizado a cada melhoria, com as linhas novas:
  - Corrida / Dupla pegada / Meia jornada (qtd e %);
  - **jornadas com troca de carro** e **jornadas com troca de linha** (qtd e %).

---

## Medição

- **Script de bancada**: roda o solver fora da API sobre uma escala (`crewPlanId`, segundos,
  semente) e imprime a nota e a perda por critério, as quantidades por tipo, as jornadas com troca
  de carro e de linha, o extra e as pendências `error`. Com semente fixa, o resultado se repete, o
  que permite comparar mudanças de pesos e de movimentos.
- **Critério de aceite** no plano de dev (UTIL), em 5 minutos, comparado com a construção:
  - cobertura de 100% e zero pendências `error`;
  - nota maior;
  - menos meias jornadas e menos jornadas com troca de linha;
  - Nº de jornadas igual ou menor.

---

## Fases

1. **A — Nota e pendências**: nova fórmula (0–9999), perda por critério no resumo, critério de
   cobertura, pendência só fora do piso/teto, script de recálculo. *Implementada (2026-09-27)*:
   `crewPlanSummary.criteria`, "Perdas na nota" no painel da escala, `pnpm crew:recalculate`.
2. **B — Avaliação incremental**: `evaluateDuty`, agregado, teste de igualdade.
3. **C1 — Laço e movimentos baratos**: mover rendição, trocar pontas, unir meias jornadas,
   absorver pegada; simulated annealing; parada (configuração + Parar); progresso e propostas;
   script de bancada.
4. **C2 — Destruir e reconstruir**: construção com ruído, vizinhanças.
5. **C3 — Tela**: andamento e comparativo novos na aba Cenários.

A Fase A já é útil sozinha: a nota e as pendências da tela ficam coerentes com a configuração.

---

## Fora de escopo

- Paralelizar por operador (várias threads) — só se o desempenho pedir.
- Solução exata (programação inteira / geração de colunas).
- Mover viagens entre carros (é o "Reduzir trocas de carro").
- Revisão do solver de veículos (depois, com base neste).
