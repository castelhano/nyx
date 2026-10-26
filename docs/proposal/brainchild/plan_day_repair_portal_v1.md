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

> CONSIDERAÇÂO: "Só mexe no que tem pendência" -> "Altera o minimo possivel para corrigir pendencias", texto sugere que apenas tabelas com pendências podem ser alteradas, mais melhor texto que descreve eh esse que fiz, fluxo que imagino: Filtra pendencias -> Tenta ajustar so com as sobras (condutor e carro) -> [caso nao seja possivel] tenta rodar solução de trocas em escalas (mesmo sem pendencia) que altere o minimo possovel, exemplo: Uma escala sem condutor, condutor sobrando atual não pode ir na linha desta escala, basta inverter um outro que possa com ele... foi aletado apenas um condutor que tinha habilitação para a linha pendente...

| Direcionamento | Pendências |
|---|---|
| Cobrir tabelas | `DUTY_UNASSIGNED`, `CREW_ABSENT`, `SHIFT_WINDOW` — usa plantões e disponíveis, com as regras do gerador (`pairRule`, `ruleModes`) |
| Encaixar veículos | `BLOCK_NO_VEHICLE`, `VEHICLE_DOUBLE`, `VEHICLE_UNAVAILABLE`, `VEHICLE_TYPE_MISMATCH` |
| Recompor dia misto | `TRIP_UNCOVERED`, pegadas `isStale`, `BLOCK_NO_CREW` — reencaixe de viagens (lógica do vehicle solver sobre o adaptador do dia) e ajuste de pegadas (crew solver) |

Num dia `PUBLISHED`, cada mudança entra no `DailyChangeLog`, como já acontece hoje.

### 1.1 O que já existe

| Recurso | Onde | Limite para o reparo |
|---|---|---|
| **Sugestões por tabela sem operador** — até 8 livres que as regras permitem, ordenados pela variação da pontuação do gerador, com motivos | `GET roster-board/suggest` (`RosterBoardService.suggest`), painel da tabela na tela Escala | uma tabela por vez; só quem está sem nada no dia; não considera quem está de plantão |
| **Diagnóstico das tabelas sem operador** — por motivo (janela, linha, veículo, CNH) e turno | `GET roster-board/shortage` | só explica, não resolve |
| **Gerador** sobre um dia (ou período), PLANNED e, com `includePublished`, PUBLISHED mudando o mínimo | `roster-generator.*` | refaz **tudo** que não está fixo; para preservar o resto é preciso travar à mão |
| **Veículos do gerador** — casamento de custo mínimo por data (preferido → habitual → qualquer elegível) | `roster-vehicles.ts` | solta **todos** os carros da empresa nos dias antes de casar |
| **Edição manual** — operador da tabela (unitário e em lote), trava, carro do bloco, cancelar viagem, folga, troca de dia entre dois operadores | endpoints do dia e `roster-board/assign`, `swap`, `day-off` | manual, uma decisão por vez; recalcula e registra no `DailyChangeLog` |
| **Férias em dias já gerados** — as tabelas do titular passam ao ferista quando ele está livre; senão ficam sem operador | `vacation-release.service.ts` | só férias; outras ausências aprovadas ficam como `CREW_ABSENT` |
| **Rematerializar** — descarta o dia e copia os planos de novo | `POST :id/rematerialize` | perde toda a alocação |
| **Dia misto** — viagens sem bloco contadas no resumo (`uncoveredTrips`), pegadas `isStale` com `staleReason` | `daily-materialize.ts`, `getBoard` | **não há edição estrutural no dia** (mover viagem entre blocos, refazer pegadas); `TRIP_UNCOVERED` não existe como pendência |

Conclusão: a cobertura de tabelas e o encaixe de veículos já têm o motor pronto (o modelo do gerador
e o casamento de veículos). Falta restringir esses motores ao que tem pendência, mantendo o resto
do dia intacto. A recomposição do dia misto não tem base nenhuma hoje.

### 1.2 Etapas propostas

**Etapa A — Cobrir tabelas**

- **Alvos** (por dia × empresa × função):
  - tabelas e plantões sem operador (`DUTY_UNASSIGNED`, `RESERVE_SHORT`);
  - tabelas cujo operador não pode estar nela: `CREW_ABSENT`, `CREW_ON_DAY_OFF`, `CREW_INACTIVE`,
    `NO_SHIFT`, e regras em modo BLOCK (`SHIFT_WINDOW`, `LINE_NOT_ALLOWED`, `VEHICLE_TYPE_BLOCKED`,
    CNH / curso). O operador sai da tabela e ela entra como alvo.
- **Candidatos:** quem está livre no dia e quem está num plantão (o plantão vira falta de reserva,
  menos grave que uma tabela descoberta — a mesma ordem do gerador).
