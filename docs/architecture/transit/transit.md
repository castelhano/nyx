# Transit — Arquitetura do Domínio

> Referência completa do domínio `transit`. Cobre modelagem de dados, regras de negócio, arquitetura do solver e checklist de implementação por fase.

---

## 1. Visão Geral

O domínio `transit` implementa um sistema de planejamento e escala para empresas de transporte urbano. O objetivo central é partir de um cadastro de linhas e viagens avulsas e gerar automaticamente um **planejamento de veículos otimizado** — atribuindo viagens a blocos de veículo buscando a melhor combinação possível dentro de restrições configuráveis.

### Fases planejadas

| Fase | Escopo | Status |
|---|---|---|
| **1 — Rede e Timetabling** | Cadastro de rede, viagens, geração de blocos de veículo | 🔄 Em andamento |
| **2 — Escala de Motoristas** | Criação de turnos, atricuição de condutores e veiculos (planejados) sobre os blocos gerados | ⏳ Futuro |
| **3 — Plantão / Duty Roster** | Gestão de quem está de serviço em cada dia real | ⏳ Futuro |

---

## 2. Modelo de Dados

### 2.1 Camada de Rede (cadastro estático)

```
TransitLocality ──── TravelTimeMatrix ────┐
       │                                  │
       └── RouteLocality ◄── TransitRoute ◄── TransitLine
       └── DepotFleet
```

#### `TransitLocality` — ponto ou terminal nomeado

| Campo | Tipo | Notas |
|---|---|---|
| `branchId` | FK Branch | scoping por filial |
| `code` | String? | código operacional opcional |
| `name` | String | nome exibido em relatórios |
| `lat` / `lng` | Float | coordenadas para OSRM |
| `isDepot` | Boolean | marca garagens |

#### `TransitLine` — linha de transporte

| Campo | Tipo | Notas |
|---|---|---|
| `branchId` | FK Branch | scoping |
| `code` | String | único por filial |
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
| `allowsCrewChange` | Boolean | troca de turno permitida **nesta linha** neste ponto |

**Regra do fallback:**
```
deltaMinutes resolvido =
  RouteLocality.deltaMinutes        // específico da linha (manual)
  ?? TravelTimeMatrix(prev, curr).baseMinutes  // matriz OSRM
  ?? erro — par sem dados
```

O mesmo vale para `deltaKm`. Isso separa o tempo de percurso *comercial* (para relatórios de passagem) do tempo de deslocamento *entre quaisquer dois locais* (para o solver VSP).

#### `TravelTimeMatrix` — matriz de tempos entre localidades

Cobre todos os pares de localidades, incluindo pares entre linhas diferentes (fundamental para o solver calcular dead runs). Gerada automaticamente via OSRM, com override manual por par.

| Campo | Tipo | Notas |
|---|---|---|
| `branchId` | FK Branch | scoping |
| `originId` | FK TransitLocality | — |
| `destinationId` | FK TransitLocality | — |
| `baseMinutes` | Float | tempo base (OSRM ou manual) |
| `distanceKm` | Float | distância (OSRM ou manual) |
| `peakMultiplier` | Float | multiplicador para horário de pico (default 1.0) |
| `source` | Enum | OSRM / MANUAL |

**Geração da matriz via OSRM:**

```
GET /table/v1/driving/{coordinates}?annotations=duration,distance
```

- Endpoint `/table` do OSRM recebe N coordenadas e retorna matriz N×N
- Uma chamada preenche todos os pares
- Chamada disparada automaticamente quando localidades são criadas/atualizadas
- Resultado persistido na tabela — override manual por par é possível

**Dois usos distintos da matriz:**

| Uso | Fonte | Para quê |
|---|---|---|
| Relatório de passagem | `RouteLocality.deltaMinutes` (ou fallback) | Horário em cada ponto do itinerário |
| Dead run do solver | `TravelTimeMatrix.baseMinutes` | Veículo pode ir do fim da viagem A ao início da B? |

#### `DepotFleet` — contingente de veículos por garagem

| Campo | Tipo | Notas |
|---|---|---|
| `branchId` | FK Branch | scoping |
| `localityId` | FK TransitLocality | deve ser uma locality com `isDepot: true` |
| `vehicleType` | Enum | BUS / MICRO_BUS / MINIBUS / VAN |
| `quantity` | Int | veículos disponíveis deste tipo nesta garagem |

