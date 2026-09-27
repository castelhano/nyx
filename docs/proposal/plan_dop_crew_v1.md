# Proposta — DOP: visão de Escala (condutores lógicos)

Objetivo: estender o DOP (`plan_dop_v1.md`) com uma segunda visão, **Escala**, ao lado da
atual (**Carros**). Ela resume os dados **previstos** de jornada no período a partir das
`CrewPlan` ativas. O acesso continua único: mesmo card, menubar e rota `/transit/dop`. Um
switch no cabeçalho alterna as visões e mantém escopo, competência e período selecionados.

Escopo: **condutores lógicos** (as jornadas da escala), não pessoas. Quem trabalha em cada
dia, folgas, DSR e interjornada real são assunto da escala nominal
(`settings-roster.schema.ts`, ainda não consumida). A única ponte para pessoas é o **Quadro
estimado** (decisão 7), um indicativo derivado das jornadas da semana típica, que também é a
base do custo fixo (seção Custos).

Terminologia: **horas operacionais** = horas planejadas pagas da jornada
(`DutySummary.paidMinutes`, hoje igual a `workMinutes`). "Horas pagas" daria ideia de
realizado, e o DOP é só previsto.

Status: todas as perguntas estão respondidas (seção "Perguntas e respostas"). Pronto para
implementar.

---

## O que já existe (peças reaproveitáveis)

| Peça | Onde | Estado |
|---|---|---|
| Resolução (dia, linha) → `VehiclePlan` ativo | `dop.service.ts` (`buildDayTypeResolver` + `findActivePlan`) | Pronto. A visão Escala usa a mesma resolução |
| `CrewPlan.status`/`validFrom`/`validTo` | `transit.prisma` (`model CrewPlan`) | Pronto. Vigência carimbada em `activate()`; `closeActive()` encerra a escala quando outra é ativada ou quando o `VehiclePlan` é substituído. No máximo uma escala ACTIVE por `VehiclePlan` |
| `CrewPlanSummary` (nível escala, persistido) | `crew-plan.schema.ts` | `dutyCount`, `byRole`, `byKind`, `workMinutes`, `paidMinutes`, `overtimeMinutes`, `nightMinutes`, `uncoveredMinutes`, `staleDutyCount`, `issueDutyCount`, `score` |
| `DutySummary` (nível jornada, persistido) | `duty.schema.ts` | `spreadMinutes`, `workMinutes`, `paidMinutes`, `breakMinutes`, `overtimeMinutes`, `nightMinutes`, `pieceCount`, `vehicleChanges`, `lineChanges`, `startMinutes`, `endMinutes`, `interShiftRestMinutes` (estimativa: mesma jornada no dia seguinte) |
| `computeCrewPlan` | `crew-scoring.calc.ts` | Roda a cada edição da escala, ao abrir a escala e ao editar o `VehiclePlan`. Já conhece as viagens (`lineId`) de cada pegada e o `branchId` de cada jornada, então é o lugar natural para agregados novos por linha e empresa |
| Ativação exige cobertura | `CrewPlanService.activate()` | Escala ativa nasce sem jornada desatualizada e sem trecho sem motorista. Pode ficar desatualizada depois, se o `VehiclePlan` for editado |
| Configurações por escopo | `TransitCrewConfigService` (`transit.crew`, fallback global) | Padrão pronto de "uma CCT compartilhada por todas as operadoras do escopo". Os parâmetros de custo seguem o mesmo padrão |
| Limites de interjornada | `settings-roster.interShiftRest` (`floor` 600, `idealMin` 660) | Existem, ainda não consumidos. O DOP passa a usá-los |

---

## Decisões

1. **Mesma página, switch de visão.** `app/transit/dop/page.tsx` ganha um toggle
   **Carros | Escala** no cabeçalho. Escopo, competência, início e fim ficam no estado da
   página, compartilhados pelas duas visões. O layout base se repete: faixa de composição do
   período, linha de KPIs, painéis lado a lado e a tabela por linha com abas + CSV.

2. **Endpoint separado, mesma resolução.** `GET /transit/dop/crew?scopeId&from&to`, carregado
   só quando a visão Escala é aberta. A resolução de calendário e de `VehiclePlan` é extraída
   para um método compartilhado no `DopService`.

3. **Resolução por linha, como no DOP atual.** Para cada (dia, linha): dayType efetivo →
   `VehiclePlan` ativo → `CrewPlan` ACTIVE desse `VehiclePlan` vigente na data (`validFrom` ≤
   dia ≤ `validTo` ou aberto) → **fatia da linha** nos agregados da escala. Isso cobre exceção
   de calendário por linha sem caso especial.

