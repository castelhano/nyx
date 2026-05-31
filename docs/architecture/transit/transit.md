# Transit — Arquitetura do Domínio

> Referência completa do domínio `transit`. Cobre modelagem de dados, regras de negócio, arquitetura do solver e checklist de implementação por fase.

---

## 1. Visão Geral

O domínio `transit` implementa um sistema de planejamento e escala para operadoras de transporte. O objetivo central é partir de um cadastro de linhas e viagens e gerar automaticamente um **planejamento de veículos otimizado** — atribuindo viagens a blocos de veículo buscando o menor número possível de veículos dentro de restrições configuráveis.

### Princípio de separação de responsabilidades

| Camada | O que representa | Vínculo com empresa |
|---|---|---|
| Rede (locality, line, route) | Infraestrutura física e linhas | Nenhum — dados neutros |
| Timetable (trip, dayType) | Horários por tipo de dia | Nenhum — templates reutilizáveis |
| Planejamento (vehiclePlan, block) | Alocação de veículos às trips | Branch entra no `VehicleBlock` |
| Escala Padrão | Planejamento de veículos e condutores | Fase 2 |
| Escala diária | Snapshot para execução real | Fase 3 |

A empresa (branch) não é proprietária de linhas ou horários. Ela opera **blocos** de veículos. Isso permite operação compartilhada de linhas entre empresas sem duplicação de dados.

### Fases planejadas

| Fase | Escopo | Status |
|---|---|---|
| **1 — Rede e Timetabling** | Cadastro de rede, viagens, geração de blocos de veículo | 🔄 Em andamento |
| **2 — Escala de Motoristas** | Criação de turnos, atribuição de condutores sobre os blocos gerados | ⏳ Futuro |
| **3 — Escala Diária** | Snapshot diário para execução real; atribuição nominal de condutores e veículos | ⏳ Futuro |

---

## 2. Modelo de Dados

### 2.1 Camada de Rede (cadastro estático)

```
TransitLocality ──── TravelTimeMatrix ────┐
       │                                  │
       └── RouteLocality ◄── TransitRoute ◄── TransitLine
```

#### `TransitLocality` — ponto ou terminal nomeado

Global — não vinculada a nenhuma empresa. O mesmo ponto pode ser referenciado por linhas de qualquer operadora.

| Campo | Tipo | Notas |
|---|---|---|
| `code` | String? | código operacional opcional |
| `name` | String | nome exibido em relatórios |
| `lat` / `lng` | Float | coordenadas para OSRM |
| `isDepot` | Boolean | marca garagens |

#### `TransitLine` — linha de transporte

Global — não vinculada a filial. A empresa que opera os veículos nessa linha é definida no `VehicleBlock`, não aqui.

| Campo | Tipo | Notas |
|---|---|---|
| `code` | String `@unique` | código operacional único globalmente |
| `name` | String | — |
| `type` | Enum | URBAN / METROPOLITAN / RURAL / SPECIAL |
| `isActive` | Boolean | — |

#### `TransitRoute` — sentido de uma linha

Cada `TransitLine` tem 1-N `TransitRoutes`. Um sentido define uma direção de operação e a sequência de pontos percorridos.

| Campo | Tipo | Notas |
|---|---|---|
| `lineId` | FK TransitLine | — |
| `direction` | Enum | OUTBOUND / INBOUND / CIRCULAR |
| `name` | String | ex: "Sentido Centro" |
| `originLocalityId` | FK TransitLocality | — |
| `destinationLocalityId` | FK TransitLocality | — |

#### `RouteLocality` — ponto de referência na rota

Join table entre `TransitRoute` e `TransitLocality`. Representa os pontos percorridos na ordem correta.

| Campo | Tipo | Notas |
|---|---|---|
| `routeId` | FK TransitRoute | — |
| `localityId` | FK TransitLocality | — |
| `sequence` | Int | ordem no percurso |
| `deltaMinutes` | Int? | tempo desde o ponto anterior; `null` → fallback TravelTimeMatrix |
| `deltaKm` | Float? | distância desde o ponto anterior; `null` → fallback TravelTimeMatrix |
| `allowsCrewChange` | Boolean | troca de turno permitida neste ponto (usado na Fase 2) |