O solver usa esta tabela para saber quantos veículos de cada tipo estão disponíveis por garagem.

---

### 2.2 Camada de Programação (viagens e configuração)

```
DayType ◄── TransitTrip ──► TransitRoute
               │
ServicePeriod ─┘
```

#### `DayType` — tipo de dia operacional

| Campo | Tipo | Notas |
|---|---|---|
| `branchId` | FK Branch | — |
| `code` | String | ex: "DU", "SA", "DO" |
| `name` | String | ex: "Dia Útil", "Sábado" |
| `sortOrder` | Int | ordem de exibição em selects |

#### `ServicePeriod` — período de vigência do quadro

| Campo | Tipo | Notas |
|---|---|---|
| `branchId` | FK Branch | — |
| `name` | String | ex: "Jan–Mar 2026" |
| `validFrom` | DateTime | — |
| `validTo` | DateTime? | — |
| `status` | Enum | DRAFT / ACTIVE / ARCHIVED |

#### `TransitTrip` — viagem avulsa (átomo do planejamento)

As viagens são cadastradas sem atribuição de veículo. O solver as distribui entre blocos.

| Campo | Tipo | Notas |
|---|---|---|
| `branchId` | FK Branch | scoping |
| `servicePeriodId` | FK ServicePeriod | — |
| `dayTypeId` | FK DayType | — |
| `routeId` | FK TransitRoute | — |
| `departureMinutes` | Int | minutos desde o início do dia operacional |
| `arrivalMinutes` | Int | pode ser > 1440 para viagens que cruzam a meia-noite |
| `requiredVehicleType` | Enum? | solver tenta consolidar viagens com mesmo tipo |
| `constraints` | Json? | ver §2.4 |

**Dia operacional:** o dia operacional começa no horário configurado em `PlanningConfig.operationalDayStartHour` (padrão: 04h00). Viagens entre 00:00 e 03:59 pertencem ao dia operacional anterior e têm `departureMinutes` > 1440.

```
// Exemplos com operationalDayStartHour = 4 (04h00)
23:00 → departureMinutes = (23 - 4) * 60 = 1140
00:10 → departureMinutes = (24 - 4) * 60 + 10 = 1210
01:50 → departureMinutes = (24 - 4) * 60 + 110 = 1310
04:00 → departureMinutes = 0  (início do próximo dia operacional)
```

#### `PlanningConfig` — configuração de geração (BaseSettingsService)

Settings singleton por filial com fallback global. Define os parâmetros do solver e os critérios de parada.

| Grupo | Campos |
|---|---|
| Dia Operacional | `operationalDayStartHour` |
| Intervalos | `minLayoverMinutes`, `maxLayoverMinutes` |
| Deslocamento em Vazio | `maxDeadrunSoftMinutes`, `maxDeadrunHardMinutes` |
| Duração do Bloco | `blockDurationMinMinutes`, `blockDurationIdealMinMinutes`, `blockDurationIdealMaxMinutes`, `blockDurationMaxMinutes` |
| Pesos de Otimização | `weightMinimizeFleet`, `weightMinimizeDeadrun`, `weightBlockDuration` |
| Critério de Parada | `stopNoImprovementMinutes`, `stopMaxTotalMinutes` |

**Hierarquia de configuração:**
- `scope: branchId` → config específica da filial
- `scope: 'global'` → fallback padrão do sistema
- Service tenta a config da filial primeiro, cai no global se não existir

---

### 2.3 Camada de Output (planejamento gerado)

```
VehiclePlan
    └── VehicleBlock (1 por veículo)
            └── BlockTrip (viagens + dead runs na sequência)
```

#### `VehiclePlan` — resultado de uma execução do solver

| Campo | Tipo | Notas |
|---|---|---|
| `servicePeriodId` | FK ServicePeriod | — |
| `dayTypeId` | FK DayType | — |
| `status` | Enum | DRAFT / PROCESSING / READY / CONFIRMED |
| `fleetCount` | Int? | total de veículos no plano |
| `score` | Float? | pontuação do melhor candidato encontrado |
| `deadrunKm` | Float? | total de km em vazio no plano |
| `generatedAt` | DateTime? | momento em que a geração completou |
| `constraints` | Json? | ver §2.4 |

**Regra de negócio:** apenas um plano `CONFIRMED` por `(servicePeriodId, dayTypeId)`. Múltiplos `DRAFT`/`READY` são permitidos para comparação. Enforcement no service layer.

