# Plano de implementação v1 — Painel de Escala (Console)

**Status: implementado (Etapas 0–6).** Referência de arquitetura: `docs/architecture/transit/console.md`.
Migration pendente (`pnpm db:migrate`): `CrewRoleJobTitle`, `RosterAdjustment`,
`CrewMemberLine.priority`, `DailyOperation.crewContext`.

> **Implementado — diferenças em relação ao texto abaixo:**
> - Lacuna 1 estava errada: o PlanPanel da escala lógica já mostra as tabelas por turno (bloco
>   "Turnos"); nada a fazer no item 5.2.
> - `CrewRoleJobTitle` com `id` próprio + `jobTitleId @unique` (padrão do `BaseService`), editado como
>   recurso comum do transit ("Cargos das Funções"), não como seção da tela de configurações.
> - "Trocar regime" (§4.4) entrou na ação de grupos: cada linha da sugestão pode trocar de regime e
>   grupo; não há uma ação separada.
> - Ações sem data: grupos, linhas e prioritárias (valem para a próxima geração); com data: turnos e
>   perfis. Rotas `actions/:kind/{suggest,preview,apply}`, `GET/PUT rule`, `GET adjustments`.
> - O quadro analisado é o **planejado**: o vínculo de turno aberto de cada operador (um ajuste com
>   data futura já conta), não o turno de hoje.
> - `LINE_NO_PLAN`: linha com OS aprovada para o tipo de dia e fora do plano efetivo (uma linha que
>   não roda no domingo não é erro).
> - Sugestão de turnos aceita um movimento quando reduz a falta acumulada do destino (Σ tabelas sem
>   operador na janela), não só o pior dia — uma pessoa sozinha raramente melhora o pior dia.
> - `awayMinDays` e o critério `priorityLine` aparecem na tela de configurações de escala real; a regra
>   de seleção só no Painel (Q14).

Histórico:
- [`plan_roster_console_v1.md`](plan_roster_console_v1.md): levantamento, conceito e respostas
  Q1–Q9. Continua valendo como registro das decisões; este documento é o que se implementa.
- Protótipo: `apps/web/src/app/playground/` (`page.tsx`, `cards.tsx`, `AdjustModal.tsx`,
  `console-data.ts`). É a referência visual e de fluxo das Etapas 3–5.

Convenções (as mesmas dos planos de rostering):
- Comentários em snippets Prisma/TS em inglês; texto em pt-BR.
- Minutos do dia operacional (`> 1440` = madrugada seguinte); datas `'YYYY-MM-DD'`
  (`plan-validity.ts`).
- Migrations: o usuário roda `pnpm db:migrate`.
- Cada etapa é entregável e testável sozinha.

---

## Foco — a pergunta que o Painel responde

> **Minha escala está equilibrada?** Tenho funcionários para todos os turnos e linhas? O que
> sobra (independente de férias) está bem distribuído entre os turnos?

O Painel trabalha **sobre o planejado**: planos efetivos × quadro cadastrado. Ele não é uma tela
do dia real.

- **Não escala ninguém.** Alocar operadores em tabelas e dias continua sendo exclusivo do
  gerador e da tela Escala.
- **Atua no planejamento:** valida e ajusta o quadro (turnos, grupos de folga, regime,
  habilitação de linhas, perfis) e aponta gargalos da escala lógica. O objetivo é deixar o
  terreno equilibrado para o gerador trabalhar bem.
- **O dia real aparece só como aviso:** erros de dias gerados e não publicados, e informação
  secundária (ex.: feristas, afastados). Nesses casos o Painel apenas leva para a Escala.

Toda seção, alerta ou ação nova deve responder à pergunta acima. Se não responder, não é do
Painel.

---

## 0. Decisões consolidadas

| Tema | Decisão |
|---|---|
| Recorte | **Escopo + empresa + função** (Q1, §1.3). Cada empresa opera num único escopo; empresa em mais de um é alerta de configuração. Mesma regra para todas as funções (Q5) |
| Natureza | Central de gestão **do planejamento**: diagnostica **e** corrige o quadro (Q2). Não escala ninguém (Foco). Escala lógica estrutural (janela de turno, tabelas) só como sugestão + link |
| Base do cálculo | **Planos efetivos × quadro ativo**, foto atual, sem horizonte (Q4, Q8). Não lê escala real nem histórico |
| Plano efetivo | Por escopo × tipo de dia, o `VehiclePlan` não-rascunho **sem `validTo`** (a ativação encerra os demais), mesmo que comece no futuro; badge quando começa > 10 dias à frente (Q9) |
| Plano sem escala | `VehiclePlan` efetivo sem `CrewPlan` ativo = **erro**; o tipo de dia fica sem demanda (não volta ao plano anterior) |
| Tabela sem empresa | **Erro** (`BRANCH_NONE`), fora da demanda |
| Saldo | Por turno (rótulo) no heatmap; total do dia pelo **máximo cobrível** (encaixe), o mesmo matching do gerador (Q6) |
| Pior dia | O saldo de cada tipo de dia é o do **pior dia** da janela de referência, não a média (a média aparece como detalhe) |
| Férias e afastados | **Férias não tiram ninguém da oferta**: o equilíbrio é do quadro, independente de férias (feristas aparecem só como informação). Só afastamento longo (INSS etc.) sai da oferta e aparece à parte (§1.5) |
| Plantões | Metas de reserva entram como demanda; turno pelo encaixe da janela (`bestShift`) |
| Linhas | Habilitação por **linha × turno**, nunca no dia inteiro; só as combinações com falta aparecem abertas |
| Ações | Sugestão → lista editável → prévia → confirmar → **lote registrado e consultável** (sem desfazer na v1 — Q12). Data de efeito informada pelo usuário em cada ajuste (Q2a) |
| Linhas prioritárias | O gestor define **linhas prioritárias** por operador, separadas das preferidas dele, sem limite e fora do alcance do portal; o gerador considera primeiro as prioritárias, depois as preferidas (Q10, §4.8) |
| Afastado | Afastamento (não férias) a partir de `awayMinDays` dias sai da oferta — configurável por empresa, padrão 15 (Q11) |
| Regra de seleção | Decide **quem** se move quando o Painel já sabe **quantos**. Filtros fixos (janela, linhas, tipo de veículo) + dois critérios de desempate ordenáveis: **mais novo no turno** e **mais novo na empresa** (§4.7). Por empresa, editada só no Painel (Q14); sem marcação "voluntário" (Q2b) |
| Turno × grupo | Ordem fixa: primeiro turnos (total por turno), depois grupos dentro do turno. Mover de turno já define o grupo no regime de destino |
| Sugestão de turno | Só propõe mover se o **máximo cobrível** não piora e o déficit do destino diminui |
| Cargo → função | `CrewRoleJobTitle` (vários cargos → uma função), cargo do **contrato vigente** (Q7) |
| Layout | KPIs + alertas no topo; menu lateral de análises com status; painel da análise selecionada (validado no protótipo) |
| Fora do Painel | Escala real (carga, banco, pedidos, custos), CNH/curso, histórico, absenteísmo (etapa futura) |

