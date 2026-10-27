# Plano — Reparo do dia e portal do condutor

**Status: reparo e portal implementados (backend, login "Gestão | Operador" e a tela do
condutor em `apps/web/src/app/portal/*`).** O que existe está descrito em
[`docs/architecture/transit/rostering.md`](../../architecture/transit/rostering.md).

> **Implementado — diferenças em relação ao texto abaixo:**
> - Cotas: `absenceLimits` (por código do tipo de ausência, editável no formulário do perfil) e
>   `timeWindowLimit`, no lugar da lista `requestLimits`. Sem máximo = sem cota.
> - `portalOverride` substitui só os campos que preenche (a lista de cotas inteira), editado no
>   cadastro do operador (aba Portal).
> - O acesso (`CrewAccess`) nasce no primeiro login com o PIN inicial (CPF); o gestor reseta pelo
>   botão "Resetar PIN do portal" na lista de operadores.
> - Notificações: geradas do `DailyChangeLog` na primeira leitura do portal (qualquer escritor do
>   histórico — edição, gerador, reparo, férias), só as criadas depois do acesso.
> - O aviso de cota no pedido lançado pelo gestor (`STAFF_ON_BEHALF`) aparece no formulário de
>   lançamento (Pedidos do operador), pelo `GET transit/crew-member/:id/portal-quotas`.

Convenções: comentários em snippets Prisma/TS em inglês; texto em pt-BR; minutos do dia
operacional (`> 1440` = madrugada seguinte).

---

## 1. Reparo do dia

Ação do usuário na tela Escala: **altera o mínimo possível para corrigir as pendências** do período
selecionado. Não é restrito às tabelas com pendência — uma tabela sem pendência pode mudar se isso
resolver uma pendência com menos alterações (ex.: uma troca entre dois operadores).

Fluxo de cada direcionamento: filtra as pendências → tenta resolver só com as **sobras** (operadores
e carros livres) → se não der, **trocas** com o menor número de alterações → se ainda não der,
**opções** para o usuário escolher (quadro insuficiente) ou fica sem solução, com o motivo.

### Decisões

| Tema | Decisão |
|---|---|
| Alcance | O período selecionado na tela Escala; cada dia resolvido por si, numa proposta só |
| Princípio | Mudar o mínimo possível; tabelas sem pendência podem mudar numa troca |
| Fluxo | Proposta → lista editável → prévia (pendências antes → depois) → confirmar, como no Painel |
| Regra em WARN | O operador sai se houver substituto **sem nenhuma pendência**; senão fica como está |
| Dias publicados | Valem. O modal destaca, com badge de alerta, as mudanças em dias `PUBLISHED` e quantos condutores serão afetados; cada mudança entra no `DailyChangeLog` |
| Trocas | Preferência por **um movimento** (um operador a mais alterado por alvo); no máximo **dois níveis**. Valem também em dias publicados — notificar quem muda é o propósito do `DailyChangeLog` |
| Travadas | Entradas travadas e folgas lançadas à mão nunca mudam, nem numa troca — só pela edição manual |
| Período | Os dias são resolvidos em ordem; o dia seguinte já considera o proposto para o anterior (interjornada). A prévia avisa quando uma mudança afeta outro dia |
| Folga | Chamar quem está de folga (hora extra) fica fora desta versão |
| Dia misto | Fora do reparo — ver "Fora deste plano" |

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
e o casamento de veículos). Falta usá-los para mudar o mínimo possível, mantendo o resto do dia
intacto.

### 1.2 Etapa A — Cobrir tabelas

**Alvos** (por dia × empresa × função):
- tabelas sem operador (`DUTY_UNASSIGNED`);
- tabelas cujo operador não pode estar nela: `CREW_ABSENT`, `CREW_ON_DAY_OFF`, `CREW_INACTIVE`,
  `NO_SHIFT` e regras em modo BLOCK (`SHIFT_WINDOW`, `LINE_NOT_ALLOWED`, `VEHICLE_TYPE_BLOCKED`,
  CNH / curso) — o operador sai e a tabela vira alvo;
- tabelas com regra em modo WARN, só quando houver substituto sem nenhuma pendência.

Plantão sem operador (`RESERVE_SHORT`) não é alvo: o plantão é a sobra do dia.

**Níveis**, nesta ordem, cada um só para o que o anterior não resolveu:

