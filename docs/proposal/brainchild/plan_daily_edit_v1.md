# Plano — Edição estrutural da escala diária

**Status: plano fechado, pronto para implementar a partir da etapa 0.** Nada foi implementado, e o spike
do Gantt (etapa 3) ainda não foi feito.

**Sem produção:** o sistema ainda não está em produção (posição de 2026-11-06). As migrações deste plano
não precisam preencher dados nem manter compatibilidade com dias existentes.

Convenções: comentários em snippets Prisma/TS em inglês; texto em pt-BR; minutos do dia operacional
(`> 1440` = madrugada seguinte).

---

## Objetivo

Incluir, remover e alterar viagens, ociosas, intervalos e blocos de um dia, e trocar a empresa do
bloco, sem afetar o plano. A mesma alteração pode valer para vários dias do mesmo plano.

A tela Escala fica como está: a edição é pouco frequente e não pode custar nada na leitura.

## Decisões

| Tema | Decisão |
|---|---|
| Onde a edição grava | Direto nas tabelas do dia. Sem camada aplicada na leitura |
| Registro | Cada salvamento gera um `DailyChangeSet` reaplicável, no formato do `apply-diff` |
| Tela | Rota própria (`/transit/daily-operation/[id]/edit`); a Escala não carrega o Gantt |
| Remover viagem | Viagem do plano é cancelada (`isCancelled`, a supressão fica registrada). Viagem criada no dia é apagada |
| Empresa do bloco | Carro e operador saem; a tabela só nesse bloco acompanha a empresa; o resto vai para o Reparar |
| Dias publicados | Podem ser editados, com aviso e notificação. Encerrados são somente leitura |
| Dias não gerados | Entram: a alteração é aplicada quando o dia for criado |
| Refazer | Por empresa, com escolha explícita: manter as edições (reaplica) ou limpá-las. Vira refazer do escopo só nos casos da seção 5 |
| Publicar e encerrar | Por empresa. O escopo só consolida a visão do dia |
| Desfazer | Sem desfazer na primeira versão. Reverter é uma nova alteração, como no `RosterAdjustment` |

## Fora deste plano

- Antes e depois das pendências na prévia: exige separar um cálculo puro do `recalculate`.
- Plantões: seguem pelos alvos e extras atuais. `syncReserves` remove plantão sem `sourceDutyId`,
  sem `standbyExtra` e sem operador, e a geração aceita apaga os extras anteriores.
- Limpar uma alteração específica de um dia: a limpeza vale para todas as alterações da data.

---

## 1. O que já existe

| Recurso | Onde | Uso aqui |
|---|---|---|
| Dia como cópia própria | `daily-materialize.ts` | Base da edição; nada chega ao plano |
| Recálculo sobre as tabelas do dia | `DailyOperationService.recalculate` | Gerador, Reparar, portal e tela do dia já leem o resultado |
| Ids estáveis entre dias | `sourceId`, `sourceBlockId` (gravados, sem leitura hoje) | Traduzem a alteração de um dia para outro |
| Formato de edição | `vehiclePlanDiffSchema` | Conteúdo do `DailyChangeSet` |
| Editor | `useGanttEditor` (um único ponto de gravação), `GanttBoard` | Reaproveitados com adaptador |
| Pegada acompanhando a edição | `planPieceAdjust`, `resolveAnchor` | Portados para o dia |
| Remoção de bloco | `onDelete: SetNull` em eventos e pegadas | Viagens ficam sem bloco e a pegada fica inválida |
| Cobertura de tabelas e carros | Reparar | Resolve a cascata da troca de empresa |
| Notificação | `DailyChangeLog`, `syncNotifications` (mensagem genérica) | Novas ações já notificam |

## 2. Modelo

```prisma
// A structural edit of one or more dates. No FK to DailyOperation: it must survive rematerialize
model DailyChangeSet {
  id             String     @id @default(uuid())
  scopeId        String
  // dates it applies to, including days not created yet
  dates          DateTime[] @db.Date
  // dates whose edits were discarded at a remake — kept for the record, never replayed
  clearedDates   DateTime[] @db.Date
  // the plans the refs belong to
  vehiclePlanIds String[]
  // empresas it touched, before and after the edit — more than one: a cross-empresa change
  branchIds      String[]
  // VehiclePlanDiff subset, refs by sourceId / sourceBlockId
  diff           Json
  // per date: what could not be applied
  conflicts      Json?
  reason         String?
  userId         String?
  createdAt      DateTime   @default(now())

  @@index([scopeId])
  @@map("transit_daily_change_sets")
}
```

