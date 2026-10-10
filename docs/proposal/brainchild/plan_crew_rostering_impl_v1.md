# Plano — Turnos, escala real (rostering) e portal do condutor

**Status: proposta de implementação, aguardando respostas em [Dúvidas](#dúvidas).**
Decisões de direção: [`plan_crew_rostering_v1.md`](plan_crew_rostering_v1.md) (com as
considerações do usuário). Este documento transforma aquelas decisões em modelos, regras e
fases, a partir do que o sistema já tem hoje.

Convenções deste plano:
- Comentários em snippets Prisma/TS em inglês (regra do repo); texto em pt-BR.
- Minutos seguem a convenção já usada em `TransitTrip`/`DutyPiece`: minutos desde o início do
  **dia operacional**, `> 1440` = madrugada seguinte.
- Novos resources seguem o padrão de 4 arquivos (schema Zod + Prisma + Service + Controller).
- Cada fase é entregável sozinha; nada de uma fase depende de fase posterior.

---

## 0. O que o sistema atual impõe ao desenho

Achados da análise do código que mudam ou confirmam decisões da v1:

| # | Achado | Onde | Consequência |
|---|---|---|---|
| A1 | `Settings` já suporta escopo `global`, `branch` e `transitScope`, com fallback para global | `core/base-settings.service.ts` | Configurações por branch (modo de linha, reserva, turno) entram em `transit.roster` com escopo `branch` — sem modelo novo |
| A2 | `transit.roster` hoje é **global** e só `interShiftRest` é lido (DOP Escala) | `transit-roster-config.service.ts`, `dop-crew.service.ts:216` | Passar para escopo `branch` não quebra o DOP (`get()` sem escopo cai no global) |
| A3 | `driverPrefTech` existe em `RosterSettings`, mas tecnologia virou **restrição** (condutor que não opera articulado) | `settings-roster.schema.ts` | Proposta: remover o critério e tratar como habilitação rígida (§2.4) |
| A4 | `Contract.weeklyHours` existe (`max(44)`), mas o sync de funcionários **não cria contratos** (`DESCFUNCAO` é lido e descartado) | `hr.prisma`, `employee-sync.md` | Carga mensal precisa de fallback quando não há contrato (§2.6, D4) |
| A5 | `Employee.branchId` já existe; `Employee.status` vem do sync (`D` → `TERMINATED`) | `hr.prisma`, `employee-sync.md` | `CrewMember` não tem branch próprio; portal confere `Employee.status` |
| A6 | `Duty.branchId` é **nullable**; `DutySummary.startMinutes/endMinutes` já são o início/fim efetivos | `transit.prisma`, `duty.schema.ts` | Turno derivado usa esses campos; duty sem branch não recebe turno |
| A7 | `DayTypeService.resolveDayType(date, lineId)` + `findActivePlan` (DOP) já resolvem "qual plano roda na linha X no dia D" | `day-type.service.ts`, `dop/dop-resolution.ts` | Materialização da escala diária reaproveita a mesma resolução |
| A8 | `plan-validity.ts`: dias como `'YYYY-MM-DD'`, `@db.Date`, `inForceOn` | `timetabling/plan-validity.ts` | Datas da escala real seguem o mesmo padrão |
| A9 | `JwtStrategy` valida **qualquer** token assinado com `JWT_SECRET`, sem checar `aud` | `auth/jwt.strategy.ts` | Portal **precisa** de secret próprio (`PORTAL_JWT_SECRET`), não só `aud` (§7.2) |
| A10 | Senhas usam `argon2` | `user.service.ts`, `auth.controller.ts` | PIN do portal usa `argon2` |
| A11 | Proxy do Next redireciona para `/login` qualquer rota sem cookie `token` | `apps/web/src/proxy.ts` | `/portal` precisa entrar como rota pública no proxy (o portal tem auth própria) |
| A12 | DOP Escala já estima efetivo (`DopCrewStaffing`) por papel | `dop-crew.service.ts:159` | Efetivo por turno é extensão natural (§1.5) |
| A13 | Crew solver: worker threads + SSE + jobs por plano + `CrewScoreAggregate` compartilhado entre tela e solver | `docs/architecture/transit/crew-solver.md` | O gerador de escala reaproveita a mesma infraestrutura e o mesmo princípio ("otimiza o que a tela mostra") |
| A14 | `Job` já guarda `input`/`output` por execução | `core.prisma` | Parâmetros de cada geração de escala (horizonte, limite de alterações…) ficam em `Job.input` — sem modelo de "execução" |
| A15 | `VehicleType` (STANDARD, ARTICULATED…) é o mesmo enum em `Vehicle`, `VehicleBlock.vehicleType` e `TransitLine.vehicleTypes` | `fleet.prisma`, `transit.prisma` | Habilitação do condutor por tipo de veículo usa o mesmo enum |
| A16 | `VehicleStatus.MAINTENANCE` não tem período | `fleet.prisma` | Indisponibilidade de veículo precisa de evento com datas (§3) |

---

## Fase 1 — Turno na escala lógica

Única fase da camada lógica. Fecha a lacuna antes da escala real.

### 1.1 Modelo

Turno por **branch** (resposta da v1).

```prisma
// A work shift of a branch ("turno") — a window of constraints a duty must fit, not a label.
// A crew member is bound to one (CrewMemberShift, Phase 2); a duty gets the one it fits.
model CrewShift {
  id        String   @id @default(uuid())
  branchId  String
  code      String
  name      String
  // tie-break when a duty fits several shifts — lower wins
  priority  Int      @default(0)
  // ShiftRules (packages/schemas/transit/crew-shift.schema.ts)
  rules     Json
  isActive  Boolean  @default(true)
  createdAt DateTime @default(now())
  updatedAt DateTime @updatedAt

  branch  Branch            @relation(fields: [branchId], references: [id])
  duties  Duty[]

  @@unique([branchId, code])
  @@map("transit_crew_shifts")
}
```

```ts
// Each window reuses the range criterion's bands, in minutes of the operational day:
// outside [floor, ceiling] → doesn't fit (hard); outside [idealMin, idealMax] → fits, costs score.
const shiftWindowSchema = z.object({
  floor: z.number().int().min(0), idealMin: z.number().int().min(0),
  idealMax: z.number().int().min(0), ceiling: z.number().int().min(0),
})

export const shiftRulesSchema = z.object({
  start:      shiftWindowSchema,   // sign-on (DutySummary.startMinutes)
  end:        shiftWindowSchema,   // sign-off (DutySummary.endMinutes) — may run past 1440
  allowSplit: z.boolean(),         // SPLIT duties fit this shift
})

// The crew member's override (Phase 2): any field set replaces the shift's
export const shiftRulesOverrideSchema = shiftRulesSchema.partial()
```

Exemplo — Manhã: `start {floor 210, idealMin 240, idealMax 420, ceiling 480}` (03:30–08:00,
ideal 04:00–07:00), `end {floor 0, idealMin 0, idealMax 840, ceiling 900}` (até 15:00, ideal até
14:00), `allowSplit: false`.

Diferenças em relação à v1:
- `máxMinutosNoturnos` fora (consideração do usuário).
- Cadeia de herança fica **Turno → ajuste do condutor**. O nível "padrão do Scope" sai: com
  turno por branch, o turno já é o padrão (ver D1).
- `modifier`/`active` não ficam no turno: o peso do encaixe ideal é um critério único em
  `transit.roster` (`shiftFit`, §5.4), igual para todos os turnos.

### 1.2 Turno na `Duty`

```prisma
model Duty {
  // ...
  // derived on recalculate (best-fitting CrewShift of the duty's branch) unless shiftPinned
  shiftId     String?
  shiftPinned Boolean  @default(false)
  shift       CrewShift? @relation(fields: [shiftId], references: [id], onDelete: SetNull)
}
```

Regra de derivação (no `recalculate` do `CrewPlanService`, onde `evaluateDuty` já roda):
1. `branchId` nulo → `shiftId = null`, sem issue (o `BRANCH_MISMATCH`/falta de operador já
   aparece por outro caminho).
2. Candidatos = turnos ativos do branch cuja janela `start` contém `startMinutes`, `end` contém
   `endMinutes` (entre floor e ceiling) e, se `kind = SPLIT`, `allowSplit`.
3. Escolhe o de menor `priority`; empate → o de menor distância ao ideal (start + end).
4. Nenhum candidato → `shiftId = null` + issue `SHIFT_NONE` (warning).
5. `shiftPinned` → mantém o turno escolhido pelo usuário; se ele não couber mais → issue
   `SHIFT_MISMATCH` (warning). Nunca bloqueia o save (padrão de `Duty.issues`).
6. `STANDBY` sem horário (sem início/fim) → sem turno.

Novos códigos em `dutyIssueSchema.code`: `SHIFT_NONE`, `SHIFT_MISMATCH`.

### 1.3 Summary

`crewPlanSummarySchema` ganha:

```ts
byShift: z.array(z.object({
  branchId: z.string().nullable(),
  shiftId:  z.string().nullable(),   // null = duties without a shift
  role:     z.string(),
  dutyCount: z.number(),
})).default([]),
```

### 1.4 Telas

- Cadastro de turno: resource genérico `transit/crew-shift` (filho de nada; aparece no sidebar).
  O form da janela é um editor de faixa — reaproveitar o editor de range criterion das
  configurações, exibindo H:MM (`DurationInput`, já usado nos settings de transit).
- Lista/Gantt da escala lógica: coluna "Turno" e filtro por turno; o seletor da duty permite
  fixar o turno (`shiftPinned`).
- Card no resumo do CrewPlan: tabelas por turno × branch.

### 1.5 Efetivo por turno (opcional nesta fase)

O DOP Escala já estima efetivo por papel (A12). Estender para papel × turno. A conta fica
completa só com o regime de folgas (Fase 2); até lá mostra tabelas/dia por turno.

### 1.6 Entregáveis

| Arquivo | Mudança |
|---|---|
| `packages/schemas/transit/crew-shift.schema.ts` | novo |
| `apps/api/prisma/schema/transit.prisma` | `CrewShift`, `Duty.shiftId/shiftPinned` |
| `apps/api/src/modules/transit/timetabling/crew-shift/*` | service/controller/module |
| `crew-plan/crew-scoring.calc.ts` / `crew-plan.service.ts` | derivação + issues + `byShift` |
| `packages/schemas/transit/duty.schema.ts`, `crew-plan.schema.ts` | issues, `shiftId`, `byShift` |
| web: lista/Gantt/resumo da escala lógica | coluna, filtro, pin, card |

---

## Fase 2 — Cadastros do condutor

### 2.1 `CrewMember`

Extensão 1:1 de `Employee`, no domínio `transit` (é perfil operacional, não RH).

```prisma
model CrewMember {
  id          String   @id @default(uuid())
  employeeId  String   @unique
  role        CrewRole @default(DRIVER)
  // out of the generator when false (still assignable by hand)
  isRosterable Boolean @default(true)
  // ShiftRulesOverride — only the fields that differ from the bound shift
  shiftOverride Json?
  restPatternId String?
  // position of day 1 of the pattern on restAnchorDate (see RestPattern)
  restAnchorDate DateTime? @db.Date
  // VehicleType[] this person may NOT operate (e.g. ARTICULATED) — empty = all
  blockedVehicleTypes VehicleType[] @default([])
  // optional fixed car: the generator keeps it when it can; empty = habitual car (Phase 5)
  preferredVehicleId String?
  // overrides the contract's monthly hours (D4)
  monthlyHours  Int?
  licenseCategory  String?
  licenseExpiresAt DateTime? @db.Date
  // collective transport course (curso de transporte coletivo)
  courseExpiresAt  DateTime? @db.Date
  // CrewPreferences — { overtime: 'LIKES' | 'NEUTRAL' | 'AVOIDS' } — grows freely
  preferences Json?
  portalProfileId String?
  // PortalPermissions override (Phase 7)
  portalOverride  Json?
  notes       String?
  createdAt   DateTime @default(now())
  updatedAt   DateTime @updatedAt

  employee         Employee          @relation(fields: [employeeId], references: [id])
  restPattern      RestPattern?      @relation(fields: [restPatternId], references: [id])
  preferredVehicle Vehicle?          @relation(fields: [preferredVehicleId], references: [id])
  shifts           CrewMemberShift[]
  lines            CrewMemberLine[]
  absences         CrewAbsence[]

  @@map("transit_crew_members")
}
```

- **Branch**: vem de `Employee.branchId` (consideração do usuário).
- **Função**: `role` é `CrewRole`. A função do contrato (`JobTitle`) é a referência de RH; ver D2
  para como elas se ligam.
- **Criação**: em massa a partir de `Employee` (ação "Gerar perfis de condutor" filtrando por
  branch/status), além do CRUD individual. Ver D3.

### 2.2 Turno do condutor (com histórico)

```prisma
model CrewMemberShift {
  id           String    @id @default(uuid())
  crewMemberId String
  shiftId      String
  validFrom    DateTime  @db.Date
  // null = current
  validTo      DateTime? @db.Date

  crewMember CrewMember @relation(fields: [crewMemberId], references: [id], onDelete: Cascade)
  shift      CrewShift  @relation(fields: [shiftId], references: [id])

  @@index([crewMemberId, validFrom])
  @@map("transit_crew_member_shifts")
}
```

Regras:
- Sem sobreposição de vigência por condutor (validado no service; mesma lógica de corte de
  `activationEffect`: novo vínculo corta o anterior no dia anterior).
- Turno do condutor tem que ser do mesmo branch do `Employee`.
- **Janela efetiva** em uma data = `rules` do turno vigente, com `shiftOverride` aplicado campo
  a campo. Sem turno vigente → condutor sem restrição de horário (D5).

### 2.3 Linhas do condutor

```prisma
enum CrewLineAccess {
  ENABLED   // whitelist mode: may operate
  BLOCKED   // blacklist mode: may not operate
}

// One row per (crew member, line): access and/or preference rank
model CrewMemberLine {
  id           String          @id @default(uuid())
  crewMemberId String
  lineId       String
  // null = no explicit access (blacklist mode: allowed by default; whitelist mode: not allowed)
  access       CrewLineAccess?
  // 1 = primary, 2 = secondary, ... up to roster.maxPreferredLines; null = not preferred
  rank         Int?
  createdAt    DateTime        @default(now())
  updatedAt    DateTime        @updatedAt

  crewMember CrewMember  @relation(fields: [crewMemberId], references: [id], onDelete: Cascade)
  line       TransitLine @relation(fields: [lineId], references: [id])

  @@unique([crewMemberId, lineId])
  @@unique([crewMemberId, rank])
  @@map("transit_crew_member_lines")
}
```

Modo por branch em `transit.roster` (`lineAccessMode: 'WHITELIST' | 'BLACKLIST'`).

**Pode operar a linha L** =
- `WHITELIST`: existe linha com `access = ENABLED`.
- `BLACKLIST`: não existe linha com `access = BLOCKED`.

Validações (service):
- `rank` só se o condutor pode operar a linha (no modo atual do branch). Logo, no `WHITELIST`
  rank exige `ENABLED`; no `BLACKLIST` rank exige `access != BLOCKED`.
- `rank` entre 1 e `maxPreferredLines`; ranks contíguos (1, 2, 3 — sem pular).
- `access` só editável por usuário (gestor); `rank` editável por usuário e pelo portal.
- Linha de outro Scope que não o do branch: permitido? (D6).

Troca de modo do branch: valores do modo antigo ficam no banco e são ignorados (`ENABLED` não
tem efeito em `BLACKLIST`, e vice-versa). A tela avisa quantos vínculos ficam sem efeito. Ranks
que deixam de ser válidos viram pendência no cadastro, não são apagados.

### 2.4 Tipo de veículo

`CrewMember.blockedVehicleTypes` (lista de bloqueio, porque a maioria opera tudo).
Regra rígida do gerador: condutor não pega tabela cujas pegadas cobrem bloco com
`vehicleType` bloqueado. Na alocação manual: issue `VEHICLE_TYPE_BLOCKED`.

`RosterSettings.range.driverPrefTech` sai (A3). Ver D7 sobre combustível/transmissão.

### 2.5 Ausências

```prisma
// Kind of absence — férias, atestado, afastamento INSS, folga compensada, licença...
model CrewAbsenceType {
  id        String   @id @default(uuid())
  code      String   @unique
  name      String
  // counts as worked hours toward the monthly load (e.g. paid leave) — see D8
  countsAsWorked Boolean @default(false)
  // may be requested through the portal (limits live in the portal profile)
  requestable    Boolean @default(false)
  isActive  Boolean  @default(true)
  createdAt DateTime @default(now())
  updatedAt DateTime @updatedAt

  absences CrewAbsence[]

  @@map("transit_crew_absence_types")
}

enum CrewAbsenceStatus {
  REQUESTED
  APPROVED
  REJECTED
  CANCELLED
}

model CrewAbsence {
  id            String            @id @default(uuid())
  crewMemberId  String
  typeId        String
  startDate     DateTime          @db.Date
  // inclusive
  endDate       DateTime          @db.Date
  status        CrewAbsenceStatus @default(APPROVED)
  // who asked: a staff user, or the crew member through the portal
  requestedByUserId String?
  requestedViaPortal Boolean      @default(false)
  reviewedByUserId  String?
  reviewedAt    DateTime?
  notes         String?
  createdAt     DateTime          @default(now())
  updatedAt     DateTime          @updatedAt

  crewMember CrewMember      @relation(fields: [crewMemberId], references: [id], onDelete: Cascade)
  type       CrewAbsenceType @relation(fields: [typeId], references: [id])

  @@index([crewMemberId, startDate])
  @@map("transit_crew_absences")
}
```

- Lançada por usuário nasce `APPROVED`; pelo portal nasce `REQUESTED`.
- Só `APPROVED` tira o condutor da escala.
- Aprovar ausência que cai em dia já escalado → o dia ganha pendência `ABSENT_ASSIGNED` (Fase 4);
  não desfaz a alocação sozinho.
- Autoria explícita (`requestedByUserId` / `requestedViaPortal`) em vez de autoria polimórfica
  genérica — resolve a questão de auditoria da v1 só onde o portal escreve.

### 2.6 Carga mensal

Resposta da v1: carga de **210h mensais**, semanal projetada.

- `Contract` ganha `monthlyHours Int?`. Semanal projetada = `monthlyHours / 5` (convenção CLT:
  220 ↔ 44, 210 ↔ 42). `weeklyHours` existente continua como está (D4).
- **Carga efetiva** de um condutor =
  `CrewMember.monthlyHours ?? Contract ativo.monthlyHours ?? transit.roster(branch).defaultMonthlyHours`.
  O fallback de branch é necessário porque o sync não cria contratos (A4).
- Ausência `countsAsWorked = false` reduz a carga do mês proporcionalmente aos dias (D8).

### 2.7 Regime de folgas

```prisma
// Named day-off cycle — e.g. "6x1 rotativo" = 49-day string with the day off walking one
// weekday per week, "5x2" = "WWWWWOO", "12x36" = "WO".
model RestPattern {
  id        String   @id @default(uuid())
  branchId  String
  name      String
  // one char per day of the cycle: W = work, O = off
  pattern   String
  createdAt DateTime @default(now())
  updatedAt DateTime @updatedAt

  branch      Branch       @relation(fields: [branchId], references: [id])
  crewMembers CrewMember[]

  @@unique([branchId, name])
  @@map("transit_rest_patterns")
}
```

- Dia do ciclo em uma data = `(date - restAnchorDate) mod pattern.length`.
- Cobre ciclo fixo, rotativo (ciclo de 7 semanas) e 12x36 com uma única representação.
- Domingo a cada N semanas: em vez de regra no gerador, é propriedade do padrão. A tela do
  padrão mostra "domingos de folga a cada X semanas" calculado, para conferência com a CCT.
- Folga do padrão é **sugestão materializada** (Fase 4/5 grava `DAY_OFF`); o usuário pode trocar.
- Alternativa (folga livre, decidida pelo gerador com limites) em D9.

### 2.8 `transit.roster` por branch

`TransitRosterConfigService` passa para escopo `branch` (A1/A2). Schema novo:

```ts
rosterSettingsSchema = z.object({
  lineAccessMode:      z.enum(['WHITELIST', 'BLACKLIST']).default('BLACKLIST'),
  maxPreferredLines:   z.number().int().min(0).max(10).default(3),
  // weight share of each rank for the preferred-line criterion: rank 1 = [0], ...
  preferredLineGrades: z.array(z.number().min(0).max(100)).default([100, 60, 30]),
  defaultMonthlyHours: z.number().int().min(1).max(300).default(210),
  // days looked back to find a crew member's habitual car
  habitualVehicleDays: z.number().int().min(1).max(90).default(14),
  reserveTargets: z.array(z.object({
    dayTypeId:    z.uuid().meta({ resource: 'day-type', domain: 'transit' }),
    startMinutes: z.number().int().min(0),
    endMinutes:   z.number().int().min(0).nullable(),
    localityId:   z.uuid().meta({ resource: 'locality', domain: 'transit' }),
    count:        z.number().int().min(1),
  })).default([]),
  range: z.object({
    interShiftRest: rangeCriterionSchema,   // kept (DOP reads it)
    driverPrefLine: rangeCriterionSchema,   // new meaning: weighted by rank (§5.4)
    shiftFit:       rangeCriterionSchema,   // distance to the shift's ideal window
  }),
})
```

`.meta({ resource, domain })` nos ids garante integridade (padrão do `BaseSettingsService`).
Os nomes exatos de resource (`day-type`, `locality`) seguem os já registrados.

---

## Fase 3 — Frota

```prisma
// A vehicle out of service over a date range (maintenance, inspection, accident...)
model VehicleUnavailability {
  id        String    @id @default(uuid())
  vehicleId String
  startDate DateTime  @db.Date
  // null = open-ended
  endDate   DateTime? @db.Date
  reason    String
  notes     String?
  createdAt DateTime  @default(now())
  updatedAt DateTime  @updatedAt

  vehicle Vehicle @relation(fields: [vehicleId], references: [id], onDelete: Cascade)

  @@index([vehicleId, startDate])
  @@map("vehicle_unavailabilities")
}
```

- Veículo elegível para um bloco num dia: `status = ACTIVE`, sem indisponibilidade na data,
  `vehicleType` igual ao do bloco (D10 sobre aceitar tipo "maior"), `branchId` igual ao do bloco.
- `VehicleStatus.MAINTENANCE` continua para o estado "agora"; o período vem da tabela nova.

---

## Fase 4 — Escala diária materializada

### 4.1 Opção recomendada: instância diária reaproveita `VehiclePlan`/`CrewPlan`

Materializar o dia = **clonar** o `VehiclePlan` e o `CrewPlan` em vigor para uma instância
marcada com a data operacional. Tudo que já existe passa a funcionar no dia sem reescrita:
Gantt, `recalculate`, issues de bloco e de tabela, pegadas, solvers, exportações.

```prisma
model VehiclePlan {
  // ...
  // set on a daily instance — the materialized operation of this date; null = logical plan
  operationalDate DateTime? @db.Date
  // DailyStatus — only on daily instances
  dailyStatus     DailyStatus?
  // the logical plans this day was built from — [{ vehiclePlanId, crewPlanId, lineIds }]
  dailySources    Json?

  @@unique([scopeId, operationalDate])
}

enum DailyStatus {
  PLANNED     // being built / generated
  PUBLISHED   // visible to crew (portal), changes are tracked
  CLOSED      // executed — read-only
}

model VehicleBlock {
  // ...
  // the real vehicle on a daily instance
  vehicleId String?
}
```

- O `CrewPlan` clonado aponta para o `VehiclePlan` clonado (relação já existente). `status`
  das instâncias fica fora do ciclo de ativação (`DRAFT/ACTIVE/SUPERSEDED` não se aplica):
  filtros, telas de plano e `activate` ignoram `operationalDate != null`.
- Volume: cerca de 1 cópia de trips/blocos/duties por scope por dia. Para ~2.000 viagens/dia
  são ~730 mil linhas/ano em `transit_trips`. Postgres aguenta, mas pede índice por
  `vehiclePlanId` (já existe via FK) e política de arquivamento (D11).
- A alternativa (tabelas dedicadas `DayBlock`/`DayDuty`) exigiria reescrever Gantt, validação e
  solver para o dia. Ver D12.

### 4.2 Materialização

Entrada: `scopeId` + data `D`.

1. Para cada linha ativa do Scope: `dayType = resolveDayType(D, line)`;
   `plan = findActivePlan(scope, dayType, D)` (A7) e o `CrewPlan` em vigor dele.
2. Agrupa linhas por plano resultante.
   - **Dia normal** (um plano): clona tudo.
   - **Dia misto** (mais de um plano): de cada plano `P` clona os blocos, mas só mantém viagens
     das linhas que resolveram para `P`; deadruns/intervalos ficam como estão. Duties de cada
     plano são clonadas com as pegadas; pegada que perdeu viagens fica `isStale`.
3. `dayTypeId` da instância = dayType de padrão da data (`resolveByPattern`); `dailySources`
   registra a origem por linha.
4. Nada é ajustado automaticamente (v1). O resultado já sai com as pendências calculadas pelo
   `recalculate` existente + as pendências do dia (§4.4).
5. Materializar data que já existe → não faz nada (idempotente). "Rematerializar" (descartar o
   dia e clonar de novo) é ação explícita, só em `PLANNED`.

### 4.3 Alocação — fonte única

```prisma
enum RosterEntryKind {
  DUTY       // works a duty of the day (DutyId)
  STANDBY    // plantão generated from the reserve target (a STANDBY duty of the day)
  DAY_OFF    // folga do regime
  COMP_OFF   // folga compensada (abate banco de horas)
}

// What a crew member does on an operational date — THE roster. One row per person per day.
// Absences are not rows here: they come from CrewAbsence (APPROVED) and win over any row.
model RosterEntry {
  id           String          @id @default(uuid())
  crewMemberId String
  date         DateTime        @db.Date
  kind         RosterEntryKind
  // a duty of the daily instance (DUTY / STANDBY)
  dutyId       String?         @unique
  // kept by the generator on reprocessing
  locked       Boolean         @default(false)
  // GENERATED | MANUAL
  source       String          @default("MANUAL")
  createdAt    DateTime        @default(now())
  updatedAt    DateTime        @updatedAt

  crewMember CrewMember @relation(fields: [crewMemberId], references: [id], onDelete: Cascade)
  duty       Duty?      @relation(fields: [dutyId], references: [id], onDelete: SetNull)

  @@unique([crewMemberId, date])
  @@index([date])
  @@map("transit_roster_entries")
}
```

- "Escala mensal" = `RosterEntry` de um intervalo de datas. Não há outro modelo.
- Plantão gerado pela meta de reserva é uma `Duty` `STANDBY` criada na instância diária, com
  `DutyActivity STANDBY` no horário/local da meta. Mesma estrutura do `STANDBY` lógico
  (v1 §9), que já vem clonado do plano e conta para a meta.
- Veículo do dia: `VehicleBlock.vehicleId` na instância.
- Horas trabalhadas da pessoa no dia = `Duty.summary.paidMinutes` da duty alocada (D13 sobre
  qual minuto conta para a carga).

### 4.4 Pendências do dia

Calculadas por dia, armazenadas no summary da instância (lista) e marcadas nas entidades.
Nunca bloqueiam save.

| Código | Onde | Regra |
|---|---|---|
| `DUTY_UNASSIGNED` | Duty | tabela DRIVER sem `RosterEntry` |
| `BLOCK_NO_VEHICLE` | VehicleBlock | bloco sem `vehicleId` |
| `VEHICLE_DOUBLE` | VehicleBlock | mesmo veículo em blocos com horário sobreposto |
| `VEHICLE_UNAVAILABLE` | VehicleBlock | veículo inativo/indisponível na data |
| `VEHICLE_TYPE_MISMATCH` | VehicleBlock | tipo do veículo ≠ tipo do bloco |
| `CREW_ABSENT` | RosterEntry | condutor com ausência aprovada na data |
| `LINE_NOT_ALLOWED` | RosterEntry | tabela com linha que o condutor não pode operar |
| `VEHICLE_TYPE_BLOCKED` | RosterEntry | tabela cobre tipo de veículo bloqueado para ele |
| `SHIFT_WINDOW` | RosterEntry | tabela fora da janela efetiva (floor/ceiling) do condutor |
| `INTER_SHIFT_REST` | RosterEntry | interjornada com o dia anterior/seguinte abaixo do floor |
| `BRANCH_MISMATCH` | RosterEntry | condutor de outro branch (já existe para duty × bloco) |
| `TRIP_UNCOVERED` | Trip | viagem do dia misto sem bloco (perdeu o bloco na composição) |
| `LICENSE_EXPIRED` | RosterEntry | CNH/curso vencido na data |
| `RESERVE_SHORT` | dia | plantões abaixo da meta da faixa |

Interjornada entre datas: fim da duty em `D` = `endMinutes` (pode passar de 1440); início em
`D+1` = `1440 + startMinutes`; descanso = diferença.

### 4.5 Ciclo

`PLANNED` → `PUBLISHED` → `CLOSED`.
- `PUBLISHED`: portal enxerga; alterações seguem permitidas (troca de última hora), mas a
  instância passa a registrar o histórico de mudanças da alocação (D14).
- `CLOSED`: somente leitura; base para horas realizadas do mês.

---

## Fase 5 — Gerador de escala (rostering)

### 5.1 Parâmetros (tela de geração → `Job.input`)

| Parâmetro | Uso |
|---|---|
| `branchId` | um gerador por branch (o bloqueio de branch é regra rígida) |
| `role` | DRIVER por padrão |
| `from`, `to` | horizonte; materializa as datas que faltam |
| `ensureMonthlyLoad` | liga o critério de carga mensal |
| `maxChanges` | trocas de tabela por condutor no horizonte |
| `loadPeriod` | período da carga (mês civil por padrão; D15) |

Dias antes de `from` (e `RosterEntry.locked`) são **fixos**; as horas e as trocas já feitas no
período da carga entram nas contas.

### 5.2 Regras rígidas (nunca violadas pelo gerador)

1. Condutor ativo (`Employee.status = ACTIVE`, `isRosterable`).
2. Sem ausência aprovada na data; respeita `DAY_OFF` do regime.
3. Uma entrada por pessoa por data.
R. Certo, mais manualmente o usuario pode alocar o mesmo condutor em duas escalas (desde que não aja sobreposição), sistema apenas alerta duplicidade
4. Mesmo branch do condutor e da tabela.
5. Linha permitida (modo do branch) para todas as linhas da tabela.
6. Tipo de veículo não bloqueado.
7. Tabela dentro da janela efetiva (floor/ceiling de start e end; `allowSplit`).
8. Interjornada ≥ floor de `interShiftRest`, inclusive com dias fixos vizinhos.
9. Trocas de tabela ≤ `maxChanges`.
10. CNH e curso válidos na data.
R. Adicionar propriedade de comportamento, uma para cada caso, se o gerador alerta ou bloqueia, se apenas alerta, escala o condutor normalmente e deixa notificação no dia

### 5.3 Continuidade e trocas

- Assinatura da tabela = (linha dominante, turno). Linha dominante = maior parcela de minutos
  de viagem na tabela (já calculada por linha em `CrewPlanSummary.byLine`; aqui por duty).
- **Troca** = a assinatura do dia é diferente da última assinatura trabalhada pelo condutor
  (folga, ausência e plantão não contam nem quebram a sequência).

### 5.4 Critérios leves (score)

Mesmo formato dos outros solvers (`rangeCriterionSchema`, peso, `rawScore`):

| Critério | Medida |
|---|---|
| `driverPrefLine` | % dos minutos de viagem da escala em linha preferencial, ponderado pela gradação (`preferredLineGrades`) |
| `shiftFit` | distância do início/fim da tabela ao ideal da janela efetiva |
| `interShiftRest` | interjornada fora do ideal |
| carga mensal (com `ensureMonthlyLoad`) | déficit projetado de horas no período — só déficit (v1) |
| preferência de hora extra (sem `ensureMonthlyLoad`) | `LIKES` premia, `AVOIDS` penaliza horas acima da carga |
| continuidade | cada troca custa (além do limite rígido) — o gerador só troca quando paga |

### 5.5 Algoritmo (proposta)

1. **Construção dia a dia**: para cada data do horizonte, atribuição de custo mínimo
   (Hungarian / min-cost matching) entre condutores disponíveis e tabelas do dia, com custo =
   critérios acima, considerando o estado acumulado (última assinatura, trocas gastas, horas
   projetadas). Rápido e explicável.
2. **Melhoria**: simulated annealing sobre a sequência inteira (troca de tabelas entre dois
   condutores em uma faixa de dias), como o `CrewImprover`. Mesma infraestrutura do crew solver
   (A13): worker threads, SSE, job em segundo plano, propostas comparáveis na tela.
3. **Reserva**: condutores sem tabela no dia preenchem a meta de reserva (por horário, local),
   descontando `STANDBY` lógico já existente. O que sobrar fica sem entrada e aparece como
   "disponível" — o usuário decide (mais plantão, `COMP_OFF`…).
4. **Veículo** (passo separado, depois da tripulação, por dia):
   - âncora do bloco = condutor da manhã (pegada que começa mais cedo; v1);
   - prioridade: `preferredVehicleId` do âncora → carro habitual do âncora (mais frequente nos
     últimos `habitualVehicleDays` trabalhados) → carro habitual do outro condutor → qualquer
     elegível (§3);
   - matching de custo mínimo entre veículos elegíveis e blocos.

Resultado: proposta → usuário aceita → grava `RosterEntry` (`source = GENERATED`) e
`VehicleBlock.vehicleId`. Entradas `locked`/manuais dentro do horizonte são respeitadas (D16).

---

## Fase 6 — Reparo do dia

Ação na instância diária, disparada pelo usuário, com direcionamento:

| Direcionamento | Resolve |
|---|---|
| Cobrir tabelas sem condutor | `DUTY_UNASSIGNED`, `CREW_ABSENT` — usa reservas/plantões e disponíveis do dia, respeitando §5.2 |
| Encaixar veículos | `BLOCK_NO_VEHICLE`, `VEHICLE_DOUBLE`, `VEHICLE_UNAVAILABLE`, `VEHICLE_TYPE_MISMATCH` |
| Recompor dia misto | `TRIP_UNCOVERED` e pegadas `isStale` — reencaixa viagens órfãs nos blocos (vehicle solver restrito) e ajusta pegadas (crew solver com duties não afetadas `locked`) |

Escopo mínimo: só mexe em entidades com pendência; o resto entra como `locked`. Os solvers
existentes já respeitam `constraints.locked` em blocos e duties.

---

## Fase 7 — Portal do condutor

### 7.1 Modelos

```prisma
// Portal credentials — never exposed by a generic controller
model CrewAccess {
  id             String    @id @default(uuid())
  crewMemberId   String    @unique
  pinHash        String
  mustChangePin  Boolean   @default(true)
  failedAttempts Int       @default(0)
  lockedUntil    DateTime?
  lastLoginAt    DateTime?
  // bumped on PIN reset / forced logout — tokens with an older version are rejected
  tokenVersion   Int       @default(0)
  createdAt      DateTime  @default(now())
  updatedAt      DateTime  @updatedAt

  crewMember CrewMember @relation(fields: [crewMemberId], references: [id], onDelete: Cascade)

  @@map("transit_crew_access")
}

model PortalProfile {
  id          String   @id @default(uuid())
  branchId    String
  name        String
  // PortalPermissions — { viewRoster, requestAbsence, editPreferredLines,
  //   absenceLimits: [{ absenceTypeId, maxDays, periodDays }] }
  permissions Json
  createdAt   DateTime @default(now())
  updatedAt   DateTime @updatedAt

  @@unique([branchId, name])
  @@map("transit_portal_profiles")
}
```

Permissões efetivas = `PortalProfile.permissions` com `CrewMember.portalOverride` por cima.

### 7.2 Auth

- Login: `Employee.code` + PIN de 6 dígitos (`argon2`, A10).
- PIN inicial: 6 primeiros dígitos do CPF, gravado ao criar o `CrewAccess` (criado junto com o
  `CrewMember` ou ao habilitar o portal); `mustChangePin = true`. Reset pelo gestor volta a isso
  e incrementa `tokenVersion`.
- Token com **secret próprio** (`PORTAL_JWT_SECRET`): obrigatório, não só `aud` — a
  `JwtStrategy` atual aceita qualquer token assinado com `JWT_SECRET` (A9). Payload
  `{ sub: crewMemberId, tv: tokenVersion }`.
- Guard do portal a cada requisição: `CrewAccess.tokenVersion == tv`, `Employee.status = ACTIVE`,
  `mustChangePin` só libera a rota de troca de PIN.
- Bloqueio: N tentativas falhas → `lockedUntil` (ex.: 5 tentativas, 15 min). Rate limit por IP
  no endpoint de login.
- Endpoints em `/api/portal/*`, controller próprio (não estende `BaseController`):
  `POST auth/login`, `POST auth/change-pin`, `GET me`, `GET roster?from&to`,
  `GET/POST absences`, `GET/PUT preferred-lines`.

### 7.3 Frontend

- Rotas `apps/web/src/app/portal/*` com layout próprio, mobile-first.
- `/portal` entra como pública no `proxy.ts` (A11); o portal controla a própria sessão.
- Token em chave própria (`portalToken`), sem o cookie `token` dos usuários.
- Sem sidebar/topbar/discovery do sistema principal.

---

## Regras consolidadas

| Regra | Tipo | Onde vale |
|---|---|---|
| Tabela cabe na janela do turno (floor/ceiling) | rígida no gerador, pendência no manual | Fases 1 (derivação), 5 |
| Linha permitida pelo modo do branch | rígida no gerador, pendência no manual | Fases 2, 4, 5 |
| Preferencial só entre linhas permitidas | validação de cadastro | Fase 2 |
| Tipo de veículo bloqueado | rígida no gerador, pendência no manual | Fases 2, 4, 5 |
| Mesmo branch condutor × tabela | rígida no gerador, pendência no manual | Fases 4, 5 |
| Interjornada ≥ floor | rígida no gerador, pendência no manual | Fases 4, 5 |
| Trocas ≤ limite do período | rígida no gerador | Fase 5 |
| Carga mensal — só déficit | leve (com a opção ligada) | Fase 5 |
| Preferência de hora extra | leve (com a opção de carga desligada) | Fase 5 |
| Carro fixo → habitual → outro | leve (passo de veículo) | Fase 5 |
| STANDBY lógico conta para a meta de reserva | regra de cálculo | Fase 5 |
| Dia materializado sem ajuste automático | regra de fluxo | Fase 4 |

---

## Dúvidas

Responda abaixo de cada uma (`R.:`).

**D1 — Nível "padrão do Scope" do turno.** Com turno por branch, proponho cadeia de dois níveis
(Turno → condutor) e remover o "padrão do Scope" da v1. Concorda?
R.: Concordo

**D2 — Função do condutor × contrato.** O `Contract` liga a `JobTitle` (função de RH). Opções:
(a) `JobTitle` ganha `crewRole CrewRole?` e o `CrewMember.role` é **derivado** do contrato
ativo; (b) `CrewMember.role` é gravado, sugerido pelo `JobTitle` na criação. Como o sync não cria
contratos (A4), (a) deixaria condutor sem função até alguém cadastrar contrato. Proponho (b).
R,: Eu entendo que a criação de um Employee eh transparente para o modulo de transit, aqui so existe funcionario quando criado um CrewMember manualmente pelo usuário, e na criação ele escolhe uma role, eu não vejo ganhor real envolver JobTitle aqui, pois uma role (DRIVER) pode vir de JobTitle Motorista, Motorista de Micro, Motorista Pleno, etc... se não eh essaa a duvida me detalhe melhor

**D3 — Criação do `CrewMember`.** Em massa a partir dos funcionários (filtro por branch/status;
função via D2) + manual. Ou deveria ser automática no sync quando a função for de condutor?
R.: Acho que tudo manual, ao criar deve informar algumas coisas necessárias (turno pelo menos), até pensar em uma inclusçao em massa (desde que todos compartilhem as mesmas caracteristicas), mais nao quero fazer sync automatico agora nao

**D4 — Carga no contrato.** "210 mensais e projeta a semanal": proponho adicionar
`Contract.monthlyHours` e projetar semanal = mensal / 5 (210 → 42h). O `weeklyHours` atual fica
(ou sai?). Confirma a fórmula? E o fallback por branch (`defaultMonthlyHours = 210`) quando não
há contrato?
R.: Se nao me engano as regras trabalhistas todas tratam das horas semanais, e horas mensais são usadas no processos da folha de pagamento (fora do escopo do app), se fizer sentido acho que pode manter as horas semanais e projeta a mensal (pra mim eh indifernte, pode me dar sua sugestão)

**D5 — Condutor sem turno.** Sem turno vigente: (a) sem restrição de horário; (b) fica fora do
gerador até ter turno. Proponho (b) — evita alocação "solta".
R.: B fica fora até definir turno

**D6 — Linha fora do Scope do branch.** Um condutor pode ter vínculo com linha de outro Scope
(branch que opera em dois Scopes)? Se sim, a validação é só "linha de algum Scope em que o
branch é `ScopeOperator`".
R.: Não entendi a duvida, se nao me engano um branch nao tem amarração direta com scope, uma questão que quero implementar aqui logo na fase 1 eh uma amarração da linha a um branch, no gerador adicionar um switch "Consistir linha da empresa" que força a alocação desta empresa somente nas linhas dela, mais ainda assim não sei se isso se refere a sua duvida  


**D7 — Habilitação além do tipo.** Só `VehicleType` (articulado etc.), ou também combustível
(elétrico) e transmissão (automático/manual)? Isso exige o bloco/linha saber exigir esses
atributos, o que hoje só existe para `VehicleType`.
R.: So VehicleType na V1


**D8 — Ausência × carga.** Férias/afastamento reduzem a carga do mês proporcionalmente (ex.: 10
dias de férias → carga × 20/30)? Algum tipo conta como trabalhado (`countsAsWorked`)?
R.: Sim, na verdade acho que todas as ausencias, inclusive faltas e atestados devem reduzir a carga mensal, carga eh proporcional aos dias efetivos trabalhados do funcionário, caso contrario (no meu entendimento) o gerador ia sobrecarregar a jornada de alguem que se ausentou por alguns dias para compensar a falta de horas, e isso nao se aplica na pratica 

**D9 — Regime de folga.** Proposta: padrão fixo (`RestPattern`) com âncora por condutor; a folga
sai do padrão e o usuário ajusta. Alternativa: folga livre, decidida pelo gerador com limites
(máx. dias seguidos, domingo a cada N semanas). Qual a prática nas empresas — folga fixa
pré-definida ou definida a cada escala?
R.: fiquei em duvida de qual seria o formato deste RestPattern, mno final deste doc detalho um pouco melhor esta duvida, na prática imagino definir um padrão de folgas por turno (permitindo diferenciar folha do condutor da manha de um dupla pegada, por exemplo) e o gerador segue esse padrão..


**D10 — Tipo de veículo no encaixe.** Bloco `STANDARD` pode receber articulado se faltar carro
(tipo "maior"), ou é sempre igual? Hoje `TransitLine.vehicleTypes.allowed` já lista os tipos
aceitos por linha — usar isso no encaixe do dia?
R.: não, so usar TransitLine.vehicleTypes.allowed dando prioridade no tipo prefered da linha

**D11 — Retenção das instâncias diárias.** Manter para sempre, ou arquivar/compactar após N
meses (mantendo só `RosterEntry` + summary)?
R.: Ponto ainda para decidir, mais abaixo eu questiono se ideia eh realmente usar a mesma tabela de VehiclePlan, essa eh minha principal duvida sobre este aspecto 


**D12 — Instância diária reaproveitando `VehiclePlan`/`CrewPlan` (§4.1).** É a peça mais
estrutural do plano. Concorda com clonar os modelos existentes com `operationalDate`, em vez de
tabelas dedicadas?
R.: Pela sua pergunta já responde algumas duvidas, essa ideia particularmente me assutou um pouco inicialmente, mais não quero ser imperarivo aqui, se vc perceber ganho real quero que me convença

**D13 — Hora que conta para a carga.** `paidMinutes` (inclui sign-on/off, ocioso pago e pausas
pagas) ou `workMinutes`? E hora extra/noturno do dia entram em algum controle do gerador ou só em
relatório?
R.: paidMinutes, tem que somar tudo, e estes dados de extra/noturno, etc, se for otimizar os calculos para resumo poderia entrar em uma summary, mais não sei se vejo urgencia disso 


**D14 — Mudanças após publicar.** Depois de `PUBLISHED`, guardar histórico de quem mudou o quê
(troca de condutor/carro) é necessário na primeira versão, ou basta a alocação final?
R.: Sim, após publicado todas as alterações importantes serem registradas, não sei se uma tabela ou um json na propria escala resolveria, pode me sugerir

**D15 — Período da carga.** Mês civil, ou período de fechamento da folha (ex.: 21 a 20)? Se for
de folha, vira configuração do branch.
R.: melhor já colocar na configuração do branch que cobre qualquer cenário 

**D16 — Alocação manual dentro do horizonte.** Ao reprocessar, uma entrada manual não travada
pode ser trocada pelo gerador, ou toda entrada manual é tratada como travada?
R.: se nao esta travada pode movimentar

**D17 — Um condutor, uma tabela por dia.** Existe caso de um condutor fazer duas tabelas no dia
(ex.: uma meia jornada extra) ou de uma tabela ser dividida entre dois condutores no dia (troca
no meio)? O modelo proposto assume 1 pessoa ↔ 1 tabela por dia.
R.: Automatico pelo gerador não, usuario pode manualmente alocar condutor em duas escalas (desde que sem sobreposição), neste caso sistema apenas alerta

---

## Ordem de implementação

| Fase | Entrega | Depende de |
|---|---|---|
| 1 | `CrewShift`, turno derivado na `Duty`, `byShift`, telas | — |
| 2 | `CrewMember`, `CrewMemberShift`, `CrewMemberLine`, ausências, `RestPattern`, `Contract.monthlyHours`, `transit.roster` por branch | 1 |
| 3 | `VehicleUnavailability` | — |
| 4 | Instância diária, materialização, `RosterEntry`, pendências do dia, alocação manual | 2, 3 |
| 5 | Gerador (tripulação + veículo + reserva) | 4 |
| 6 | Reparo do dia | 4 (5 para reaproveitar o motor) |
| 7 | Portal | 2 (escala no portal depende de 4) |




Outras considerações:
1) notificação para condutor se escala ja liberada mudar
2) sequencia de folgas, vi que no modelo de Crewmember foi adicionado restPatternId e restAnchorDate (otimo), vou colar abaixo um modelo que criei em outra app antigo apenas como referencia, mais não precisa mudar se entende que o que ja foi proposto atende tao bem quanto ou melhor:

# ============================================
# FREQUENCIA / TURNO
# ============================================

class Turno(models.Model):
    class DiaSemana(models.TextChoices):
        DOMINGO = '0', _('Domingo')
        SEGUNDA = '1', _('Segunda')
        TERCA   = '2', _('Terca')
        QUARTA  = '3', _('Quarta')
        QUINTA  = '4', _('Quinta')
        SEXTA   = '5', _('Sexta')
        SABADO  = '6', _('Sabado')

    nome       = models.CharField(_('Nome'), max_length=30, unique=True, blank=False)
    dias_ciclo = models.PositiveIntegerField(_('Dias Ciclo'), default=0)
    inicio     = models.DateField(_('Inicio'), default=datetime.today)
    def __str__(self):
        return self.nome
auditlog.register(Turno)


class TurnoDia(models.Model):
    turno         = models.ForeignKey(Turno, on_delete=models.CASCADE, related_name='dias', verbose_name=_('Turno'))
    posicao_ciclo = models.IntegerField(_('Posicao Ciclo'))
    horarios      = models.JSONField(_('Horarios'), default=list)
    tolerancia    = models.PositiveIntegerField(_('Tolerancia'), default=10)
    eh_folga      = models.BooleanField(_('E Folga'), default=False)
    class Meta:
        constraints = [models.UniqueConstraint(fields=['turno', 'posicao_ciclo'], name='unique_posicao_por_turno')]
        ordering    = ['posicao_ciclo']
    def __str__(self):
        return f'{self.turno.nome} | cicle: {self.posicao_ciclo}'


