# Proposta — Escala Lógica de Tripulação (CrewPlan)

Objetivo: modelar a **escala lógica** de tripulação — jornadas ("tabelas") sem pessoa
atribuída — construída sobre os blocos de um `VehiclePlan`. Nesta etapa, **tudo manual**:
a jornada é montada pelo usuário e os settings servem para **validar e sinalizar** o que foi
montado, não para gerar. O solver de escala será repensado do zero numa etapa futura.

Fora de escopo: **escala nominal** (funcionário × data × jornada, rodízios 6x1/12x36,
folgas, preferências) — etapa posterior que vai referenciar `Duty`.

Status: **consolidado** — sem dúvidas em aberto (2026-09-26).

---

## O que já existe (peças reaproveitáveis)

| Peça | Onde | Estado |
|---|---|---|
| `VehiclePlan → VehicleBlock → BlockTrip / BlockDeadrun / BlockInterval` | `transit.prisma` | Consolidado — a escala lógica é construída **sobre** os blocos, sem alterá-los |
| `RouteLocality.allowsCrewChange` | `transit.prisma` | Já existe e já é considerado pelo `OsrmService`. Define, junto com as pontas da rota, onde uma pegada pode começar/terminar |
| `IntervalType` (`isPaid`, `minMinutes`, `maxMinutes`) | `transit.prisma` | Reaproveitado para classificar os intervalos da jornada (refeição, etc.) |
| `ScopeOperator` / `VehicleBlock.branchId` | `transit.prisma` | Operadores do Scope — base para `Duty.branchId` |
| `scheduleSettingsSchema` (`transit.schedule`) | `settings-schedule.schema.ts` | **Sem uso hoje** — será reescrito (ver Settings) |
| `BaseSettingsService` + tabela `Settings (key, scope)` | `base-settings.service.ts`, `core.prisma` | Singleton JSON por (key, scope), hoje só `'global' \| 'branch'` |
| `rangeCriterionSchema` / `anchoredCriterionSchema` | `settings-planning.schema.ts` | Mesmo mecanismo de faixas do plano de veículos |
| `VehiclePlan.activate()` (vigência + supersessão) | `vehicle-plan.service.ts` | Padrão a seguir no `CrewPlan` |
| Estado de pendências do Gantt (`pendingCount`, `clearAllPending`) | `vehicle-plan/[id]/hooks/useGanttEditor.ts` | Usado para liberar/bloquear o switch Veículos ⇄ Escala |

---

## Decisões consolidadas

1. **Tudo manual nesta etapa.** `CrewPlan.generatedAt` e `constraints` existem no modelo, sem
   uso, prontos para o solver futuro. `Duty.kind` também é **escolhido pelo usuário** (nada
   derivado automaticamente).

2. **Papel como enum**: `CrewRole { DRIVER, FARE_COLLECTOR, ASSISTANT }` (motorista,
   cobrador, auxiliar). Cobertura obrigatória só para `DRIVER`.

3. **Numeração separada por papel, exibida com prefixo**: `D10`, `C10`, `A10`. Persistido
   como `dutyNumber Int` + `role`; o prefixo é derivado do papel (mapa fixo no schema:
   `DRIVER → D`, `FARE_COLLECTOR → C`, `ASSISTANT → A`), nunca armazenado.
   Unique: `[crewPlanId, role, dutyNumber]`.

4. **Pontos de troca**: uma pegada só começa/termina na **origem ou destino da rota** ou num
   `RouteLocality` com `allowsCrewChange = true` da viagem que o bloco executa naquele
   minuto — e também nas pontas dos deadruns (saída/recolhida de garagem, deslocamentos).
   Horário da parada intermediária = mesma regra do OSO (chegada real da viagem − minutos
   até o destino via `deltaMinutes`, matriz como fallback). Calculado em
   `crew-plan/relief-points.ts` e exposto em `GET /transit/duty-piece/relief-points/:vehicleBlockId`.
   A UI só oferece pontos válidos; o **server rejeita** (400) o que não for — é
   estrutural, não regra de CCT.

