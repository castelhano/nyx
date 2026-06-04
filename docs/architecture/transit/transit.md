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
       └── RouteLocality ◄── TransitRoute ◄── TransitLine ◄── LineGroupLine ──► LineGroup
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

#### `LineGroup` — agrupamento de linhas para escopo de edição

Agrupa linhas para uso na tela de edição de horários. Um grupo pode representar as linhas operadas por uma filial ou qualquer conjunto ad-hoc.

| Campo | Tipo | Notas |
|---|---|---|
| `name` | String | nome do grupo |
| `branchId` | FK Branch? | filial proprietária; `null` = grupo genérico |

#### `LineGroupLine` — join table M-N entre `LineGroup` e `TransitLine`

| Campo | Tipo | Notas |
|---|---|---|
| `lineGroupId` | FK LineGroup | cascade delete |
| `lineId` | FK TransitLine | — |

Uma mesma linha pode pertencer a múltiplos grupos (ex: Branch A e Branch B operam a mesma linha — sem duplicação de dados).

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
DayType ◄── TripDayType ──► TransitTrip ──► TransitRoute
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

#### `TripDayType` — associação M-N entre viagem e tipo de dia

Join table entre `TransitTrip` e `DayType`. Uma mesma viagem pode ser válida para múltiplos tipos de dia (ex: `UTIL` e `FERIAS`). Isso elimina duplicação de trips quando o horário é idêntico em dois períodos.

| Campo | Tipo | Notas |
|---|---|---|
| `tripId` | FK TransitTrip | cascade delete |
| `dayTypeId` | FK DayType | — |

`@@id([tripId, dayTypeId])` — chave composta; não existe duplicate.

#### `TransitTrip` — viagem avulsa (átomo do planejamento)

Template permanente por `Route`. Não possui vínculo com empresa nem com vigência — é um dado técnico da linha. Os tipos de dia que a viagem cobre são definidos via `TripDayType`. O solver consome trips filtradas pelo escopo do `VehiclePlan` usando `dayTypes: { some: { dayTypeId } }`.

| Campo | Tipo | Notas |
|---|---|---|
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

| Grupo | Campos | Solver atual |
|---|---|---|
| Dia Operacional | `operationalDayStartHour` | ✓ usado |
| Intervalos | `minLayoverMinutes`, `maxLayoverMinutes` | `min` é hard constraint; `max` reservado para Fase 2 |
| Deslocamento em Vazio | `maxDeadrunSoftMinutes`, `maxDeadrunHardMinutes` | ✓ ambos usados |
| Duração do Bloco | `blockDurationMinMinutes`, `blockDurationIdealMinMinutes`, `blockDurationIdealMaxMinutes`, `blockDurationMaxMinutes` | **Reservado para Fase 2 (crew scheduling)** — campos existem no schema mas o VSP atual os ignora |
| Pesos de Otimização | `weightMinimizeFleet`, `weightMinimizeDeadrun`, `weightBlockDuration` | `fleet` e `deadrun` usados; `blockDuration` reservado para Fase 2 |
| Critério de Parada | `stopNoImprovementMinutes`, `stopMaxTotalMinutes` | ✓ usados |

> **Por que `blockDuration*` não é usado no VSP:** um bloco representa um **veículo**, não um condutor. Veículos não têm limite de jornada. Os limites de duração do bloco são restrições de **jornada do condutor** e serão aplicados na Fase 2 (crew scheduling), quando blocos longos serão particionados em turnos respeitando a legislação.

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
| `summary` | Json? | preenchido pelo solver ao assumir — shape `VehiclePlanSummary`: `{ fleetCount, score, deadrunKm, productiveKm, totalKm, deadrunMinutes, productiveMinutes, totalMinutes }` |
| `generatedAt` | DateTime? | momento em que o melhor resultado foi assumido |
| `constraints` | Json? | ver §2.4 |
| `notes` | String? | — |