**Regra do fallback:**
```
deltaMinutes resolvido =
  RouteLocality.deltaMinutes        // específico da linha (manual)
  ?? TravelTimeMatrix(prev, curr).baseMinutes  // matriz global OSRM
  ?? erro — par sem dados
```

#### `TravelTimeMatrix` — matriz de tempos entre localidades

Global — não vinculada a filial. Cobre os pares de localidades **efetivamente necessários** (ver §5).

| Campo | Tipo | Notas |
|---|---|---|
| `originId` | FK TransitLocality | — |
| `destinationId` | FK TransitLocality | — |
| `baseMinutes` | Float | tempo base (OSRM ou manual) |
| `distanceKm` | Float | distância (OSRM ou manual) |
| `peakMultiplier` | Float | multiplicador para horário de pico (default 1.0) |
| `source` | Enum | OSRM / MANUAL |

**Constraint:** `@@unique([originId, destinationId])` — um registro por par de pontos.

**Usos da matriz:**

| Uso | Fonte | Para quê |
|---|---|---|
| Dead run do solver | `TravelTimeMatrix.baseMinutes` | Veículo pode ir do fim da viagem A ao início da B? |
| Relatório de passagem | `RouteLocality.deltaMinutes` (ou fallback) | Horário em cada ponto do itinerário |

---

### 2.2 Camada de Programação (viagens e calendário)

```
DayType ◄────────── TransitTrip ──► TransitRoute
   │
   └── LineCalendarException ──► TransitLine (N-N)
```

#### `DayType` — tipo de dia operacional

Global. Os mesmos tipos de dia são compartilhados por toda a operação.

| Campo | Tipo | Notas |
|---|---|---|
| `code` | String | único globalmente; ex: `UTIL`, `SAB`, `DOM` |
| `name` | String | ex: "Dia Útil", "Sábado" |
| `description` | String? | — |
| `pattern` | Json? | `DayTypePattern` — define quais dias do calendário este tipo cobre; `null` = sem resolução automática (ex: FERIAS) |
| `priority` | Int | ordem de prioridade na resolução automática — número menor = maior prioridade quando dois padrões cobrem a mesma data |
| `sortOrder` | Int | ordem de exibição em selects e relatórios |

**`DayTypePattern` — shape do campo `pattern`:**

```typescript
type DayTypePattern =
  | { type: 'weekdays'; days: number[] }
  // days usa ISO weekday: 1=seg … 7=dom
  // ex: UTIL → { type: 'weekdays', days: [1,2,3,4,5] }

  | { type: 'month_window'; anchor: 'start' | 'end'; days: number; baseWeekdays?: number[] }
  // ex: primeiros 15 dias úteis → { type: 'month_window', anchor: 'start', days: 15, baseWeekdays: [1,2,3,4,5] }
```

`pattern: null` — tipo sem resolução automática. Entra em cena apenas via `LineCalendarException` (ex: FERIAS, ESPECIAL).

**Resolução de DayType para uma data real:**
1. Existe `LineCalendarException` ativa para essa data cobrindo a linha? → usa `overrideDayTypeId`
2. Avalia os `DayType` com `pattern` não-nulo em ordem crescente de `priority`; primeiro match ganha
3. Fallback: tipos base por dia da semana (UTIL / SAB / DOM)

#### `LineCalendarException` — exceção de calendário por linha

Define períodos em que um conjunto de linhas opera com um tipo de dia diferente do padrão (ex: férias escolares).

| Campo | Tipo | Notas |
|---|---|---|
| `validFrom` | DateTime | início do período de exceção |
| `validTo` | DateTime? | fim do período; `null` = sem data de término |
| `sourceDayTypeId` | FK DayType? | tipo base a ser sobregravado; `null` sobregrava todos os dias no intervalo |
| `overrideDayTypeId` | FK DayType | tipo de dia a usar neste período |
| `notes` | String? | — |

#### `LineCalendarExceptionLine` — escopo de linhas da exceção

Join table M-N entre `LineCalendarException` e `TransitLine`.