class TurnoHistorico(models.Model):
    contrato        = models.ForeignKey(Contrato, on_delete=models.CASCADE, related_name='historico_turnos', verbose_name=_('Contrato'))
    turno           = models.ForeignKey(Turno, on_delete=models.PROTECT, verbose_name=_('Turno'))
    inicio_vigencia = models.DateField(_('Inicio Vigencia'), default=datetime.today)
    fim_vigencia    = models.DateField(_('Fim Vigencia'), blank=True, null=True)
    class Meta:
        verbose_name        = _('Historico Turno')
        verbose_name_plural = _('Historicos Turnos')
        ordering            = ['-inicio_vigencia']
    def __str__(self):
        return f'{self.contrato.funcionario.matricula} | {self.turno.nome}'
    def clean(self):
        super().clean()
        if not self.inicio_vigencia or not self.contrato_id:
            return
        if self.fim_vigencia and self.fim_vigencia < self.inicio_vigencia:
            raise ValidationError({'fim_vigencia': _('Data de fim nao pode ser anterior a data de inicio')})
        overlap = TurnoHistorico.objects.filter(contrato_id=self.contrato_id).exclude(pk=self.pk)
        if self.fim_vigencia:
            overlap = overlap.filter(
                Q(fim_vigencia__gte=self.inicio_vigencia) | Q(fim_vigencia__isnull=True),
                inicio_vigencia__lte=self.fim_vigencia
            )
        else:
            overlap = overlap.filter(Q(fim_vigencia__gte=self.inicio_vigencia) | Q(fim_vigencia__isnull=True))
        if overlap.exists():
            raise ValidationError(DEFAULT_MESSAGES.get('recordOverlap'), '')