**Regra de negócio — ACTIVE:**
- Múltiplos `DRAFT` são permitidos por `dayTypeId` (comparação de cenários)
- Uma linha não pode estar em dois `VehiclePlan ACTIVE` do mesmo `dayTypeId`
- Enforcement no service layer ao ativar (`POST /:id/activate`)
- `DELETE /:id` só é permitido para planos com `status = 'DRAFT'` — planos ACTIVE não podem ser excluídos

#### `VehiclePlanLine` — escopo de linhas do plano

Define quais linhas o solver considera ao gerar este plano. Necessário também para filtrar "todos os planos que cobrem a linha X".

| Campo | Tipo | Notas |
|---|---|---|
| `vehiclePlanId` | FK VehiclePlan | cascade delete |
| `lineId` | FK TransitLine | — |

Gerenciado via endpoints no `VehiclePlanController` (sem controller próprio — join table simples):
- `POST /transit/vehicle-plan/:id/lines` `{ lineId }` — adiciona linha ao escopo
- `DELETE /transit/vehicle-plan/:id/lines/:lineId` — remove linha do escopo

#### `VehicleBlock` — sequência de trabalho de um veículo

| Campo | Tipo | Notas |
|---|---|---|
| `vehiclePlanId` | FK VehiclePlan | cascade delete |
| `branchId` | FK Branch? | empresa que opera este bloco; `null` = ainda não atribuído |
| `blockNumber` | Int | identificador dentro do plano |
| `depotId` | FK TransitLocality | garagem de origem e retorno |
| `vehicleType` | Enum | tipo de veículo alocado |
| `isStale` | Boolean | `true` quando qualquer trip do bloco foi alterada após a geração; resetado ao criar novos blocos via `assumeBest()` |
| `summary` | Json? | preenchido pelo solver — shape `VehicleBlockSummary`: `{ totalMinutes, productiveMinutes, deadrunMinutes, totalKm, productiveKm, deadrunKm }` |
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
            plan.summary  = { fleetCount, score, deadrunKm, productiveKm, totalKm, deadrunMinutes, productiveMinutes, totalMinutes }
            block.summary = { totalMinutes, productiveMinutes, deadrunMinutes, totalKm, productiveKm, deadrunKm } por bloco

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

### 3.3 Critérios de parada e ciclo de vida do job

| Critério | Campo | Comportamento |
|---|---|---|
| Sem melhora | `stopNoImprovementMinutes` | Encerra se nenhum candidato melhor for encontrado neste intervalo |
| Tempo total | `stopMaxTotalMinutes` | Encerra independentemente do progresso |
| Manual | — | Usuário clica "Parar" → `POST .../stop` → worker recebe `{ type: 'stop' }` |
| Assumir Melhor | — | `assumeBest` envia `{ type: 'stop' }` ao worker antes de persistir |

**Ciclo de vida do job (`Map<jobId, Job>`):**

```
generate()  → job criado; worker inicia
    │
    ▼
worker envia 'improvement' → job.best = result
worker envia 'progress'    → SSE forwarded ao cliente
    │
    ▼
worker envia 'done' (qualquer motivo)
    │   messages$.complete() — SSE fecha
    │   job PERMANECE no map (job.best acessível)
    │   TTL de 30 min agenda limpeza automática (jobs abandonados)
    ▼
assumeBest()
    │   job.worker.postMessage({ type: 'stop' }) — para se ainda rodando
    │   persiste VehicleBlocks no banco
    │   this.jobs.delete(jobId) — job removido
    ▼
  fim
```

**Por que o job não é deletado ao receber `done`:** o usuário pode querer "Parar" o solver e só depois clicar "Assumir Melhor". Se o job fosse deletado ao encerrar, `job.best` seria perdido e o botão ficaria sem efeito.

### 3.4 Função de pontuação (VSP — Fase 1)

O solver foca exclusivamente em minimizar frota. Restrições de jornada de condutor são Fase 2.

```
score = 100
      - Σ dead_run_acima_do_soft × weightMinimizeDeadrun
      - frota_utilizada × weightMinimizeFleet
```

**Violações duras** (descartam o candidato):
- Dead run acima de `maxDeadrunHardMinutes` (restrição física real do veículo)
- Intervalo entre viagens abaixo de `minLayoverMinutes`
- Violação de `requiredVehicleType`
- Violação de `constraints.pinnedBlock`