4. **Rateio por linha persistido no `CrewPlanSummary`.** Uma jornada pode operar várias linhas,
   então os números por linha são rateados: a jornada se divide entre as linhas **na proporção
   dos minutos de viagem de cada linha** dentro das pegadas dela. Uma jornada sem viagem
   (reserva ou só atividades) vai para **Sem linha**, que aparece como a última linha da
   tabela, para os totais fecharem. Calculado em `computeCrewPlan` e gravado em
   `CrewPlanSummary.byLine`; o DOP só lê.

5. **Totais do escopo = soma das fatias por linha**, sem somar `CrewPlanSummary` inteiro. Sem
   exceção de calendário, a soma das fatias de uma escala fecha exatamente com o total dela
   (incluindo Sem linha). Com exceção, cada linha puxa a fatia da escala que de fato opera
   naquele dia.

6. **Dia sem escala ativa = zero + alerta.** Há plano de carros ativo sem escala ativa: é uma
   lacuna de planejamento, não uma linha que não opera, e aparece como alerta.

7. **Quadro estimado = max(maior dia de seg–sex; sáb + dom), por papel.** Quem trabalha no
   sábado folga no domingo e vice-versa, então o fim de semana exige o quadro de sábado **mais**
   o de domingo. Exemplo: útil 120, sábado 80, domingo 50 → max(120; 80 + 50) = **130**.
   - **Semana típica montada pelos padrões de dia** (`DayType.pattern`, `weekdays` 1–7), não
     pelos nomes: cada dia da semana recebe as jornadas do dayType que o cobre. Um único dayType
     cobrindo sáb+dom entra duas vezes na soma. Exceções de calendário e feriados não entram.
   - **Por papel**: motorista, cobrador e auxiliar são quadros separados; o total soma os três.
   - **Estimativa**: sem férias, absenteísmo ou folgas fora do fim de semana. A tela diz isso
     (subtítulo ou tooltip com a fórmula, ex.: "maior entre útil (120) e sáb+dom (80+50)").
   - **Quadro vigente por dia**: se as escalas ativas mudam dentro do período, cada dia usa o
     quadro da semana típica vigente naquele dia (é o que o custo fixo usa). O KPI mostra o
     **maior** quadro do período, que é o número de dimensionamento.
   - Calculado no endpoint do DOP, não no `CrewPlanSummary`, porque combina dayTypes diferentes.

8. **Dia útil de referência = dayType que cobre seg–sex, pelo padrão de dias.** Vale para o KPI
   Jornadas/dia útil, para a frota da relação condutor/veículo e para o quadro. É o mesmo
   critério nos três, então numerador e denominador ficam na mesma base. A visão Carros mantém
   o critério atual (dayType mais frequente).

9. **Motorista por padrão, com filtro de papel.** Como o filtro vale para KPIs, painéis e
   tabela, os agregados persistidos (`byLine`, `byBranch`) são **separados por papel**. A
   relação condutor/veículo é sempre só motorista.

10. **Dados por jornada lidos na hora.** O endpoint lê o `DutySummary` das jornadas das escalas
    ativas do período. São poucas escalas e algumas centenas de jornadas, então o custo é baixo.
    Dessa leitura saem, por papel e por dayType:
    - **Interjornada** com os limites atuais de `settings-roster.interShiftRest`, em dois
      números sem sobreposição: **abaixo do mínimo** (< `floor`) e **abaixo do ideal**
      (≥ `floor` e < `idealMin`). Mudar os limites vale na hora, sem recalcular escalas.
    - **Médias por jornada**: amplitude, trabalhado, intervalo, trocas de carro e trocas de
      linha.
    - **% de jornadas multi-linha**: jornadas que operam **2 ou mais linhas distintas** no dia.
      A→B→A conta como 2 linhas (e 2 trocas). Exige o campo novo `DutySummary.lineCount`.

---

## Indicadores

Convenção: **Nível** = onde o dado nasce; **Período** = como vira número do período. "Dia ×
dias" é o valor diário do dayType multiplicado pelos dias daquele tipo no período, somado.
"Snapshot" é o valor diário do dayType, não somado. Todos respeitam o filtro de papel
(decisão 9).

### KPIs (linha de destaque)