| Campo | Tipo | Notas |
|---|---|---|
| `exceptionId` | FK LineCalendarException | cascade delete |
| `lineId` | FK TransitLine | — |

#### `TransitTrip` — viagem avulsa (átomo do planejamento)

Template permanente por `Route + DayType`. Não possui vínculo com empresa nem com vigência — é um dado técnico da linha. O solver consome trips filtradas pelo escopo do `VehiclePlan`.

| Campo | Tipo | Notas |
|---|---|---|
| `dayTypeId` | FK DayType | — |
| `routeId` | FK TransitRoute | — |
| `departureMinutes` | Int | minutos desde o início do dia operacional |
| `arrivalMinutes` | Int | pode ser > 1440 para viagens que cruzam a meia-noite |
| `requiredVehicleType` | Enum? | solver consolida viagens com mesmo tipo |
| `constraints` | Json? | ver §2.4 |

**Dia operacional:** começa no horário configurado em `PlanningConfig.operationalDayStartHour` (padrão: 04h00).

```
// Exemplos com operationalDayStartHour = 4 (04h00)
23:00 → departureMinutes = (23 - 4) * 60 = 1140
00:10 → departureMinutes = (24 - 4) * 60 + 10 = 1210
04:00 → departureMinutes = 0  (início do próximo dia operacional)
```

#### `PlanningConfig` — configuração de geração (BaseSettingsService)

Settings singleton por filial com fallback global.

| Grupo | Campos |
|---|---|
| Dia Operacional | `operationalDayStartHour` |
| Intervalos | `minLayoverMinutes`, `maxLayoverMinutes` |
| Deslocamento em Vazio | `maxDeadrunSoftMinutes`, `maxDeadrunHardMinutes` |
| Duração do Bloco | `blockDurationMinMinutes`, `blockDurationIdealMinMinutes`, `blockDurationIdealMaxMinutes`, `blockDurationMaxMinutes` |
| Pesos de Otimização | `weightMinimizeFleet`, `weightMinimizeDeadrun`, `weightBlockDuration` |
| Critério de Parada | `stopNoImprovementMinutes`, `stopMaxTotalMinutes` |

---

### 2.3 Camada de Output (planejamento gerado)

```
VehiclePlan ──── VehiclePlanLine ──► TransitLine
    └── VehicleBlock (branchId nullable — empresa que opera)
            └── BlockTrip
```

#### `VehiclePlan` — resultado de uma execução do solver

| Campo | Tipo | Notas |
|---|---|---|
| `dayTypeId` | FK DayType | tipo de dia que este plano cobre |
| `status` | Enum | DRAFT / ACTIVE |
| `summary` | Json? | preenchido pelo solver ao assumir: `{ fleetCount, score, deadrunKm, ... }` — extensível sem migrations |
| `generatedAt` | DateTime? | momento em que o melhor resultado foi assumido |
| `constraints` | Json? | ver §2.4 |
| `notes` | String? | — |

**Regra de negócio — ACTIVE:**
- Múltiplos `DRAFT` são permitidos por `dayTypeId` (comparação de cenários)
- Uma linha não pode estar em dois `VehiclePlan ACTIVE` do mesmo `dayTypeId`
- Enforcement no service layer ao ativar (`POST /:id/activate`)

#### `VehiclePlanLine` — escopo de linhas do plano

Define quais linhas o solver considera ao gerar este plano. Necessário também para filtrar "todos os planos que cobrem a linha X".

| Campo | Tipo | Notas |
|---|---|---|
| `vehiclePlanId` | FK VehiclePlan | cascade delete |
| `lineId` | FK TransitLine | — |

#### `VehicleBlock` — sequência de trabalho de um veículo

| Campo | Tipo | Notas |
|---|---|---|
| `vehiclePlanId` | FK VehiclePlan | cascade delete |
| `branchId` | FK Branch? | empresa que opera este bloco; `null` = ainda não atribuído |
| `blockNumber` | Int | identificador dentro do plano |
| `depotId` | FK TransitLocality | garagem de origem e retorno |
| `vehicleType` | Enum | tipo de veículo alocado |
| `summary` | Json? | preenchido pelo solver: `{ totalMinutes, totalKm, deadrunKm, ... }` |
| `constraints` | Json? | ver §2.4 |