**Violações suaves** (penalizam a pontuação):
- Dead run acima de `maxDeadrunSoftMinutes`

**Reservado para Fase 2 (crew scheduling) — não aplicado ao VSP:**
- Restrições de `blockDurationMin/Max/Ideal`
- Penalidade por bloco fora da faixa ideal
- `maxLayoverMinutes` como penalidade suave

### 3.5 Autenticação SSE

`EventSource` nativo não suporta headers customizados. Solução: `JwtOrQueryGuard` que injeta `?token=<jwt>` como `Authorization: Bearer` antes do Passport processar.

```typescript
@Injectable()
export class JwtOrQueryGuard extends AuthGuard('jwt') {
  override getRequest(context: ExecutionContext) {
    const req = context.switchToHttp().getRequest()
    if (req.query?.token && !req.headers.authorization) {
      req.headers.authorization = `Bearer ${req.query.token}`
    }
    return req
  }
}
```

**Regra crítica:** `JwtOrQueryGuard` deve estar no **decorator de classe** do `VehiclePlanController`, nunca apenas no método `stream`. Guards de classe executam antes de guards de método — se a classe usar `JwtAuthGuard` e o método usar `JwtOrQueryGuard`, o guard da classe rejeita o SSE antes que o de método possa injetar o token.

```typescript
@Controller('transit/vehicle-plan')
@UseGuards(JwtOrQueryGuard)   // ← cobre todos os endpoints, inclusive SSE
export class VehiclePlanController { ... }
```

Antes de produção: migrar para `httpOnly` cookie-based auth e remover suporte a `?token=`.

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
JOIN transit_trip_day_types tdt ON tdt.tripId = tt.id AND tdt.dayTypeId = :dayTypeId
WHERE rl.localityId = :localityId
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
      line.service.ts            extends BaseService (sem scopeField — global); natural sort por code em findAll
      line.controller.ts         extends BaseController
    line-group/
      line-group.service.ts      extends BaseService (sem scopeField — global); gerencia lineIds M-N
      line-group.controller.ts   extends BaseController
      line-group.module.ts
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
      vehicle-plan.service.ts    NÃO extends BaseService — generate, assume, activate, addLine, removeLine, getGanttData
      vehicle-plan.controller.ts NÃO extends BaseController — SSE + ativação + gestão de linhas + gantt-data
      vehicle-block.service.ts   extends BaseService — CRUD padrão; hidden: true (gerido pela UI do plano)
      vehicle-block.controller.ts extends BaseController
      solver/
        solver.worker.ts         worker_threads — loop de otimização
        solver.types.ts          SolverResult, SolverConfig, SolverMessage, VehiclePlanSummary, VehicleBlockSummary
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
- [x] `LineService` / `LineController` — sem `scopeField`; linha é global; natural sort por `code`
- [x] `LineGroupService` / `LineGroupController` — sem `scopeField`; gerencia `lineIds` M-N via override
- [x] `RouteService` / `RouteController`
- [x] `RouteLocalityService` / `RouteLocalityController`
- [x] `TravelTimeService` / `TravelTimeController` — sem `scopeField`; matriz é global
- [x] `OsrmService.generateMatrix()` — opera sobre subconjunto relevante de localidades

### Etapa 3 — Programação (TimetablingModule) ✅

- [x] `DayTypeService` / `DayTypeController`
- [x] Campo `pattern` no schema Zod de `DayType`
- [x] Campo `priority` no schema Zod e Prisma de `DayType`
- [x] `CalendarExceptionService` / `CalendarExceptionController`
- [x] `TripService` / `TripController` — sem `scopeField`; trips são globais
- [x] `PlanningConfigService` extends `BaseSettingsService`
- [x] `PlanningConfigController` extends `BaseSettingsController`
- [x] Implementar lógica de resolução de `DayType` para data real (usar `priority` + `pattern`)

### Etapa 4 — Solver ✅