- **Motor:** o `RosterModel` do gerador num dia só, com todo o resto como fixo: as entradas fora dos
  alvos não mudam. Casamento de custo mínimo dos alvos com os candidatos (mesmo objetivo em níveis:
  cobertura, WARN, preferidos, pontuação). Interjornada com os dias vizinhos respeitada.
- **Fluxo** (o mesmo do Painel): proposta → lista editável (trocar o operador sugerido por outro
  candidato, desmarcar) → prévia (pendências antes → depois) → confirmar → `assignMany` (registra
  no `DailyChangeLog` se o dia for `PUBLISHED`).
- O que sobrar sem operador aparece com o motivo (o diagnóstico do `shortage`).

**Etapa B — Encaixar veículos**

- **Alvos:** blocos com `BLOCK_NO_VEHICLE`, `VEHICLE_UNAVAILABLE`, `VEHICLE_TYPE_MISMATCH`,
  `VEHICLE_BRANCH_MISMATCH`; em `VEHICLE_DOUBLE`, o carro fica no bloco em que ele é preferido ou
  habitual do âncora, e os outros blocos viram alvo.
- **Motor:** `roster-vehicles.ts` passa a aceitar um conjunto de blocos a refazer; os carros dos
  demais blocos ficam onde estão e saem da lista de elegíveis. Mesma ordem de preferência.
- **Fluxo:** igual ao da Etapa A (lista com o carro sugerido por bloco, editável).

**Etapa C — Recompor dia misto**

- Hoje não há edição estrutural no dia. Seria preciso: a pendência `TRIP_UNCOVERED`; um adaptador
  do vehicle solver para o dia (encaixar as viagens sem bloco nos blocos existentes ou num bloco
  novo); refazer as pegadas `isStale` com o crew solver sobre o dia (`daily-relief.ts` já adapta os
  blocos do dia para o cálculo de tripulação).
- É a maior das três e depende de decisões próprias (ver dúvidas).

**Etapa D — Tela**

- Na tela Escala: botão **Reparar** no painel do dia e no topo das pendências do período, com o
  direcionamento (Cobrir tabelas / Encaixar veículos). Abre o modal da proposta.
- Atalho para reparar só uma tabela a partir do painel dela (a Etapa A com um alvo).

### 1.3 Dúvidas

Responda abaixo de cada uma (`R.:`).

**R1 — Alcance.** O reparo age num dia, ou no período selecionado na tela Escala (cada dia
resolvido por si, numa proposta só)? Proponho o período: as pendências já são listadas por período,
e reparar dia a dia uma semana inteira é repetitivo.
R.: Perfeito, pode ser pelo periodo selecionado

**R2 — Quem pode cobrir.** Além dos livres e de quem está de plantão: (a) tirar alguém de uma
tabela para cobrir outra mais importante (cadeia de trocas); (b) chamar quem está de folga (hora
extra, sempre como aviso). Proponho nenhum dos dois na primeira versão — só livres e plantões —, e
(b) como opção desligada por padrão se fizer falta.
R.: Isso (comentei acima), vou citar alguns cenarios e o que é possivel do motor fazer (sugerir):
### Quadro insuficiente (nao tem operador para fechar tabelas):
>> se existe compensação no dia (respeitando periodo da tabela) sugere cancelar uma compensação do dia para fechar
ou
>> sugere reduzir plantao para fechar, qual plantao sugerir? no horário onde existe mais plantao (respeitando turno da escala), se de manha existe 1 plantao as 04h00 e 3 as 05h00 sugestão vem de um dos da 05h00
(qual critério sugerir?) AMBOS, no modal de sugestão mostrar as opções, usuario seleciona a que melhor que convir

### Falta de carro
> Aqui não tem muito o que fazer, se existe sobra de carro de outra tecnologia (exemplo sobra um convencional e escala pede um articulado) veja se existe tabela para giro, se não fica em branco de carro

**R3 — Regras em modo WARN.** Um operador numa tabela com uma regra em WARN (ex.: fora da janela,
permitido com pendência): o reparo o tira se houver alguém sem a pendência? Proponho sim, mas só
se o substituto não tiver nenhuma pendência; senão fica como está.
R.: Perfeito

**R4 — Dias publicados.** O reparo vale para dias `PUBLISHED` (com registro no `DailyChangeLog`,
que vai notificar o condutor no portal)? Proponho sim, com aviso na prévia de quantos condutores
serão afetados.
R.: Sim, alterações em dias publicados tem badge de alerta adicional no modal destacado

**R5 — Dia misto.** Com que frequência acontece na prática (só com exceções de calendário por
linha)? Proponho tirar a Etapa C deste escopo e fechar A, B e D primeiro; a recomposição vira um
plano próprio se for necessária.
R.: Eh essencial implementação, mais devido a complexidade vamos fechar todos os outros primeiro e deixar ele para o final

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