---

## 1. Avaliação — riscos e como o desenho responde

### 1.1 Duplicar regras do gerador
O Painel decide "quem pode cobrir o quê" com as mesmas regras do gerador. Se reimplementar, as
duas visões divergem e o Painel diz "ok" para um quadro que o gerador não consegue escalar.

**Resposta:** extrair de `roster-generator.calc.ts` as regras fixas por par operador × tabela
(hoje duplicadas entre `pairRule` e `blockedBy`) para uma função pura única, e o matching de
`coverageBound` para uma função genérica (`maxMatching(dutiesByDay, candidates)`). Gerador e
Painel passam a chamar as mesmas funções. A janela efetiva vem de `effectiveWindow`
(`daily-checks.ts`), também já compartilhada.

O Painel usa essas regras só para **medir** se o quadro dá conta (quantas tabelas são
cobríveis). Ele não aloca ninguém: quem escala continua sendo o gerador (Foco).

### 1.2 "Semana típica" esconde dias ruins
Regimes com ciclo maior que 7 dias (6x1 sábado/domingo alternado = 14) não oferecem o mesmo
número de pessoas toda semana. Tipos de dia `month_window` (ex.: fim de mês) não aparecem em
qualquer semana.

**Resposta:** a análise roda sobre uma **janela de referência de 35 dias** a partir de hoje
(cinco semanas cobrem ciclos de 7, 14 e 28 dias e pegam um fim/início de mês). O tipo de dia de
cada data vem de `DayTypeService.resolveByPattern(date)`. Exceções de calendário por linha
(`LineCalendarException`) e feriados ficam fora, porque são pontuais. Cada tipo de dia mostra o
pior dia e a média. A janela é técnica e não aparece como "horizonte" para o usuário.

### 1.3 Recorte e plano efetivo
Validado no código:
- **Um plano efetivo por escopo × tipo de dia.** Ativar um `VehiclePlan` encerra (ou volta a
  rascunho) os outros não-rascunho do mesmo escopo × tipo de dia (`vehicle-plan.service.ts`,
  ativação). Então há no máximo um sem `validTo`. A resolução por linha da materialização do
  dia só existe por causa das exceções de calendário, que o Painel não usa. O comentário do
  model `VehiclePlan` ("nothing enforces a single ACTIVE one") está desatualizado e deve ser
  corrigido na Etapa 1.
- **Empresa em mais de um escopo:** o modelo permite (`ScopeOperator` não restringe, e a tela
  Escala trata `multiScope`). Pela regra de negócio isso não deveria acontecer: cada empresa
  opera num escopo, com seu próprio quadro. O quadro de uma empresa não é dividido por escopo, então
  analisar dois escopos com o mesmo quadro contaria os operadores duas vezes.

**Resposta:** recorte **escopo + empresa + função**. O seletor de escopo lista os escopos que a
empresa opera (normalmente um, já selecionado). Empresa em mais de um escopo gera o alerta
`BRANCH_MULTI_SCOPE` (configuração a corrigir), e a análise segue com o escopo escolhido e o
quadro inteiro da empresa. Linha ativa do escopo que não está no plano efetivo de um tipo de
dia vira alerta (`LINE_NO_PLAN`).


### 1.4 De quem é a tabela
Mesma regra do gerador: `Duty.branchId = empresa`, ou nulo num scope que a empresa opera
sozinha. Nulo num scope compartilhado → `BRANCH_NONE` (erro) e fora da demanda.

### 1.5 Oferta realista
- Entram `CrewMember` da função, `isRosterable`, `Employee.status = ACTIVE`, com turno vigente
  na data de referência (`CrewMemberShiftService.current`).
- **Férias não descontam.** O Painel mede se o quadro está equilibrado, independente de quem
  está de férias agora. Operadores de férias e seus feristas aparecem só como informação.
- **Afastado:** `CrewOccurrence` `APPROVED`, tipo com efeito `ABSENCE` que **não** é férias
  (`systemKey ≠ VACATION`), cobrindo a data de referência e com término ≥ data +
  `transit.roster.awayMinDays` (por empresa, padrão 15 — Q11). Sai da oferta e aparece como "afastado". Ausências curtas não
  descontam: é o que o absenteísmo futuro vai medir.