- [x] Tipos em `solver.types.ts` — `SolverBlock` e `SolverResult` com métricas completas
- [x] `VehiclePlanSummary` e `VehicleBlockSummary` como schemas Zod tipados em `packages/schemas`
- [x] `solver.worker.ts` com loop, score, constraints, critérios de parada, métricas completas por bloco
- [x] `VehiclePlanService.generate()` — busca trips via `VehiclePlanLine → lineId → route → trip`
- [x] `VehiclePlanService.assumeBest()` — persiste blocos com `summary` tipado (8 campos)
- [x] `VehiclePlanService.activate()` — valida sobreposição de linhas; status `ACTIVE`
- [x] `VehiclePlanService.addLine()` / `removeLine()` — gestão do escopo de linhas
- [x] `VehiclePlanService.getGanttData()` — retorna plano + blocos + viagens aninhadas para o Gantt
- [x] `VehiclePlanController` — endpoints: `generate`, `stream` (SSE), `assume`, `stop`, `activate`, `lines`, `gantt-data`
- [x] `VehicleBlockService` / `VehicleBlockController` — CRUD padrão; schema com `hidden: true`

### Etapa 5 — Relatórios

- [ ] `GET /transit/report/passage?tripId=`
- [ ] `GET /transit/report/inspector?localityId=&dayTypeId=`
- [ ] `GET /transit/report/plan-km?vehiclePlanId=`

### Etapa 6 — Frontend

- [x] Páginas genéricas (AutoList + AutoForm) para todos os resources CRUD
- [x] Gantt engine (`app/transit/vehicle-plan/[id]/engine/`) — ver §9:
  - [x] `gantt.types.ts` — tipos compartilhados (`GanttRow`, `GanttSegment`, `GanttView`, `ViewportSnapshot`)
  - [x] `layout/layout.types.ts` — interfaces `LayoutRow`, `LayoutSegment`, `LayoutStrategy`
  - [x] `layout/sequential.layout.ts` — posicionamento sequencial de blocos
  - [x] `viewport.ts` — conversão tempo↔pixel, zoom (ctrl+wheel), scroll, range visível
  - [x] `renderer.ts` — draw calls: bandas, grid de tempo, segmentos com `roundRect`, hover outline
  - [x] `hit-tester.ts` — índice espacial, O(visible)
  - [x] `interaction.ts` — wheel scroll/zoom, drag (middle button), hover, click
  - [x] `gantt-engine.ts` — coordenador; expõe `setView`, `getSegmentRect`, `requestDraw`; notifica React via `onStateChangeCallback`