**Atribuição de empresa:**
- O solver preenche `branchId` automaticamente quando o escopo do plano tem uma única empresa definida
- Em planejamento compartilhado entre empresas, `branchId` fica `null` e o usuário atribui manualmente
- Blocos sem `branchId` são ignorados na geração da escala diária (Fase 3)

#### `BlockTrip` — viagem (comercial ou em vazio) dentro de um bloco

| Campo | Tipo | Notas |
|---|---|---|
| `vehicleBlockId` | FK VehicleBlock | cascade delete |
| `tripId` | FK TransitTrip | — |
| `sequence` | Int | posição no bloco |
| `isDeadhead` | Boolean | true = deslocamento em vazio |
| `deadheadMinutes` | Int? | tempo do dead run (da TravelTimeMatrix) |
| `deadheadKm` | Float? | distância do dead run (da TravelTimeMatrix) |

---

### 2.4 Sistema de Restrições (`constraints: Json`)

Campos `constraints` evitam proliferação de booleans. Cada model tem seu shape documentado.

#### `TransitTrip.constraints`

```typescript
interface TripConstraints {
  locked?: string[]     // campos imutáveis para o solver
                        // ex: ['departureMinutes', 'arrivalMinutes']
  pinnedBlock?: string  // UUID do VehicleBlock — trip não pode ser movida
}
```

#### `VehicleBlock.constraints`

```typescript
interface VehicleBlockConstraints {
  locked?: true   // bloco inteiro congelado — trips não podem ser reassinaladas
}
```

#### `VehiclePlan.constraints`

```typescript
interface VehiclePlanConstraints {
  locked?: true   // plano inteiro congelado — não pode ser reprocessado
}
```

**Precedência aplicada pelo solver (maior → menor):**

1. `VehiclePlan.constraints.locked` → ignora o plano, não roda
2. `VehicleBlock.constraints.locked` → mantém o bloco inteiro intacto
3. `Trip.constraints.pinnedBlock` → mantém a trip no bloco especificado
4. `Trip.constraints.locked` contém `'departureMinutes'` → não ajusta horário

---

## 3. Solver VSP — Arquitetura

O solver resolve o **Vehicle Scheduling Problem (VSP)**: dada uma lista de viagens (filtradas pelo escopo do `VehiclePlan`), distribui-as entre o menor número possível de veículos respeitando restrições de tempo e frota.

### 3.1 Fluxo geral

```
Usuario seleciona linhas e dayType → cria VehiclePlan com VehiclePlanLines
        │
        ▼
Usuario clica "Gerar"
        │
        ▼
POST /transit/vehicle-plan/:id/generate
        │
        ├── busca trips via VehiclePlanLine → TransitLine → TransitRoute → TransitTrip
        ├── busca TravelTimeMatrix completa (subconjunto relevante — ver §5)
        ├── gera jobId
        └── inicia Worker Thread com config + trips + matrix
                │
                ▼
        Worker avalia combinações em loop
        ├── score > bestScore? → atualiza best, posta 'improvement'
        ├── a cada tentativa → posta 'progress'
        └── critério de parada atingido? → posta 'done'
                │
                ▼
GET /transit/vehicle-plan/:id/stream  (SSE)
        │  recebe eventos do Worker via MessagePort
        └── cliente vê: { attempt, bestScore, bestFleet, deadrunKm, elapsed }

Usuario clica "Assumir Melhor"
        │
        ▼
POST /transit/vehicle-plan/:id/assume
        └── persiste o best atual → VehicleBlocks criados (branchId: null)
            plan.summary = { fleetCount, score, deadrunKm }
            block.summary = { totalMinutes, totalKm } por bloco

Usuario atribui empresa(s) aos blocos → status permanece DRAFT até ativar

Usuario clica "Ativar"
        │
        ▼
POST /transit/vehicle-plan/:id/activate
        └── valida que nenhuma linha do escopo já está em outro ACTIVE do mesmo dayType
            → status ACTIVE
```

### 3.2 Worker Thread