#### `VehicleBlock` — sequência de trabalho de um veículo

| Campo | Tipo | Notas |
|---|---|---|
| `vehiclePlanId` | FK VehiclePlan | cascade delete |
| `blockNumber` | Int | identificador dentro do plano |
| `depotId` | FK TransitLocality | garagem de origem e retorno |
| `vehicleType` | Enum | tipo de veículo alocado |
| `totalMinutes` | Int? | duração total do bloco |
| `totalKm` | Float? | km total (comercial + vazio) |
| `constraints` | Json? | ver §2.4 |

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

O solver resolve o **Vehicle Scheduling Problem (VSP)**: dada uma lista de viagens, distribui-as entre o menor número possível de veículos respeitando restrições de tempo e frota, pontuando cada distribuição candidata.

### 3.1 Fluxo geral

```
Usuario clica "Gerar"
        │
        ▼
POST /transit/vehicle-plan/:id/generate
        │
        ├── cria VehiclePlan com status PROCESSING
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
        └── persiste o best atual → status READY
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

O main thread recebe mensagens `improvement` e armazena o melhor resultado em `jobs.get(jobId).best`. O endpoint `/assume` retorna esse valor instantaneamente — sem precisar consultar o worker.

### 3.3 Critérios de parada (configurados em `PlanningConfig`)

| Critério | Campo | Comportamento |
|---|---|---|
| Sem melhora | `stopNoImprovementMinutes` | Encerra se nenhum candidato melhor for encontrado neste intervalo |
| Tempo total | `stopMaxTotalMinutes` | Encerra independentemente do progresso |
| Manual | — | Usuário clica "Parar" → `POST .../stop` → worker recebe `{ type: 'stop' }` |

### 3.4 Função de pontuação

Cada candidato recebe uma pontuação calculada a partir de penalidades e pesos configurados:

```
score = 100
      - Σ penalidade_bloco_fora_da_faixa_ideal × weightBlockDuration
      - Σ dead_run_acima_do_soft × weightMinimizeDeadrun
      - frota_utilizada × weightMinimizeFleet
```

**Violações duras** (descartam o candidato imediatamente):
- Bloco abaixo de `blockDurationMinMinutes`
- Bloco acima de `blockDurationMaxMinutes`
- Dead run acima de `maxDeadrunHardMinutes`
- Intervalo entre viagens abaixo de `minLayoverMinutes`
- Violação de `requiredVehicleType` (viagem requer tipo X, bloco tem tipo Y)
- Violação de `constraints.pinnedBlock` (trip alocada em bloco diferente do travado)

**Violações suaves** (penalizam a pontuação):
- Dead run acima de `maxDeadrunSoftMinutes`
- Intervalo entre viagens acima de `maxLayoverMinutes`
- Bloco fora da faixa `[idealMin, idealMax]`

### 3.5 Autenticação SSE

`EventSource` nativo não suporta headers customizados. Abordagem para o MVP:

- Token JWT passado como query param: `GET /stream?token=<jwt>`
- Endpoint `/assume` usa `apiFetch` normalmente (header `Authorization`)

Antes de produção: migrar para `httpOnly` cookie-based auth para o SSE.

### 3.6 Isolamento por job

Múltiplas gerações simultâneas são suportadas via `Map<jobId, { worker, best }>`. O `jobId` é gerado no frontend (UUID) e enviado como query param no SSE e no `/assume`.

---

## 4. Relatórios

### 4.1 Relatório de passagem (condutor)

Para uma `TransitTrip`, calcula o horário em cada `RouteLocality`:

```
horário_ponto[0] = Trip.departureMinutes
horário_ponto[n] = horário_ponto[n-1] + delta_resolvido(n-1, n)
```

Onde `delta_resolvido` aplica a regra de fallback do §2.1 (RouteLocality.deltaMinutes ?? TravelTimeMatrix).

### 4.2 Relatório de fiscal (por localidade)

Para uma `TransitLocality`, lista todas as viagens que passam por ela em ordem de horário:

```
SELECT rl.*, tt.*
FROM transit_route_localities rl
JOIN transit_trips tt ON tt.routeId = rl.routeId
WHERE rl.localityId = :localityId
  AND tt.dayTypeId = :dayTypeId