- [x] `views/vehicles.view.ts` — 1 linha por bloco, viagens por cor de linha, dead runs em cinza
- [x] Página customizada `app/transit/vehicle-plan/[id]/page.tsx`:
  - [x] `GanttBoard` + `TimeRuler` + `RowList` + `SegmentTooltip`
  - [x] Topbar: Gerar / Parar / Assumir Melhor / Ativar
  - [x] "Parar" visível apenas enquanto SSE está aberto; "Assumir Melhor" persiste até assumir (mesmo após parar)
  - [x] Painel de progresso SSE inline na summary bar (tentativa, blocos, score)
  - [x] Summary bar: Status, Tipo (dayType.code), x linhas, x blocos, x viagens
  - [x] Seleção de linhas via `LinesPanel` (`POST/DELETE .../lines`)
  - [x] Distinção visual IDA/VOLTA no Gantt (cor cheia vs clareada) + tooltip com direção
  - [x] Botão "Excluir" na topbar (apenas DRAFT, com modal de confirmação `variant: 'destructive'`)
  - [x] Pesquisa por código/nome no `LinesPanel`
  - [x] `RowList` — layout de duas linhas: label + resumo (`Xv · Yh`) dentro do height existente (44px); largura 112→160px
  - [x] `BlockDetailPopover` — popover posicionado à direita da coluna de labels ao clicar [ⓘ]; exibe tipo, viagens, jornada, km produtivo/garagem
  - [ ] `ViewSwitcher` — visão veículos / linhas / garagens
  - [ ] Atribuição de `branchId` por bloco inline no Gantt

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
| `VehiclePlanService` herança | Estende `BaseService` + métodos custom | Necessário para registro no `resourceRegistry` (discovery) e endpoints CRUD via `BaseController` |
| Relation `blockTrips` | Nome Prisma correto em `VehicleBlock` | Campo se chama `blockTrips`, não `trips`; `trips` é nome usado apenas no `SolverBlock` (solver interno) |
| Gantt canvas + DOM | Canvas para segmentos, DOM para TimeRuler/RowList/tooltip | Motor opera em CSS pixels; DPR tratado 1× no init via `ctx.setTransform(dpr,…)`; overlays DOM usam `engine.getSegmentRect()` diretamente |
| Bloco ≠ jornada de condutor | `blockDuration*` ignorado no VSP | Um bloco representa um veículo; veículo não tem limite de jornada. Limites de duração são restrições de condutor — aplicados no crew scheduling (Fase 2) |
| Job persiste após `done` | `jobs.delete()` não ocorre no handler `done` | Permite "Assumir Melhor" após "Parar"; job limpo em `assumeBest()` ou TTL de 30 min |
| `assumeBest` para o worker | `assumeBest` envia `stop` antes de persistir | Evita estado inconsistente: worker pode estar rodando quando o usuário clicar "Assumir Melhor" sem clicar "Parar" antes |
| `TransitTrip` sem `dayTypeId` direto | Join table `TripDayType` (M-N) | Uma trip com mesmo horário vale para UTIL e FERIAS; com FK direto seria obrigatório duplicar a trip — ajuste de horário em um registro não propagaria para o outro |
| Gantt IDA/VOLTA | OUTBOUND = cor cheia; INBOUND = cor clareada 45% (blend branco) | Mesma cor de linha, hue igual, distinção clara de direção sem exigir legenda separada |
| `dayType` no ganttData | `getGanttData` inclui relação `dayType` | Summary bar precisa do `code` do tipo de dia; evita query extra no frontend |
| DELETE restrito a DRAFT | `VehiclePlanService.remove()` override verifica `status === 'DRAFT'` | Plano ACTIVE não pode ser apagado — representa a programação vigente; exclusão acidental quebraria a escala diária (Fase 3) |
| `RowList` duas linhas | Label + resumo `Xv · Yh` em 44px (ROW_HEIGHT inalterado); largura 160px | Mantém alinhamento pixel-perfeito com o canvas sem alterar o engine; info mínima visível sem abrir popover |
| `BlockDetailPopover` posicionado pelo board | `screenY = RULER_HEIGHT + row.y - vp.scrollY`; `left = LABEL_WIDTH + 8` | O `GanttBoard` tem `position: relative`; popover calculado no mesmo sistema de coordenadas do canvas — sem `portal` necessário |
| `variant: 'destructive' as const` | Ações de topbar destrutivas usam `as const` no literal | TypeScript infere literais de string em spreads ternários como `string` sem contexto explícito; `as const` preserva o tipo literal para satisfazer `TopbarAction.variant` |
| `VehicleBlock.isStale` | Boolean flag no bloco | Marcado `true` em `TripService.update()` via `updateMany` nos blocos que contêm a trip; resetado ao criar novos blocos em `assumeBest()`; permite visualização de blocos desatualizados no Gantt sem recalcular |
| `LineGroup` escopo de edição | Modelo separado com `branchId?` + M-N com `TransitLine` | Unifica os três casos de escopo (linhas avulsas, por filial, grupo ad-hoc) em um único modelo; linha pode pertencer a múltiplos grupos sem duplicação |
| Natural sort de linhas | `LineService.findAll()` override com sort JS pós-query | DB não suporta natural sort (numérico + alfanumérico) de forma portável; com ~200 linhas o custo é negligenciável; `sortField` explícito bypassa o override |

---

## 9. Arquitetura de UI — Gantt Views

As páginas de planejamento do domínio transit são **todas custom pages**. A visualização central é um diagrama de Gantt com régua de tempo horizontal e linhas verticais representando veículos, motoristas, escalas, etc. Múltiplas "visões" do mesmo conjunto de dados serão suportadas.

### 9.1 Estratégia de renderização