O solver roda em `worker_threads` do Node — não bloqueia o event loop do NestJS.

```typescript
// apps/api/src/modules/transit/timetabling/solver/solver.worker.ts
import { workerData, parentPort } from 'worker_threads'

// Mensagens recebidas do main thread
// { type: 'stop' }

// Mensagens enviadas ao main thread
// { type: 'progress',    attempt, bestScore, bestFleet, deadrunKm, elapsed }
// { type: 'improvement', scenario: SolverResult, score, fleetCount, deadrunKm }
// { type: 'done',        stopReason: 'no_improvement' | 'max_time' | 'user_stopped' }
```

### 3.3 Critérios de parada

| Critério | Campo | Comportamento |
|---|---|---|
| Sem melhora | `stopNoImprovementMinutes` | Encerra se nenhum candidato melhor for encontrado neste intervalo |
| Tempo total | `stopMaxTotalMinutes` | Encerra independentemente do progresso |
| Manual | — | Usuário clica "Parar" → `POST .../stop` → worker recebe `{ type: 'stop' }` |

### 3.4 Função de pontuação

```
score = 100
      - Σ penalidade_bloco_fora_da_faixa_ideal × weightBlockDuration
      - Σ dead_run_acima_do_soft × weightMinimizeDeadrun
      - frota_utilizada × weightMinimizeFleet
```

**Violações duras** (descartam o candidato):
- Bloco fora de `[blockDurationMinMinutes, blockDurationMaxMinutes]`
- Dead run acima de `maxDeadrunHardMinutes`
- Intervalo entre viagens abaixo de `minLayoverMinutes`
- Violação de `requiredVehicleType`
- Violação de `constraints.pinnedBlock`

**Violações suaves** (penalizam a pontuação):
- Dead run acima de `maxDeadrunSoftMinutes`
- Intervalo acima de `maxLayoverMinutes`
- Bloco fora da faixa ideal `[idealMin, idealMax]`

### 3.5 Autenticação SSE

`EventSource` nativo não suporta headers customizados:
- Token JWT passado como query param: `GET /stream?token=<jwt>` (MVP)
- Antes de produção: migrar para `httpOnly` cookie-based auth

### 3.6 Isolamento por job

Múltiplas gerações simultâneas suportadas via `Map<jobId, { worker, best }>`.

---

## 4. Relatórios

### 4.1 Relatório de passagem (condutor)

Para uma `TransitTrip`, calcula o horário em cada `RouteLocality`:

```
horário_ponto[0] = Trip.departureMinutes
horário_ponto[n] = horário_ponto[n-1] + delta_resolvido(n-1, n)
```

### 4.2 Relatório de fiscal (por localidade)

Para uma `TransitLocality`, lista todas as viagens que passam por ela em ordem de horário:

```sql
SELECT rl.*, tt.*
FROM transit_route_localities rl
JOIN transit_trips tt ON tt.routeId = rl.routeId
WHERE rl.localityId = :localityId
  AND tt.dayTypeId  = :dayTypeId
ORDER BY tt.departureMinutes + Σ(deltas até rl.sequence)
```

### 4.3 Km prevista do projeto

```
km_vazio_plano     = Σ BlockTrip.deadheadKm WHERE isDeadhead = true
km_comercial_plano = Σ TravelTimeMatrix.distanceKm para cada trip no plano
```

---

## 5. Integração OSRM

### Endpoint utilizado

```
GET http://osrm-server/table/v1/driving/{lon1,lat1;lon2,lat2;...}
    ?annotations=duration,distance
```

### Subconjunto de localidades calculado

A matriz **não** é gerada para todas as localidades cadastradas. Apenas os pares entre localidades efetivamente necessárias são calculados:

| Conjunto | Por quê |
|---|---|
| `isDepot = true` | Dead runs garagem → início de viagem e fim de viagem → garagem |
| `TransitRoute.originLocalityId` | Ponto de partida de viagens produtivas |
| `TransitRoute.destinationLocalityId` | Ponto de chegada de viagens produtivas |
| Todos os `RouteLocality.localityId` | Fallback de `deltaMinutes` para pontos de passagem |