Mudanças em tabelas existentes:

- `changeSetId String?` em `DailyBlock`, `DailyBlockEvent` e `DailyDuty`: quem criou o item.
  `null` = veio do plano.
- `revision Int @default(0)` em `DailyOperation`: sobe só em edição estrutural. O salvamento envia
  a revisão lida e recebe 409 se ela mudou. `updatedAt` não serve, porque o recálculo o altera.

Itens adicionados recebem um `sourceId` / `sourceBlockId` novo, igual em todos os dias da alteração.
Assim uma alteração posterior consegue referenciá-los em qualquer data. Esses campos são ids simples,
sem relação com o plano.

A migração fica por conta do usuário (`pnpm db:migrate`).

## 3. Aplicação

`applyDayDiff(dia, diff)`: função pura, com testes, que recebe o estado do dia e devolve o que gravar
ou os conflitos encontrados. É mais simples que o `applyDiff` do plano: não há `BlockTrip`, OSO nem
drift de horário. Grupos de viagens (`bundleId`) continuam se movendo juntos.

Fluxo do salvamento:

1. Traduz os ids do dia para `sourceId` e grava o `DailyChangeSet`.
2. Para cada data já criada: resolve as referências, aplica em transação, sobe `revision` e recalcula.
3. Data com referência que não resolve: fica de fora e entra em `conflicts`, sem afetar as outras.
4. Dia `PUBLISHED`: registra no `DailyChangeLog`, uma entrada por operador afetado em cada alteração.

`create()` passa a ser: copiar o plano, aplicar as alterações da data por ordem de `createdAt`, e
recalcular. Refazer e dias futuros usam esse mesmo caminho.

Ajustes de apoio:

- Nova pendência `TRIP_UNCOVERED` para viagem sem bloco; hoje ela só conta em `uncoveredTrips`.
- `loadCrewBranchRules` passa a incluir as linhas dos eventos do dia, porque uma viagem adicionada pode
  ser de linha fora de `sources`.
- Pegadas: calcular a âncora antes de aplicar, reajustar com `planPieceAdjust` depois. O que não
  encaixar vira pendência. Sem coluna nova, pois as âncoras valem só durante a edição.

## 4. Vários dias

Ao salvar: **Só este dia** ou **Outros dias do mesmo plano**, com a lista de datas e o estado de cada
uma (planejada, publicada, ainda não gerada).

- Elegíveis: mesmos `vehiclePlanId` em `sources`. Na etapa 4, também o mesmo `crewPlanId`.
- Fora: dias passados e encerrados.
- A prévia mostra datas, conflitos, cascata e operadores afetados.
- Mudança duradoura continua sendo no plano.

## 5. Refazer: manter ou limpar as edições

Vale para **Refazer o dia** e **Refazer período**, sempre a partir de hoje. Hoje o `rematerialize` apaga
o dia do escopo inteiro e leva junto a alocação da outra empresa. Passa a refazer só a empresa selecionada.

### Refazer por empresa

`materializeDay` calcula a cópia completa, para manter a numeração de blocos e tabelas, e grava só o que
é da empresa. As demais ficam intactas, com alocação e edições. Pegadas de outra empresa em bloco
recriado são religadas pelo `sourceBlockId`.

**Só refaz a empresa quando as três condições valem:**

1. A empresa está `PLANNED` na data.
2. O plano do dia é o que está em vigor (o dia não está desatualizado).
3. A cópia resultante é coerente: nenhuma viagem duplica ou se perde, e nenhuma alteração da data
   envolve duas empresas (`branchIds` com mais de uma).

Quando a condição 2 ou 3 falha, o modal explica o motivo e oferece **refazer o escopo inteiro**, que
exige todas as empresas `PLANNED` na data. Se alguma já publicou, um administrador precisa despublicá-la
antes. A condição 1 não tem saída: a própria empresa precisa ser despublicada.