Renderizar cada viagem/bloco como elemento DOM individual é inviável: 50 veículos × 200 viagens = 10 000 nós, com reconciliação React a cada troca de visão.

**Solução:** `<canvas>` para a área de dados (segmentos, blocos, cores), DOM apenas para elementos pontuais (régua, labels, tooltips, painéis de edição).

```
┌─ wrapper  (position: relative; overflow: hidden) ──────────────┐
│  canvas   (position: absolute; top:0; left:0; 100%×100%)       │  ← todos os segmentos
│  overlays (position: absolute; top:0; left:0; 100%×100%;       │  ← tooltips, painéis
│            pointer-events: none)                               │
└────────────────────────────────────────────────────────────────┘
```

Canvas e overlays DOM compartilham o mesmo pai posicionado → mesmo sistema de coordenadas → alinhamento garantido.

### 9.2 Sistema de coordenadas e DPR

O engine opera exclusivamente em **CSS pixels**. O DPR (device pixel ratio) é tratado **uma única vez**, na inicialização do buffer:

```typescript
const dpr = window.devicePixelRatio ?? 1
canvas.width  = canvas.clientWidth  * dpr
canvas.height = canvas.clientHeight * dpr
ctx.scale(dpr, dpr)
// a partir daqui: ctx.fillRect(x, y, w, h) usa CSS pixels
// overlays DOM: style.left = x + 'px' usa o mesmo valor
```

Após esse setup, `engine.getSegmentRect(id)` retorna CSS pixels que o overlay DOM aplica diretamente como `left`/`top`.

### 9.3 Sincronização de scroll

O canvas não scrolleia — ele redesenha com offset. `RowList` (DOM virtualizado) e canvas leem da mesma fonte:

```
┌─ board ──────────────────────────────────────────────┐
│  TimeRuler  (DOM, sticky topo)                       │
│  ┌─ RowList (overflow-y: hidden) ─┐                  │
│  │  scrollTop ← viewport.scrollY  │  (DOM)           │
│  └──────────────────────────────  ┘                  │
│  canvas  →  desenha com translateY = -viewport.scrollY│
└──────────────────────────────────────────────────────┘
```

`viewport.scrollY` é a única fonte de verdade. Nunca dessincronizam.

### 9.4 Visões como configuração

Trocar de visão não desmonta componentes — apenas substitui a configuração de renderização e redesenha o canvas.

```typescript
interface GanttView<TData> {
  getRows:      (data: TData) => GanttRow[]
  getSegments:  (row: GanttRow, data: TData) => GanttSegment[]
  getRowLabel:  (row: GanttRow) => string
  segmentColor: (seg: GanttSegment) => string
  onSegmentClick?: (seg: GanttSegment, pos: Point) => void
  editable?:    boolean
}

// trocar de visão = ~milliseconds
engine.setView(vehiclesView, planData)
```

Visões previstas (Fase 1/2/3):

| Visão | Linhas verticais | Segmentos |
|---|---|---|
| Veículos | Um veículo (bloco) por linha | Viagens produtivas + dead runs |
| Motoristas | Um motorista por linha | Turnos + intervalos |
| Linhas | Uma linha de ônibus por linha | Viagens por horário |
| Garagens | Uma garagem por linha | Blocos que partem/chegam |

### 9.5 Arquitetura do engine — especialistas

O engine é um **coordenador**: mantém estado central e delega toda lógica a módulos especializados. Nenhuma lógica de negócio vive no arquivo principal.

```
app/transit/vehicle-plan/[id]/
  engine/
    gantt-engine.ts          ← coordenador: estado + API pública
    viewport.ts              ← tempo↔pixel, zoom, scroll, range visível
    renderer.ts              ← primitivas canvas (drawBlock, drawLabel, drawRuler…)
    hit-tester.ts            ← índice espacial, pointInRect, hover/click resolution
    interaction.ts           ← eventos DOM → comandos para o engine
    layout/
      layout.types.ts        ← interfaces: LayoutRow, LayoutSegment, LayoutStrategy
      sequential.layout.ts   ← blocos lado a lado sem sobreposição (padrão)
      overlap.layout.ts      ← faixas com sobreposição (ex: motoristas com folga)
      compact.layout.ts      ← empilha blocos, minimiza altura de linha
```

