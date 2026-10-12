# Plano — Férias de condutor e banco de horas

**Status: Fases 1–4 implementadas (migrations `20261013090000_vacation_hour_bank`, `20261013150000_standby_extra`).**
Ver [Implementação](#implementação) para o que mudou em relação ao plano.

Convenções:
- Comentários em snippets Prisma/TS em inglês (regra do repo); texto em pt-BR.
- Datas como `@db.Date` / `'YYYY-MM-DD'` (`plan-validity.ts`); horas do banco em **minutos** inteiros.
- Novos resources seguem o padrão de 4 arquivos (schema Zod + Prisma + Service + Controller).
- Cada fase é entregável sozinha; nenhuma depende de fase posterior.

---

## 0. O que o sistema atual já oferece

| Peça | Onde | Uso neste plano |
|---|---|---|
| `CrewOccurrence` (ABSENCE, aprovação, origem) | `transit.prisma` | Férias = uma ausência de um tipo de sistema |
| `CrewAbsenceType.systemKey` (`WEEKLY_OFF`, `COMP_OFF`) | `crew-absence-type/system-types.ts` | Novo `systemKey: 'VACATION'` |
| Ausência aprovada tira o condutor do gerador (`status != free`) e reduz a carga | `roster-generator.input.ts` (`reducesLoad`) | Férias já ficam fora da escala gerada e do teto de cobertura |
| `RosterEntry` `COMP_OFF` | `transit.prisma` | Débito de uma jornada no banco |
| Preferenciais (`Duty.constraints.crewMemberIds`, `VehiclePlan.constraints.bundleCrew`) | `roster-generator.input.ts` (`preferredOf`) | Ferista herda a posição do titular |
| `Contract.weeklyHours`, `Contract.salary` | `hr.prisma` | Jornada diária e valor da hora |
| `Holiday` (global ou por `branchId`) | `core.prisma` | Feriado: nada entra no banco, compensação bloqueada |
| `RosterModel` (carga trabalhada `workedBefore`, `targetMinutes`) | `roster-generator.calc.ts` | Passa a usar horas reais nos dias importados |

---

## Fase 1 — Férias

### 1.1 Modelo

- Tipo de ausência de sistema **"Férias"** (`systemKey: 'VACATION'`, `effect: ABSENCE`), criado
  como os outros tipos de sistema e nunca excluído.
- `CrewOccurrence` ganha o ferista:

```prisma
model CrewOccurrence {
  // ...
  // VACATION only — who covers the crew member's duties in the period (optional)
  coverCrewMemberId String?
  coverCrewMember   CrewMember? @relation("OccurrenceCover", fields: [coverCrewMemberId], references: [id])
}
```

- Férias fracionadas = **um lançamento por período**, cada um com o seu ferista. Regras da CLT
  (fracionamento, início perto de feriado/DSR) ficam com a frequência — o sistema não valida.

### 1.2 Lançamento

- Formulário de férias com **campo de tags de operadores** (componente existente) + início + fim.
  - **Um operador:** campo "Ferista" opcional.
  - **Vários operadores** (mesmo período, sem ferista): cria uma ocorrência por operador; o campo
    de ferista some.
- Alertas (não bloqueiam):
  - ferista de **turno diferente** do titular;
  - ferista já **ausente** no período.
- Bloqueio: o mesmo ferista não cobre **dois titulares com períodos sobrepostos**.

### 1.3 Efeito na escala diária

- Ao aprovar/lançar, os dias já gerados (`PLANNED`, e `PUBLISHED` com registro em
  `DailyChangeLog` + aviso ao operador) **liberam as escalas do titular**. Com ferista definido,
  elas já vão direto para o ferista quando ele estiver livre e as regras permitirem; o resto fica
  sem operador para o gerador resolver.
- Ao excluir/encurtar as férias: os dias devolvidos voltam a ficar disponíveis para o titular na
  próxima geração (não se refaz nada automaticamente).

### 1.4 Gerador — o ferista ocupa o lugar do titular no período

No `loadRosterInput`, para cada dia do período de férias com ferista:

| O que o ferista herda | Como |
|---|---|
| Prioridade nas listas de preferenciais | Em `preferredOf`, o ferista entra **na posição** do titular (escalas e grupos de viagens) |
| A tabela do titular | Usa as `lastSignatures` do titular → a continuidade de tabela puxa a mesma escala |
| As folgas do titular | Usa a escala de descanso (pattern + offset) do titular nesses dias |
| — | Carga, contrato e turno continuam os do próprio ferista |

- As **trocas de tabela na entrada e na saída** do período não contam no limite de trocas
  (`maxChanges`) — nem do ferista, nem do titular na volta.
- Teto de cobertura: nada a fazer — ausência já não conta como livre (`coverageBound`).
- Solver do plano lógico ("Limitar turnos ao quadro ativo"): **não muda** nesta fase.

### 1.5 Visualização

- Escala diária: dia de férias com estilo próprio (como as demais ausências) e o ferista indicado
  no tooltip; no ferista, marca "cobrindo 30087".
- Listagem de férias (filtros: empresa, período, com/sem ferista).

---

## Fase 2 — Banco de horas (previsto)

### 2.1 Jornada diária pelo contrato

```prisma
model Contract {
  // ...
  weeklyHours  Int @default(44)
  // worked days per week — the daily journey is weeklyHours / workDaysPerWeek (42h / 6 = 7h)
  workDaysPerWeek Int @default(6)
}
```

- `jornadaDiaria = weeklyHours / workDaysPerWeek` (o `CrewMember.weeklyHours` continua
  sobrescrevendo as horas semanais).
- Valor da hora (informativo): `salary / (weeklyHours × 5)`; hora extra 50% = valor da hora × 1,5;
  feriado = × 2.

### 2.2 Regra do dia

| Situação | Banco | A pagar |
|---|---|---|
| Dia comum, trabalhou **mais** que a jornada (`extra`) | **50%** de `extra` | 50% de `extra` |
| Dia comum, trabalhou **menos** (`falta = jornada − trabalhado`) | **−100%** de `falta` | — |
| Feriado trabalhado | nada | 100% de `extra` |
| Folga compensada (`COMP_OFF`) | **−jornada diária** | — |
| Folga, férias, atestado, falta, INSS, acidente, suspensão, folga prêmio, abonado, treinamento | neutro | — |
| Plantão (previsto) | neutro | — |

- Compensação **bloqueada em feriado** (lançamento manual e gerador).
- Previsto: horas pagas da escala (`DailyDuty.summary`) vs. jornada diária.

### 2.3 Lotes e abatimento

Mês **civil**. Cada condutor tem, por mês de origem, um lote:

```prisma
// What a crew member's hour bank holds from one month of origin — positive (credit to use by the
// end of the next month) or negative (debt carried on). Closed months are frozen.
model HourBankLot {
  id           String   @id @default(uuid())
  crewMemberId String
  month        DateTime @db.Date   // first day of the month of origin
  minutes      Int                 // current balance of the lot (credits minus what was used)
  // ...
  @@unique([crewMemberId, month])
}

// Every movement, so balances are a sum and can be audited
model HourBankEntry {
  id           String   @id @default(uuid())
  crewMemberId String
  date         DateTime @db.Date
  kind         HourBankEntryKind // CREDIT | DEBIT | COMP_OFF | PAYOUT | RESET | OPENING
  minutes      Int               // signed
  source       String            // FORECAST | IMPORT | MANUAL | CLOSING
  lotMonth     DateTime? @db.Date
}
```

Regras:
1. **Dentro do mês**, positivos e negativos se compensam livremente.
2. **Abatimento** (compensação ou hora negativa) consome primeiro o lote positivo **mais antigo**
   (o do mês anterior, que vence antes), depois o do mês corrente.
3. Hora positiva do mês abate primeiro um **negativo herdado**.
4. **Vencimento:** lote positivo do mês M não usado até o fim de M+1 → vai para **"a pagar"** no
   fechamento de M+1.
5. **Negativo** passa para o mês seguinte; no fechamento de **mês par** (fev, abr, jun, ago, out,
   dez) o saldo negativo é **perdoado** (zera).

### 2.4 Saldo inicial

- Definido por condutor no **mês de corte** (lançamento `OPENING`, importável por planilha/CSV),
  já sujeito às regras de vencimento a partir dali.
- Os saldos do ERP (extrato RCB) **não são usados** — o ERP não aplica estas regras.

### 2.5 Fechamento mensal

- Ação **"Fechar mês"** por empresa (qualquer usuário com edição): aplica vencimento → "a pagar",
  reset de negativos em mês par, congela o mês. Reabrir é permitido (mesma permissão).
- Só fecha um mês cuja importação cobre o mês inteiro (Fase 3); antes disso, o fechamento usa o
  previsto e avisa.

### 2.6 Telas e relatórios

- **Saldo por condutor:** previsto vs. realizado, lote do mês anterior (vencendo), mês corrente,
  negativo herdado; extrato de movimentos.
- **A pagar** por mês (horas e valor informativo) e **saldos parciais**.
- Exportação **CSV** para conferência.
- Na escala diária: coluna/tooltip de saldo do operador.

---

## Fase 3 — Importação da frequência (realizado)

### 3.1 Arquivo

Fonte: **"Listagem de Movimentos da Frequência"** (dia a dia), um arquivo por empresa.

Por dia usamos:

| Campo | Uso |
|---|---|
| `OCORRENCIA` / texto do dia | `NOR`, `F TRB` (feriado trabalhado), `COMPENSACAO B`, `FOLGA`, `FERIADO`, `FERIAS`, `ATESTADO`, `FALTA`… |
| `EXTRA + EXCES` | hora extra real do dia (a separação é só o limite de 2h da CLT) |
| `INCOM` | hora negativa do dia |
| `ENTRA`/`SAIDA`/`LINHA` | conferência com a escala (opcional) |

- O extrato do banco (RCB) **não** é usado.
- `C.NOT`, `A.NOT` e eventos de folha não afetam o banco.

### 3.2 Parser

- Texto de largura fixa, **Latin-1**, quebras de página e cabeçalho repetido; funcionário pode
  continuar na página seguinte.
- Dia com **várias linhas** (várias batidas): valores só na última — agregar por data.
- Chave: **matrícula** (`030087` ↔ `30087`, comparar sem zeros à esquerda).
- Período do cabeçalho (`PERIODO DE: dd/mm/aaaa a dd/mm/aaaa`) define o que é substituído.
- Na importação o usuário escolhe a empresa; o sistema confere com a razão social do cabeçalho e
  recusa se não bater.

### 3.3 Gravação

```prisma
// One day of the frequency file — the actual hours, replacing the forecast for the day
model CrewTimesheetDay {
  id           String   @id @default(uuid())
  crewMemberId String
  date         DateTime @db.Date
  occurrence   String            // NOR | F TRB | COMPENSACAO B | FOLGA | ...
  extraMinutes Int               // EXTRA + EXCES
  shortMinutes Int               // INCOM
  hash         String            // the day's parsed content — re-imports skip unchanged days
  importId     String
  @@unique([crewMemberId, date])
}
```

- **Última importação sobrescreve.** Só grava os dias cujo `hash` mudou.
- Dias importados geram os movimentos do banco com `source: IMPORT` e anulam os `FORECAST` do dia.
- Compensação no arquivo vale como **real**, mesmo que o dia estivesse escalado.
- Relatório da importação: dias novos/alterados, funcionários não encontrados, divergências
  (férias do cabeçalho × férias lançadas, compensação no arquivo × escala).

### 3.4 Gerador usa o realizado

- A carga trabalhada do período (`workedBefore`) usa as horas reais nos dias importados e o
  previsto nos demais.

---

## Fase 4 — Gerador usando o banco

Na geração, a seção **"Sobra de condutores"**:

- **Plantões extras** (além das metas da empresa): linhas de dia (ou todos os dias do período),
  início–fim, local de apresentação e quantidade. Criados ao iniciar a geração
  (`DailyDuty.standbyExtra` = a geração); o aceite substitui os das gerações anteriores nos dias
  planejados; descartar remove os da própria geração.
- **Compensar banco com a sobra:** quem fica livre num dia (sem tabela nem plantão, fora de
  feriado) recebe **folga compensada** (`RosterEntry COMP_OFF`, `source GENERATED` — refeita a
  cada geração). A sobra não é escolhida só entre quem já sobraria: o gerador decide junto quem
  trabalha e quem compensa, deixando livres os de mais saldo.

Prioridade de quem compensa (`bankPriority`): saldo do mês anterior ≥ 5h primeiro (maior
primeiro); abaixo disso, a soma do mês anterior com o corrente. O saldo é abatido a cada
compensação dada no período (uma jornada, mais antigo primeiro).

Ordem do objetivo: regras rígidas > cobertura das tabelas > plantões > WARN > preferencial
(descer um na lista < **banco** < sair da lista) > demais critérios. Ou seja:
- linha com poucos habilitados: ninguém sai se a tabela ficaria descoberta;
- preferencial único: mantém; com outro listado que caiba no dia, o 1º pode compensar.

Com a compensação ligada, a troca de tabela de uma substituição pontual (outra tabela e volta
à de antes no dia trabalhado seguinte) não conta no limite de trocas — só no score.

Após gerar: folgas dadas, horas abatidas e **alerta** de quem ficou mais de 3h negativo
(`ROSTER_COMP_TOLERANCE`).

---

## Decisões

| # | Pergunta | Decisão |
|---|---|---|
| F1 | O que o ferista herda | Só a prioridade nas listas de preferenciais; turno diferente gera alerta, não bloqueia |
| F2 | Escopo do ferista | Segue a escala do titular, inclusive as folgas, no período |
| F3 | Fracionamento | Um lançamento por período, cada um com o seu ferista; CLT fica com a frequência |
| F4 | Quadro ativo no solver | Não muda agora; o gerador diário já desconta ausentes do teto |
| F5 | Lançamento | Manual; vários operadores de uma vez (mesmo período, sem ferista) |
| B1 | Fonte do realizado | Previsto pela escala; importação semanal da frequência substitui o previsto |
| B2 | Jornada diária | Pelo contrato: semanal ÷ dias trabalhados/semana (novo campo, padrão 6) |
| B3 | Extra | 50% banco / 50% pago, todos os dias; feriado: tudo pago, compensação proibida |
| B4 | Abatimento | Mais antigo primeiro (mês anterior antes do corrente) |
| B5 | Mês | Civil |
| B6 | Negativo | Carrega; perdoado (zerado) no fechamento dos meses pares |
| B7 | A pagar | Só listagem + CSV; relatórios de saldo e valor (informativo) |
| B8 | Valor da hora | salário ÷ (semanal × 5) × 1,5 (feriado × 2) |
| B9 | Plantão | Neutro no previsto; no realizado vale o arquivo |
| B10 | Arquivo | Listagem diária; `EXTRA + EXCES` = extra, `INCOM` = negativo; extrato RCB ignorado |
| B11 | Reimportação | Última sobrescreve; grava só os dias alterados |
| B12 | Ocorrências neutras | Folga prêmio, abonado, treinamento, suspensão, JORJ, faltas, atestados, INSS, acidente |
| B13 | Saldo inicial | Lançado no mês de corte |
| B14 | Fechamento | Qualquer usuário com edição fecha e reabre |
| B15 | Empresas | Mesmo formato e regras; um arquivo por empresa |

---

## Implementação

| Item | Onde | Diferença do plano |
|---|---|---|
| Tipo "Férias" (`FE`, `systemKey VACATION`) + `CrewOccurrence.coverCrewMemberId` | migration, `crew-occurrence.service.ts` | — |
| Lançamento/listagem | `transit/vacation` (API `crew/vacation/`, página `app/transit/vacation`) | Ferista também editável na tela de pedidos do operador |
| Liberação das escalas | `vacation-release.service.ts` | Ferista "livre" = sem tabela/folga fixa no dia, sem ausência e com interjornada ok com os dias vizinhos |
| Gerador | `roster-generator.input.ts`, `RgMember.lastSwaps` | A troca de entrada/saída não conta porque as últimas tabelas são **substituídas** no dia (titular na entrada, as do próprio ferista na saída) |
| Escala diária | `roster-board.service.ts`, `OperatorsGrid.tsx` | Férias em verde-azulado; ferista com traço e tooltip "Cobrindo as férias de …"; saldo do banco no tooltip da coluna de carga |
| Jornada diária | `Contract.workDaysPerWeek` | — |
| Mês de corte | `RosterSettings.hourBankStart` (Configurações › Escala) | Novo campo — sem ele a empresa não tem banco |
| Banco | `transit/hour-bank` (`hour-bank.calc.ts` regras puras + testes) | Dias de mês **aberto** são lidos ao vivo (frequência importada, senão a escala); o fechamento os congela como `HourBankEntry` `DAY` e grava `HourBankLot` (com `pay` e `holiday` separados, para o valor × 1,5 / × 2). Só o último mês fechado reabre |
| Saldo inicial / ajustes | `HourBankEntry` `OPENING` (datado no mês de origem do lote) / `ADJUST` | — |
| Importação | `timesheet-parser.ts`, `timesheet-import.service.ts` | Empresa conferida pelo CNPJ do cabeçalho (`Branch.taxId`); `CrewTimesheetDay.workedMinutes` = `TOTAL` (carga real do gerador). Só `NOR` mexe no banco; `F TRB` paga a extra, `COMPENSACAO B` debita a jornada, o resto é neutro |
| Compensação em feriado | `daily-operation.service.ts` (`setDayOff*`), `syncDaysOff` | Bloqueada no lançamento manual; pedido aprovado não gera FC em feriado |