> **Fase 2:** localidades com `RouteLocality.allowsCrewChange = true` já estão cobertas pelo conjunto de `RouteLocality` acima — nenhuma alteração necessária quando a escala de motoristas for implementada.

### Fluxo de atualização da matriz

1. `TransitLocality` criada ou lat/lng atualizado
2. Job assíncrono chama `OsrmService.generateMatrix()`
3. Coleta o subconjunto relevante de localidades (depots + route endpoints + waypoints)
4. Dispara chamada OSRM `/table` com essas coordenadas
5. Converte: segundos → minutos, metros → km
6. `upsert` em `TravelTimeMatrix` com `source: 'OSRM'`
7. Entradas com `source: 'MANUAL'` **não são sobrescritas**

### Configuração

```
# apps/api/.env
OSRM_URL=http://localhost:5000
```

---

## 6. Estrutura de Módulos NestJS

```
apps/api/src/modules/transit/
  transit.module.ts              @Domain({ label: 'Trânsito', icon: 'Bus' })
  network/
    network.module.ts
    locality/
      locality.service.ts        extends BaseService (sem scopeField — global)
      locality.controller.ts     extends BaseController
    line/
      line.service.ts            extends BaseService (sem scopeField — global)
      line.controller.ts         extends BaseController
    route/
      route.service.ts
      route.controller.ts
    route-locality/
      route-locality.service.ts
      route-locality.controller.ts
    travel-time/
      travel-time.service.ts     extends BaseService (sem scopeField — matriz global)
      travel-time.controller.ts  extends BaseController
      osrm.service.ts            generateMatrix() — subconjunto relevante, upsert global
  timetabling/
    timetabling.module.ts
    day-type/
      day-type.service.ts        extends BaseService (sem scopeField — global)
      day-type.controller.ts
    line-calendar-exception/
      calendar-exception.service.ts
      calendar-exception.controller.ts
    trip/
      trip.service.ts            extends BaseService (sem scopeField — trips são globais)
      trip.controller.ts
    vehicle-plan/
      vehicle-plan.service.ts    NÃO extends BaseService — lógica custom
      vehicle-plan.controller.ts NÃO extends BaseController — endpoints SSE + ativação
      solver/
        solver.worker.ts         worker_threads — loop de otimização
        solver.types.ts          SolverResult, SolverConfig, SolverMessage
    settings/
      planning-config/
        planning-config.service.ts    extends BaseSettingsService
        planning-config.controller.ts extends BaseSettingsController
```

---

## 7. Checklist de Implementação — Fase 1

### Etapa 1 — Infraestrutura e migração ✅

- [x] Criar `TransitModule` com `@Domain({ label: 'Trânsito', icon: 'Bus' })`
- [x] Registrar `TransitModule` em `AppModule`
- [x] Criar `NetworkModule` e `TimetablingModule` como sub-módulos
- [x] Executar `pnpm db:migrate` para aplicar `transit.prisma`

### Etapa 2 — Rede (NetworkModule) ✅

- [x] `LocalityService` / `LocalityController`
- [x] `LineService` / `LineController` — sem `scopeField`; linha é global
- [x] `RouteService` / `RouteController`
- [x] `RouteLocalityService` / `RouteLocalityController`
- [x] `TravelTimeService` / `TravelTimeController` — sem `scopeField`; matriz é global
- [x] `OsrmService.generateMatrix()` — opera sobre subconjunto relevante de localidades

### Etapa 3 — Programação (TimetablingModule) ⚠️ parcialmente pendente

- [x] `DayTypeService` / `DayTypeController`
- [x] Campo `pattern` no schema Zod de `DayType`
- [x] Campo `priority` no schema Zod e Prisma de `DayType`
- [x] `CalendarExceptionService` / `CalendarExceptionController`
- [x] `TripService` / `TripController` — sem `scopeField`; trips são globais
- [x] `PlanningConfigService` extends `BaseSettingsService`
- [x] `PlanningConfigController` extends `BaseSettingsController`
- [ ] Implementar lógica de resolução de `DayType` para data real (usar `priority` + `pattern`)

### Etapa 4 — Solver ⚠️ parcialmente pendente