1. **Sobras** — quem está livre no dia (sem tabela, plantão, folga ou ausência). Casamento de custo
   mínimo dos alvos com os livres, pelo `RosterModel` do gerador num dia só, com todo o resto fixo
   (mesmo objetivo em níveis: cobertura, WARN, preferidos, pontuação). Interjornada com os dias
   vizinhos respeitada.
2. **Trocas** — um livre que não pode ir no alvo (ex.: não tem a linha) entra na tabela de outro
   operador, que vai para o alvo (**um movimento**). Só se nenhum resolver, **dois níveis**: o livre
   entra na tabela de B, B vai para a de C, C vai para o alvo. Nunca além disso. Entre as soluções,
   a que altera menos operadores, depois a de melhor pontuação. Cada troca aparece na lista como um
   grupo (quem sai de onde e vai para onde).
3. **Quadro insuficiente** — sem sobras nem trocas, o modal mostra, por alvo, as opções para o
   usuário escolher:
   - **cancelar uma folga compensada** do dia: só as dadas pelo gerador (`source = GENERATED`),
     nunca as pedidas e aprovadas; um operador cuja janela (turno + limites + restrições) cobre a
     tabela, primeiro quem tem **menos saldo no banco de horas**. O dia volta a ser de trabalho e a
     carga dele sobe;
   - **reduzir um plantão**: tirar o operador de um plantão do mesmo turno da tabela, do horário com
     **mais plantões** (ex.: um às 04:00 e três às 05:00 → um dos das 05:00). O plantão fica sem
     operador (`RESERVE_SHORT`).
   Sem nenhuma opção, a tabela fica sem operador, com o motivo (o diagnóstico do `shortage`).

### 1.3 Etapa B — Encaixar veículos

**Alvos:** blocos com `BLOCK_NO_VEHICLE`, `VEHICLE_UNAVAILABLE`, `VEHICLE_TYPE_MISMATCH`,
`VEHICLE_BRANCH_MISMATCH`; em `VEHICLE_DOUBLE`, o carro fica no bloco em que ele é preferido ou
habitual do âncora, e os outros viram alvo.

**Níveis:**

1. **Sobras** — carros da empresa livres no dia (ativos, disponíveis, sem outro bloco), do tipo que
   o bloco aceita. `roster-vehicles.ts` passa a refazer só os blocos-alvo: os demais carros ficam
   onde estão e saem da lista de elegíveis. Mesma ordem de preferência (preferido → habitual →
   qualquer elegível).
2. **Giro de tipo** — sobra um carro de outro tipo (ex.: sobra um convencional, o alvo pede
   articulado): procura um bloco que hoje roda com um carro do tipo do alvo e aceita o tipo que
   sobrou; esse bloco recebe o carro que sobrou e o dele vai para o alvo. Um nível só. O carro que
   sai deixa de ser o preferido / habitual do âncora daquele bloco: isso entra como custo, e o giro
   escolhe o bloco onde essa troca pesa menos.
3. Sem sobra nem giro, o bloco fica sem carro.

### 1.4 Etapa C — Tela

- Botão **Reparar** no topo das pendências do período e no painel do dia, com o direcionamento
  (Cobrir tabelas / Encaixar veículos). Abre o modal da proposta, agrupada por dia.
- No modal, por alvo: a solução proposta (sobra, troca ou giro, com quem muda) ou as opções de
  quadro insuficiente para escolher; desmarcar ou trocar o sugerido.
- Prévia: pendências antes → depois por dia; badge de alerta nos dias publicados, com os condutores
  afetados.
- Atalho para reparar uma tabela só, a partir do painel dela.

### Fora deste plano — recompor o dia misto

Essencial, mas não cabe no reparo: viagens sem bloco (`TRIP_UNCOVERED`, que nem existe como
pendência hoje) e pegadas `isStale` exigem refazer a estrutura do dia — encaixar viagens em blocos
e refazer pegadas. Será uma opção própria, com um solver ajustado ou dedicado (o vehicle solver e
o crew solver sobre os blocos do dia; `daily-relief.ts` já adapta os blocos do dia para o cálculo
de tripulação). Fica para depois de fechar o reparo e o portal.

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
  // the empresa's default — used by its crew members without a profile; one per empresa
  isDefault   Boolean  @default(false)
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

- Cada condutor aponta para um perfil da própria empresa; sem perfil, vale o padrão da empresa
  (`isDefault`); sem padrão, os valores do schema (só ver a escala).
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
