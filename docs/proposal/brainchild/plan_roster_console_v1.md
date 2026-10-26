# Proposta — Painel de Escala (Console)

**Status: levantamento fechado; protótipo validado.** A implementação segue
[`plan_roster_console_impl_v1.md`](plan_roster_console_impl_v1.md), que revisa alguns pontos
daqui (endpoint único de snapshot, janela de referência, etapas).

Objetivo: uma central única de **gestão da escala**, onde o gestor vê de relance:
- o resumo das escalas lógicas em vigor (útil, sábado, domingo);
- se a escala lógica está bem distribuída entre turnos;
- se o quadro de operadores (turnos, grupos de folga, linhas, tipos de veículo) dá conta da
  demanda;
- e **corrige** o quadro dali mesmo (sugestões por regra → confirmar → aplica em lote).

Nome: rota `transit/console`, rótulo **Painel de Escala**. Resolve o item "Dashboard de escala"
de `docs/TODO.md`.

---

## 0. Como funciona hoje

### 0.1 Fluxo

```
LineSchedule (OS) ─► VehiclePlan (scope × dayType, vigência) ─► CrewPlan (Duty = tabela)
                                                                     │  turno derivado (CrewShift),
                                                                     │  byShift / byLine / byBranch, issues
                                                                     ▼
          resolveDayType(data, linha) + plano em vigor por linha ─► DailyOperation (scope × data)
                                                                     │  cópia: DailyBlock / DailyDuty
                                                                     │  dia misto, sources, "outdated"
                                                                     ▼
 CrewMember + CrewMemberShift + RestPattern + CrewOccurrence ─► Gerador (empresa × função, ≤ 31 dias)
                                                                     │  folgas do regime, reserva,
                                                                     │  compensação pelo banco
                                                                     ▼
                                RosterEntry (a escala) ─► PUBLISHED (DailyChangeLog) ─► CLOSED
                                                                     │
                       CrewTimesheetDay (frequência importada) ─► HourBank (previsão × realizado,
                                                                     fechamento do mês, lotes)
```

### 0.2 Onde cada informação mora hoje

| Informação | Fonte | Tela | Granularidade |
|---|---|---|---|
| Resumo da escala lógica (tabelas, horas, extra, noturno, descoberto, score, critérios) | `CrewPlanSummary` | `crew-plan/[id]` (PlanPanel) | um plano |
| Tabelas por turno | `CrewPlanSummary.byShift` | **nenhuma** (calculado em `crew-scoring.calc.ts`, não exibido) | um plano |
| Tabelas por linha / empresa | `byLine`, `byBranch` | PlanPanel, DOP | um plano / scope |
| Efetivo estimado, custo, qualidade por tipo de dia | `DopCrewPeriodSummary` | DOP › Escala | scope × período |
| Grupos de folga por turno, balancear | `RestPatternService.groups/balance` | cadastro do regime | um regime |
| Pendências do dia | `DailySummary.issues`, `DAILY_ISSUE_CODES` | Escala (workspace) | empresa × período |
| Qualidade da escala real (continuidade, trocas, preferência, carga, desvio do turno) | `RosterQuality` | Escala › QualityTable | empresa × período |
| Falta de operadores e motivo | `RosterShortage`, `bound` | Escala › ShortageList | empresa × período |
| Carga × realizado por operador | `RosterBoardMember.stats` | Escala › grade | empresa × período |
| Banco de horas | `HourBankOverview` | `hour-bank` | empresa × mês |
| Férias / pedidos | `CrewOccurrence` | `vacation`, `crew-occurrence` | empresa |

Conclusão: **quase todos os números já existem**, mas espalhados em telas com recortes
diferentes (plano, scope, empresa, regime, mês). Ninguém cruza **demanda** (tabelas da escala
lógica) com **oferta** (quadro × turno × regime × ausências) antes do gerador rodar — e o
gerador só mostra isso depois, como falta (`shortage`).