- Regime efetivo = `CrewMember.restPatternId ?? turno.restPatternId`; folga por
  `restPatternWorks(pattern, restOffset, day, holiday=false)`.
- Operador sem turno ou sem regime: fica fora da oferta e aparece como problema de cadastro.


### 1.6 Ajustes concorrentes e dados velhos
Entre a sugestão e o confirmar, alguém pode editar o operador.

**Resposta:** o servidor nunca confia nos números do cliente. `preview` e `apply` recalculam a
partir do banco. `apply` confere se cada operador ainda está no estado de origem (turno/grupo
do `from`) e recusa com 409 listando quem mudou. Mesmo padrão do import (revalida ao gravar).

### 1.7 Registro dos ajustes (sem desfazer na v1)
Desfazer automático saiu da v1 (Q12): a complexidade (desfazer parcial, interação entre ajustes,
reescrita de histórico) não compensa o ganho. Reverter um ajuste é manual — um novo ajuste no
sentido contrário, pelo mesmo fluxo.

O que fica, e é importante porque várias ações mexem em lote: **todo ajuste confirmado é
registrado** (`RosterAdjustment`) com quem, quando, a ação, a data de efeito, a regra de seleção
em uso e, por operador, o antes → depois. O Painel tem a seção **"Ajustes"** para consultar o
que foi feito (filtro por período e ação; abrir um lote mostra os operadores e as mudanças).

### 1.8 Data de efeito
Informada pelo usuário (Q2a), `≥ hoje`. No futuro, `startShift` já fecha o vínculo atual na
véspera e cria o novo. Ponto a tratar: hoje `closeOpenBefore` não lida com um vínculo futuro já
agendado (dois ajustes futuros seguidos) — a Etapa 1 cobre isso. Dias já gerados não mudam; a
prévia avisa quantos são.

**Grupo e regime não têm data — e não precisam (Q15).** `CrewMember.restOffset` e
`restPatternId` continuam campos simples, sem histórico. A regra é a mesma do resto do Painel:
**o cadastro muda agora e só chega aos dias na próxima geração.** Para os dias já gerados não
serem afetados, cada dia guarda o regime e o grupo com que foi gerado (§1.9). Aplicar um ajuste
num dia já gerado = gerar o dia de novo.