5. **Jornada livre entre carros e linhas.** Um condutor pode trabalhar em mais de um bloco
   e mais de uma linha na mesma jornada. `vehicleChanges`/`lineChanges` são só informação.

6. **Pegada referencia o bloco por janela de tempo + local**, não por FK para `BlockTrip`
   (troca no meio da viagem exige granularidade abaixo da viagem). A cobertura
   (bloco − pegadas) é **sempre derivada** — trecho sem pegada `DRIVER` = "descoberto".

7. **Intervalo de veículo ≠ intervalo de tripulação.** `BlockInterval` é o carro parado; a
   refeição do motorista pode ocorrer com o carro rodando. `DutyActivity` é separada — intervalo
   da jornada é sempre lançado manualmente, nunca deduzido do `BlockInterval`.

8. **Regras de jornada (CCT) por `Scope` de transit** — todas as empresas do Scope seguem a
   mesma CCT, sem replicar regra por branch. Resolução:
   `CrewPlan.settings ?? Settings(transit.crew, scope = Scope.id) ?? Settings(transit.crew, global)`.

9. **Override por plano = cópia completa em `CrewPlan.settings`.** `null` = herda ao vivo;
   "personalizar" grava snapshot completo do settings efetivo; "restaurar padrão" volta a
   `null`. Mesmo mecanismo que o `VehiclePlan` já usa (ver decisão 13).