| Indicador | Nível | Fonte | Período | Status |
|---|---|---|---|---|
| Jornadas/dia útil (subtítulo: jornadas-dia no período) | Escala → linha (fração) | `byLine[].dutyShare` | Snapshot do dia útil de referência (decisão 8); subtítulo = dia × dias | ✅ |
| Quadro estimado | Escopo, por papel | jornadas por dia da semana típica (decisão 7) | Maior quadro vigente no período | ✅ |
| Horas operacionais | Escala → linha | `byLine[].paidMinutes` | Dia × dias | ✅ |
| Horas extras (+ % das operacionais) | Escala → linha | `byLine[].overtimeMinutes` | Dia × dias | ✅ |
| Horas noturnas | Escala → linha | `byLine[].nightMinutes` | Dia × dias | ✅ |
| Relação condutor/veículo | Escopo | quadro estimado de motorista ÷ frota do dia útil de referência (decisão 8) | Snapshot | ✅ |
| Aproveitamento (horas de veículo em serviço ÷ horas operacionais) | Escala | `coveredMinutes` ÷ `paidMinutes` de motorista (mesmo par do critério `anchored.efficiency`, invertido: quanto maior, melhor) | Dia × dias | ✅ — persiste `coveredMinutes` |
| Custo total da escala | Escopo, por papel | seção Custos | Período | ✅ |

> RESPOSTA: "Relação condutor/veículo": Quadro consolidado maximo(util ou sab+dom) / frota dos dias uteis, o quadro usa mesmo mostrado, e a frotas de referencia eh dos dias uteis

### Composição (painéis)

| Indicador | Nível | Fonte | Período | Status |
|---|---|---|---|---|
| Jornadas por papel (motorista, cobrador, auxiliar) | Escala | `byRole` | Snapshot por dayType | ✅ |
| Jornadas por tipo (corrida, dupla pegada, meia, reserva) | Escala | `byKind` | Snapshot por dayType + % | ✅ |
| Horas por empresa (operacionais, extra, noturno) | Escala | `CrewPlanSummary.byBranch` (por `Duty.branchId` e papel) | Dia × dias | ✅ — equivalente ao "Km por empresa" |
| Horas por tipo de dia | Escala | agregado das fatias | Dia × dias, com linha "Mês" | ✅ — equivalente ao "Km por tipo de dia" |
| Custo por componente (fixo, extra, noturno, encargos, benefícios) | Escopo | seção Custos | Período | ✅ |

### Tabela por linha (abas, como na visão Carros)

| Aba / coluna | Fonte | Período | Status |
|---|---|---|---|
| **Jornadas**: jornadas-equivalentes por dayType | `byLine[].dutyShare` | Snapshot por dayType | ✅ |
| **Horas**: operacionais, extra, noturno por dayType + Mês | `byLine[]` | Dia × dias | ✅ |
| **Custos**: custo da linha, custo por hora operacional | seção Custos (rateio por horas operacionais) | Período | ✅ |
| Última linha: **Sem linha** | `byLine[lineId = null]` | — | ✅ |

### Qualidade da escala (alertas / painel secundário)

| Indicador | Nível | Fonte | Período | Status |
|---|---|---|---|---|
| Dias sem escala ativa (por dayType) | Período | resolução da decisão 3 | Contagem de dias | ✅ |
| Jornadas com pendência | Escala | `issueDutyCount` | Snapshot | ✅ |
| Jornadas desatualizadas / sem motorista | Escala | `staleDutyCount`, `uncoveredMinutes` | Snapshot | ✅ — deveria ser zero numa escala ativa, mas pode deixar de ser após editar o planejamento |
| Interjornada: abaixo do mínimo / abaixo do ideal | Jornada (lida na hora) | `DutySummary.interShiftRestMinutes` vs `settings-roster.interShiftRest` | Snapshot por dayType (decisão 10) | ✅ |
| Médias por jornada: amplitude, trabalhado, intervalo | Jornada (lida na hora) | `DutySummary` | Snapshot por dayType | ✅ |
| Trocas (card seccionado): média de trocas de carro · média de trocas de linha · % multi-linha | Jornada (lida na hora) | `DutySummary.vehicleChanges`, `lineChanges`, `lineCount` | Snapshot por dayType | ✅ |
| Score da escala | Escala | `score` | Snapshot por dayType | ✅ |

> RESPOSTA: (Médias por jornada):
- amplitude, trabalhado, intervalo, trocas de carro/linha: SIM
- trocas de carro/linha: aqui queria mostrar além da média quantidade de percentual de jornadas (por dayType) com mais de uma linha (card seccionado, ou outra sugestão)

### Fora da v1

- Cruzamentos com a visão Carros: horas operacionais por viagem, km por hora operacional,
  **custo por km** e **custo por viagem**.

---

## Custos

Custo **estimado** da escala, sempre com os parâmetros **atuais**. Não há vigência: quando a CCT
muda, o usuário altera os parâmetros e eles passam a valer, inclusive ao reabrir períodos
passados.