### 0.3 Lacunas já identificadas

1. `byShift` é calculado e nunca exibido.
2. Efetivo do DOP (`dop-crew.service.ts:177`) = `max(maior dia útil; sáb + dom)`: ignora o regime
   de folga real, férias, absenteísmo e reserva. É uma estimativa de "quantas pessoas", não
   "quantas por turno" nem "quantas faltam".
3. `RestPatternService.balance()` iguala o tamanho dos grupos dentro de cada turno, **sem olhar
   a demanda por dia da semana** (ex.: domingo pede menos tabelas — mais gente deveria folgar no
   domingo).
4. Tabela com `branchId` nulo não recebe turno → some da demanda por turno. **Toda tabela sem
   empresa é erro** a ser exibido no Painel (§A, §6.4).
5. A elegibilidade do gerador é por **encaixe na janela**, não pelo rótulo do turno: um saldo
   "por turno" simples é aproximado (um operador da manhã pode cobrir uma tabela intermediária).
6. Não há série histórica dos indicadores — não é necessária: o Painel trabalha só com a foto
   atual (Q8).
7. A home (`app/page.tsx`) só lista domínios — não há nenhum ponto de entrada "o que preciso
   resolver hoje".

---

## 1. Conceito

- **Recorte:** empresa + função (como a tela Escala). Scope aparece como quebra quando a
  empresa opera mais de um. Tudo na URL. A mesma regra vale para todas as funções — hoje só há
  motoristas, as demais entram sem trabalho extra.
- **Sem horizonte de datas.** O dimensionamento é **planos efetivos × quadro ativo**, foto
  atual: a semana típica (útil, sábado, domingo) dos `CrewPlan` efetivos contra os operadores
  ativos, seus turnos e grupos de folga. Não lê escala real, não lê histórico.