ORDER BY tt.departureMinutes + Σ(deltas até rl.sequence)
```

### 4.3 Km prevista do projeto

```
km_linha = Σ RouteLocality.deltaKm (ou TravelTimeMatrix.distanceKm como fallback)
km_vazio_plano = Σ BlockTrip.deadheadKm WHERE isDeadhead = true
km_comercial_plano = Σ TravelTimeMatrix.distanceKm para cada trip no plano
```

---

## 5. Integração OSRM

### Endpoint utilizado

```
GET http://osrm-server/table/v1/driving/{lon1,lat1;lon2,lat2;...}
    ?annotations=duration,distance
```

Retorna matrizes N×N de duração (segundos) e distância (metros).

### Fluxo de atualização da matriz

1. `TransitLocality` criada ou lat/lng atualizado
2. Job assíncrono busca todas as localidades ativas da filial
3. Dispara chamada OSRM `/table` com todas as coordenadas
4. Converte: segundos → minutos, metros → km
5. `upsert` em `TravelTimeMatrix` com `source: 'OSRM'`
6. Entradas com `source: 'MANUAL'` **não são sobrescritas**

### Configuração

```typescript
// apps/api/.env
OSRM_URL=http://localhost:5000   // instância local self-hosted
```

---

## 6. Estrutura de Módulos NestJS

```
apps/api/src/modules/transit/
  transit.module.ts              @Domain({ label: 'Trânsito', icon: 'Bus' })
  network/
    network.module.ts
    locality/
      locality.service.ts        extends BaseService
      locality.controller.ts     extends BaseController
    line/
      line.service.ts
      line.controller.ts
    route/
      route.service.ts
      route.controller.ts
    route-locality/
      route-locality.service.ts
      route-locality.controller.ts
    travel-time/
      travel-time.service.ts
      travel-time.controller.ts
      osrm.service.ts            integração OSRM (chamadas HTTP + upsert)
    depot-fleet/
      depot-fleet.service.ts
      depot-fleet.controller.ts
  timetabling/
    timetabling.module.ts
    day-type/
      day-type.service.ts
      day-type.controller.ts
    service-period/
      service-period.service.ts
      service-period.controller.ts
    trip/
      trip.service.ts
      trip.controller.ts
    vehicle-plan/
      vehicle-plan.service.ts    NÃO extends BaseService — lógica custom
      vehicle-plan.controller.ts NÃO extends BaseController — endpoints SSE
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

### Etapa 1 — Infraestrutura e migração

- [ ] Criar `TransitModule` com `@Domain({ label: 'Trânsito', icon: 'Bus' })`
- [ ] Registrar `TransitModule` em `AppModule`
- [ ] Criar `NetworkModule` e `TimetablingModule` como sub-módulos
- [ ] Executar `pnpm db:migrate` para aplicar `transit.prisma`

### Etapa 2 — Rede (NetworkModule)

- [ ] `LocalityService` / `LocalityController` (BaseService, scopeField: `branchId`)
- [ ] `LineService` / `LineController` (scopeField: `branchId`)
- [ ] `RouteService` / `RouteController` (child de Line, sem scopeField — acesso via lineId)
- [ ] `RouteLocalityService` / `RouteLocalityController` (child de Route)
- [ ] `TravelTimeService` / `TravelTimeController` (scopeField: `branchId`)
- [ ] `OsrmService` — `generateMatrix(branchId)` dispara OSRM e faz upsert
- [ ] Hook em `LocalityService.create/update` → enfileira job de regeneração da matriz
- [ ] `DepotFleetService` / `DepotFleetController` (scopeField: `branchId`)

### Etapa 3 — Programação (TimetablingModule)

- [ ] `DayTypeService` / `DayTypeController` (scopeField: `branchId`)
- [ ] `ServicePeriodService` / `ServicePeriodController` (scopeField: `branchId`)
- [ ] `TripService` / `TripController` (scopeField: `branchId`)
  - [ ] `buildSearchWhere` por routeId, dayTypeId, horário
  - [ ] Filtro `f_servicePeriodId` para contexto da lista filha
- [ ] `PlanningConfigService` extends `BaseSettingsService` (scope: `branchId` | `global`)
- [ ] `PlanningConfigController` extends `BaseSettingsController`
- [ ] Registrar `PlanningConfig` no `SettingsModule`

### Etapa 4 — Solver