- [x] Tipos em `solver.types.ts`
- [x] `solver.worker.ts` com loop, score, constraints, critérios de parada
- [x] `VehiclePlanService.generate()` — busca trips via `VehiclePlanLine → lineId → route → trip`
- [x] `VehiclePlanService.assumeBest()` — persiste blocos com `summary` JSON
- [x] `VehiclePlanService.activate()` — valida sobreposição de linhas; status `ACTIVE`
- [x] `VehiclePlanController` — endpoints: `generate`, `stream` (SSE), `assume`, `stop`, `activate`
- [ ] `VehicleBlock.branchId` — preencher automaticamente no `assumeBest()` quando o escopo do plano tiver empresa única

### Etapa 5 — Relatórios

- [ ] `GET /transit/report/passage?tripId=`
- [ ] `GET /transit/report/inspector?localityId=&dayTypeId=`
- [ ] `GET /transit/report/plan-km?vehiclePlanId=`

### Etapa 6 — Frontend

- [x] Páginas genéricas (AutoList + AutoForm) para todos os resources CRUD
- [ ] Página customizada `app/transit/vehicle-plan/[id]/page.tsx`:
  - [ ] Seleção de linhas (escopo) e dayType ao criar o plano
  - [ ] Topbar: Gerar / Parar / Assumir Melhor / Ativar
  - [ ] Painel de progresso SSE
  - [ ] Lista de blocos com atribuição de empresa por bloco (ou em lote)
  - [ ] Indicadores visuais de constraints (lock icons)

---

## 8. Decisões de Arquitetura Registradas

| Decisão | Escolha | Razão |
|---|---|---|
| Branch em linhas e trips | Não — dados neutros | Linhas podem ser operadas por múltiplas empresas; duplicar por branch seria redundante |
| Branch no planejamento | `VehicleBlock.branchId` (nullable) | A empresa opera blocos, não linhas; atribuição feita após geração pelo solver |
| Escopo do solver | `VehiclePlanLine` M-N com `TransitLine` | Permite gerar plano para 1 linha, N linhas ou toda a rede sem modelos separados |
| Constraint de plano único | Uma linha não pode estar em dois ACTIVE do mesmo dayType | Enforcement no service layer; permite múltiplos DRAFTs para comparação |
| Status do VehiclePlan | `DRAFT` / `ACTIVE` apenas | Estados intermediários (processing, ready) são transientes — gerenciados em memória via jobs Map, não persistidos |
| Histórico de planejamentos | Não mantido | Planejamento ACTIVE substitui o anterior; a escala diária (Fase 3) é o snapshot permanente |
| Versão de trips | Não versionada no plano | Trip é um template permanente; a escala diária é o snapshot com dados copiados |
| Exceção de calendário | `LineCalendarException` com intervalo + linhas | Substitui `ServicePeriod`; responsabilidade única: override de dayType por linha e período |
| `DayType.pattern` | `Json?` com shape documentado | Permite resolução automática de dayType para datas reais sem depender de convenção de código |
| `DayType.priority` vs `sortOrder` | Campos separados | `priority` controla resolução de conflito de padrões; `sortOrder` controla apenas exibição em UI |
| Métricas do plano/bloco | `summary Json?` | Campo único extensível — evita migrations para cada nova métrica que o solver calcular |
| Tempo das viagens | Minutos desde início do dia operacional (Int) | Evita ambiguidade de timezone e virada de dia |
| Matriz de tempos | Global, subconjunto relevante | Depots + endpoints de rota + waypoints — não gera pares desnecessários para centenas de localidades |
| Worker do solver | `worker_threads` Node.js | Não bloqueia event loop; NestJS continua respondendo |
| SSE auth | Query param `?token=jwt` (MVP) | EventSource não suporta headers; migrar para cookie em produção |
| PlanningConfig | BaseSettingsService com scope branch + global | Reutiliza infraestrutura existente; fallback global automático |

---

## 9. Referências

- `docs/architecture/ARCHITECTURE.md` — arquitetura geral do sistema
- `apps/api/prisma/schema/transit.prisma` — modelos Prisma
- `packages/schemas/transit/` — schemas Zod de todos os resources
