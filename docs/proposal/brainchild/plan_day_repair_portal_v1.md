# Plano — Reparo do dia e portal do condutor

**Status: pendente.** São as duas fases que faltam da escala real. O que já existe (cadastros do
condutor, dia operacional, gerador, tela Escala, publicação com `DailyChangeLog`) está descrito em
[`docs/architecture/transit/rostering.md`](../../architecture/transit/rostering.md).

Convenções: comentários em snippets Prisma/TS em inglês; texto em pt-BR; minutos do dia
operacional (`> 1440` = madrugada seguinte).

---

## 1. Reparo do dia

Ação do usuário na `DailyOperation`, com direcionamento. Só mexe no que tem pendência; o resto
entra travado.

| Direcionamento | Pendências |
|---|---|
| Cobrir tabelas | `DUTY_UNASSIGNED`, `CREW_ABSENT`, `SHIFT_WINDOW` — usa plantões e disponíveis, com as regras do gerador (`pairRule`, `ruleModes`) |
| Encaixar veículos | `BLOCK_NO_VEHICLE`, `VEHICLE_DOUBLE`, `VEHICLE_UNAVAILABLE`, `VEHICLE_TYPE_MISMATCH` |
| Recompor dia misto | `TRIP_UNCOVERED`, pegadas `isStale`, `BLOCK_NO_CREW` — reencaixe de viagens (lógica do vehicle solver sobre o adaptador do dia) e ajuste de pegadas (crew solver) |

Num dia `PUBLISHED`, cada mudança entra no `DailyChangeLog`, como já acontece hoje.

---

## 2. Portal do condutor

### 2.1 Modelos

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
  id           String    @id @default(uuid())
  crewMemberId String
  // the operational date it is about
  date         DateTime  @db.Date
  changeLogId  String?
  message      String
  readAt       DateTime?
  createdAt    DateTime  @default(now())

  crewMember CrewMember @relation(fields: [crewMemberId], references: [id], onDelete: Cascade)

  @@index([crewMemberId, readAt])
  @@map("transit_crew_notifications")
}

// CrewMember, new fields
//   portalProfileId String?
//   portalOverride  Json?   // PortalPermissions override
```

```ts
export const portalPermissionsSchema = z.object({
  viewRoster:         z.boolean().default(true),
  requestAbsence:     z.boolean().default(false),
  requestTimeWindow:  z.boolean().default(false),
  editPreferredLines: z.boolean().default(false),
  // request quotas — e.g. { kind: 'ABSENCE', absenceTypeId: <Folga solicitada>, period: 'MONTH',
  // maxRequests: 3 }. Every portal request is one day, so requests = days. No entry = no quota.
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

- Permissões efetivas = perfil ⊕ `CrewMember.portalOverride`. O override substitui a lista
  `requestLimits` inteira (não mescla item a item).
- Só tipos de ausência com `requestable = true` podem ser pedidos.
- Linhas prioritárias (`CrewMemberLine.priority`) aparecem no portal, mas o condutor não altera.

### 2.2 Pedidos e cota

- Pedido do portal (`origin = PORTAL`) é sempre de **um dia** e nasce `REQUESTED`, com
  `requested` preenchido. O resto do fluxo de `CrewOccurrence` já existe (aprovação pelo gestor na
  tela Escala, efeito DAY_OFF / COMP_OFF na escala).
- **Cota**: um pedido `PORTAL` que estoura a cota do tipo no período é recusado na hora (422, sem
  gravar). Consomem cota os pedidos `REQUESTED` e `APPROVED` do condutor com origem `PORTAL` ou
  `STAFF_ON_BEHALF`, contados pela data da ocorrência (`startDate`). `STAFF_ON_BEHALF` acima da
  cota é permitido (decisão do gestor), com aviso.
- O portal mostra o saldo de cada cota no período ("Folga solicitada: 1 de 3 em outubro").

### 2.3 Notificações

Cada `DailyChangeLog` (dia `PUBLISHED`) gera uma `CrewNotification` para cada condutor em
`crewMemberIds`.

### 2.4 Auth

- Login: `Employee.code` + PIN de 6 dígitos (`argon2`). PIN inicial = 6 primeiros dígitos do CPF,
  `mustChangePin = true`; o reset do gestor volta a isso e incrementa `tokenVersion`.
- `PORTAL_JWT_SECRET` próprio; payload `{ sub: crewMemberId, tv }`.
- Guard do portal (toda requisição): `tokenVersion` confere e `Employee.status = ACTIVE`.
  - `mustChangePin` → só a troca de PIN;
  - notificação não lida → só listar / confirmar notificações.
  O bloqueio vale na API, não só na tela.
- Bloqueio por tentativas (ex.: 5 → 15 min) + rate limit por IP no login.
- Endpoints `/api/portal/*` (controller próprio): `auth/login`, `auth/change-pin`, `me`,
  `notifications` (+ `ack`), `roster?from&to`, `occurrences` (GET/POST), `preferred-lines`
  (GET/PUT).

### 2.5 Frontend

- `apps/web/src/app/portal/*`, layout próprio, mobile-first; `/portal` público no `proxy.ts`.
- Token em `portalToken`.
- Após o login, com notificações não lidas, um modal obrigatório lista as mudanças e exige
  "Li e confirmo" antes de liberar as demais funções.