auditlog.register(TurnoHistorico)

RestPattern precisa (acho) de alguma revisão, exemplo: hoje os condutores da manha e tarde folgam 1 sabado e na outra semana no domingo (revesamento) já os condutores de carro dupla pegada folgam sempre todo domingo e feriados.. (nao estou dizendo que esta errado), a ideia aqui eh criar os dois esquemas de revesamento para cada empresa eh isso? talvez branchId aqui nao ser uma relação de FK, e sim um M2M? (se discorda pode falar)

ao final quals modelos de folga ele precisa representar:
6x1 (contemplando o revesamento que expliquei acima), 5x2, 6x2,  que podem ser folgas consecutivas ou exemplo: (ter+sab | ter+dom), no modelo sugerido eu consigo representar todos estes casos?

3) qual o shape das preferencias do crewmember
4) CrewAbsence da forma que foi proposto consegu responder a pergunta "quantas solicitações do condutor foram feitas e quantas atendidas no periodo"?
5) TransitRosterConfigService, já existe hoje uma entrada no settings para escala de operadores (não utilizada, pode reaproveitar, remover, etc, ao final não deixar residuo de abordagem concorrente, deixar o escopo claro e enxuto)
6) VehicleUnavailability entendo que eh um modelo do domain fleet (e nao transit)
4.1: Materializar o dia = **clonar**, vc mostra o model VehiclePlan com campos operationalDate, dailyStatus, etc...  sua ideia eh usar o mesmo modelo (persistir na mesma tabela)? acho que nao eh isso certo, seria apenas uma herança, usar a mesma tabela acho que eh loucura (se for isso mesmo e entender que é a melhor abordagem por favor insista e me convença)