**Caso limite — troca de turno com data futura.** O turno tem histórico (muda só na data de
efeito); o grupo novo vai para o cadastro na hora. Gerar dias anteriores à data de efeito depois
do ajuste faria esses dias saírem com o turno antigo e o grupo novo. Na v1: a prévia avisa ("o
grupo novo vale para a próxima geração, mesmo antes de dd/mm") e sugere como data de efeito o
primeiro dia ainda não gerado. Na prática o gestor ajusta o quadro antes de gerar o período
seguinte, então o caso é raro.

### 1.9 Contexto da geração no dia
Hoje o padrão de folga é recalculado na hora, com o grupo **atual** do operador, em três lugares:
pendência `CREW_ON_DAY_OFF` (`daily-checks.ts`), marcação "folga prevista do regime" na grade da
Escala (`roster-board.service.ts`) e painel do dia (`daily-operation.service.ts`). Depois de uma
troca de grupo, um dia já gerado que for recalculado ganharia pendências falsas e a grade
mostraria a folga prevista no lugar errado.

**Resposta:** o dia guarda o contexto com que a escala foi gerada, e as checagens leem dele:

```prisma
model DailyOperation {
  // ...
  // per role, per crew member: the rest cycle the day's roster was generated with —
  // { DRIVER: { <crewMemberId>: { restPatternId, restOffset } } }. Written for every day an accepted
  // generation actually writes; the day's checks read it instead of the crew member's current
  // settings. null = never generated (checks use the current settings)
  crewContext Json?
}
```

- No dia, e não no `RosterEntry`: quem ficou livre não tem `RosterEntry`, e a checagem precisa
  do grupo dele mesmo assim. Nem no `RosterGeneration`: ele cobre um período, mas nem todo dia do
  período é escrito (os publicados ficam de fora). Cada empresa opera um único escopo (§1.3),
  então o dia do escopo é o dia da empresa.
- Só regime e grupo entram: o turno já tem histórico com data (`CrewMemberShift`).
- Operador sem contexto no dia (alocado à mão num dia nunca gerado, ou perfil criado depois):
  cadastro atual.
- Regerar o dia regrava o contexto.

Substitui a proposta de histórico de folga.

### 1.10 Desempenho
Por empresa × função: ~150 operadores, ~200 tabelas por tipo de dia, 35 dias. O matching por dia
é trivial nesse tamanho. Uma carga de banco por requisição, cálculo em memória.

**Decisão (revisa o v1 §5 "cards independentes"):** **um endpoint de snapshot** devolve todas
as análises. Elas saem da mesma entrada, e os alertas e o status do menu precisam de todas de
qualquer forma. As ações têm endpoints próprios.

### 1.11 Permissões
Recurso singleton `console` (subject CASL `Console`): ver o Painel = `read`. Cada ação confere
também a permissão do que altera: `update` em `CrewMember` (turno, grupo, regime, linhas,
criar perfil) e em Settings para salvar a regra. Para não-admin, a empresa precisa estar em
`branchIds`.

---

## 2. Modelo de cálculo

Arquivos: `apps/api/src/modules/transit/console/console.input.ts` (carga) e `console.calc.ts`
(puro, com spec). Tipos de resposta em `packages/schemas/transit/console.schema.ts`, usados por
API e web.

### 2.1 Entrada (`ConsoleInput`)

```ts
interface ConsoleInput {
  scopeId:  string
  branchId: string
  role:     CrewRole
  today:    Day
  // reference window: 35 days from today, with the day type of each (resolveByPattern)
  days:     { day: Day; dayTypeId: string }[]
  dayTypes: { id: string; code: string; name: string }[]
  shifts:   ShiftRow[]              // the empresa's active CrewShifts (windows, allowSplit, restPattern)
  plans:    EffectivePlanRow[]      // per scope × day type: vehicle/crew plan, validFrom, summary figures, lineIds
  // the effective crew plans' duties of the empresa, plus the reserve targets as standby duties
  duties:   { id: string; dayTypeId: string; scopeId: string; shiftId: string | null; kind: DutyKind
              start: number; end: number; lineMinutes: { lineId: string; minutes: number }[]
              vehicleTypes: VehicleType[]; standby: boolean; pinned: string[] }[]
  noBranchDuties: { planId: string; dayTypeId: string; count: number }[]
  crew:     { id: string; code: string; name: string; hireDate: Day; shiftId: string | null
              window: ShiftWindow | null; restPattern: RestCycle | null; restOffset: number
              lineAccess: Record<string, CrewLineAccess>; prefLines: string[]; priorityLines: string[]; hireDate: Day
              blockedVehicleTypes: VehicleType[]; away: { type: string; until: Day } | null
              // info only — vacations never leave the supply
              vacation: { until: Day; cover: string | null } | null
              // tie-breaks of the selection rule (§4.7): current shift's start, hire date
              shiftSince: Day }[]
  lineAccessMode: 'WHITELIST' | 'BLACKLIST'
  noProfile: { employeeId: string; code: string; name: string; jobTitle: string }[]
  dailyErrors: DailyErrorRow[]      // generated, not published, ≤ 30 days ahead, with error issues
}
```

### 2.2 Saídas (`ConsoleSnapshot`)

| Bloco | Conteúdo | Regra |
|---|---|---|
| `plans` | linhas por scope × tipo de dia (protótipo, seção A) | §1.3 |
| `staffing.cells[shift][dayType]` | `demand`, `worst`, `avg`, `balance = worst − demand` | oferta = operadores do turno que trabalham no dia; pior dia da janela |
| `staffing.required[shift]` | `max_t ⌈demanda_t × ciclo ÷ dias trabalhados⌉` | fator pelo regime predominante do turno (6x1 → 7/6) |
| `staffing.coverable[dayType]` | máximo cobrível no pior dia, e a demanda total (com "sem turno") | `maxMatching` com as regras fixas (§1.1) |
| `shifts` | início das tabelas por tipo de dia (histograma), janelas, `SHIFT_NONE`, sobreposição, turnos sem tabela | sobre `duties` |
| `groups[shift]` | por regime: operadores por grupo, oferta × demanda por dia da semana, distribuição pela demanda | §4.3 |
| `lines` | por turno × linha dominante: tabelas, necessário (`× fator`), habilitados, vinculados (prioritária ou preferida), `gap` | habilitado = acesso de linha + tipo de veículo |
| `crewData` | sem perfil, sem turno, sem regime, fora do gerador, afastados, carro fixo em conflito | §1.5 |
| `dailyErrors` | dias gerados com erro | `DailySummary.issues` de severidade erro, ou `outdated` |
| `alerts` | lista única (§3) | função pura sobre os blocos acima |
| `status[section]` | pior severidade + contagem, para o menu | derivado de `alerts` |

### 2.3 Linha dominante
Cada tabela conta para a linha com mais minutos de viagem (`lineMinutes`), a mesma usada na
assinatura de continuidade do gerador. Tabela sem viagem (plantão) não entra na análise de
linhas.

---

## 3. Alertas

Códigos em `console.schema.ts` (`CONSOLE_ALERT_CODES`), cada um com severidade e seção do menu.

| Código | Sev. | Seção | Quando |
|---|---|---|---|
| `PLAN_NO_CREW` | erro | Escalas | plano efetivo sem `CrewPlan` ativo |
| `DUTY_NO_BRANCH` | erro | Escalas | tabelas sem empresa em scope compartilhado |
| `LINE_NO_PLAN` | erro | Escalas | linha ativa do escopo fora do plano efetivo de um tipo de dia |
| `BRANCH_MULTI_SCOPE` | alerta | Escalas | empresa opera em mais de um escopo (configuração; o quadro não se divide) |
| `PLAN_FUTURE` | alerta | Escalas | plano efetivo começa > 10 dias à frente |
| `PLAN_UNCOVERED` / `PLAN_STALE` | alerta | Escalas | descoberto > 0 / tabelas desatualizadas |
| `SHIFT_SHORT` | erro | Demanda × quadro | saldo < 0 no pior dia de algum tipo de dia |
| `COVERAGE_SHORT` | erro | Demanda × quadro | máximo cobrível < demanda |
| `DUTY_NO_SHIFT` | alerta | Turnos | tabelas fora de qualquer turno |
| `SHIFT_IDLE` | info | Turnos | turno com operadores e sem tabela num tipo de dia |
| `GROUPS_OFF_DEMAND` | alerta | Grupos | ≥ 2 operadores fora da distribuição pela demanda |
| `REST_RUN_LONG` | alerta | Grupos | regime/grupo com > 6 dias seguidos |
| `LINE_SHORT` | erro | Cadastro | habilitados < necessário numa linha × turno |
| `LINE_LOW_BOND` | alerta | Cadastro | vinculados (prioritária ou preferida) < necessário numa linha × turno |
| `NO_PROFILE` | alerta | Cadastro | funcionário com cargo mapeado e sem `CrewMember` |
| `NO_SHIFT` / `NO_PATTERN` | alerta | Cadastro | operador sem turno / sem regime |
| `FIXED_CAR_CONFLICT` | alerta | Cadastro | carro fixo inativo, de outra empresa ou dividido entre turnos sobrepostos |
| `AWAY` | info | Cadastro | afastados (não férias) fora da oferta |
| `DAILY_ERROR` | erro | Dias gerados | dia gerado, não publicado, com erro (os de amanhã sobem para o topo) |

---

## 4. Ações

### 4.1 Contrato comum

```
POST /transit/console/actions/:kind/suggest   { scopeId, branchId, role, ...params }      → Suggestion   (nada gravado)
POST /transit/console/actions/:kind/preview   { scopeId, branchId, role, effective, items } → Impact       (recalcula no servidor)
POST /transit/console/actions/:kind/apply     { scopeId, branchId, role, effective, items } → RosterAdjustment
GET  /transit/console/adjustments?scopeId&branchId&role&from&to&kind                    → ajustes registrados (consulta)
```

`kind`: `shifts`, `groups`, `pattern`, `lines`, `priority`, `profiles`. `Suggestion` = itens propostos
(operador, de → para, grupo, motivos), banco de alternativas por par, não-elegíveis com motivo.
`Impact` = saldo antes × depois, cobríveis antes × depois, avisos (tabelas que perdem o
preferido, transição de grupo > 6 dias, dias já gerados com o quadro antigo).

### 4.2 Balancear turnos (`shifts`)
1. Saldo mínimo de cada turno (pior tipo de dia). Turnos com déficit, em ordem do maior.
2. Doadores: turnos com sobra; um doador cede no máximo a própria sobra.
3. Candidatos do doador passam pelos filtros fixos contra o destino: janela (`effectiveWindow`
   cabe na do turno de destino), linhas (habilitado na maioria das linhas do destino, pelo modo
   da empresa) e tipo de veículo. Depois são ordenados pela regra de seleção (§4.7).
4. Cada escolhido (regime escalonado) recebe o grupo onde o destino tem mais sobra; com regime
   próprio do turno de destino diferente, o grupo é escolhido nele.
5. Só entra na proposta se o máximo cobrível não piora (§0).
6. Aplicar: `startShift(id, shiftId, effective, tx)` por item; grupo por `restOffset` (vale a
   partir da próxima geração — §1.8, com o aviso do caso limite na prévia).

### 4.3 Grupos de folga por demanda (`groups`)
Por turno × regime: distribuição ideal dos operadores nos grupos, maximizando o pior saldo por
dia da semana (guloso: cada folga vai, uma a uma, para o grupo cujo dia tem mais sobra). Move o
mínimo possível de operadores, escolhidos pela regra de seleção (§4.7) entre os do grupo que
perde gente.
Sem data de efeito: o grupo novo vale a partir da próxima geração (§1.8); a prévia avisa
transições com mais de 6 dias seguidos a partir do primeiro dia ainda não gerado. Vira o modo "por demanda" de
`RestPatternService.balance()` (o modo "igualar" continua na tela do regime).

### 4.4 Trocar regime (`pattern`)
Operadores selecionados → outro `RestPattern` + grupo. Sem data de efeito, como os grupos
(§1.8); mesma prévia de transição.

### 4.5 Habilitar linha (`lines`)
Para uma linha × turno com falta: operadores do turno sem acesso à linha, ordenados por (já
preferem a linha) → regra de seleção (§4.7). Aplicar grava `CrewMemberLine.access` pelo modo da
empresa (WHITELIST → `ENABLED`; BLACKLIST → remove `BLOCKED`). A preferência do operador
(`rank`) não é tocada; para direcionar o gerador, ver linhas prioritárias (§4.8).

### 4.6 Criar perfil (`profiles`)
Funcionários sem perfil: o Painel propõe função (pelo cargo), turno (o de maior déficit em que a
pessoa cabe) e grupo. Aplicar cria `CrewMember` + `CrewMemberShift` pelo service existente.

### 4.7 Regra de seleção

**O que é.** O diagnóstico diz **quantos** mover ("faltam 3 na Manhã, sobram 6 na Tarde"); a
regra de seleção decide **quais** operadores o Painel sugere. Ela tem duas partes:

1. **Filtros fixos** (não configuráveis, as mesmas regras do gerador): sai quem não pode ir para
   o destino — limite de horário incompatível com a janela do turno, sem habilitação na maioria
   das linhas do destino, tipo de veículo bloqueado. Aparecem na sugestão como "não elegíveis",
   com o motivo.
2. **Critérios de desempate** (configuráveis, por empresa): ordenam quem passou pelos filtros. Os
   primeiros da ordem viram a sugestão; o gestor ainda pode trocar qualquer um antes de
   confirmar.

**Critérios** — os dois usuais nas empresas; o gestor escolhe quais valem e em que ordem:

| Critério | Quem sai primeiro | Fonte | Por quê |
|---|---|---|---|
| **Mais novo no turno** | quem chegou por último ao turno de origem (ex.: para tirar gente da Manhã, os últimos que vieram para a Manhã) | `CrewMemberShift.validFrom` do vínculo vigente | quem está há mais tempo no turno já organizou a vida em torno dele |
| **Mais novo na empresa** | os admitidos mais recentemente | `Employee.hireDate` | preserva os funcionários antigos |

Os dois dados já existem; nada novo a cadastrar. Empate em todos os critérios ativos: ordem de
matrícula. Ficaram de fora (pouco eficientes na prática): "linhas preferidas no destino" — as
linhas operam em quase todos os turnos, então não diferencia ninguém — e "menos trocas recentes".

Exemplo, com "mais novo no turno › mais novo na empresa": para mover 3 da Tarde para a Manhã, o
Painel pega os 3 que entraram na Tarde mais recentemente; se dois entraram no mesmo dia, vai
primeiro o admitido mais recente. Cada sugestão mostra o motivo ("Na Tarde desde 03/2026 ·
Admissão 2024").

**Onde se edita (Q14):** só no Painel — botão "Regra de seleção" no topo e link "editar" no modal
de ajuste; mudar a regra reordena a sugestão aberta na hora. Grava em `transit.roster` da
empresa (o único lugar que lê é o Painel; a tela de configurações do transit não ganha seção).

```ts
rebalanceRules: z.object({
  // tie-breaks in priority order — each one breaks the previous one's ties; matrícula last
  criteria: z.array(z.object({
    key:    z.enum(['shiftTenure', 'hireDate']),
    active: z.boolean(),
  })).default([{ key: 'shiftTenure', active: true }, { key: 'hireDate', active: true }]),
}).default({})
```

---

### 4.8 Linhas prioritárias da empresa (`priority`) — Q10

**Problema.** Numa linha × turno com pouca preferência, o gerador acaba escalando "qualquer
um" habilitado. O gestor quer apontar quem deve operar ali, sem depender da escolha do operador
e sem consumir as 3 preferências dele.

**Conceito.** Dois níveis independentes por operador × linha:

| | Linha **prioritária** (empresa) | Linha **preferida** (operador) |
|---|---|---|
| Quem define | gestor (tela de linhas do operador e Painel) | operador (portal, futuro) ou gestor por ele |
| Limite | sem limite | `maxPreferredLines` (3) |
| Ordem | sem ordem — é um conjunto | rank 1, 2, 3 |
| Portal | visível, **não editável** pelo operador | editável |
| Gerador | considerado **primeiro** | considerado depois |

Uma linha pode ser as duas coisas ao mesmo tempo. Prioritária implica poder operar: no modo
WHITELIST, marcar prioritária habilita a linha; no BLACKLIST, não pode estar bloqueada (garantido
por ser a mesma linha da tabela).

**Modelo.** Não é JSON: o vínculo operador × linha já é uma tabela (`CrewMemberLine`, uma linha
por par), então ganha uma coluna:

```prisma
model CrewMemberLine {
  // ...
  // set by staff, beyond the crew member's own preferences — the generator weighs it first;
  // the crew portal shows it but can't change it
  priority Boolean @default(false)
}
```

**Gerador.** Novo critério em `transit.roster.range`, com peso maior que o da preferência:

```ts
// % of the trip minutes on the empresa's priority lines, for whoever has any
priorityLine: { active: true, modifier: 30, floor: 0, idealMin: 70, idealMax: 100, ceiling: 100 },
```

Calculado como o `prefShare` atual, sobre o conjunto de linhas prioritárias. Como o peso é maior
que o de `driverPrefLine` (20), o gerador tende a cumprir primeiro as prioritárias e, com elas
atendidas, as preferências do operador.

**No Painel.** A análise de linha × turno (§2.2 `lines`) ganha a coluna **vinculados** =
operadores do turno com a linha prioritária ou preferida. Vinculados abaixo do necessário é
alerta `LINE_LOW_BOND` (o gerador vai completar com quem não tem vínculo com a linha). Ação
`priority`: sugere operadores do turno, já habilitados, para marcar a linha como prioritária
(ordenados por: já preferem a linha → regra de seleção §4.7).

**Na tela atual de linhas do operador:** marcação de prioritária ao lado do acesso e do rank.

## 5. Modelos e ajustes no que existe

```prisma
// Which JobTitles are crew of a role — an employee whose current contract has one should have a
// CrewMember of that role. Several titles may map to the same role.
model CrewRoleJobTitle {
  jobTitleId String   @id
  role       CrewRole

  jobTitle JobTitle @relation(fields: [jobTitleId], references: [id])

  @@map("transit_crew_role_job_titles")
}

// One confirmed adjustment of the Painel de Escala — what changed, kept for later reference
model RosterAdjustment {
  id        String    @id @default(uuid())
  branchId  String
  role      CrewRole
  // shifts | groups | pattern | lines | profiles
  kind      String
  effective DateTime  @db.Date
  // the selection rule in use when it was suggested
  rule      Json?
  // [{ crewMemberId, before, after }] — before/after hold the touched fields and the
  // CrewMemberShift rows created / closed
  items     Json
  userId    String?
  createdAt DateTime  @default(now())

  @@index([branchId, role, createdAt])
  @@map("transit_roster_adjustments")
}
```

| # | Onde | Mudança |
|---|---|---|
| 1 | `duty.schema.ts`, `crew-scoring.calc.ts` | issue `BRANCH_NONE` (erro): tabela sem empresa em scope com mais de um operador |
| 2 | `crew-plan/[id]` PlanPanel | card "tabelas por turno × empresa" a partir de `byShift` |
| 3 | `roster-generator.calc.ts` | extrair regras fixas por par (`pairRule`/`blockedBy`) e o matching de `coverageBound` para funções compartilhadas; o gerador passa a usá-las (sem mudança de comportamento) |
| 4 | `crew-member-shift.service.ts` | `startShift` com vínculo futuro já agendado (substitui em vez de falhar) |
| 5 | `settings-roster.schema.ts` | `rebalanceRules` (§4.7), `awayMinDays` (padrão 15), critério `priorityLine` em `range` (§4.8) |
| 5b | `CrewMemberLine` + tela de linhas do operador | coluna `priority` (§4.8) |
| 5c | `roster-generator.input.ts` / `.calc.ts` | critério `priorityLine` (mesmo cálculo do `prefShare`, sobre as prioritárias) |
| 5d | `DailyOperation.crewContext` + `roster-generator.service.ts` (aceitar) | grava regime e grupo de cada operador nos dias escritos (§1.9) |
| 5e | `daily-checks.ts`, `roster-board.service.ts`, `daily-operation.service.ts` | folga do padrão lida do `crewContext` do dia quando existe (§1.9) |
| 6 | `rest-pattern.service.ts` | `balance()` com modo "por demanda" (recebe a demanda por dia da semana) |
| 7 | Settings do transit (tela) | seção "Cargos × função" (`CrewRoleJobTitle`) |
| 8 | `dop-crew.service.ts` | efetivo estimado passa a usar `required` do cálculo do Painel, ou ganha nota de estimativa |
| 9 | `docs/TODO.md` | "Dashboard de escala" aponta para este plano |

---

## 6. Etapas de implementação

### Etapa 0 — Protótipo ✅
Layout, densidade e fluxo validados em `/playground`.

### Etapa 1 — Fundações (sem tela nova)
Entrega:
- `BRANCH_NONE` no recálculo da escala lógica (5.1) + exibição no plano.
- Card de tabelas por turno no PlanPanel (5.2).
- `CrewRoleJobTitle`: model, service/controller, seção na tela de settings (5.7).
- `RosterAdjustment`: model (sem endpoints ainda).
- Linhas prioritárias: coluna `priority`, marcação na tela de linhas do operador e critério
  `priorityLine` no gerador (§4.8).
- `rebalanceRules` e `awayMinDays` no schema de settings (5.5).
- `startShift` com vínculo futuro (5.4) + spec.
- Contexto da geração no dia (5d, 5e): mudar o grupo de um operador não muda pendências nem a
  grade dos dias já gerados.
- Comentário do model `VehiclePlan` corrigido: a ativação garante um único plano efetivo por
  escopo × tipo de dia (§1.3).

Pronto quando: recalcular um plano com tabela sem empresa em scope compartilhado mostra o erro;
o PlanPanel mostra tabelas por turno; cargos mapeados aparecem e salvam; migration gerada (o
usuário roda `pnpm db:migrate`).

### Etapa 2 — Motor de cálculo (backend puro, sem tela)
Entrega:
- Extração das regras fixas e do matching do gerador (5.3), com os specs do gerador passando
  sem alteração.
- `console.input.ts`: resolução do plano efetivo por linha (§1.3), tabelas da empresa (§1.4),
  metas de reserva como plantões, janela de referência (§1.2), oferta (§1.5), sem perfil
  (`CrewRoleJobTitle` × contrato vigente), dias gerados com erro.
- `console.calc.ts`: staffing, coverable, shifts, groups, lines, crewData, alerts, status.
- `console.calc.spec.ts`: casos com regime 6x1 escalonado, 6x1 alternado de 14 dias, 5x2;
  pior dia × média; afastado; linha × turno com sobra num turno e falta em outro; plano sem
  escala; tabela sem empresa.

Pronto quando: os specs passam e um script/endpoint de debug devolve o snapshot de uma empresa
real com números conferidos à mão em pelo menos um turno.

### Etapa 3 — Painel (leitura)
Entrega:
- `consoleSchema` singleton (como `dopSchema`), registro em `resourceRegistry`, subject
  `Console`, `featured` no domínio transit.
- `ConsoleModule`/`ConsoleController`: `GET /transit/console?scopeId&branchId&role` (snapshot) e
  `metadata`.
- Página `apps/web/src/app/transit/console/page.tsx` com os componentes do protótipo ligados ao
  snapshot: KPIs, alertas, menu com status, seções A–F. Escopo, empresa, função e seção na URL;
  `AutoBreadcrumb`; `alt+v`. Botões de ação visíveis mas desabilitados ("em breve") até a Etapa 4.
- Links reais: plano (escala lógica filtrada), Escala (dia), operador, turno, regime.

Pronto quando: o Painel abre para uma empresa real, cada alerta leva à seção certa e os links
navegam para as telas certas.

### Etapa 4 — Ações I: fluxo + Balancear turnos
Entrega:
- Endpoints `suggest`/`preview`/`apply` (§4.1) com revalidação (§1.6) e registro do lote
  `RosterAdjustment` (§1.7).
- Ação `shifts` (§4.2).
- Modal de ajuste do protótipo ligado à API; modal da regra salvando em settings.
- Seção "Ajustes" para consultar os lotes registrados (§1.7).

Pronto quando: um ajuste aplicado aparece no cadastro do operador (aba Turnos com a data de
efeito); a próxima geração da Escala usa o turno novo; o lote aparece em "Ajustes" com o antes →
depois de cada operador; editar o operador
entre a sugestão e o confirmar devolve 409 com a lista.

### Etapa 5 — Ações II
Entrega: `groups` (§4.3, com o modo por demanda do `balance()`), `pattern` (§4.4), `lines`
(§4.5), `priority` (§4.8), `profiles` (§4.6).

Pronto quando: cada ação passa pelo mesmo fluxo e pelo mesmo registro da Etapa 4.

### Etapa 6 — Integrações e limpeza
Entrega: efetivo do DOP (5.8), `docs/TODO.md` (5.9), doc de arquitetura
`docs/architecture/transit/console.md` (cálculo, alertas, ações), limpeza do `/playground`.

### Futuro (fora deste plano)
- Absenteísmo e férias pela frequência importada (`CrewTimesheetDay`) → fator no quadro
  necessário e dimensionamento de plantões (Q3).
- Simulação "e se" livre sobre `console.calc.ts`.
- Atalho de teclado para alternar as análises do menu.

### Dependências

```
Etapa 1 ──► Etapa 2 ──► Etapa 3 ──► Etapa 4 ──► Etapa 5 ──► Etapa 6
 (models,     (calc)      (tela)      (fluxo)     (demais
  settings)                                         ações)
```

---

## 7. Testes

| Nível | O quê |
|---|---|
| Unitário (`console.calc.spec.ts`) | oferta por regime/grupo, pior dia, quadro necessário, matching, linha × turno, alertas e status |
| Unitário (gerador) | specs atuais passando após a extração (5.3) — garantia de comportamento igual |
| Unitário (ações) | sugestão respeita filtros e ordem da regra; grupos por demanda; transição > 6 dias |
| Integração (service) | apply revalida e grava o lote com antes → depois; `startShift` futuro; geração grava `crewContext` e as checagens de um dia gerado ignoram troca de grupo posterior |
| Unitário (gerador) | critério `priorityLine` pesa antes de `driverPrefLine` |
| Manual | snapshot de uma empresa real conferido; fluxo completo no navegador |

---

## Dúvidas

**Q10 — Preferências pelo gestor.** Na habilitação de linhas (§4.5), o Painel pode também
adicionar a linha às **preferências** do operador, ou a preferência fica só com o operador
(portal)? Proposta: só habilitação; preferência fica com o operador.
R.: Quero permitir a preferencia pelo gestor, "desvinculada" da preferencia do operador, ou seja defini 3 preferencias do operador, operador pode escolher 3 e gestor (tela atual) pode extrapolar esse limite definindo preferencias forçadas (ou outro nome menos agressivo), ideia aqui é em linhas com baixa preferencia evitar de o gerador escalar pessoas aleatorias, gerador olha se existe preferencias por parte da empresa (prioritarias) e na sequencia olha as do condutor... na futura tela do operador estas linahs definidas pelo gestor nao podem ser alteradas por ele, veja como adaptar da melhor forma o json para implementar essa ideia
> Entrou em §4.8: coluna `priority` em `CrewMemberLine`, critério `priorityLine` no gerador, análise e ação no Painel.

**Q11 — Afastado.** Prazo mínimo de um afastamento (não férias) para tirar alguém da oferta
(`AWAY_MIN_DAYS`): 15 dias?
Configurável por empresa ou constante?
R.: Configuravel por empresa, default 15
> `transit.roster.awayMinDays` (§1.5).

**Q12 — Desfazer.** Qualquer ajuste pode ser desfeito a qualquer tempo, ou só os ainda não
"vencidos" (data de efeito no futuro / até N dias depois)? Proposta: a qualquer tempo, com
desfazer parcial (§1.7).

R.: acho que este desfazer poderia ficar fora desta primeira versão, acho que ele pode adicionar grau de complexidade alto para um ganho não tão evidente.. é importante registrar essas movimentações, especialmente que aqui algumas contecem em lote para permitir  consulta futura pelo usuario "do que foi feito", desfazer neste momento fica manual
> Entrou em §1.7: sem desfazer; todo lote registrado e consultável na seção "Ajustes".

**Q13 — Endpoint único.** Snapshot único para as análises (§1.10) em vez de uma consulta por
card. De acordo?
R.: Otimo
> §1.10.

**Q14 — Regra de seleção.** Fica editável só no Painel, ou também na tela de configurações do
transit, junto das outras regras de escala real?
R.: Opção A (só no Painel). Critérios de desempate: data de contratação (preserva os antigos,
move os mais novos) e mais novo no turno (move os últimos que chegaram ao turno de origem); o
usuário escolhe a ordem. "Linhas preferidas no destino" sai — as linhas operam em quase todos
os turnos.
> Entrou em §4.7 e §0.

**Q15 — Data de efeito para grupo e regime.** Grupo (`restOffset`) e regime (`restPatternId`)
não têm histórico (§1.8): mudar o grupo hoje muda também as folgas previstas do passado e dos
dias já gerados, e uma troca com data futura não é representável. Proposta: o vínculo de turno
(`CrewMemberShift`) passa a guardar também `restPatternId` e `restOffset` — vira "turno + regime +
grupo a partir de uma data". O regime já é, por padrão, do turno, e a troca de turno já pede o
grupo novo. Toda mudança de turno, grupo ou regime ganha data de efeito real (inclusive pela tela
do operador), e o histórico fica coerente com os dias gerados. Entraria na Etapa 1. De acordo?
R.: Algumas considerações aqui, vc afirmou "O regime já é, por padrão, do turno", e nao esta errado em 95% dos casos, mais existe excessões, funcionarios adventistas tem folga diferente dos demais (por exemplo), então amarrar uma coisa na outra vai gerar conflito (acho). Agora talvez o problema seja mais simples, ao gerar uma escala de um dia ele opera no turno grupo do funcionario (ok) essa folga ja esta persistida na escala diaria certo? (ou nao) altero o grupo do operador, nenhuma escala ja gerada eh  ser alterada, somente as proximas gerações de escala atuam sobre isso.. se essa aformação minha for verdadeira ja nao cobre este cenário sem ter que criar um historico de alterações?
> Entrou em §1.8 e §1.9: sem histórico de folga e sem acoplar regime ao turno. Grupo e regime valem
> a partir da próxima geração; cada dia gerado guarda o regime e o grupo usados
> (`DailyOperation.crewContext`) e as checagens leem dele. Ajuste num dia gerado = gerar de novo.
> Caso limite (troca de turno futura + grupo) tratado com aviso na prévia.