### Parâmetros (por escopo, fallback global — mesmo padrão de `TransitCrewConfigService`)

Por papel (motorista, cobrador, auxiliar):

| Parâmetro | Unidade | Exemplo |
|---|---|---|
| Salário base | R$/mês | 3.200,00 |
| Carga horária mensal (divisor) | horas/mês | 220 |
| Encargos (tudo incluso: INSS, FGTS, 13º, férias + 1/3, RAT…) | % | 38 |
| Benefícios por funcionário (soma: VR, cesta, plano de saúde…) | R$/mês | 1.100,00 |

Fixos no código:
- Hora extra: **+50%**. Domingo e feriado não têm adicional próprio (aproximação aceita).
- Adicional noturno: **20%** sobre a hora noturna reduzida (minutos noturnos × 60/52,5).

### Fórmula (por papel, período de D dias)

```
valorHora  = salárioBase ÷ cargaHorariaMensal
fixo       = Σ por dia (quadroVigenteNoDia × salárioBase ÷ 30)     // = quadro × salário × D/30 se o quadro não muda
extra      = horasExtras × valorHora × 1,5
noturno    = (minutosNoturnos ÷ 52,5) × valorHora × 0,20
encargos   = (fixo + extra + noturno) × encargos%
benefícios = Σ por dia (quadroVigenteNoDia × benefícios ÷ 30)      // sem encargos
total      = fixo + extra + noturno + encargos + benefícios
```

- **Fixo pelo quadro, variável pelas horas.** As pessoas recebem salário mensal, e o quadro já
  captura isso. Extras e noturno variam com a escala.
- **Período por dias.** O salário é mensal e o período é livre (até 12 meses), então é
  proporcional por dias (÷ 30). Fecha exato no mês de 30 dias, com diferença pequena nos demais.
- **Custo por linha e por empresa**: o total de cada papel é rateado pela participação da linha
  (ou empresa) nas horas operacionais daquele papel (`byLine`/`byBranch`), incluindo Sem linha.
- **Fica de fora**: custo real por pessoa (anuênio, tempo de casa, afastamentos), assunto da
  escala nominal e da folha.

---

## Campos novos persistidos

Tudo calculado em `computeCrewPlan` e gravado no recálculo.

`DutySummary`:

```ts
lineCount: number   // linhas distintas operadas no dia (A→B→A = 2)
```

`CrewPlanSummary`:

```ts
byLine: {
  lineId:          string | null   // null = Sem linha (jornada sem viagem)
  role:            CrewRole
  dutyShare:       number          // jornadas-equivalentes (fração)
  workMinutes:     number
  paidMinutes:     number          // horas operacionais
  overtimeMinutes: number
  nightMinutes:    number
}[]
byBranch: {
  branchId:        string | null   // null = Não informado
  role:            CrewRole
  dutyCount:       number
  paidMinutes:     number
  overtimeMinutes: number
  nightMinutes:    number
}[]
coveredMinutes:    number          // já calculado internamente (coverage), hoje não persistido
```

Interjornada, médias e multi-linha **não** são persistidos no resumo da escala (decisão 10).

Escalas antigas ganham esses campos no próximo recálculo, que já acontece ao abrir a escala.
Para o DOP, campo ausente contribui zero (mesmo fallback de `idleKm`/`byBranch` na visão Carros).
Opcionalmente, um recálculo em lote das escalas ACTIVE.

---

## Perguntas e respostas

- **Rateio por linha:** minutos de viagem da linha dentro das pegadas (proposto), ou km da
  linha dentro das pegadas? E o bucket Sem linha aparece na tabela como uma linha própria?
> RESPOSTA: pode ser o proposto
> RESPOSTA (Sem linha): pode ser — última linha da tabela. ✅ Fechado.
- **Papéis:** a visão mostra todos os papéis juntos, com filtro, ou só motorista por padrão?
  A relação condutor/veículo faz sentido só para motorista.
> RESPOSTA: so motorista por padrao
> RESPOSTA (agregados por papel): pode ser — `byLine`/`byBranch` separados por papel. ✅ Fechado.
- **Condutores lógicos no KPI:** snapshot do dayType dominante (mesmo critério da frota
  operacional), ou média ponderada pelos dias do período?
> RESPOSTA: pode ser o proposto
> NOTA: fechado como dois números distintos. **Jornadas/dia útil** (subtítulo com jornadas-dia
> do período) e **Quadro estimado** (regra manual atual, decisão 7). A média ponderada foi
> descartada: nenhum dia real tem esse valor. O dia útil de referência passou a ser o dayType
> que cobre seg–sex (decisão 8). ✅ Fechado.
- **Estimativa de quadro de pessoal:** substituída pela regra max(útil; sáb + dom), por papel,
  a partir da semana típica — ver decisão 7. O fator 7/6 foi descartado. ✅ Fechado.