10. **Três sinais independentes** — divergência estrutural, descumprimento de regra e
    descoberto (detalhe em [Sinalização](#sinalização-stale--issues--descoberto)).

11. **Hora noturna** (22h–5h): nesta etapa só entra no summary como `nightMinutes`
    informativo — sem hora reduzida nem adicional no cálculo de minutos pagos.

12. **Ciclo de vida atrelado ao `VehiclePlan`**: só ativa `CrewPlan` se o `VehiclePlan`
    estiver ACTIVE; quando o `VehiclePlan` deixa de ser ACTIVE (supersessão), a `CrewPlan`
    ACTIVE dele é encerrada junto (`validTo` = mesmo instante).

13. **Renomear `VehiclePlan.metrics → settings`** na mesma leva, por consistência (hoje
    `metrics` significa "dados" em `TransitLine` e "config override" em `VehiclePlan`).
    Referências levantadas em [Rename VehiclePlan.metrics](#rename-vehicleplanmetrics--settings).

14. **Uma só experiência Veículos ⇄ Escala.** Para o usuário não há dois "módulos": abre o
    plano pelo mesmo atalho de hoje e um **switch** nas duas telas alterna entre visão de
    veículos e de escala. O switch só é liberado com **zero pendências** na tela atual.
    `CrewPlan` não aparece no sidebar/discovery (resource filho).

---

## Modelo proposto

```prisma
enum CrewPlanStatus {
  DRAFT
  ACTIVE
}

enum CrewRole {
  DRIVER
  FARE_COLLECTOR
  ASSISTANT
}

enum DutyKind {
  STRAIGHT  // jornada corrida
  SPLIT     // dupla pegada
  TRIPPER   // meia jornada / pegada curta
  STANDBY   // reserva / plantão (pode não ter pegadas)
}

enum DutyActivityType {
  SIGN_ON   // apresentação
  SIGN_OFF  // encerramento / prestação de contas
  BREAK     // intervalo (refeição etc.) — classificado por IntervalType
  TRAVEL    // deslocamento entre pontos de troca (a pé, carona, linha regular)
  STANDBY   // reserva/plantão
}

// Escala lógica de um VehiclePlan — N versões por plano de veículo, no máximo 1 ACTIVE
model CrewPlan {
  id            String         @id @default(uuid())
  vehiclePlanId String
  description   String?
  status        CrewPlanStatus @default(DRAFT)
  validFrom     DateTime?
  validTo       DateTime?
  // CrewPlanSummary — { dutyCount, byRole, byKind, workMinutes, paidMinutes,
  //   overtimeMinutes, nightMinutes, uncoveredMinutes, uncovered: [{ vehicleBlockId,
  //   startMinutes, endMinutes }], staleDutyCount, issueDutyCount, score }
  summary       Json?
  // CrewSettings completo (snapshot) — null = herda Scope/global ao vivo
  settings      Json?
  // sem uso nesta etapa — reservado para o solver
  constraints   Json?
  generatedAt   DateTime?
  notes         String?
  createdAt     DateTime       @default(now())
  updatedAt     DateTime       @updatedAt

  vehiclePlan VehiclePlan @relation(fields: [vehiclePlanId], references: [id], onDelete: Cascade)
  duties      Duty[]

  @@map("transit_crew_plans")
}

// Jornada ("tabela") — unidade que depois recebe uma pessoa na escala nominal
model Duty {
  id          String   @id @default(uuid())
  crewPlanId  String
  role        CrewRole @default(DRIVER)
  dutyNumber  Int      // exibido com prefixo do papel: D10, C10, A10
  kind        DutyKind @default(STRAIGHT)
  branchId    String?
  // DutySummary — números: { spreadMinutes, workMinutes, paidMinutes, breakMinutes,
  //   overtimeMinutes, nightMinutes, pieceCount, vehicleChanges, lineChanges }
  summary     Json?
  // divergência estrutural com o VehiclePlan (ver Sinalização) — true se alguma pegada
  // está stale; denormalizado de DutyPiece.isStale para filtro/lista
  isStale     Boolean  @default(false)
  // DutyIssue[] — regras não atendidas (CCT, operador...) — ver Sinalização
  issues      Json?
  // denormalizado de issues (length > 0) para filtro/lista/badge
  hasIssues   Boolean  @default(false)
  constraints Json?
  notes       String?
  createdAt   DateTime @default(now())
  updatedAt   DateTime @updatedAt

  crewPlan   CrewPlan       @relation(fields: [crewPlanId], references: [id], onDelete: Cascade)
  branch     Branch?        @relation("BranchDuties", fields: [branchId], references: [id])
  pieces     DutyPiece[]
  activities DutyActivity[]

  @@unique([crewPlanId, role, dutyNumber])
  @@map("transit_duties")
}

// Pegada — trecho contínuo de UM VehicleBlock entre dois pontos de troca
model DutyPiece {
  id              String   @id @default(uuid())
  dutyId          String
  // null = bloco removido do VehiclePlan (pegada órfã, isStale = true) — mantida para o
  // usuário ver o que tinha e realocar, em vez de sumir via cascade
  vehicleBlockId  String?
  sequence        Int
  startMinutes    Int
  endMinutes      Int
  startLocalityId String
  endLocalityId   String
  isStale         Boolean  @default(false)
  // StaleReason (código) — BLOCK_REMOVED | OUT_OF_BLOCK_WINDOW | INVALID_RELIEF_POINT
  staleReason     String?
  createdAt       DateTime @default(now())
  updatedAt       DateTime @updatedAt

  duty          Duty            @relation(fields: [dutyId], references: [id], onDelete: Cascade)
  vehicleBlock  VehicleBlock?   @relation(fields: [vehicleBlockId], references: [id], onDelete: SetNull)
  startLocality TransitLocality @relation("DutyPieceStart", fields: [startLocalityId], references: [id])
  endLocality   TransitLocality @relation("DutyPieceEnd", fields: [endLocalityId], references: [id])

  @@unique([dutyId, sequence])
  @@map("transit_duty_pieces")
}

// Tempo da jornada fora do volante
model DutyActivity {
  id                    String           @id @default(uuid())
  dutyId                String
  type                  DutyActivityType
  intervalTypeId        String?          // obrigatório quando type = BREAK
  startMinutes          Int
  endMinutes            Int
  originLocalityId      String?
  destinationLocalityId String?
  createdAt             DateTime         @default(now())
  updatedAt             DateTime         @updatedAt

  duty                Duty             @relation(fields: [dutyId], references: [id], onDelete: Cascade)
  intervalType        IntervalType?    @relation(fields: [intervalTypeId], references: [id])
  originLocality      TransitLocality? @relation("DutyActivityOrigin", fields: [originLocalityId], references: [id])
  destinationLocality TransitLocality? @relation("DutyActivityDestination", fields: [destinationLocalityId], references: [id])

  @@map("transit_duty_activities")
}
```

Minutos seguem a convenção do módulo (a partir do início do dia operacional, > 1440 =
madrugada seguinte).

---

## Sinalização: stale × issues × descoberto

Três sinais, cada um com causa e ação corretiva diferentes — não se misturam:

| Sinal | Pergunta que responde | Causa | Onde fica | Quem recalcula |
|---|---|---|---|---|
| **Stale** | "A escala ainda **encaixa** no plano de veículos?" | Edição no `VehiclePlan` (bloco removido, janela do bloco encolheu, viagem mudou e o ponto de troca não existe mais naquele minuto) | `DutyPiece.isStale` + `staleReason`; `Duty.isStale` (agregado); `CrewPlan.summary.staleDutyCount` | Hook no save do `VehiclePlan` (`applyDiff` e afins), só para as pegadas dos blocos afetados |
| **Issues** | "A jornada **cumpre as regras**?" | Regra de CCT fora da faixa, pegada em bloco de outro operador, etc. | `Duty.issues` (lista) + `Duty.hasIssues`; `CrewPlan.summary.issueDutyCount` | A cada save da jornada; e em lote ao abrir a escala |
| **Descoberto** | "O plano de veículos está **todo coberto**?" | Trecho de bloco sem pegada `DRIVER` | `CrewPlan.summary.uncovered` (derivado, nunca por pegada) | Junto com o summary do plano |

Considerações:

- **Stale é estado de integridade, não regra.** Não tem severidade nem limite configurável;
  só some quando o usuário ajusta/realoca a pegada (ou a remove). Por isso fica em coluna
  própria, e **por pegada** — a UI precisa apontar *qual* trecho quebrou, não só a jornada.
- **Pegada órfã em vez de cascade.** Se o bloco é removido, a pegada fica com
  `vehicleBlockId = null` e `staleReason = BLOCK_REMOVED`. Com cascade ela sumiria em
  silêncio e a jornada ficaria "curta" sem explicação.
- **Pegada stale não entra em issues nem na cobertura.** Evita dupla contagem: o trecho do
  bloco que ela deveria cobrir aparece como descoberto, e a jornada aparece como stale.
- **Issues guardam o critério não atendido**, estruturado para a UI e para a lista:

  ```ts
  type DutyIssue = {
    code:      'WORK_TIME' | 'SPREAD' | 'MEAL_BREAK' | 'SPLIT_INTERVAL'
             | 'CONTINUOUS_DRIVING' | 'MIN_PIECE' | 'TRAVEL_GAP' | 'BRANCH_MISMATCH'
    severity:  'warning' | 'error'   // error = fora de [floor, ceiling]; warning = fora do ideal
    value:     number                // valor realizado (min, contagem...)
    limit?:    number                // limite violado
    pieceId?:  string                // quando a regra aponta para uma pegada específica
  }
  ```

  `pieceId` é o que permite **sinalizar o bloco no Gantt** (ex.: `BRANCH_MISMATCH` marca o
  trecho do bloco de outro operador), atendendo o "erro-alerta" pedido para operador
  divergente.
- **Nada disso bloqueia save.** Só bloqueiam erros estruturais do próprio input (ver
  Validações). Stale e issues são para revisão do usuário.
- `hasIssues` / `isStale` denormalizados em `Duty` existem só para filtrar/listar/pintar sem
  abrir o JSON; a fonte é `issues` / `DutyPiece.isStale`.

- **Ativação**: jornadas **stale** ou trechos **descobertos** bloqueiam a ativação (a
  escala não encaixa no plano de veículos). **Issues** (inclusive `error`) só pedem
  confirmação — são regras sinalizadas, mesma filosofia do resto.
- **Settings alterado** (global/Scope editado): as issues das escalas que herdam ao vivo são
  recalculadas em lote **ao abrir a escala** (cálculo puro e barato). Sem job em background
  varrendo todos os planos.

---

## Ciclo de vida do CrewPlan

- N `CrewPlan` por `VehiclePlan`; no máximo **um ACTIVE por `VehiclePlan`**.
- **Ativar**: exige `VehiclePlan` ACTIVE. Carimba `validFrom` e encerra (`validTo`) a
  ACTIVE anterior do mesmo `VehiclePlan`.
- **Supersessão do `VehiclePlan`** (outro plano ativado para o mesmo scope+dayType): a
  `CrewPlan` ACTIVE do plano superado recebe `validTo` na mesma transação.
- **Duplicar `CrewPlan`** dentro do mesmo `VehiclePlan`: cópia direta de jornadas, pegadas e
  atividades (inclusive flags stale/issues, que são recalculados).
- **Duplicar `VehiclePlan`** não leva as escalas (blocos são linhas novas). "Copiar escala
  de outro VehiclePlan" (remapeando pegadas por `blockNumber`) fica para um segundo momento.

---

## Settings

Hoje `transit.schedule` mistura regras de duas etapas. Proposta: separar em duas keys.

| Atual | Novo | Etapa |
|---|---|---|
| `layover` (360/440/550/560) | `crew.range.workTime` | lógica — duração da jornada |
| `shiftBreak` | `crew.range.mealBreak` | lógica — intervalo intrajornada |
| `splitShiftInterval` | `crew.range.splitInterval` | lógica — intervalo da dupla pegada |
| `interShiftRest` | `roster.range.interShiftRest` | nominal — descanso entre jornadas (11h) |
| `driverPrefLine` / `driverPrefTech` | `roster.range.*` | nominal — preferências da pessoa |

Renomear campos persistidos faz o Zod descartá-los silenciosamente (ver comentário em
`BaseSettingsService`). Como nada disso está em uso, custo zero — linhas salvas em
`transit.schedule` são simplesmente abandonadas (pode apagar na migração).

### `crewSettingsSchema` (key `transit.crew`, por Scope)

```ts
{
  signOnMinutes:               10,   // apresentação antes da 1ª pegada
  signOffMinutes:              5,    // encerramento após a última pegada
  handoverMinutes:             0,    // sobreposição tolerada na troca (rendição)
  minPieceMinutes:             60,
  maxContinuousDrivingMinutes: 300,
  nightStartHour:              22,   // janela noturna 22h–5h (hora do relógio) —
  nightEndHour:                5,    // só nightMinutes informativo
  range: {
    workTime:       { active, modifier, floor: 360, idealMin: 440, idealMax: 550, ceiling: 560 },
    spread:         { ...,                                                        ceiling: 780 }, // amplitude
    mealBreak:      { floor: 60, idealMin: 70, idealMax: 110, ceiling: 120 },
    splitInterval:  { floor: 60, idealMin: 60, idealMax: 240, ceiling: 250 },
    overtimeRatio:  { ... },  // % de minutos extras sobre o total trabalhado
    splitRatio:     { ... },  // % de jornadas SPLIT
    vehicleChanges: { ... },  // trocas de carro por jornada
  },
  anchored: {
    dutyCount:  { ... },  // realizado / mínimo teórico (horas de bloco ÷ workTime.idealMin)
    efficiency: { ... },  // minutos pagos / minutos de bloco cobertos
  },
}
```

Valores dos critérios novos (`spread`, `overtimeRatio`, `splitRatio`, `vehicleChanges`,
`anchored.*`) a calibrar. As faixas geram as issues (fora do ideal → `warning`, fora de
floor/ceiling → `error`) e o score do plano.

### `rosterSettingsSchema` (key `transit.roster`, global)

Só `interShiftRest`, `driverPrefLine`, `driverPrefTech` — sem consumo nesta etapa.

### Settings por Scope de transit

A tabela `Settings (key, scope)` já suporta isso; falta o modo no `BaseSettingsService`,
que hoje só entende `'global' | 'branch'`. Proposta: terceiro modo `'transitScope'`
(`Settings.scope = Scope.id`, fallback para `global`), sem coluna nova em `Scope`. A página
`transit/settings` ganha seletor de Scope na aba de escala (em vez do seletor de branch).

---

## Validações estruturais (bloqueiam o save — 400)

Tudo que torna o dado **inconsistente**, não "fora da regra":

- Início/fim da pegada fora de ponto de troca válido (pontas da rota ou `allowsCrewChange`
  da viagem em curso naquele minuto). A UI já só oferece pontos válidos.
- Pegada fora da janela do bloco.
- Pegadas da mesma jornada sobrepostas entre si ou com atividades da mesma jornada — exceto
  `BREAK` dentro de uma pegada, desde que inteiro no tempo parado do carro (fora de viagens e
  deadruns do bloco): o tripulante descansa com o carro (`duty-occupancy.utils.ts`).
- Duas pegadas do **mesmo papel** cobrindo o mesmo trecho do mesmo bloco (tolerância
  `handoverMinutes`).
- `BREAK` sem `intervalTypeId`.

Pegada que **fica** inválida depois (edição do `VehiclePlan`) não é erro de save — vira
**stale**.

---

## Rename `VehiclePlan.metrics → settings`

Referências levantadas (só as do `VehiclePlan`; `TransitLine.metrics` **não** muda):

| Arquivo | Ponto |
|---|---|
| `apps/api/prisma/schema/transit.prisma` | campo + comentário ("per-plan override snapshot") |
| `packages/schemas/transit/vehicle-plan.schema.ts:128` | campo `metrics` do schema |
| `apps/api/src/modules/transit/timetabling/vehicle-plan/vehicle-plan.service.ts` | `:54` comentário, `:59` strip do dto, `:155-156`, `:376`, `:474`, `:531`, `:591` (`planMetrics`), `:632` (duplicate) |
| `apps/web/src/app/transit/vehicle-plan/[id]/page.tsx:194` | `hasCustomMetrics` |
| `apps/web/src/app/transit/vehicle-plan/[id]/hooks/useSolverController.ts:99` | `{ metrics: null }` (limpar customização) |
| `apps/web/src/app/transit/vehicle-plan/[id]/components/OptimizeModal.tsx:149` | comentário "custom metrics notice" |
| `docs/architecture/transit/solver.md` | `:58`, `:60`, `:71`, `:326` |

Nomes locais (`planMetrics`, `hasCustomMetrics`) passam para `planSettings` /
`hasCustomSettings`. Migração: `ALTER TABLE ... RENAME COLUMN metrics TO settings` (dado
preservado). Conferir scripts `apps/api/prisma/transit-export.ts` / `transit-import.ts` —
hoje só exportam `TransitLine.metrics`, não o do plano.

---

## Backend — organização

- Prisma: modelos acima em `transit.prisma` + relações inversas em `VehiclePlan`,
  `VehicleBlock`, `TransitLocality`, `IntervalType`, `Branch`.
- Schemas Zod em `packages/schemas/transit/`: `crew-plan.schema.ts`, `duty.schema.ts`,
  `duty-piece.schema.ts`, `duty-activity.schema.ts`, `settings-crew.schema.ts`,
  `settings-roster.schema.ts` (substitui `settings-schedule.schema.ts`). `CrewPlan` declara
  `breadcrumb` apontando para `vehicle-plan` (fica fora do sidebar/discovery).
- Módulo em `apps/api/src/modules/transit/timetabling/crew-plan/` (espelha `vehicle-plan/`):
  `CrewPlanService` (CRUD, activate, duplicate, personalizar/restaurar settings,
  recalculate) + serviços de `Duty`/`DutyPiece`/`DutyActivity`.
- Cálculo puro (sem Prisma) em `crew-scoring.calc.ts`: summary, issues, cobertura, score —
  como `plan-scoring.calc.ts`.
- `VehiclePlanService`: hook pós-save para marcar pegadas stale dos blocos afetados; em
  `activate()` encerrar a `CrewPlan` ACTIVE do plano superado.

## Frontend — esboço

- **Rota própria** `/transit/crew-plan/[id]` — o switch navega entre as duas rotas. As
  páginas de veículos já são grandes e o estado de pendências de cada uma fica isolado.
- **Switch Veículos ⇄ Escala** nas duas telas, liberado só com `pendingCount === 0`. A partir
  do `VehiclePlan`, o switch abre **sempre a `CrewPlan` ACTIVE**. Sem ACTIVE (ex.:
  `VehiclePlan` ainda em DRAFT), abre a mais recente; sem nenhuma, oferece criar.
- **Seletor de versão** na tela de escala para trocar entre as `CrewPlan` do mesmo
  `VehiclePlan` e criar nova (vazia ou duplicando a atual).
- Tela de escala: Gantt dos blocos (somente leitura na parte de veículo) com as pegadas
  coloridas por jornada; trechos descobertos, pegadas stale e pegadas com issue (`pieceId`)
  destacados. Seleção de trecho entre pontos de troca → "atribuir à jornada X / nova
  jornada". Painel lateral da jornada (timeline, summary, issues).
- Interação do Gantt de escala em documento próprio (como `gantt-interaction.md`).

---

## Fases

Fases 1–6 implementadas em 2026-09-26 (migrações `vehicle_plan_settings_rename` e `crew_plan`).
Endpoints de settings por plano já entraram na fase 3: `GET /transit/crew-plan/:id/settings`
(`{ settings, isCustom }`), `POST .../settings/customize`, `PUT .../settings`, `DELETE .../settings`.

Decisões tomadas na implementação (fases 4–6):

- **Stale é derivado**, não um flag persistente limpo só no save: `CrewPlanService.recalculate()`
  re-checa cada pegada contra o bloco atual (bloco existe, janela, ponto de troca) e grava
  `isStale`/`staleReason`. Roda após toda escrita de jornada/pegada/atividade, ao abrir a escala
  (`GET /transit/crew-plan/:id/board?recalculate=1`, só na primeira carga — os refetches após
  edições não recalculam de novo) e após `VehiclePlanService.recalculate()`/`applyDiff`. Grava só
  as linhas cujo estado derivado mudou.
- **Apresentação/encerramento implícitos**: sem atividade `SIGN_ON`/`SIGN_OFF` explícita, o cálculo
  assume `signOnMinutes`/`signOffMinutes` antes da 1ª / depois da última pegada.
- **Intervalos**: só atividades `BREAK`, lançadas manualmente — no vão entre pegadas ou dentro de uma
  pegada (tempo parado do carro). Intervalo dentro da pegada não descobre o carro.
- **Trabalhado × pago**: trabalhado = pegadas menos os intervalos dentro delas + atividades
  não-intervalo + intervalos remunerados (`IntervalType.isPaid`) + apresentação/encerramento; pago =
  trabalhado. Intervalo remunerado continua sendo descanso (corta direção contínua, conta como
  refeição). *(Antes: pago = trabalhado + intervalos pagos — ver `plan_crew_solver_v1.md`, fase 0.)*
- **Local de refeição**: intervalo do tipo `crew.mealBreakIntervalTypeId` fora de parada
  `RouteLocality.allowsMealBreak` na rota da linha que chega ao local →
  `MEAL_LOCATION` (`warning`, com `activityId`); a tela avisa ao lançar. Local derivado: dentro da
  pegada, onde o carro está parado; entre pegadas, fim da anterior.
- **Travar jornada**: `Duty.constraints.locked` (`POST /transit/duty/:id/lock`) — o gerador de
  escala não altera; a edição manual continua livre.
- **Extra** = trabalhado acima de `workTime.idealMin`.
- **Aplicabilidade das regras por tipo de jornada**: `WORK_TIME` não vale para meia jornada/reserva;
  `MEAL_BREAK` só para corrida; `SPLIT_INTERVAL` só para dupla pegada (maior intervalo entre
  pegadas). Direção contínua = soma dos trechos trabalhados (pegadas menos intervalos) encadeados
  até um intervalo entre eles — no vão entre pegadas ou dentro de uma pegada.
- **Cobertura só onde o carro está em serviço**: exige motorista na janela do bloco menos os
  intervalos do próprio carro (`BlockInterval`) e menos o tempo recolhido na garagem entre um
  deadrun `RETURN` e um `ACCESS` seguinte (`serviceSpans` em `relief-points.ts`). Descoberto,
  trava de ativação, `dutyCount` e `efficiency` usam essa mesma base.
- **`TRAVEL_GAP`**: pegadas consecutivas em locais diferentes — `error` se o intervalo é menor que
  a matriz de tempos; `warning` se não há tempo na matriz nem atividade `TRAVEL` declarada.
- **Score**: mesma fórmula do plano de veículos (`rangeV`/`anchoredV`, 0–9999). `dutyCount` ancora
  em ⌈minutos de bloco ÷ `workTime.idealMin`⌉ jornadas de motorista; `efficiency` em minutos de
  bloco cobertos.
- **Tela**: sem fila de pendências — cada ação grava na hora (o switch fica sempre liberado do lado
  da escala). Pegada criada com um clique no ponto de troca de fim: o início é inferido como o começo do
  trecho descoberto anterior (fim da pegada de motorista anterior no carro, ou início do trecho em
  serviço após intervalo/garagem, o que for mais tarde); Shift+clique escolhe o início explicitamente.
  Pontos só são renderizados na linha sob o mouse.
- **Duas visões** (`?view=duties` na URL, seletor "Carros | Jornadas" ao lado de "Veículos"): por
  carro (pegadas coloridas por jornada, trechos sem motorista) e por jornada (uma linha por jornada,
  pegadas coloridas por carro para evidenciar trocas de carro, atividades em estilo neutro, "cabo"
  de apresentação/encerramento implícitos, pegadas órfãs como "Sem bloco", faixa de viagens sob
  cada pegada e intervalos hachurados). Na visão por jornada, clicar num trecho livre — tempo parado
  do carro na faixa de viagens, ou o vão entre duas pegadas — insere um intervalo (modal
  pré-preenchido com o trecho e, como sugestão, o tipo do intervalo do carro se houver); pegadas são criadas pela visão de carros; o resto da edição
  fica no painel lateral.
- **Filtro (F7)** no mesmo formato da barra do plano de veículos, com critérios por visão (carros:
  início/término, operador, "sem motorista"; jornadas: início/término, operador, papel, tipo,
  "com pendências", "desatualizadas") combinados em E; linhas podem ser fixadas (olho) e continuam
  visíveis mesmo filtradas. **Exibir › Cores das linhas** colore as viagens por linha (tom mais
  claro da mesma paleta fosca, cor atribuída pela ordem do código da linha), preferência salva no
  navegador. "Configurações" (topbar) abre um modal com o mesmo editor da página
  de Configurações (`settings/crew-settings-editor.tsx`): herdando, os valores ficam somente
  leitura com a ação "Customizar" (cópia completa); personalizada, os valores são editáveis
  (marcados onde diferem do herdado) com "Salvar" e "Restaurar padrão".

1. **Rename** `VehiclePlan.metrics → settings` (isolado, antes de tudo).
2. **Settings** — `crewSettingsSchema` / `rosterSettingsSchema`, modo `'transitScope'` no
   `BaseSettingsService`, aba de escala na página de settings.
3. **Modelo** — Prisma + migração, schemas Zod, services/controllers CRUD + validações
   estruturais.
4. **Cálculo** — `crew-scoring.calc.ts`: summary, issues, cobertura, score.
5. **Integração com VehiclePlan** — stale no save do plano, encerramento na supersessão,
   regra de ativação.
6. **Tela** — Gantt de escala, switch Veículos ⇄ Escala, edição de jornadas.

## Fora desta etapa

- Solver de escala (usa `generatedAt`, `constraints`).
- Escala nominal (`Employee` × data × `Duty`), rodízios, folgas, preferências
  (`transit.roster`).
- "Bloco exige cobrador/auxiliar" (cobertura obrigatória para outros papéis).
- Hora reduzida / adicional noturno no cálculo de pagos.
- Import de dados de tripulação do arquivo do software externo (marcador `'2'`, `tabId`,
  `driverCode` — ver `docs/architecture/transit/vehicle-plan-import.md`) — o import segue
  ignorando o marcador `'2'`, sem mudança nesta etapa.
- Copiar escala entre `VehiclePlan` diferentes (remapeamento por `blockNumber`).