**Responsabilidade de cada especialista:**

| Módulo | O que faz | O que NÃO sabe |
|---|---|---|
| `viewport.ts` | Converte tempo↔pixel, gerencia zoom/scroll/pan, calcula range visível | Canvas, dados de viagem |
| `renderer.ts` | Recebe rows já posicionadas + viewport, executa draw calls | Dados de domínio, eventos |
| `hit-tester.ts` | Indexa rects dos segmentos visíveis, responde `hitTest(point)` | Canvas, visões |
| `interaction.ts` | Traduz mouse/touch/keyboard em chamadas ao engine | Canvas, dados |
| `layout/*.ts` | Recebe rows brutas, devolve rows com `y`, `height`, `lanes` calculados | Canvas, eventos |

**Coordenador — contrato mínimo:**

```typescript
class GanttEngine {
  readonly viewport:    Viewport
  readonly renderer:    Renderer
  readonly hitTester:   HitTester
  readonly interaction: Interaction
  private  layout:      LayoutStrategy

  // troca de layout sem desmontar nada
  setLayout(strategy: LayoutStrategy): void

  // troca de visão sem desmontar nada
  setView<T>(view: GanttView<T>, data: T): void

  // expõe posição de um segmento em CSS pixels para overlays DOM
  getSegmentRect(segId: string): DOMRect | null

  // agenda requestAnimationFrame se ainda não agendado
  private invalidate(): void
}
```

### 9.6 Hit testing e edição

O canvas não dispara eventos por segmento — o container captura e o engine resolve:

```typescript
canvas.addEventListener('click', (e) => {
  const seg = engine.hitTest({ x: e.offsetX, y: e.offsetY })
  if (seg) openEditPanel(seg)   // monta DOM sob demanda
})
```

`hitTester.index()` é chamado após cada `setView()` ou redraw. Itera apenas os segmentos no viewport atual — O(visible) não O(total).

### 9.7 Estrutura de componentes React

```
app/transit/vehicle-plan/[id]/
  page.tsx                      ← custom page: topbar actions, AutoBreadcrumb
  components/
    GanttBoard.tsx              ← orquestra canvas + overlays + engine lifecycle; gerencia BlockDetailPopover
    TimeRuler.tsx               ← DOM sticky, régua de tempo
    RowList.tsx                 ← DOM virtualizado; 2 linhas por row (label + Xv·Yh) + botão [ⓘ]
    SegmentTooltip.tsx          ← overlay DOM posicionado via engine.getSegmentRect()
    BlockDetailPopover.tsx      ← popover de detalhes do bloco (tipo, viagens, km, jornada)
    LinesPanel.tsx              ← painel lateral com pesquisa + toggle de linhas do plano
    EditPanel.tsx               ← painel lateral/modal para edições inline
    ViewSwitcher.tsx            ← botões de troca de visão → engine.setView()
  engine/
    …                           ← (ver §9.5)
  views/
    vehicles.view.ts
    drivers.view.ts             ← Fase 2
    lines.view.ts
```

### 9.8 Ordem de implementação sugerida

1. **`viewport.ts`** — fundação matemática; todos os outros dependem dele
2. **`layout/layout.types.ts` + `sequential.layout.ts`** — layout padrão para veículos
3. **`renderer.ts`** — desenha rows já posicionadas; resultado visível imediato
4. **`hit-tester.ts`** — habilita interação
5. **`interaction.ts`** — scroll, zoom, click
6. **`gantt-engine.ts`** — conecta tudo
7. **`vehicles.view.ts`** — primeira visão concreta
8. **Componentes React** (`GanttBoard`, `TimeRuler`, `RowList`) — integra ao Next.js
9. **`EditPanel`** + ações de topbar — edição inline de blocos

---

## 10. Referências

- `docs/architecture/ARCHITECTURE.md` — arquitetura geral do sistema
- `apps/api/prisma/schema/transit.prisma` — modelos Prisma
- `packages/schemas/transit/` — schemas Zod de todos os resources
