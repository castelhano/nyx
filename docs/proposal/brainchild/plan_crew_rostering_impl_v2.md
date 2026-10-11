# Plano v2 — Turnos, escala real (rostering) e portal do condutor

**Status: proposta de implementação fechada — dúvidas Q-A a Q-D e cota de solicitações
respondidas (ver [Dúvidas](#dúvidas)).**

Histórico:
- [`plan_crew_rostering_v1.md`](plan_crew_rostering_v1.md) — decisões de direção.
- [`plan_crew_rostering_impl_v1.md`](plan_crew_rostering_impl_v1.md) — primeira versão do plano,
  com as respostas D1–D17 e as "outras considerações" do usuário.
- Este documento substitui o `impl_v1`: incorpora as respostas, as revisões discutidas depois
  (Q1–Q7) e **descarta** a instância diária gravada nas tabelas de `VehiclePlan`/`CrewPlan`.

Convenções:
- Comentários em snippets Prisma/TS em inglês (regra do repo); texto em pt-BR.
- Minutos desde o início do **dia operacional**, `> 1440` = madrugada seguinte (convenção de
  `TransitTrip`/`DutyPiece`). Datas como `@db.Date` / `'YYYY-MM-DD'` (`plan-validity.ts`).
- Novos resources seguem o padrão de 4 arquivos.
- Cada fase é entregável sozinha.

---

## 0. Pontos do sistema atual que moldam o desenho

| # | Achado | Consequência |
|---|---|---|
| A1 | `Settings` aceita escopo `global`, `branch`, `transitScope`, com fallback para global (`base-settings.service.ts`) | Config por empresa vai em `transit.roster` com escopo `branch` |
| A2 | `transit.roster` é global, só `interShiftRest` é lido (DOP Escala, `dop-crew.service.ts:216`); a tela é `app/transit/settings/page.tsx` | `interShiftRest` migra para `transit.crew` (por scope, CCT); `driverPrefTech` sai; o roster passa a ser por branch, sem resíduo |
| A3 | Sync de funcionários não cria `Contract` | Carga semanal precisa de fallback por branch |
| A4 | `Employee.branchId` e `Employee.status` (sync) | `CrewMember` não tem branch; portal confere `status` |
| A5 | `Duty.branchId` nullable; `DutySummary.startMinutes/endMinutes` = início/fim efetivos | Base do turno derivado |
| A6 | Blocos recebem empresa pelo vehicle solver via `ScopeOperator.share` — não por linha | Linha ↔ empresa (M2M) é conceito novo; interação com o vehicle solver em aberto (Q-A) |
| A7 | `resolveDayType(date, line)` + `findActivePlan` (DOP) | Reaproveitados na materialização do dia |
| A8 | Services do `VehiclePlan` têm efeitos que não podem ocorrer num dia: drift (`isDrifted`, `hasAttributeDrift`), propagação de atributos para `LineDeparture`/OSO, ativação/vigência | Instância diária em **tabelas próprias** (§4) |
| A9 | `evaluateDuty`/`CrewScoreAggregate` (puros, entrada montada em `crew-solver.input.ts`), `validateBlock` (`block-validation.ts`), engine do Gantt (`GanttView/GanttRow/GanttSegment`) | Reuso no dia via adaptador, não via tabela |
| A10 | `JwtStrategy` aceita qualquer token assinado com `JWT_SECRET`, sem `aud` | Portal com `PORTAL_JWT_SECRET` próprio |
| A11 | `argon2` já é usado | PIN usa `argon2` |
| A12 | `proxy.ts` do Next manda para `/login` toda rota sem cookie `token` | `/portal` entra como pública no proxy |
| A13 | Crew solver: workers + SSE + jobs; `Job.input/output` | Gerador reaproveita a infraestrutura; parâmetros em `Job.input` |
| A14 | `TransitLine.vehicleTypes { allowed, preferred }`, `TransitTrip.requiredVehicleType` | Elegibilidade de veículo no dia |

---

## Decisões consolidadas

| Tema | Decisão |
|---|---|
| Turno | Por branch; janela de restrições (start/end com floor/ideal/ceiling, `allowSplit`); cadeia Turno → ajuste do condutor; turno derivado na `Duty` |
| Condutor sem turno | Fora do gerador |
| `CrewMember` | Criado manualmente; função (`CrewRole`) e turno obrigatórios; sem `JobTitle`; inclusão em massa (mesmas características) depois |
| Linha ↔ empresa | M2M, já na Fase 1; linha sem operadora = qualquer empresa do Scope; opção "Consistir linha da empresa" no vehicle solver **e** no gerador de escala; warning `LINE_NOT_OPERATED` em bloco e tabela da escala lógica |
| Linhas do condutor | Tabela própria; modo habilitada/inabilitada por branch; rank 1..N |
| Tipo de veículo | Só `VehicleType` na v1; lista de bloqueio no condutor |
| Encaixe de veículo | Tipo ∈ `allowed` de todas as linhas do bloco e `requiredVehicleType` das viagens; prioridade ao `preferred` |
| Carga | Fonte = horas **semanais** (contrato → override → default do branch); mensal = semanal × 5; período da carga configurável no branch |
| Ausências e carga | Toda ausência e folga compensada reduzem a carga proporcionalmente aos dias (o saldo de banco de horas está fora do app) |
| Hora da carga | `paidMinutes` |
| Folgas | `RestPattern` global (string de ciclo + âncora + folga em feriados), padrão no turno com override no condutor, grupo (deslocamento) por condutor; cadastro `Holiday` |
| Solicitações | Ausência **e** restrição pontual de horário ("parar até X") num só modelo, com pedido original imutável e origem; toda solicitação do condutor é de um único dia; cota por tipo e período bloqueia novos pedidos |
| Regras do gerador | Configuráveis `BLOCK`/`WARN` por branch, exceto as sempre bloqueantes |
| Dia operacional | Tabelas próprias (`Daily*`); materializa sem ajuste; reparo sob demanda |
| Alocação | `RosterEntry` = fonte única; gerador 1 tabela/pessoa/dia; manual permite mais de uma (alerta), sobreposição bloqueia |
| Reprocessamento | Só entrada travada é preservada |
| Após publicar | `DailyChangeLog` (tabela) → `CrewNotification` |
| Portal | Login matrícula + PIN 6 dígitos (inicial = 6 primeiros do CPF), secret próprio; notificações não lidas exigem confirmação antes de liberar o resto |
| Indisponibilidade de veículo | Domínio `fleet` |

---

## Fase 1 — Turno e linha ↔ empresa (escala lógica)

### 1.1 `CrewShift` (implementado)

As janelas viraram **colunas** em vez de um JSON `rules`: o cadastro sai do CRUD genérico (widget
`time`, H:MM, aceita passar de 24:00) sem tela própria. O turno é **compartilhado** pelas empresas
que o usam (`CrewShiftBranch`, M2M) — como o padrão de folga, é só a forma da janela; empresa com
horário diferente ganha um turno próprio. Código único no geral. O ajuste por condutor (Fase 2) continua
sendo um JSON parcial com as mesmas chaves. `restPatternId` entra na Fase 2, junto com
`RestPattern`.

```prisma
model CrewShift {
  id            String   @id @default(uuid())
  code          String   @unique
  name          String
  priority      Int      @default(0)   // tie-break — lower wins
  startFloor    Int                    // sign-on window: floor ≤ idealMin ≤ idealMax ≤ ceiling
  startIdealMin Int
  startIdealMax Int
  startCeiling  Int
  endFloor      Int                    // sign-off window, same bands (may run past 1440)
  endIdealMin   Int
  endIdealMax   Int
  endCeiling    Int
  allowSplit    Boolean  @default(false)
  isActive      Boolean  @default(true)
  notes         String?
  branches      CrewShiftBranch[]   // (shiftId, branchId)
  // ...
}
```

Encaixe e escolha ficam em `packages/schemas/transit/crew-shift.schema.ts` (`shiftFits`,
`shiftIdealDistance`, `bestShift`), compartilhados por API e tela.

### 1.2 Turno derivado na `Duty`

```prisma
model Duty {
  // ...
  // derived on recalculate (best-fitting CrewShift of the duty's branch) unless shiftPinned
  shiftId     String?
  shiftPinned Boolean    @default(false)
  shift       CrewShift? @relation(fields: [shiftId], references: [id], onDelete: SetNull)
}
```

Derivação no `recalculate` do `CrewPlanService` (onde `evaluateDuty` roda):
1. `branchId` nulo → sem turno, sem issue.
2. Candidatos: turnos ativos do branch com `startMinutes` em `[start.floor, start.ceiling]`,
   `endMinutes` em `[end.floor, end.ceiling]` e, se `SPLIT`, `allowSplit`.
3. Menor `priority`; empate → menor distância ao ideal (start + end).
4. Nenhum → `SHIFT_NONE` (warning).
5. `shiftPinned` mantém; se não couber → `SHIFT_MISMATCH` (warning).
6. `STANDBY` sem horário → sem turno.

`crewPlanSummarySchema.byShift: [{ branchId, shiftId | null, role, dutyCount }]`.

### 1.3 Linha ↔ empresa

```prisma
// Which branches operate a line — a line may be shared by several operators
model LineOperator {
  lineId   String
  branchId String

  line   TransitLine @relation(fields: [lineId], references: [id], onDelete: Cascade)
  branch Branch      @relation(fields: [branchId], references: [id])

  @@id([lineId, branchId])
  @@map("transit_line_operators")
}
```

- Validação: o branch tem que ser `ScopeOperator` do Scope da linha.
- Edição: multi-select de empresas no form da linha.
- **Linha sem nenhuma operadora = operada por qualquer empresa do Scope** (não obriga cadastrar
  todas as linhas).
- "Empresa opera a linha L" = L sem operadoras, ou existe `LineOperator(L, empresa)`.
- Uso: vehicle solver (§1.4), escala lógica (§1.5), escala real (§5.1) e filtro das linhas do
  condutor (§2.3).

### 1.4 Vehicle solver — "Consistir linha da empresa"

Hoje o vehicle solver escolhe a empresa de cada cadeia pelo maior déficit em relação ao
`ScopeOperator.share` (`vehicle-solver.calc.ts`, ~l. 402). Com a opção ligada:

- `planningSettingsSchema` ganha `restrictToBranchLines: z.boolean().default(false)` — aparece no
  modal de geração e entra no snapshot `VehiclePlan.settings`, como os outros parâmetros de
  planejamento.
- Ligada, é **regra rígida**: um bloco só recebe empresa que opera **todas** as linhas das suas
  viagens. Empresas candidatas de uma cadeia = interseção das operadoras das linhas dela; o
  `share` continua escolhendo dentro dessa interseção (ele já é alvo de score, não restrição).
- Interseção vazia (cadeia mistura linhas exclusivas de empresas diferentes) → a cadeia não pode
  ser montada assim; o solver não junta essas viagens no mesmo bloco. Mover viagens entre blocos
  (`improve`) respeita a mesma regra.
- Desligada: comportamento atual.

### 1.5 Warning `LINE_NOT_OPERATED` na escala lógica

Sinaliza o conflito antes do dia, sem bloquear nada (independe da opção do solver):

- **Bloco**: `VehicleBlock.branchId` não opera alguma linha das suas viagens → novo código em
  `VEHICLE_BLOCK_ISSUE_CODES` (`block-validation.ts`).
- **Tabela**: `Duty.branchId` não opera alguma linha das viagens cobertas pelas suas pegadas →
  novo código em `dutyIssueSchema` (warning). `branchId` nulo → não verifica.

### 1.6 Telas e entregáveis

- `transit/crew-shift` (resource genérico); editor de faixa em H:MM (`DurationInput`).
- Escala lógica: coluna/filtro de turno, pin do turno, card de tabelas por turno × branch.
- Form da linha: empresas operadoras.
- Modal de geração do plano de veículos: opção "Consistir linha da empresa".
- Opcional: DOP Escala com efetivo por papel × turno (completo só com folgas, Fase 2).

| Arquivo | Mudança |
|---|---|
| `packages/schemas/transit/crew-shift.schema.ts`, `line-operator` no `line.schema.ts` | novo |
| `transit.prisma` | `CrewShift`, `LineOperator`, `Duty.shiftId/shiftPinned` |
| `timetabling/crew-shift/*` | service/controller/module |
| `crew-plan/crew-scoring.calc.ts`, `crew-plan.service.ts` | derivação de turno, issues, `byShift`, `LINE_NOT_OPERATED` |
| `duty.schema.ts`, `crew-plan.schema.ts` | `SHIFT_NONE`, `SHIFT_MISMATCH`, `LINE_NOT_OPERATED`, `shiftId`, `byShift` |
| `settings-planning.schema.ts`, `vehicle-solver/*` (input, calc, improve) | `restrictToBranchLines` |
| `block-validation.ts`, `vehicle-plan.service.ts` (recalculate) | `LINE_NOT_OPERATED` no bloco |
| web | turno na escala lógica, operadoras no form da linha, opção no modal de geração |

---

## Fase 2 — Cadastros do condutor

> **Implementado — diferenças em relação ao texto abaixo:**
> - Ciclo do `RestPattern` em **T/F** (trabalha/folga), não W/O.
> - Ajuste de horário do condutor: duas colunas, `notBeforeMinutes` / `notAfterMinutes` ("não
>   inicia antes de / não termina depois de"), substituindo o início mínimo e o término máximo do
>   turno — no lugar do JSON `shiftOverride`.
> - Preferência de hora extra como coluna `overtimePreference`, não JSON `preferences`.
> - `CrewMember.shiftId` (turno atual) é campo calculado: no cadastro, cria o primeiro
>   `CrewMemberShift`; trocar inicia o novo hoje. Datas específicas: aba Turnos do condutor.
> - `portalProfileId` / `portalOverride` ficam para a Fase 7.
> - `transit.roster` (por empresa) só com `lineAccessMode`, `maxPreferredLines`,
>   `defaultWeeklyHours`; os demais campos entram na Fase 5, com o gerador que os lê.
> - `interShiftRest` foi para `transit.crew` mantendo os valores padrão de antes (o DOP lê de lá).
> - Cota de solicitações, aprovação pelo portal e notificações: Fase 7.

### 2.1 `CrewMember`

```prisma
model CrewMember {
  id           String   @id @default(uuid())
  employeeId   String   @unique
  role         CrewRole
  // out of the generator when false (still assignable by hand)
  isRosterable Boolean  @default(true)
  // ShiftRulesOverride — only the fields that differ from the bound shift
  shiftOverride Json?
  // overrides the shift's RestPattern
  restPatternId String?
  // the crew member's group in the cycle: days shifted from the pattern's anchor
  restOffset    Int      @default(0)
  // VehicleType this person may NOT operate — empty = all
  blockedVehicleTypes VehicleType[] @default([])
  // optional fixed car — the generator keeps it when it can; null = habitual car
  preferredVehicleId String?
  // overrides the contract's weekly hours
  weeklyHours   Int?
  licenseCategory  String?
  licenseExpiresAt DateTime? @db.Date
  courseExpiresAt  DateTime? @db.Date
  // CrewPreferences
  preferences     Json?
  portalProfileId String?
  // PortalPermissions override
  portalOverride  Json?
  notes        String?
  createdAt    DateTime @default(now())
  updatedAt    DateTime @updatedAt

  employee         Employee          @relation(fields: [employeeId], references: [id])
  restPattern      RestPattern?      @relation(fields: [restPatternId], references: [id])
  preferredVehicle Vehicle?          @relation(fields: [preferredVehicleId], references: [id])
  portalProfile    PortalProfile?    @relation(fields: [portalProfileId], references: [id])
  shifts           CrewMemberShift[]
  lines            CrewMemberLine[]
  occurrences      CrewOccurrence[]
  rosterEntries    RosterEntry[]
  notifications    CrewNotification[]
  access           CrewAccess?

  @@map("transit_crew_members")
}
```

```ts
export const crewPreferencesSchema = z.object({
  overtime: z.enum(['LIKES', 'NEUTRAL', 'AVOIDS']).default('NEUTRAL'),
})
```

- Criação manual: escolhe o funcionário (`Employee` do mesmo branch, `ACTIVE`, sem
  `CrewMember`), `role` e turno inicial (cria o primeiro `CrewMemberShift`). Turno obrigatório.
- Branch = `Employee.branchId`.

### 2.2 Turno do condutor (histórico)

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

- Sem sobreposição; novo vínculo corta o anterior no dia anterior.
- Turno do mesmo branch do `Employee`.
- Sem turno vigente na data → fora do gerador (alocável à mão, com pendência).
- **Janela efetiva na data** = `shift.rules` ⊕ `shiftOverride` ⊕ restrição pontual aprovada da
  data (§2.5, só aperta a janela).
- Trocar de turno troca o padrão de folga (se o condutor não tiver override): a tela pede o
  grupo (`restOffset`) no novo padrão.

### 2.3 Linhas do condutor

```prisma
enum CrewLineAccess {
  ENABLED  // whitelist mode: may operate
  BLOCKED  // blacklist mode: may not operate
}

model CrewMemberLine {
  id           String          @id @default(uuid())
  crewMemberId String
  lineId       String
  // null = no explicit access (blacklist: allowed; whitelist: not allowed)
  access       CrewLineAccess?
  // 1 = primary, 2 = secondary... ≤ roster.maxPreferredLines; null = not preferred
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

- Pode operar `L`: `WHITELIST` → existe `ENABLED`; `BLACKLIST` → não existe `BLOCKED`.
- `rank` só em linha que pode operar; ranks contíguos; até `maxPreferredLines`.
- `access` só gestor; `rank` gestor e portal.
- Linhas oferecidas no cadastro: as operadas pela empresa do condutor (`LineOperator`) — Q-B.
- Trocar o modo do branch não apaga nada; vínculos do modo antigo ficam sem efeito (a tela
  informa quantos).

### 2.4 Carga

- **Semanal efetiva** = `CrewMember.weeklyHours ?? Contract ativo.weeklyHours ?? roster.defaultWeeklyHours`.
- **Mensal** = semanal × 5 (42 → 210, 44 → 220).
- **Carga do período** = mensal × (dias do período − dias com ausência aprovada ou `COMP_OFF`)
  ÷ dias do período. A folga do regime não reduz (já está embutida na carga).
- Período = `roster.loadPeriodStartDay` (1 = mês civil; 21 = de 21 a 20).
- Horas realizadas/planejadas = Σ `paidMinutes` das tabelas alocadas.

### 2.5 Ocorrências — ausências e restrições pontuais

Ausência e "parar até X horas" são o mesmo tipo de coisa: algo que o condutor (ou o gestor)
registra, que pode ser pedido, aprovado ou recusado, e que muda a disponibilidade. Um único
modelo responde "quantas solicitações foram feitas e quantas atendidas no período".

```prisma
// Kind of absence — férias, atestado, falta, afastamento, licença...
model CrewAbsenceType {
  id          String   @id @default(uuid())
  code        String   @unique
  name        String
  // may be requested through the portal (limits live in the portal profile)
  requestable Boolean  @default(false)
  isActive    Boolean  @default(true)
  createdAt   DateTime @default(now())
  updatedAt   DateTime @updatedAt

  occurrences CrewOccurrence[]

  @@map("transit_crew_absence_types")
}

enum CrewOccurrenceKind {
  ABSENCE      // out on [startDate, endDate]
  TIME_WINDOW  // works, but only inside the window on [startDate, endDate]
}

enum CrewOccurrenceStatus {
  REQUESTED
  APPROVED
  REJECTED
  CANCELLED
}

enum CrewOccurrenceOrigin {
  PORTAL           // asked by the crew member in the portal
  STAFF_ON_BEHALF  // asked by the crew member, entered by staff
  STAFF            // staff decision (atestado, falta...)
}

model CrewOccurrence {
  id            String               @id @default(uuid())
  crewMemberId  String
  kind          CrewOccurrenceKind
  // ABSENCE only
  absenceTypeId String?
  startDate     DateTime             @db.Date
  // inclusive
  endDate       DateTime             @db.Date
  // TIME_WINDOW only — minutes of the operational day; either may be null
  startNotBefore Int?
  endNotAfter    Int?
  // immutable copy of what was asked — { startDate, endDate, startNotBefore?, endNotAfter? };
  // staff may adjust the fields above before approving, this keeps the original
  requested     Json?
  status        CrewOccurrenceStatus @default(APPROVED)
  origin        CrewOccurrenceOrigin
  createdByUserId  String?
  reviewedByUserId String?
  reviewedAt    DateTime?
  notes         String?
  reviewNotes   String?
  createdAt     DateTime             @default(now())
  updatedAt     DateTime             @updatedAt

  crewMember  CrewMember       @relation(fields: [crewMemberId], references: [id], onDelete: Cascade)
  absenceType CrewAbsenceType? @relation(fields: [absenceTypeId], references: [id])

  @@index([crewMemberId, startDate])
  @@map("transit_crew_occurrences")
}
```

Regras:
- `PORTAL` nasce `REQUESTED` com `requested` preenchido; `STAFF_ON_BEHALF` idem (é pedido do
  condutor); `STAFF` nasce `APPROVED`, sem `requested`.
- **Solicitação é sempre de um dia**: `PORTAL` e `STAFF_ON_BEHALF` exigem
  `startDate = endDate` (validado no service). Só `STAFF` lança intervalo (férias, afastamento).
- **Cota**: novo pedido `PORTAL` que estoura a cota do tipo no período (§7.1, `requestLimits`) é
  recusado na hora (422, sem gravar). Consomem cota os pedidos `REQUESTED` e `APPROVED` do condutor
  com origem `PORTAL` ou `STAFF_ON_BEHALF`, contados pela data da ocorrência (`startDate`) dentro
  do período. `STAFF_ON_BEHALF` acima da cota é permitido (decisão do gestor), com aviso.
- Só `APPROVED` tem efeito.
- **Solicitações no período**: `origin ∈ {PORTAL, STAFF_ON_BEHALF}`, por `createdAt`; atendidas =
  `APPROVED`; "atendida com ajuste" = `APPROVED` com datas/janela diferentes de `requested`.
- `ABSENCE` aprovada que cai em dia já escalado → pendência `CREW_ABSENT` no dia; não desaloca
  sozinha.
- `TIME_WINDOW` aprovada aperta a janela efetiva (§2.2). Para o gerador vale como a regra de
  janela do turno (modo `BLOCK`/`WARN`, §5.2). Dia já escalado fora da janela → pendência
  `SHIFT_WINDOW`.

> **Atualização — tipos de ausência e ERP:**
> - Pedido lançado pelo gestor (`STAFF_ON_BEHALF`) pode ter vários dias; só o portal limita a um dia.
>   Cotas (Fase 7) passam a contar **dias**.
> - `CrewAbsenceType.effect` diz o que o tipo vira na escala: `ABSENCE` (indisponível, reduz a
>   carga), `DAY_OFF` (folga semanal — ocupa o dia, não reduz a carga) ou `COMP_OFF` (folga
>   compensada, reduz a carga). Aprovar um pedido `DAY_OFF`/`COMP_OFF` cria a folga na escala
>   (`RosterEntry.crewOccurrenceId`, `source = REQUEST`) nos dias sem tabela; deixar de estar aprovado
>   a remove. O gerador mantém essas folgas.
> - Tipos do sistema (`systemKey`): `WEEKLY_OFF` "Folga semanal (DSR)" e `COMP_OFF` "Folga
>   compensada" — não são excluídos nem mudam de efeito. Toda folga da escala aponta para um tipo
>   (`RosterEntry.absenceTypeId`; sem escolha, o do sistema), então a empresa pode ter várias
>   compensações (banco de horas, feriado…).
> - `CrewAbsenceType.externalCodes` (`{ GLOBUS }`, mesmo padrão de Localidade/Linha): o código de
>   cada evento no ERP Globus, o mesmo para todas as empresas. Dias trabalhados (normal, feriado,
>   extra, noturno) ficam para o desenho da integração.

### 2.6 Regime de folgas

```prisma
// Day-off cycle, shared by every branch — one char per day: W = work, O = off.
// Day of the cycle on a date = (date − anchorDate + crewMember.restOffset) mod length.
model RestPattern {
  id            String   @id @default(uuid())
  name          String   @unique
  pattern       String
  // day 0 of the cycle
  anchorDate    DateTime @db.Date
  // also off on any Holiday that applies to the crew member's branch
  offOnHolidays Boolean  @default(false)
  createdAt     DateTime @default(now())
  updatedAt     DateTime @updatedAt

  shifts      CrewShift[]
  crewMembers CrewMember[]

  @@map("transit_rest_patterns")
}
```

Representação dos casos (âncora numa segunda-feira):

| Regime | `pattern` |
|---|---|
| 6x1, revezamento sáb/dom | `WWWWWOWWWWWWWO` (14) |
| 6x1, folga todo domingo + feriados (ex.: dupla pegada) | `WWWWWWO` + `offOnHolidays` |
| 5x2 | `WWWWWOO` |
| 6x2 | `WWWWWWOO` (8 — roda nos dias da semana) |
| 5x2 não consecutiva (ter+sáb / ter+dom) | `WOWWWOWWOWWWWO` (14) |
| 12x36 | `WO` |

- **Grupos de revezamento**: condutores do mesmo padrão com `restOffset` diferentes (ex.: 0 e 7
  no 6x1 sáb/dom → metade folga sábado, metade domingo). A tela do padrão mostra, por grupo:
  calendário das próximas semanas, máximo de dias seguidos trabalhados, frequência de domingo
  de folga.
- Padrão efetivo = `CrewMember.restPatternId ?? turno vigente.restPatternId`. Sem padrão → sem
  folga automática (o gerador não decide folga na v1).
- O gerador materializa `DAY_OFF` a partir do padrão; o usuário pode mover.

### 2.7 Feriados

```prisma
// A holiday — global (branchId null) or a branch's own (municipal holiday of a garage's city)
model Holiday {
  id       String   @id @default(uuid())
  date     DateTime @db.Date
  name     String
  branchId String?

  branch Branch? @relation(fields: [branchId], references: [id])

  @@unique([date, branchId])
  @@map("holidays")
}
```

Domínio `core` (calendário geral). Hoje só alimenta `offOnHolidays`; não altera a resolução de
dayType (continua com `LineCalendarException`).

### 2.8 Settings

**`transit.crew`** (por scope) ganha `range.interShiftRest` (vem do roster; é regra de CCT). O DOP
Escala passa a ler daqui.

**`transit.roster`** — a mesma chave existente, escopo passa a `branch`. Sai `driverPrefTech`
e `interShiftRest`. A seção da tela `transit/settings` ganha seletor de empresa.

```ts
const ruleMode = z.enum(['BLOCK', 'WARN'])

export const rosterSettingsSchema = z.object({
  lineAccessMode:      z.enum(['WHITELIST', 'BLACKLIST']).default('BLACKLIST'),
  maxPreferredLines:   z.number().int().min(0).max(10).default(3),
  // share of the preferred-line weight per rank: rank 1 = [0], rank 2 = [1]...
  preferredLineGrades: z.array(z.number().min(0).max(100)).default([100, 60, 30]),
  defaultWeeklyHours:  z.number().int().min(1).max(44).default(42),
  // first day of the load period (1 = calendar month)
  loadPeriodStartDay:  z.number().int().min(1).max(28).default(1),
  habitualVehicleDays: z.number().int().min(1).max(90).default(14),
  reserveTargets: z.array(z.object({
    dayTypeId:    z.uuid().meta({ resource: 'day-type', domain: 'transit' }),
    startMinutes: z.number().int().min(0),
    endMinutes:   z.number().int().min(0).nullable(),
    localityId:   z.uuid().meta({ resource: 'locality', domain: 'transit' }),
    count:        z.number().int().min(1),
  })).default([]),
  // generator behavior per rule — WARN assigns anyway (last resort) and flags the day
  ruleModes: z.object({
    lineAccess:     ruleMode.default('BLOCK'),
    vehicleType:    ruleMode.default('BLOCK'),
    shiftWindow:    ruleMode.default('BLOCK'),
    interShiftRest: ruleMode.default('BLOCK'),
    branch:         ruleMode.default('BLOCK'),
    license:        ruleMode.default('BLOCK'),
  }).default({}),
  range: z.object({
    driverPrefLine: rangeCriterionSchema,  // % of trip minutes on preferred lines, by grade
    shiftFit:       rangeCriterionSchema,  // minutes away from the effective ideal window
    loadDeficit:    rangeCriterionSchema,  // % below the period load (ensureMonthlyLoad)
    overtimePref:   rangeCriterionSchema,  // minutes above load vs. preference (load off)
    tableChanges:   rangeCriterionSchema,  // signature changes in the horizon
  }),
})
```

Nomes de resource (`day-type`, `locality`) conferidos na implementação.

---

## Fase 3 — Frota (`fleet`)

```prisma
// fleet.prisma — a vehicle out of service over a date range
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

**Veículo elegível para um bloco do dia**:
- `status = ACTIVE` e sem indisponibilidade na data;
- `branchId` = branch do bloco;
- tipo ∈ `allowed` de **todas** as linhas do bloco (vazio = qualquer);
- tipo = `requiredVehicleType` de toda viagem que o exige.

Prioridade: tipo = `preferred` das linhas / `vehicleType` planejado do bloco.

---

## Fase 4 — Dia operacional

> **Implementado (primeira entrega) — diferenças em relação ao texto abaixo:**
> - Pendências do condutor ficam em `DailyDuty.issues` (junto das da tabela), não no `RosterEntry`;
>   pendências do veículo em `DailyBlock.issues`. Códigos: `DAILY_ISSUE_CODES` (`daily-operation.schema.ts`).
> - O dia usa as regras de escala do escopo (`transit.crew`); uma configuração personalizada do
>   `CrewPlan` de origem não é levada.
> - Ficaram para depois: dividir tabela, `RESERVE_SHORT` (depende da meta de reserva, Fase 5),
>   notificações (Fase 7). Reparo automático é a Fase 6.
> - Tela do dia: abas Tabelas (condutor por tabela), Carros (veículo, viagens canceladas) e
>   Pessoal (situação no dia, folga lançada). A linha do tempo (Gantt) fica para uma etapa seguinte.

### 4.1 Por que tabelas próprias

O dia precisa de cálculo, validação e Gantt iguais aos do plano, mas **nenhum** dos efeitos do
plano (drift, propagação para OSO, ativação/vigência — A8). O cálculo já é puro (A9), então o
reuso acontece por adaptador: as tabelas do dia são mapeadas para a mesma entrada de
`evaluateDuty`, `CrewScoreAggregate`, `validateBlock` e da engine do Gantt. O plano lógico fica
intocado e o dia pode ser arquivado separadamente.

### 4.2 Modelos

```prisma
enum DailyStatus {
  PLANNED    // being built / generated
  PUBLISHED  // visible in the portal; changes are logged and notified
  CLOSED     // executed — read-only
}

// One operational day of a transit Scope
model DailyOperation {
  id          String      @id @default(uuid())
  scopeId     String
  date        DateTime    @db.Date
  // DayType of the date's pattern (lines may run under others — see sources)
  dayTypeId   String
  status      DailyStatus @default(PLANNED)
  // [{ vehiclePlanId, crewPlanId | null, lineIds }] — the logical plans the day came from
  sources     Json
  // DailySummary — issue counts, reserve vs target...
  summary     Json?
  publishedAt DateTime?
  closedAt    DateTime?
  createdAt   DateTime    @default(now())
  updatedAt   DateTime    @updatedAt

  scope   Scope           @relation(fields: [scopeId], references: [id])
  dayType DayType         @relation(fields: [dayTypeId], references: [id])
  blocks  DailyBlock[]
  events  DailyBlockEvent[]
  duties  DailyDuty[]
  changes DailyChangeLog[]

  @@unique([scopeId, date])
  @@map("transit_daily_operations")
}

model DailyBlock {
  id               String   @id @default(uuid())
  dailyOperationId String
  // VehicleBlock it was copied from — plain id, the logical plan may change or go away
  sourceBlockId    String?
  blockNumber      Int
  branchId         String?
  depotId          String
  vehicleType      VehicleType
  // the real vehicle
  vehicleId        String?
  issues           Json?
  hasIssues        Boolean  @default(false)
  createdAt        DateTime @default(now())
  updatedAt        DateTime @updatedAt

  operation DailyOperation    @relation(fields: [dailyOperationId], references: [id], onDelete: Cascade)
  vehicle   Vehicle?          @relation(fields: [vehicleId], references: [id])
  events    DailyBlockEvent[]
  pieces    DailyDutyPiece[]

  @@unique([dailyOperationId, blockNumber])
  @@map("transit_daily_blocks")
}

enum DailyEventKind {
  TRIP
  DEADRUN
  INTERVAL
}

// Trips, deadruns and intervals of the day in one table
model DailyBlockEvent {
  id                    String         @id @default(uuid())
  dailyOperationId      String
  // null = trip left without a block (mixed day) — TRIP_UNCOVERED
  dailyBlockId          String?
  kind                  DailyEventKind
  // TransitTrip / BlockDeadrun / BlockInterval it was copied from — plain id
  sourceId              String?
  lineId                String?
  routeId               String?
  deadrunType           DeadrunType?
  intervalTypeId        String?
  originLocalityId      String?
  destinationLocalityId String?
  startMinutes          Int
  endMinutes            Int
  requiredVehicleType   VehicleType?
  bundleId              String?
  // trip not run today (supressão) — kept for the record
  isCancelled           Boolean        @default(false)
  notes                 String?

  operation DailyOperation @relation(fields: [dailyOperationId], references: [id], onDelete: Cascade)
  block     DailyBlock?    @relation(fields: [dailyBlockId], references: [id], onDelete: SetNull)

  @@index([dailyBlockId])
  @@map("transit_daily_block_events")
}

model DailyDuty {
  id               String   @id @default(uuid())
  dailyOperationId String
  // Duty it was copied from — plain id
  sourceDutyId     String?
  role             CrewRole
  dutyNumber       Int
  kind             DutyKind
  branchId         String?
  shiftId          String?
  // DutySummary — same shape as the logical duty
  summary          Json?
  issues           Json?
  hasIssues        Boolean  @default(false)
  createdAt        DateTime @default(now())
  updatedAt        DateTime @updatedAt

  operation     DailyOperation      @relation(fields: [dailyOperationId], references: [id], onDelete: Cascade)
  pieces        DailyDutyPiece[]
  activities    DailyDutyActivity[]
  rosterEntries RosterEntry[]

  @@unique([dailyOperationId, role, dutyNumber])
  @@map("transit_daily_duties")
}

model DailyDutyPiece {
  id              String   @id @default(uuid())
  dailyDutyId     String
  dailyBlockId    String?
  sequence        Int
  startMinutes    Int
  endMinutes      Int
  startLocalityId String
  endLocalityId   String
  isStale         Boolean  @default(false)
  staleReason     String?

  duty  DailyDuty   @relation(fields: [dailyDutyId], references: [id], onDelete: Cascade)
  block DailyBlock? @relation(fields: [dailyBlockId], references: [id], onDelete: SetNull)

  @@unique([dailyDutyId, sequence])
  @@map("transit_daily_duty_pieces")
}

model DailyDutyActivity {
  id                    String           @id @default(uuid())
  dailyDutyId           String
  type                  DutyActivityType
  intervalTypeId        String?
  startMinutes          Int
  endMinutes            Int
  originLocalityId      String?
  destinationLocalityId String?

  duty DailyDuty @relation(fields: [dailyDutyId], references: [id], onDelete: Cascade)

  @@map("transit_daily_duty_activities")
}
```

### 4.3 Materialização (`scopeId` + data)

1. Por linha ativa do Scope: `resolveDayType(D, line)` → `findActivePlan` → `CrewPlan` em vigor.
2. Agrupa linhas por plano.
3. **Dia normal**: copia blocos, eventos e tabelas do plano.
4. **Dia misto**: de cada plano `P` copia os blocos que têm viagem de linha resolvida para `P`,
   mantendo só essas viagens (deadruns/intervalos ficam). Blocos de planos secundários são
   renumerados depois do maior número do principal (o principal é o do dayType da data). Copia
   as tabelas cujas pegadas tocam algum bloco copiado; pegadas em bloco não copiado ficam
   `isStale`.
5. Plano sem `CrewPlan` em vigor → blocos sem tabelas (pendência `BLOCK_NO_CREW`).
6. Nenhum ajuste automático. Calcula as pendências (§4.5).
7. Idempotente. "Rematerializar" (descarta e copia de novo) só em `PLANNED` e sem alocação
   travada.

### 4.4 Alocação

```prisma
enum RosterEntryKind {
  DUTY      // works a daily duty
  STANDBY   // plantão — a STANDBY daily duty
  DAY_OFF   // day off of the rest pattern
  COMP_OFF  // folga compensada — reduces the period load like an absence
}

// What a crew member does on an operational date — THE roster
model RosterEntry {
  id           String          @id @default(uuid())
  crewMemberId String
  date         DateTime        @db.Date
  kind         RosterEntryKind
  // DUTY / STANDBY
  dailyDutyId  String?         @unique
  // preserved by the generator on reprocessing
  locked       Boolean         @default(false)
  // GENERATED | MANUAL
  source       String          @default("MANUAL")
  createdAt    DateTime        @default(now())
  updatedAt    DateTime        @updatedAt

  crewMember CrewMember @relation(fields: [crewMemberId], references: [id], onDelete: Cascade)
  dailyDuty  DailyDuty? @relation(fields: [dailyDutyId], references: [id], onDelete: SetNull)

  @@index([crewMemberId, date])
  @@index([date])
  @@map("transit_roster_entries")
}
```

Regras (service):
- Uma tabela tem no máximo um condutor (`dailyDutyId @unique`). Tabela dividida no dia =
  ação "dividir tabela", que gera duas `DailyDuty`.
- Por pessoa e data: no máximo uma `DAY_OFF`/`COMP_OFF`, e ela não convive com `DUTY`/`STANDBY`.
- Mais de uma `DUTY` no dia: só manual; permitido com pendência `CREW_MULTIPLE_DUTIES`;
  **sobreposição de horário bloqueia o save**.
- Gerador: no máximo uma `DUTY`/`STANDBY` por pessoa por dia.
- Plantão gerado pela meta de reserva = `DailyDuty` `STANDBY` com `DailyDutyActivity STANDBY`
  no horário/local da meta.
- Veículo = `DailyBlock.vehicleId`.

Ações manuais da v1: alocar/desalocar condutor, alocar veículo, cancelar/restaurar viagem,
dividir tabela, lançar folga/folga compensada.

### 4.5 Pendências do dia

| Código | Onde | Regra |
|---|---|---|
| `DUTY_UNASSIGNED` | DailyDuty | DRIVER sem condutor |
| `BLOCK_NO_CREW` | DailyBlock | trecho de serviço sem pegada DRIVER |
| `BLOCK_NO_VEHICLE` | DailyBlock | sem veículo |
| `VEHICLE_DOUBLE` | DailyBlock | mesmo veículo em blocos sobrepostos |
| `VEHICLE_UNAVAILABLE` | DailyBlock | inativo/indisponível na data |
| `VEHICLE_TYPE_MISMATCH` | DailyBlock | fora das regras de tipo (§3) |
| `TRIP_UNCOVERED` | DailyBlockEvent | viagem sem bloco |
| `CREW_ABSENT` | RosterEntry | ausência aprovada |
| `CREW_ON_DAY_OFF` | RosterEntry | escalado em dia de folga do padrão |
| `CREW_MULTIPLE_DUTIES` | RosterEntry | mais de uma tabela no dia |
| `LINE_NOT_ALLOWED` | RosterEntry | linha não permitida (modo do branch) |
| `LINE_NOT_OPERATED` | RosterEntry | linha fora da empresa do condutor (com o switch ligado na geração) |
| `VEHICLE_TYPE_BLOCKED` | RosterEntry | tipo bloqueado para o condutor |
| `SHIFT_WINDOW` | RosterEntry | fora da janela efetiva (turno + override + restrição pontual) |
| `NO_SHIFT` | RosterEntry | condutor sem turno vigente |
| `INTER_SHIFT_REST` | RosterEntry | interjornada abaixo do floor (dia anterior/seguinte) |
| `BRANCH_MISMATCH` | RosterEntry | condutor de outra empresa |
| `LICENSE_EXPIRED` | RosterEntry | CNH/curso vencido |
| `RESERVE_SHORT` | DailyOperation | plantões abaixo da meta |

Interjornada entre datas: `1440 + início(D+1) − fim(D)`.

### 4.6 Publicação, histórico e notificação

```prisma
// What changed in a PUBLISHED day — source of crew notifications
model DailyChangeLog {
  id               String   @id @default(uuid())
  dailyOperationId String
  userId           String
  // ASSIGN_CREW | UNASSIGN_CREW | ASSIGN_VEHICLE | CANCEL_TRIP | RESTORE_TRIP | SPLIT_DUTY | EDIT_DUTY
  action           String
  entityType       String
  entityId         String
  // crew members affected — who gets notified
  crewMemberIds    String[]
  before           Json?
  after            Json?
  createdAt        DateTime @default(now())

  operation DailyOperation @relation(fields: [dailyOperationId], references: [id], onDelete: Cascade)
  user      User           @relation(fields: [userId], references: [id])

  @@index([dailyOperationId, createdAt])
  @@map("transit_daily_change_logs")
}
```

- Só registra a partir de `PUBLISHED`.
- Cada mudança que afeta condutores gera uma `CrewNotification` para cada afetado (Fase 7).
- `CLOSED`: somente leitura.

---

## Fase 5 — Gerador de escala

> **Implementado (primeira entrega) — diferenças em relação ao texto abaixo:**
> - Job em memória (como o crew solver), não `Job.input`: um por empresa/função, SSE, aceitar/descartar.
>   Tela: Dias Operacionais → "Gerar escala" (`/transit/daily-operation/generate`). Horizonte até 31 dias.
> - Antes da busca cria os dias que faltam dos escopos que a empresa opera; só dias `PLANNED` são escalados.
> - Tabelas da empresa = `DailyDuty.branchId` da empresa, ou sem empresa num escopo que ela opera sozinha.
> - Entradas preservadas: travadas (cadeado na aba Tabelas do dia), de dias não `PLANNED`, folga
>   compensada e **folga lançada à mão** (decisão: trocar uma folga digitada pelo gestor seria surpresa).
> - `loadDeficit`/`overtimePref` usam recompensa convexa (quadrática além do ideal), não `rangeRaw`:
>   com `rangeRaw` o critério achata em −1 longe do ideal e a carga se concentra em poucos.
> - Regra "empresa" (`ruleModes.branch`) não entrou: o gerador só usa condutores da própria empresa.
> - Veículos: ao aceitar, preenche só carros ainda sem veículo; carro habitual = mais dirigido nos
>   `habitualVehicleDays` antes do início do horizonte.
> - Ficou para depois: meta de reserva (`reserveTargets`, passo 4 do algoritmo) e `RESERVE_SHORT` —
>   falta definir em qual escopo/dia nasce o plantão quando a empresa opera mais de um escopo.

### 5.1 Parâmetros (tela → `Job.input`)

| Parâmetro | Uso |
|---|---|
| `branchId`, `role` | um gerador por empresa e papel |
| `from`, `to` | horizonte; materializa os dias que faltam |
| `ensureMonthlyLoad` | liga `loadDeficit`; desliga `overtimePref` |
| `maxChanges` | trocas de tabela por condutor no período da carga |
| `restrictToBranchLines` | "Consistir linha da empresa": só tabelas cujas linhas a empresa opera (§1.3 — linha sem operadora conta como operada); mesma opção do vehicle solver (§1.4) |

Dias antes de `from` e entradas `locked` são fixos; horas e trocas já feitas no período da carga
entram nas contas. Entradas não travadas no horizonte podem ser movidas.

### 5.2 Regras

**Sempre bloqueiam:** condutor inativo ou não escalável; sem turno vigente; ausência aprovada;
folga do padrão; uma tabela/plantão por pessoa por dia; `maxChanges`; `restrictToBranchLines`
(quando ligado).

**Configuráveis (`roster.ruleModes`, `BLOCK`/`WARN`):** linha permitida, tipo de veículo,
janela efetiva (inclui restrição pontual), interjornada, empresa, CNH/curso.

`WARN` não é "ignorar": a violação entra no custo com peso alto; o gerador só a usa quando não
há alternativa, e o dia fica com a pendência.

### 5.3 Continuidade

- Assinatura da tabela = (linha dominante, turno). Linha dominante = mais minutos de viagem.
- Troca = assinatura diferente da última trabalhada (folga, ausência e plantão não contam).

### 5.4 Score

Critérios de `roster.range`: `driverPrefLine`, `shiftFit`, `loadDeficit` (com
`ensureMonthlyLoad`, só déficit), `overtimePref` (sem `ensureMonthlyLoad`), `tableChanges`,
mais o ideal de `interShiftRest` (de `transit.crew`) e as violações `WARN`. Mesmo formato de
score dos outros solvers (peso, `rawScore`).

### 5.5 Algoritmo

1. **Folgas**: materializa `DAY_OFF` pelo padrão (respeitando entradas travadas).
2. **Construção dia a dia**: atribuição de custo mínimo (Hungarian) entre condutores disponíveis
   e tabelas do dia, com estado acumulado (assinatura, trocas, horas projetadas).
3. **Melhoria**: simulated annealing sobre o horizonte (troca de tabelas entre dois condutores
   numa faixa de dias), na infraestrutura do crew solver.
4. **Reserva**: sobras preenchem a meta (horário, local), descontando `STANDBY` lógico copiado.
   O restante aparece como "disponível" para o usuário decidir.
5. **Veículos**, por dia: âncora = condutor da pegada mais cedo do bloco; prioridade
   `preferredVehicleId` → carro habitual do âncora (mais frequente nos últimos
   `habitualVehicleDays`) → carro habitual do outro condutor → qualquer elegível; matching de
   custo mínimo.

Proposta → usuário aceita → grava `RosterEntry` (`GENERATED`) e `DailyBlock.vehicleId`.

---

## Tela Escala (gestão da escala real)

Uma tela só (`/transit/daily-operation`, menu "Escala Diária") para gerar, editar, ver pedidos e
publicar. Substitui a lista de dias e a tela por dia.

- **Contexto:** empresa + função (escopo só como filtro); período dia / semana / mês (até 31 dias);
  tudo na URL, o último contexto lembrado. Dias não criados aparecem como "— não criado" e nascem ao
  **Gerar** (não ao navegar).
- **Faixa de dias:** estado de cada dia (não criado, pendências, planejada, publicada, encerrada).
- **Visão Operadores** (pessoas × dias): célula = tabela / F / FC / ausência / folga do regime
  prevista; ⏱ restrição, ● pedido pendente, cadeado. Teclado: setas (shift seleciona), Enter abre
  as tabelas do dia, F folga, Del limpa, L trava; arrastar uma célula para outro operador troca o
  dia. Colunas de horas × carga e trocas (os números do gerador).
- **Visão Escalas:** um dia = linha do tempo (pegadas por linha, operador e carros como badge);
  vários dias = matriz tabela × dia. Veículo editado no painel (não há visão própria de carros).
- **Painel de contexto:** operador no dia (números, folga, pedidos com aprovar/recusar), tabela
  (operador, carros, trava, pendências), dia (publicar / encerrar).
- **Pendências e Pedidos** do período no topo; **Gerar** com empresa/função/período da tela.
- API: `GET /transit/roster-board` (tudo do período numa consulta), `POST …/swap`, `PUT …/day-off`;
  edições de tabela/carro/trava pelos endpoints do dia.
- **Sugestões** por tabela sem operador: os livres que as regras permitem, pela variação da
  pontuação do gerador, com os motivos (turno, linha preferida, carga, continuidade).
- **Impacto ao aprovar** um pedido (tabelas que ficam sem operador / fora do horário).
- **Gerar** dentro da tela: a proposta aparece sobre o quadro (células que mudam tracejadas) até
  aceitar ou descartar.
- **Publicar período** (todos os dias planejados do período), **Ctrl+C / Ctrl+V** de bloco
  (mesmo número de tabela nos dias de destino).
- Edições aparecem na hora (atualização otimista); edições em bloco vão num pedido só, com um
  recálculo por dia; os dias vizinhos (interjornada) recalculam em segundo plano.

## Fase 6 — Reparo do dia

Ação do usuário na `DailyOperation`, com direcionamento; só mexe no que tem pendência, o resto
entra travado.

| Direcionamento | Pendências |
|---|---|
| Cobrir tabelas | `DUTY_UNASSIGNED`, `CREW_ABSENT`, `SHIFT_WINDOW` — usa plantões e disponíveis, regras do §5.2 |
| Encaixar veículos | `BLOCK_NO_VEHICLE`, `VEHICLE_DOUBLE`, `VEHICLE_UNAVAILABLE`, `VEHICLE_TYPE_MISMATCH` |
| Recompor dia misto | `TRIP_UNCOVERED`, pegadas `isStale`, `BLOCK_NO_CREW` — reencaixe de viagens (lógica do vehicle solver sobre o adaptador do dia) e ajuste de pegadas (crew solver) |

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
  // bumped on PIN reset — older tokens are rejected
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
  // PortalPermissions
  permissions Json
  createdAt   DateTime @default(now())
  updatedAt   DateTime @updatedAt

  crewMembers CrewMember[]

  @@unique([branchId, name])
  @@map("transit_portal_profiles")
}

model CrewNotification {
  id               String    @id @default(uuid())
  crewMemberId     String
  // the operational date it is about
  date             DateTime  @db.Date
  changeLogId      String?
  message          String
  readAt           DateTime?
  createdAt        DateTime  @default(now())

  crewMember CrewMember @relation(fields: [crewMemberId], references: [id], onDelete: Cascade)

  @@index([crewMemberId, readAt])
  @@map("transit_crew_notifications")
}
```

```ts
export const portalPermissionsSchema = z.object({
  viewRoster:         z.boolean().default(true),
  requestAbsence:     z.boolean().default(false),
  requestTimeWindow:  z.boolean().default(false),
  editPreferredLines: z.boolean().default(false),
  // request quotas — e.g. { kind: 'ABSENCE', absenceTypeId: <Folga solicitada>, period: 'MONTH',
  // maxRequests: 3 }. Every request is one day, so requests = days. No entry = no quota.
  requestLimits: z.array(z.object({
    kind:          z.enum(['ABSENCE', 'TIME_WINDOW']),
    // ABSENCE only
    absenceTypeId: z.uuid().nullable().default(null),
    // MONTH follows roster.loadPeriodStartDay; WEEK is Monday–Sunday; YEAR is the calendar year
    period:        z.enum(['WEEK', 'MONTH', 'YEAR']),
    maxRequests:   z.number().int().min(0),
  })).default([]),
})
```

Permissões efetivas = perfil ⊕ `CrewMember.portalOverride`. O override substitui a lista
`requestLimits` inteira (não mescla item a item) — um condutor com cota diferente recebe a lista
completa no override.

O portal mostra, na tela de solicitação, o saldo de cada cota no período ("Folga solicitada:
1 de 3 em outubro").

### 7.2 Auth

- Login: `Employee.code` + PIN 6 dígitos (`argon2`). PIN inicial = 6 primeiros dígitos do CPF,
  `mustChangePin = true`; reset do gestor volta a isso e incrementa `tokenVersion`.
- `PORTAL_JWT_SECRET` próprio; payload `{ sub: crewMemberId, tv }`.
- Guard do portal (toda requisição): `tokenVersion` confere, `Employee.status = ACTIVE`.
  - `mustChangePin` → só a troca de PIN;
  - notificação não lida → só listar/confirmar notificações.
  O bloqueio vale na API, não só na tela.
- Bloqueio por tentativas (ex.: 5 → 15 min) + rate limit por IP no login.
- Endpoints `/api/portal/*` (controller próprio): `auth/login`, `auth/change-pin`, `me`,
  `notifications` (+ `ack`), `roster?from&to`, `occurrences` (GET/POST), `preferred-lines`
  (GET/PUT).

### 7.3 Frontend

- `apps/web/src/app/portal/*`, layout próprio, mobile-first; `/portal` público no `proxy.ts`.
- Token em `portalToken`.
- Após login: com notificações não lidas, modal obrigatório lista as mudanças e exige
  "Li e confirmo" antes de liberar as demais funções.

---

## Ordem de implementação

| Fase | Entrega | Depende de |
|---|---|---|
| 1 | `CrewShift`, turno na `Duty`, `byShift`, `LineOperator`, "Consistir linha da empresa" no vehicle solver, `LINE_NOT_OPERATED` em bloco e tabela | — |
| 2 | `CrewMember`, `CrewMemberShift`, `CrewMemberLine`, `CrewAbsenceType`, `CrewOccurrence`, `RestPattern`, `Holiday`, settings (`transit.crew` + `transit.roster` por branch) | 1 |
| 3 | `VehicleUnavailability` | — |
| 4 | `Daily*`, materialização, `RosterEntry`, pendências, ações manuais, `DailyChangeLog` | 2, 3 |
| 5 | Gerador | 4 |
| 6 | Reparo do dia | 4 (5 para o motor) |
| 7 | Portal + `CrewNotification` | 2 (escala e notificações dependem de 4) |

---

## Dúvidas

Responda abaixo de cada uma (`R.:`).

**Q-A — Linha ↔ empresa no vehicle solver.** Hoje o vehicle solver distribui blocos entre
empresas por `ScopeOperator.share`, sem olhar linha. Com `LineOperator`, um bloco da empresa A
pode conter viagens de linha que só B opera; com "Consistir linha da empresa" ligado, nenhum
condutor de A pode pegar essa tabela. Opções: (a) `LineOperator` vale só para a escala — o
usuário ajusta o plano à mão quando houver conflito (o dia mostra `LINE_NOT_OPERATED`); (b) o
vehicle solver passa a respeitar `LineOperator` (bloco só com linhas da empresa dele), com o
`share` valendo dentro disso; (c) (a) agora e (b) depois. Proponho (c).
R.: já quero consistir tudo, se linha amarrada a uma empresa, gerador do vehicle deve ter a mesma opção de consistir linah da empresa e forçar essa alocação, incluir isso em uma das vazes de implementação



**Q-B — Linha sem operadoras cadastradas.** Linha sem nenhum `LineOperator`: (a) operada por
qualquer empresa do Scope; (b) por nenhuma. Proponho (a) — não obriga cadastrar todas as linhas
antes de usar.
R.: perfeito, A operada por qualquer uma


**Q-C — Pegada fora da empresa na escala lógica.** Vale sinalizar já na Fase 1 a tabela
(`Duty.branchId`) que cobre linha não operada pela empresa dela (warning `LINE_NOT_OPERATED`)?
Antecipa o conflito antes do dia. Proponho sim, como warning.
R.: Sim, ja pode sinalizar

**Q-D — Restrição pontual em intervalo.** "Parar até X horas" vale para um dia só ou também para
um intervalo (ex.: toda a semana que vem, por curso noturno)? O modelo aceita intervalo
(`startDate`..`endDate`); confirma se a tela/portal deve oferecer isso.
R.: Toda solicitação do usuário é somente para um dia.

Outro assunto que comentei e não me recordo se ja consolidamos, quero configurar os limites de pedidos por tipo de um usuário, ou seja "Ausensia X: limite: mensal: qutde: 3" se operador chegou a sua cota impede solicitação.. chegamos a contemplar isso?
**Resposta:** estava contemplado só em parte — o `impl_v1`/v2 limitava **dias** numa janela móvel
(`maxDays` em `periodDays`) e só para ausência. Reescrito em §7.1 (`requestLimits`) e §2.5:
quantidade de pedidos por tipo (ausência de um tipo ou restrição de horário) por semana, mês
(segue o período da carga) ou ano; no perfil de portal, com override por condutor; estourou a
cota → o portal recusa o pedido; o portal mostra o saldo.

---

### Como as respostas entraram

| Dúvida | Onde |
|---|---|
| Q-A | §1.4 — `restrictToBranchLines` no vehicle solver, regra rígida, `share` escolhe dentro das empresas permitidas; Fase 1 |
| Q-B | §1.3 — linha sem operadora = qualquer empresa do Scope |
| Q-C | §1.5 — `LINE_NOT_OPERATED` (warning) em bloco e tabela |
| Q-D | §2.5 — solicitação do condutor sempre de um dia; intervalo só lançado pelo gestor |
| Cota | §2.5 e §7.1 — `requestLimits` |