- **Plano efetivo** (Q9) = por scope × tipo de dia, o plano **sem data de fim** (`validTo`
  nulo — o último ativado), mesmo que comece no futuro: o Painel dimensiona o quadro para o
  planejamento que vai valer, não para o que está saindo. Quando o `validFrom` do efetivo está
  **mais de 10 dias à frente** de hoje, o card mostra um badge de alerta ("efetivo a partir de
  01/12").
- **Central de gestão, não só leitura.** O Painel diagnostica **e** corrige o quadro (balancear
  turnos, grupos de folga, regime, linhas — §2.1). O que é cadastro estrutural da escala lógica
  (janela dos turnos, edição de tabelas) aparece como **sugestão com link** para a tela própria.
- **Escala real fica na Escala.** Os dias gerados não entram no dimensionamento nem são
  alterados pelo Painel. Única exceção: aviso dos dias gerados e não publicados **que têm erro
  ou pendência**, até 30 dias à frente (§F).
- **Cards independentes**: cada seção tem sua própria consulta (carrega em paralelo, falha
  isolada).

Layout (desktop) — validado no protótipo (Fase 1): KPIs e alertas no topo; abaixo, um menu
lateral com as análises (ícone de erro / alerta / ok e contagem em cada item) e o painel com a
análise escolhida, na largura toda. Clicar num alerta abre a análise dele.

```
┌ Empresa ▾  Função ▾ ─────────────────────────────────────────────────────┐
│ [Erros] [Falta no quadro] [Cobríveis no útil] [Operadores] [Dias c/ erro] │  ← KPIs
├───────────────────────────────────────────────────────────────────────────┤
│ Alertas (por severidade, clicáveis)                                       │
├────────────────────────┬──────────────────────────────────────────────────┤
│ ✕ Escalas efetivas   2 │                                                  │
│ ✕ Demanda × quadro   1 │   análise selecionada                            │
│ ! Distribuição turnos 1│   (tabela, gráficos, [Sugestões])                │
│ ! Grupos de folga    3 │                                                  │
│ ✕ Cadastro do quadro 1 │                                                  │
│ ✕ Dias gerados       3 │                                                  │
│   Ajustes recentes   0 │                                                  │
└────────────────────────┴──────────────────────────────────────────────────┘
```

---

## 2. Seções

### 2.1 Ações — como o Painel corrige

Toda ação segue o mesmo fluxo, igual ao "aceitar" do gerador e ao preview da ativação de planos:

```
diagnóstico ─► [Sugestões] ─► lista proposta (editável) ─► prévia de impacto ─► Confirmar ─► aplica em lote
```

1. **Diagnóstico** — o card mostra o desequilíbrio ("turno Manhã: falta 4; Tarde: sobra 6").
2. **Sugestões** — calcula o ajuste ideal ("mover 4 da Tarde para a Manhã") e escolhe **quem**
   pela regra de seleção da empresa (abaixo). Lista com o motivo de cada escolha.
3. **Lista editável** — o gestor tira/troca operadores e define a **data de início** (hoje o
   cadastro sempre inicia o turno "hoje"; padrão a definir — Q2a).
4. **Prévia de impacto** — sobre o planejamento: saldo antes × depois por turno e tipo de dia;
   transição do grupo de folga (dias seguidos trabalhados, domingo de folga). Dias já gerados
   não são recalculados — no máximo um aviso de que N dias gerados a partir da data de início
   foram montados com o quadro antigo.
5. **Confirmar** — aplica tudo numa transação, pelos services existentes. Não gera nem
   altera escala: a próxima geração (na tela Escala) já usa o quadro ajustado.

**Regras de negócio não ficam no Painel.** Ele orquestra os services que já existem
(`CrewMemberShiftService`, `RestPatternService`, `CrewMemberLine`…), para que o cadastro e o
Painel nunca divirjam.

**Regra de seleção (definida pelo gestor, por empresa)** — critérios em ordem de prioridade,
em `transit.roster` (ex.: `rebalanceRules`), cada um ativável:
- compatível com o destino: limites `notBefore/notAfter` cabem na janela do turno de destino
  (filtro, não critério);
- linhas preferidas do operador presentes nas tabelas do turno de destino;
- menos trocas de turno/grupo recentes (estabilidade da pessoa — `CrewMemberShift` tem datas);
- antiguidade (`hireDate`) — mais novo move primeiro, ou o contrário.

**Ações previstas**

| Ação | Onde atua | Observação |
|---|---|---|
| Balancear turnos (mover N de Y para Z) | `CrewMemberShift` a partir de data | §B |
| Balancear grupos de folga por demanda | `CrewMember.restOffset` | §D; transição validada |
| Trocar regime de um grupo de operadores | `CrewMember.restPatternId` | §D |
| Habilitar linha em lote (cobertura baixa) | `CrewMemberLine` | §E; sugestão de quem |
| Criar perfil de operador para funcionário sem perfil | `CrewMember` | §E; turno e grupo sugeridos pelo saldo |
| Ajustar janela de turno / criar turno | `CrewShift` | **só sugestão + link** — muda o turno das tabelas em todos os planos |
| Definir empresa de tabela sem empresa, editar tabelas | `Duty` | **só link** para o plano filtrado |
| Gerar / corrigir / publicar dias | `RosterEntry`, `DailyOperation` | **só link** para a Escala |

**Auditoria e desfazer** — cada confirmação grava um lote (`RosterAdjustment`: quem, quando,
ação, regra usada, itens `before/after`). O Painel lista os últimos ajustes e permite **desfazer
o lote** (volta o cadastro; dias gerados nesse meio-tempo não são tocados).

### A. Escalas em vigor (escala lógica)

Por scope × tipo de dia (útil, sábado, domingo…), o plano **efetivo** (sem data de fim — §1):

- `VehiclePlan` efetivo: frota, viagens, vigência; badge quando começa mais de 10 dias à frente.
- `CrewPlan` efetivo: tabelas por função e por tipo (`STRAIGHT`/`SPLIT`/`TRIPPER`/`STANDBY`),
  média de jornada / paga / extra / noturno, minutos descobertos, tabelas `stale` e com issue,
  score.
- Comparação entre tipos de dia lado a lado.

**Erros e alertas:**
- **tabela sem empresa (`Duty.branchId` nulo) é erro** — fica fora da demanda por empresa/turno;
  link para o plano filtrado;
- linha ativa do scope sem `VehiclePlan` em vigor em algum tipo de dia;
- **`VehiclePlan` efetivo sem `CrewPlan` ativo é erro** — o tipo de dia fica sem demanda (o
  Painel não volta para a escala do plano anterior); link para o plano, onde o usuário ativa
  uma escala;
- `CrewPlan` com tabelas `stale`, descoberto > 0 ou issues de CCT;
- plano efetivo com início a mais de 10 dias de hoje (badge — a análise já é sobre ele).

### B. Demanda × quadro (dimensionamento)

O núcleo do Painel. Foto atual, por empresa `b`, função `r`, turno `s` e tipo de dia `t`
(semana típica):

- **Demanda(t, s)** = tabelas da empresa com turno `s` no `CrewPlan` efetivo do tipo de dia
  `t` (mesma regra do gerador: `branchId = b`, ou nulo num scope que `b` opera sozinha) +
  plantões das `reserveTargets` de `t`. Com várias linhas/planos, soma por tipo de dia.
- **Oferta(t, s)** = operadores ativos (`Employee` ativo, `isRosterable`) com turno vigente `s`,
  que **trabalham** nos dias da semana de `t` pelo regime e grupo (`restPatternWorks` sobre uma
  semana típica — média quando o ciclo passa de 7 dias).
- **Saldo** = oferta − demanda. Grade turno × tipo de dia (verde sobra, vermelho falta) + totais.

Refinamentos:
- **Saldo exato (sem rótulo)** (Q6): como a elegibilidade real é por encaixe de janela
  (lacuna 5), um segundo número por tipo de dia: o **máximo de tabelas cobríveis** por matching
  bipartido operadores × tabelas com as regras sempre-bloqueantes — o mesmo `bound` do gerador
  (`RosterProposalSummary.bound`), extraído para uso fora do job. Turno no heatmap, exato no
  total.
- **Quadro necessário** por turno:
  `necessário = demanda do tipo de dia × (dias do ciclo ÷ dias trabalhados do ciclo) + reserva`
  (6x1 → fator 7/6). Comparar com o quadro atual → **"faltam 4 no turno Manhã"** / "sobram 2
  na Tarde". Substitui a estimativa do DOP (lacuna 2).
- **Fica para depois:** absenteísmo (Q3) — as ausências lançadas são as previstas; a maior
  parte não é avisada antes da escala. Medir pela frequência importada (`CrewTimesheetDay`),
  e usar no dimensionamento de plantões. Férias também entram nessa etapa (fator ≈ 1/12 ou
  pelas férias lançadas).

### C. Distribuição de turnos na escala lógica

Avalia se os turnos cadastrados "conversam" com as tabelas dos planos em vigor:

- tabelas por turno × tipo de dia (`byShift`), e % do total;
- `SHIFT_NONE` (tabela que não cabe em turno nenhum) e `SHIFT_MISMATCH` (turno fixado que não
  cabe), com link para o plano filtrado;
- **histograma de início e fim das tabelas** sobreposto às janelas (floor / ideal / ceiling) de
  cada turno — mostra tabelas espremidas na borda, buracos entre turnos e turnos sobrepostos;
- tabelas que cabem em mais de um turno (decididas só pela `priority`) — sinal de janelas
  redundantes;
- turnos sem tabela em algum tipo de dia (ex.: Intermediário só existe no útil → seus
  operadores ficam sem tabela no sábado) e turnos cadastrados sem operador;
- `SPLIT` por turno × `allowSplit`.

**Sugestões (sem aplicar, link para o cadastro do turno):** "12 tabelas começam antes do floor
do turno Manhã — ampliar o floor para 04:10 ou criar turno Madrugada"; "Tarde e Intermediário
cobrem as mesmas 30 tabelas".

### D. Grupos de folga × demanda semanal

Hoje `groups()` mostra a contagem por grupo e `balance()` iguala os grupos (lacuna 3). Aqui:

- por regime × turno: operadores por grupo, **fora de grupo**, sem regime;
- **oferta por dia da semana** resultante dos grupos × **demanda por dia da semana** (tipo de
  dia de cada dia da semana) — barras duplas;
- **balancear por demanda** (ação, §2.1): distribuir os operadores nos grupos minimizando a
  falta por dia da semana (problema pequeno, guloso resolve), em vez de igualar;
- validações do regime: máximo de dias seguidos trabalhados (incluindo a virada de ciclo e a
  troca de grupo), frequência de domingo de folga por grupo (CCT).

### E. Cadastro do quadro

Problemas de cadastro que derrubam o dimensionamento ou o gerador:

- **funcionário sem perfil de operador:** `Employee` ativo cujo cargo do contrato vigente está
  mapeado para uma função (Q7, §6.8) e que não tem `CrewMember`; e `CrewMember` de funcionário
  inativo;
- operador sem turno vigente, sem regime efetivo, `isRosterable = false` (quantos e quem);
- **habilitação por linha × turno** (nunca no dia inteiro — 10 sobrando de manhã não cobrem 10
  faltando à tarde): por turno, tabelas de cada linha (linha dominante) → necessário
  (`× 7/6`) × operadores do turno que podem operá-la (modo WHITELIST/BLACKLIST e tipo de
  veículo). Mostra **só as combinações com habilitados abaixo do necessário** (erro); as ok ficam
  recolhidas. Quantos preferem a linha aparece como informação secundária;
- **tipo de veículo:** tabelas cujos blocos exigem um tipo (ex.: articulado) × operadores aptos;
- **carro fixo:** veículo fixo inativo, mesmo carro fixo para dois operadores com turnos
  sobrepostos, carro fixo de outra empresa;
- plantão: operadores que não fazem plantão (`standbyBlocked`) × metas de reserva.

CNH e curso vencendo ficam fora do Painel (Q5) — continuam como pendência do dia na Escala.

### F. Dias gerados com erro (só aviso)

Lista curta, só quando há algo — dias **gerados e não publicados** até 30 dias à frente com
pendência de erro (`DailySummary.issues`: tabela sem operador, plantão sem operador, carro sem
veículo…) ou desatualizados (`outdated`). Link para a Escala no dia. Sem erros, o card some.

### G. Simulação "e se" (futuro)

Sobre o cálculo da seção B, sem gravar: mudar a janela de um turno, mover N operadores de
turno/grupo, trocar o regime, contratar N → novo saldo. A prévia de impacto das ações (§2.1) já
é uma simulação restrita; aqui ela fica livre.

### Fora do Painel

Carga e banco de horas, pedidos, custos e aderência plano × realizado são da escala real
(Escala, banco de horas, DOP) e não entram — o Painel não olha escala real nem histórico (Q4,
Q8).

---

## 3. Catálogo de indicadores (resumo)

| Indicador | Fórmula / origem | Já existe? |
|---|---|---|
| Tabelas por turno × tipo de dia | `CrewPlanSummary.byShift` | calculado, não exibido |
| Saldo por turno × tipo de dia | oferta − demanda (§B) | não |
| Máximo cobrível por tipo de dia | matching (`bound` do gerador) | só dentro do job |
| Quadro necessário por turno | §B fórmula | não (DOP tem estimativa simples) |
| Tabelas sem empresa | `Duty.branchId` nulo | não sinalizado |
| Tabelas sem turno / turno errado | `SHIFT_NONE`, `SHIFT_MISMATCH` | issues por tabela |
| Oferta por dia da semana por regime | grupos × `restPatternWorks` | parcial (`groups()`) |
| Funcionário sem perfil de operador | cargo → função (§6.8) | não |
| Cobertura de linha | `CrewMemberLine` × `byLine` | não |
| Dias gerados com erro | `DailySummary.issues` | por dia (Escala) |

---

## 4. Alertas

Lista única no topo, com severidade e link. Cada alerta é uma função pura sobre os dados das
seções (fácil de testar e de crescer).

| Severidade | Exemplo |
|---|---|
| erro | Plano efetivo de sábado sem escala ativa · 3 tabelas sem empresa no plano de sábado · Turno Manhã: faltam 4 no útil · Linha 812 sem plano em vigor no domingo · Dia 28/10 gerado com 3 tabelas sem operador |
| alerta | Plano de sábado termina em 5 dias sem sucessor · Grupos do 6x1 desbalanceados frente à demanda de domingo · 12 tabelas fora de qualquer turno |
| info | 2 funcionários motoristas sem perfil de operador · Linha 305 com só 2 operadores habilitados |

---

## 5. Arquitetura proposta

**Registro / navegação**
- Schema singleton só para discovery/CASL, como `dopSchema` / `hourBankSchema`
  (`isSingleton`, sem model Prisma). Candidato a `featured` no domínio transit.
- Página custom `apps/web/src/app/transit/console/page.tsx`. As ações abrem em modal/drawer
  (sugestão → prévia → confirmar); `alt+g` confirma o modal aberto, `alt+v` volta, `alt+l`
  descarta a lista sugerida editada.
- Permissões: ver o Painel = leitura do resource; cada ação exige `update` do resource que ela
  altera (operador, regime, linha do operador).

**Backend** — `apps/api/src/modules/transit/console/`
- `ConsoleService` compõe o que já existe: planos em vigor (`plan-validity`, busca de plano
  ativo do DOP), `CrewPlanSummary`, `RestPatternService.groups`, `RosterBoardService` (só §F).
- Endpoints por seção (cards independentes):
  `GET /transit/console/{plans,staffing,shifts,rest-groups,crew-data,alerts,daily-errors}?branchId&role`.
- **Cálculo de oferta/demanda puro** (`staffing.calc.ts`) — entrada montada uma vez, testável
  com spec, reaproveitado pela prévia das ações e pela simulação (G). Reusar o que
  `roster-generator.input.ts` já monta (regras de elegibilidade) em vez de duplicar.
- Extrair o `bound` do gerador para função chamável fora do job.
- Ações: `POST /transit/console/<ação>/suggest` (proposta, nada gravado),
  `POST …/preview` (lista editada → impacto) e `POST …/apply` (transação + lote de auditoria);
  `POST /transit/console/adjustments/:id/undo`.
- Escopo de filial: não-admin só vê empresas do seu `branchIds`.
- Desempenho: semana típica por tipo de dia — não depende de horizonte.

**Frontend**
- `recharts` já está no projeto (o heatmap pode ser grid Tailwind hand-rolled).
- Empresa/função compartilhadas com a Escala (mesmos parâmetros de URL → os links caem no mesmo
  contexto).

---

## 6. Ajustes necessários no que existe

1. **Exibir `byShift`** no PlanPanel da escala lógica (tabelas por turno × empresa) — previsto
   no plano v2 §1.6, não entregue.
2. **Efetivo do DOP:** trocar a estimativa `max(útil; sáb + dom)` pelo quadro necessário da §B,
   ou deixar explícito na tela que é estimativa grosseira.
3. **`RestPatternService.balance()`** passa a aceitar "por demanda" (§D); o modo atual (igualar)
   continua como opção.
4. **Tabela sem empresa é erro:** novo issue na `Duty` (ex.: `BRANCH_NONE`, severidade erro) no
   recalculate do `CrewPlan`, exibido no plano e no Painel.
5. **Settings `transit.roster`** ganha `rebalanceRules` (regra de seleção, §2.1).
6. **`bound` do gerador** extraído para uso fora do job (§B, §5).
7. **Troca de turno com data de efeito em lote:** hoje o form do operador inicia o novo turno
   "hoje" (datas específicas só pela aba Turnos). O `CrewMemberShiftService` precisa de uma
   operação em lote com `validFrom` informado.
8. **Cargo → função (Q7):** associação nova no transit. **Vários cargos podem apontar para a
   mesma função** (Motorista Pleno, Motorista Micro, Motorista Articulado → `DRIVER`); o que a
   chave impede é um mesmo cargo em duas funções (se um dia existir, a chave vira
   `@@id([jobTitleId, role])`). O cargo não substitui a aptidão por tipo de veículo — essa
   continua em `CrewMember.blockedVehicleTypes` (o cargo pode, no futuro, sugerir os bloqueios
   ao criar o perfil):
   ```prisma
   // Which JobTitles are crew of a role — an employee whose current contract has one should
   // have a CrewMember of that role
   model CrewRoleJobTitle {
     jobTitleId String   @id
     role       CrewRole

     jobTitle JobTitle @relation(fields: [jobTitleId], references: [id])

     @@map("transit_crew_role_job_titles")
   }
   ```
   O cargo vem do **contrato vigente** (`Contract.jobTitleId`). Tabela no transit (e não campo
   no `JobTitle`) para o RH não depender do domínio transit. Usos: detectar funcionário sem
   perfil (§E), sugerir a função ao criar o `CrewMember`, avisar quando o cargo do contrato e a
   função do perfil divergem. Edição: uma seção na tela de configurações do transit (lista de
   cargos × função).
9. **Lote de ajustes (`RosterAdjustment`)** — model novo para auditoria e desfazer (§2.1).
10. **`docs/TODO.md`:** "Dashboard de escala" passa a apontar para este plano.

---

## 7. Fases

| Fase | Entrega | Base |
|---|---|---|
| 1 | **Protótipo da tela no `/playground`** — substitui o protótipo atual (barra de filtros da escala lógica, já entregue). Dados sintéticos, sem fetch, sem backend: layout e cards A–F, KPIs e alertas, e o fluxo completo de uma ação (Balancear turnos: sugestões → lista editável → prévia de impacto → confirmar → ajuste recente com desfazer). Objetivo: validar layout, densidade e fluxo antes de qualquer modelo/endpoint | `app/playground/page.tsx` |
| 2 | Painel base: registro (singleton), página `transit/console`, **A** (escalas em vigor, tabela sem empresa como erro), **E** (cadastro, com `CrewRoleJobTitle`), **F** (dias gerados com erro), alertas; `byShift` no PlanPanel | composição do que existe + `CrewRoleJobTitle` |
| 3 | **B** demanda × quadro + **C** distribuição de turnos; **ação Balancear turnos** com regra de seleção, prévia, lote de auditoria e desfazer | `staffing.calc.ts`, `bound` extraído, `rebalanceRules`, `RosterAdjustment` |
| 4 | **D** grupos de folga × demanda semanal; **ações** balancear grupos por demanda e trocar regime; habilitar linha em lote | `RestPatternService` + fluxo de ações |
| 5 | Absenteísmo e férias pela frequência importada; dimensionamento de plantões | `CrewTimesheetDay` |
| 6 | **G** simulação "e se" | `staffing.calc.ts` |

---

## Dúvidas

**Q1 — Recorte.** Painel por empresa + função (como a Escala), com scope só como quebra? Ou
também uma visão consolidada de todas as empresas para admin?
R.: Recorte por empresa + função

**Q2 — Só leitura?** O Painel apenas aponta e leva à tela certa, ou terá ações?
R.: Central de gestão — diagnostica e corrige (sugestões por regra definida pelo gestor, confirmar
aplica em lote). Mudança estrutural da escala lógica (janela de turno) só como sugestão. Ver §2.1.

**Q2a — Data de efeito.** Ao mover operadores de turno/grupo, qual a data de início padrão:
hoje, o primeiro dia ainda não gerado, ou o início do próximo período da carga?
(Já definido: o Painel não regenera nem altera dias gerados — a próxima geração na Escala usa
o quadro ajustado.)
R.: Data de efeito deve ser campo a ser definido pelo usuario no momento do "ajustar" no painel

**Q2b — Voluntário.** Vale criar no operador a marcação "aceita trocar de turno" como critério
da regra de seleção?
R.: Acho desnecessario

**Q3 — Absenteísmo.** Medir do histórico (ausências lançadas) ou meta fixa configurada por
empresa?
R.: Eh valido para medir o dimencionamento dos plantoes, mais hoje nao temos ferramenta consolidada para medir absenteismo, as ausencias de escala são as previstas com anatecedencia, maior aprte não eh avisada na composição da escala, demanda dados de frequencia (que podemos sim utilizar) mais fica para uma segunda etapa
> Entrou como Fase 5 (frequência importada).

**Q4 — Horizonte padrão** do Painel: próximos 30 dias? mês corrente (período da carga)?
R.: Nao sei se eh necessario definir horizonte, veja meu raciocicion, painel levanta planos ativos para util sab dom, compara necessidade destes com quadro atual e gera as analises, na pratica não tem que buscar dados de escala real, o dimensionamento eh com escalas ativas x quadro ativo... no máximo a janela pode olhar para os casos de erros nas escalas geradas e nao publicadas, neste caso acho que pode olhar todas ou se precisar limitar maximo de 30 dias a frente, mais aqui somente se existe erros ou pendencias
> Sem horizonte (§1, §B por tipo de dia); §F até 30 dias, só com erro.

**Q5 — Funções.** Cobrador e auxiliar entram desde o início ou só motorista?
R.: Na pratica hoje so temos motoristas, mais entendo que definindo a ideia de um fica "quase" automatico para os outros, algumas questão que poderiam variar é analises como CNH e Curso vencidos, mais acho que isso nem eh o foco aqui do painel (opode deixar de fora) a regra que vale para uma função vale para todas (entendo)
> Mesma regra para todas as funções; CNH/curso fora do Painel.

**Q6 — Turno como rótulo × encaixe.** O saldo principal deve ser por turno (rótulo, mais
legível) ou pelo máximo cobrível (exato, considera flexibilidade entre turnos)? Proposta: os
dois — turno no heatmap, exato no total do dia.
R.: Perfeito sua sugestão

**Q7 — Funcionário sem perfil de operador.** Qual critério identifica um `Employee` que
deveria ter `CrewMember` (cargo, departamento)?
R.: Exato, imagino um modelo novo de associação para função fixa, onde informando quais as funções representam motoristas (role motorista), mesma ideia para demais funções, o que acha? se tiver sugestão melhor quero ouvir
> Concordo — `CrewRoleJobTitle` (§6.8): cargo do contrato vigente → função, tabela no transit.

**Q8 — Tendências.** Precisa de série histórica (ex.: evolução do quadro e do absenteísmo nos
últimos 12 meses) já no início, ou só a foto atual?
R.: So a foto atual

**Q9 — Plano agendado.** Quando há plano futuro já agendado para um tipo de dia, o Painel
mostra o saldo com o plano atual, com o agendado, ou os dois (alternância)?
R.: Sempre o plano efetivo (sem data de fim), mesmo que comece no futuro; badge de alerta quando
ele começa mais de 10 dias à frente de hoje. 