- **Relação condutor/veículo — qual frota de dia útil?**
> RESPOSTA: usar o mesmo critério do quadro (dayType que cobre seg–sex). ✅ Fechado.
- **Interjornada:** entra no DOP, ou fica só no export da escala? É estimativa grosseira
  (mesma jornada no dia seguinte).
  > RESPOSTA: Quero entrar aqui a quantidade de intrajornadas irregulares, mesmo que apenas estimativa, separando em dois numeros, Abaixo do ideal (< idealMin) e Abaixo no minimo (< floor), se precisar melhorar o summary para otimizar o calculo aqui, pode fazer
> RESPOSTA: interjornada (não intrajornada); calculada na hora se não for pesado — é leve
> (decisão 10). ✅ Fechado.
- **Multi-linha:** o que é "jornada com mais de uma linha"?
> RESPOSTA: 2 ou mais linhas distintas no dia (A→B→A = 2 linhas); card seccionado com média de
> trocas de carro, média de trocas de linha e % multi-linha. ✅ Fechado.
- **Horas pagas × horas operacionais**
> RESPOSTA: "Horas operacionais" é a nomenclatura usual para o planejado; "pagas" dá ideia de
> realizado. ✅ Fechado.
- **Cruzamento com a visão Carros** (horas por viagem, km por hora): vale na v1, ou fica para
  depois?
> RESPOSTA: acho menos importante, fica para depois
- **Endpoint:** separado (`/transit/dop/crew`, proposto) ou único com `?view=crew`?
> RESPOSTA: pode ser
- **CSV da visão Escala:** mesmo formato da visão Carros, uma linha por linha com colunas por
  dayType + Mês?
> RESPOSTA: pode ser
- **Custos** — necessário adicionar indicadores de custo de escala, custo por linha.. para isso
  é necessário parametrização do salário base (e mais algun s indicaadores, jornada mes, e me
  lembre se falta algum) por role certo? me de suas considerações
> RESPOSTA: parametrização por escopo (todas as empresas do escopo compartilham); HE fixa em
> 50%; adicional noturno fixo em 20% sobre a hora reduzida; encargos em um % único já com tudo;
> benefícios em um valor total por funcionário; sem vigência (sempre valores atuais); domingo
> sem adicional próprio (aproximação aceita); encargos sobre fixo + variável e benefícios sem
> encargos; modelo híbrido (fixo pelo quadro, variável pelas horas); período proporcional por
> dias; todos os parâmetros, inclusive encargos, por papel. ✅ Fechado — ver seção Custos.

---

## Ordem de implementação sugerida

**Fase 1 — Agregados persistidos (backend)**
- `computeCrewPlan`: `DutySummary.lineCount`; `CrewPlanSummary.byLine` (rateio por minutos de
  viagem, por papel), `byBranch` (por papel) e `coveredMinutes`. Schemas em `duty.schema.ts` e
  `crew-plan.schema.ts`.

**Fase 2 — Parâmetros de custo**
- Configuração nova por escopo (fallback global), no padrão de `TransitCrewConfigService`: por
  papel, salário base, carga horária mensal, encargos % e benefícios por funcionário. Tela na
  página de configurações de transporte.

**Fase 3 — Endpoint**
- Extrair do `DopService` a resolução (dia, linha) → `VehiclePlan`, e acrescentar → `CrewPlan`
  ACTIVE vigente.
- Semana típica pelos `DayType.pattern`: dia útil de referência (seg–sex) e quadro estimado
  por papel, vigente por dia.
- Leitura do `DutySummary` das jornadas das escalas ativas: interjornada (limites atuais do
  roster), médias e % multi-linha.
- Custos pela fórmula da seção Custos, rateados por linha e empresa.
- `GET /transit/dop/crew`: fatias por (dia, linha), somadas no período; totais por dayType,
  empresa, papel e escopo; dias sem escala ativa. Tipos em `dop.schema.ts`
  (`DopCrewPeriodSummary`).

**Fase 4 — Página**
- Switch Carros | Escala no cabeçalho, com estado de escopo e período compartilhado. Visão
  Escala com o mesmo esqueleto: composição do período, KPIs, painéis (papel, tipo, empresa,
  tipo de dia, custos), tabela por linha com abas (Jornadas, Horas, Custos) e CSV. Filtro de
  papel, com motorista por padrão.

**Fase 5 — Depois da v1**
- Cruzamentos com a visão Carros (horas e custo por km/viagem).