- [ ] Definir tipos em `solver.types.ts`:
  - `SolverConfig` — config resolvida (PlanningConfig + trips + matrix)
  - `SolverResult` — candidato gerado (blocks + score + metrics)
  - `SolverMessage` — union dos tipos de mensagem do worker
- [ ] Implementar `solver.worker.ts`:
  - [ ] Loop de geração com `setInterval` ou loop síncrono em worker
  - [ ] Função de avaliação de candidato (`evaluateCandidate`)
  - [ ] Cálculo de score com penalidades configuráveis
  - [ ] Aplicação de constraints (locked fields, pinnedBlock)
  - [ ] Critérios de parada (sem melhora, timeout, stop manual)
  - [ ] Cleanup via `return () => clearInterval` no Observable
- [ ] Implementar `VehiclePlanService` (custom, não BaseService):
  - [ ] `generate(planId)` — inicia Worker, registra job no Map
  - [ ] `streamProgress(jobId)` — Observable → SSE
  - [ ] `assumeBest(jobId)` — persiste melhor candidato → status READY
  - [ ] `stop(jobId)` — envia `{ type: 'stop' }` ao worker
  - [ ] `confirm(planId)` — status CONFIRMED + valida unicidade por (servicePeriod, dayType)
- [ ] Implementar `VehiclePlanController` (custom):
  - [ ] `POST /:id/generate`
  - [ ] `GET /:id/stream` (`@Sse`)
  - [ ] `POST /:id/assume`
  - [ ] `POST /:id/stop`
  - [ ] `POST /:id/confirm`

### Etapa 5 — Relatórios

- [ ] `GET /transit/report/passage?tripId=` — horários de passagem por viagem
- [ ] `GET /transit/report/inspector?localityId=&dayTypeId=` — todas as viagens por ponto
- [ ] `GET /transit/report/plan-km?vehiclePlanId=` — km comercial + vazio + total

### Etapa 6 — Frontend

- [ ] Páginas genéricas (AutoList + AutoForm) para todos os resources CRUD
  - Criadas automaticamente pelo sistema — sem arquivos extras
- [ ] Página customizada `app/transit/vehicle-plan/[id]/page.tsx`:
  - [ ] Topbar com botões: Gerar / Parar / Assumir Melhor / Confirmar
  - [ ] Hook `useVehiclePlanStream` (baseado no dispatch-timetabling.md)
  - [ ] Painel de progresso em tempo real (SSE)
  - [ ] Lista de blocos gerados com detalhamento de viagens
  - [ ] Indicadores visuais de constraints (lock icons)
  - [ ] UI de lock/unlock de campos e blocos
- [ ] Integrar `alt+g` → Assumir Melhor (quando há resultado disponível)

---

## 8. Decisões de Arquitetura Registradas

| Decisão | Escolha | Razão |
|---|---|---|
| Tempo das viagens | Minutos desde início do dia operacional (Int) | Evita ambiguidade de timezone e virada de dia |
| Tempo base de percurso | OSRM self-hosted | Gratuito, usa OSM, endpoint `/table` cobre matriz N×N em uma chamada |
| Override de tempo | `deltaMinutes` nullable com fallback | Manualidade só onde necessário; OSRM cobre o resto |
| Km na matriz | `distanceKm` em `TravelTimeMatrix` | OSRM retorna distância junto com duração — zero custo extra |
| Worker do solver | `worker_threads` Node.js | Não bloqueia event loop; NestJS continua respondendo |
| SSE auth | Query param `?token=jwt` (MVP) | EventSource não suporta headers; migrar para cookie em produção |
| Constraints | `Json` field com shape documentado | Evita proliferação de booleans; extensível sem migration |
| PlanningConfig | BaseSettingsService com scope | Reutiliza infraestrutura existente; fallback global automático |
| Unicidade de plano confirmado | Service layer (não DB unique) | Suporta múltiplos DRAFTs para comparação; `CONFIRMED` único por (período, tipo de dia) |
| Nome do domain | `transit` | Neutro, engloba timetabling + escala + plantão sem forçar semântica |

---

## 9. Referências

- `docs/architecture/ARCHITECTURE.md` — arquitetura geral do sistema
- `docs/proposals/dispatch-timetabling.md` — arquitetura SSE do solver (referência de implementação)
- `packages/schemas/transit/` — schemas Zod de todos os resources
- `apps/api/prisma/schema/transit.prisma` — modelos Prisma