### Linhas compartilhadas

Linha compartilhada é a que tem viagens em blocos de mais de uma empresa na data. Uma empresa cadastrada
em `LineOperator` que não opera a linha naquele plano não conta.

Compartilhar a linha não força sozinho o refazer do escopo: se a linha fosse compartilhada de forma
permanente, todas as datas perderiam o refazer por empresa. A análise é a condição 3, feita sobre a
cópia completa, por `sourceId`:

- **Sem conflito:** refaz a empresa e avisa quais linhas são compartilhadas e que as viagens da outra
  empresa não mudam.
- **Com conflito:** viagem duplicada ou perdida, ou alteração cruzada: exige o refazer do escopo e lista
  as linhas afetadas.

### Manter ou limpar

A escolha só aparece quando há edições nas datas afetadas. Sem edições, o fluxo segue igual.

| Opção | Efeito |
|---|---|
| **Manter as edições** (padrão) | Copia o plano e reaplica as alterações da data; conflitos são listados ao final |
| **Limpar as edições** | Copia o plano puro: a data passa de `dates` para `clearedDates` em cada alteração |

Regras:

- Refazendo por empresa, valem só as alterações com `branchIds` igual à empresa.
- A limpeza é por data. Uma alteração feita para vários dias continua valendo nos demais.
- Um `DailyChangeSet` sem nenhuma data em `dates` permanece como registro, sem efeito.
- Não há restauração: a confirmação deixa isso claro, em destaque, como o aviso de travadas.
- Em **Refazer período**, limpar alcança todo o intervalo, inclusive datas ainda não geradas, para que
  elas não voltem com a edição depois. Datas que não podem ser refeitas não são tocadas.

### API e telas

- `POST :id/rematerialize` recebe `{ branchId | null, edits: 'keep' | 'clear' }`. `null` = escopo inteiro;
  `edits` tem padrão `keep`.
- `remakePeriodSchema` recebe `edits` e um modo de escopo inteiro. `RemakePeriodResult` passa a devolver
  `edited`, `conflicts` e, por data, o motivo de exigir o escopo, para o `dryRun` mostrar antes de confirmar.
- `handleRematerialize` (hoje um `confirm`) precisa de um modal próprio, com a empresa e a escolha; na
  Escala, a empresa vem do contexto da tela.
- `RemakePeriodModal` ganha a opção abaixo da contagem de dias. O aviso atual de "todas as empresas são
  refeitas" passa a aparecer só no modo de escopo inteiro.

## 6. Status por empresa

A escala é gerada por empresa, mas `DailyOperation.status` é do escopo. Na Escala, publicar com a empresa
A selecionada publica também a B, sem aviso, e libera a escala dela no portal.

`DailyOperation` continua sendo o dia do escopo: blocos, `sources`, numeração e a visão do sistema
dependem disso. Separar em um registro por empresa quebraria essa visão. O status sai para uma tabela
ao lado:

```prisma
// An empresa's publication of a day. No row = still PLANNED, so creating a day writes nothing here
// and an operator added to the Scope later just starts as PLANNED
model DailyBranchStatus {
  dailyOperationId String
  branchId         String
  status           DailyStatus
  publishedAt      DateTime?
  closedAt         DateTime?

  operation DailyOperation @relation(fields: [dailyOperationId], references: [id], onDelete: Cascade)

  @@id([dailyOperationId, branchId])
  @@map("transit_daily_branch_status")
}
```

`DailyOperation.status` fica como consolidado, gravado só em `setStatus` / `revertStatus`: `PLANNED`
enquanto alguma empresa estiver planejada, `CLOSED` quando todas encerrarem, e `PUBLISHED` no meio.
`publishedAt` e `closedAt` saem de `DailyOperation`. Quem só olha o dia do escopo continua lendo esse
campo, como o Painel e o recálculo de dias vizinhos.

**A empresa de um item:** a do bloco ou da tabela. Item sem empresa em escopo de um só operador é desse
operador; em escopo compartilhado já é erro (`NO_COMPANY`, `BRANCH_NONE`) e conta como `PLANNED`.

Mudanças:

| Onde | O que muda |
|---|---|
| `DailyOperationService` | `setStatus` e `revertStatus` recebem a empresa; `editable` e `log` passam a olhar a empresa do item; `syncReserves` só nas empresas `PLANNED`; excluir o dia exige todas `PLANNED` |
| Gerador (`input`, `service`) | Lê o status da empresa do parâmetro |
| Reparar | Publicado e encerrado por empresa |
| `RosterBoardService` | `operations` traz o status da empresa selecionada |
| Portal | A tabela aparece quando a empresa **da tabela** publica; um operador emprestado vê o dia aos poucos |
| `vacation-release` | A revisar: lê o status pela tabela |
| Telas | `page.tsx` e `ContextPanel` agem na empresa selecionada; a tela do dia mostra o status de cada uma |

Efeitos:

- `DailyChangeLog` registra a empresa em `UNPUBLISH` e `REOPEN`.
- Edição que envolve duas empresas exige as duas fora de `CLOSED`, e registra no histórico se alguma
  estiver publicada.
- Banco de horas não lê o status do dia: não muda.
- Com a empresa A publicada, a B não recebe um plano novo naquela data sem despublicar a A, porque plano
  novo exige refazer o escopo. Esse bloqueio já existe hoje.

## 7. Alterar empresa

Ação direta na aba de blocos da tela do dia, sem abrir o Gantt, com seleção de vários blocos.

| Item | Efeito |
|---|---|
| Carro | Sai; o bloco volta para "Encaixar veículos" |
| Tabela só nesse bloco | Acompanha a empresa; o operador sai e ela vai para "Cobrir tabelas" |
| Tabela com blocos de outra empresa | Fica como está e gera `BRANCH_MISMATCH` |
| Linha que a empresa não opera | Gera `LINE_NOT_OPERATED`, sem bloquear |

`blockUpdates` hoje só envia `depotId`; passa a aceitar `branchId` e `vehicleType`.

## 8. Editor no dia

- Rota própria, com página enxuta: sem solver, OSO, geração de linha ou exportações.
- Adaptador `DailyBoard` → `VehiclePlanGanttData`, incluindo `plan.lines`, que o hook exige.
- `useGanttEditor` recebe o salvamento por parâmetro, no lugar da chamada fixa a `apply-diff`.
- `canEditGantt: true`, `canEditStructural: false`.
- Atalhos `alt+g`, `alt+v` e `alt+l`, e `useTopbarActions`, como em toda página editável.

## 9. Etapas

Ordem recomendada: etapa 0, spike da etapa 3, etapa 1. O spike não depende da etapa 0 e pode correr em
paralelo; vem antes da etapa 1 porque seu resultado pode mudar o desenho do `diff`.

0. **Status por empresa** (seção 6): vem primeiro porque altera `editable`, `log` e as condições do
   refazer, que as etapas seguintes usam. Tem valor próprio, mesmo sem a edição estrutural.
1. **Base:** migração, `applyDayDiff` com testes, aplicação em `create()`, refazer por empresa com a
   opção de manter ou limpar, `TRIP_UNCOVERED`, `revision`.
2. **Empresa, depósito e tipo de veículo:** ação direta com vários dias.
3. **Gantt no dia:** spike de cerca de um dia para validar adaptador e hook; depois viagens, ociosas,
   intervalos e blocos. É a maior incerteza do plano.
4. **Tabelas no dia:** criar tabela, atribuir e ajustar pegadas. As telas do plano usam endpoints
   próprios, então espera-se reaproveitar componentes visuais, não o fluxo. Sem esta etapa, um bloco
   novo fica sem tabela.

## 10. Riscos

- **Sem dados reais:** a base de dev não tem dias gerados nem tabelas nos planos ativos. Custo do
  recálculo em vários dias e frequência de tabelas com blocos de duas empresas não foram medidos.
  Nos planos ativos, todos os blocos têm empresa e cada linha roda em uma só; uma linha tem duas
  empresas cadastradas em `LineOperator`.
- **Plano alterado depois da edição:** planos ativos aceitam edição pontual. Uma viagem apagada no
  plano vira conflito ao reaplicar, e o usuário decide refazendo com a opção de limpar.
- **Geração em andamento:** `accept` já ignora tabelas que deixaram de existir, mas a proposta pode ter
  sido calculada sobre horários anteriores à edição.
