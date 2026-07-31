# Scope de planejamento (Scope/ScopeOperator), VehiclePlan por escopo, e consolidação com approval-ref do LineSchedule

Status: proposto (não implementado).
Escopo: `apps/api/prisma/schema/transit.prisma`, `apps/api/prisma/schema/core.prisma`, `apps/api/src/modules/transit/**` (novos módulos `scope` e `scope-operator`, `network/line`, `timetabling/vehicle-plan/**`, `timetabling/line-schedule/**`), `packages/schemas/transit/**` (novos `scope.schema.ts`, `scope-operator.schema.ts`, ajustes em `line.schema.ts`, `vehicle-plan.schema.ts`, `line-schedule.schema.ts`, `line-departure.schema.ts`), `apps/web/src/app/transit/vehicle-plan/**`.

Consolida três frentes discutidas: (a) o bug de planejamento novo sem linhas e sem forma de corrigir; (b) o modelo `Scope`/`ScopeOperator` para dar a um planejamento um universo de linhas + operadores; (c) o plano já existente em `docs/proposal/line-schedule-approval-ref.md` (`approvalRef` como identidade do `LineSchedule`, remoção de `version`), que toca os mesmos arquivos e por isso é feito na mesma leva em vez de duas migrações separadas. App não está em produção — sem preocupação de backfill/compat.

## 0. Decisões tomadas

- **Conflito no `activate()`**: passa a ser "só um plano `ACTIVE` por `(scopeId, dayTypeId)`", em vez do overlap de linhas materializadas.
- **`TransitLine.scopeId`**: opcional. Uma linha pode existir sem escopo; só fica indisponível para qualquer `VehiclePlan` enquanto não tiver.
- **Visibilidade de `Scope`**: catálogo normal, visível a todo usuário com permissão (como `DayType`/`Branch` hoje) — sem `scopeField` no `BaseService`. Restrição por operador fica para quando a escala de motoristas consumir `ScopeOperator`.
- **`ScopeOperator`**: associação Scope↔Branch por FK simples (não m2m), com `abbr` e `share` (percentual, opcional).
- **`Scope.lines`**: FK simples (`TransitLine.scopeId`), não m2m — uma linha pertence a no máximo um escopo.

## 1. Schema Prisma + migração

**`apps/api/prisma/schema/transit.prisma`** — novos models:

```prisma
model Scope {
  id          String   @id @default(uuid())
  name        String
  description String?
  createdAt   DateTime @default(now())
  updatedAt   DateTime @updatedAt

  lines        TransitLine[]
  operators    ScopeOperator[]
  vehiclePlans VehiclePlan[]

  @@map("transit_scopes")
}

model ScopeOperator {
  id        String   @id @default(uuid())
  scopeId   String
  branchId  String
  abbr      String
  share     Float?
  createdAt DateTime @default(now())
  updatedAt DateTime @updatedAt

  scope  Scope  @relation(fields: [scopeId], references: [id], onDelete: Cascade)
  branch Branch @relation("BranchScopeOperators", fields: [branchId], references: [id])

  @@unique([scopeId, branchId])
  @@map("transit_scope_operators")
}
```

`@@unique([scopeId, branchId])` não foi pedido explicitamente mas é uma trava óbvia (evita a mesma filial duplicada como operador do mesmo escopo) — sinalizando aqui caso você prefira permitir duplicidade por algum motivo que eu não esteja vendo.

**`TransitLine`** (`transit.prisma:64-92`) — adiciona:
```prisma
scopeId String?
scope   Scope?  @relation(fields: [scopeId], references: [id], onDelete: Restrict)
```
`Restrict`: não deixa apagar um `Scope` enquanto alguma linha ainda aponta pra ele (força desvincular as linhas primeiro, o que por sua vez passa pela validação da Etapa 4).

**`VehiclePlan`** (`transit.prisma:333-354`) — adiciona:
```prisma
scopeId String
scope   Scope  @relation(fields: [scopeId], references: [id], onDelete: Restrict)
```
Obrigatório, sem default — mesmo tratamento que `dayTypeId` já recebe hoje (campo obrigatório na criação, não editável depois pela UI custom, sem guard extra no backend contra alterar via PATCH genérico — simetria com o que já existe, não é uma lacuna nova).

**`apps/api/prisma/schema/core.prisma`** — `Branch` (linha 58-82) ganha:
```prisma
scopeOperators ScopeOperator[] @relation("BranchScopeOperators")
```

**`LineSchedule`** (`transit.prisma:220-244`), conforme `line-schedule-approval-ref.md` §2:
- Remove `version Int`.
- `approvalRef String?` → `approvalRef String`.
- `@@unique([lineId, dayTypeId, version])` → `@@unique([lineId, dayTypeId, approvalRef])`.

**Migração (SQLite dev)** — uma única passagem, feita com `--create-only` porque o `LineSchedule.approvalRef` precisa de backfill antes do `NOT NULL` (mesmo procedimento já detalhado no proposal de approval-ref):
1. `prisma migrate dev --create-only --name vehicle_plan_scope`.
2. Editar o SQL gerado:
   a. Criar `transit_scopes` e `transit_scope_operators`.
   b. Adicionar `scopeId` nullable em `transit_lines`.
   c. Adicionar `scopeId` em `transit_vehicle_plans` — como não há dados de produção, pode ir direto `NOT NULL` desde que existam linhas em `transit_vehicle_plans` hoje: se sim, criar um `Scope` "Padrão" via `INSERT` e apontar todo `VehiclePlan` existente pra ele antes do `NOT NULL` (ver checagem no passo 3 abaixo); se a tabela estiver vazia, pular esse backfill.
   d. `UPDATE transit_line_schedules SET approvalRef = 'LEGACY-' || substr(id,1,8) WHERE approvalRef IS NULL OR approvalRef = ''`.
   e. Drop do índice único antigo de `LineSchedule`, drop de `version`, rebuild de `approvalRef` como `NOT NULL`, novo índice único `(lineId, dayTypeId, approvalRef)`.
3. Antes de aplicar, rodar `SELECT COUNT(*) FROM transit_vehicle_plans` no dev.db atual pra saber se o backfill do passo 2c é necessário.
4. `prisma migrate dev` (aplica) e `prisma generate`.

## 2. Zod schemas

**`packages/schemas/transit/scope.schema.ts`** (novo):
```ts
export const scopeSchema = withMeta(
  z.object({
    id:          z.uuid().meta({ listVisibility: 'hidden' }),
    name:        z.string().min(1).meta({ label: 'Nome', listVisibility: 'visible', className: 'md:w-1/2', keybind: 'n' }),
    description: z.string().optional().meta({ label: 'Descrição', widget: 'textarea', listVisibility: 'never' }),
    createdAt:   z.date().meta({ showInForm: false, listVisibility: 'never' }),
    updatedAt:   z.date().meta({ showInForm: false, listVisibility: 'never' }),
  }),
  { label: 'Escopo', labelPlural: 'Escopos', nameField: 'name', icon: 'Globe' },
)
```

**`packages/schemas/transit/scope-operator.schema.ts`** (novo), seguindo o padrão de `line-schedule.schema.ts:9-13` para o FK do pai:
```ts
export const scopeOperatorSchema = withMeta(
  z.object({
    id:      z.uuid().meta({ listVisibility: 'hidden' }),
    scopeId: z.uuid().meta({ label: 'Escopo', showInForm: false, listVisibility: 'hidden' }),
    branchId: z.uuid().meta({
      label: 'Filial', widget: 'select', resource: 'branch', domain: 'core', labelField: 'name',
      listVisibility: 'visible', filter: { type: 'relation', endpoint: 'core/branch', labelField: 'name' },
    }),
    abbr: z.string().min(1).max(10).meta({ label: 'Sigla', listVisibility: 'visible', className: 'md:w-32' }),
    share: z.number().min(0).max(100).optional().meta({ label: 'Participação (%)', listVisibility: 'visible', className: 'md:w-32' }),
    createdAt: z.date().meta({ showInForm: false, listVisibility: 'never' }),
    updatedAt: z.date().meta({ showInForm: false, listVisibility: 'never' }),
  }),
  {
    label: 'Operador', labelPlural: 'Operadores', nameField: 'abbr', icon: 'Building2',
    breadcrumb: [{ resource: 'scope', contextField: 'scopeId', listLabel: 'Escopo', nameField: 'name', keybind: 'f10' }],
  },
)
```

**`packages/schemas/transit/line.schema.ts`** — adiciona `scopeId` (opcional):
```ts
scopeId: z.uuid().optional().meta({
  label: 'Escopo', widget: 'select', resource: 'scope', domain: 'transit', labelField: 'name',
  listVisibility: 'visible', filter: { type: 'relation', endpoint: 'transit/scope', labelField: 'name' },
}),
```
Sem `breadcrumb` — `TransitLine` continua um recurso de primeiro nível (sidebar/discovery normais); `scopeId` é só mais um campo de relação filtrável, do mesmo jeito que `dayTypeId` é em `VehiclePlan` hoje.

**`packages/schemas/transit/vehicle-plan.schema.ts`** — adiciona `scopeId` (obrigatório), mesmo tratamento de `dayTypeId` (`vehicle-plan.schema.ts:29-38`):
```ts
scopeId: z.uuid().meta({
  label: 'Escopo', widget: 'select', resource: 'scope', domain: 'transit', labelField: 'name',
  listVisibility: 'visible', filter: { type: 'relation', endpoint: 'transit/scope', labelField: 'name' },
  keybind: 's',
}),
```
(`s` já é usado por `status` — ajustar para outra tecla livre, ex. `p` de "projeto"/"pertence", na hora de implementar.)

**`line-schedule.schema.ts` / `line-departure.schema.ts`** — conforme `line-schedule-approval-ref.md` §4: remove `version`, `approvalRef` vira obrigatório, `nameField` das duas passa a `approvalRef`.

## 3. Backend — novo resource `Scope`

`apps/api/src/modules/transit/scope/scope.service.ts` (estende `BaseService`, sem lógica custom — catálogo simples) + `scope.controller.ts` (estende `BaseController`) + `scope.module.ts`, registrado no módulo do domínio `transit`. Segue exatamente a receita de 4 arquivos do `CLAUDE.md` — nada especial aqui.

## 4. Backend — novo resource `ScopeOperator`

Mesma receita, filho de `Scope` via breadcrumb — sem lógica custom, `BaseService`/`BaseController` padrão resolvem o `scopeId` a partir do contexto de rota automaticamente (mesmo mecanismo do `LineSchedule` sob `TransitLine`).

## 5. Backend — `LineService` (`apps/api/src/modules/transit/network/line/line.service.ts:37-46`)

Adiciona guarda de integridade: ao trocar/remover `scopeId` de uma linha que já tem `VehiclePlanLine` (ou seja, já foi materializada em algum plano), bloquear.

```ts
override async update(id: string, dto: UpdateLineDto): Promise<Line> {
  if (dto.scopeId !== undefined) {
    const current = await this.findOne(id)
    if ((dto.scopeId ?? null) !== (current.scopeId ?? null)) {
      const materialized = await this.prisma.vehiclePlanLine.count({ where: { lineId: id } })
      if (materialized > 0) {
        throw new BadRequestException('Linha possui planejamento(s) com viagens materializadas — não é possível alterar o escopo')
      }
    }
  }
  // ...lógica de merge de metrics já existente...
}
```

## 6. Backend — `VehiclePlanService` (`apps/api/src/modules/transit/timetabling/vehicle-plan/vehicle-plan.service.ts`)

- **`generate()` (linha 34-199): sem alteração.** O universo de linhas continua vindo de `plan.lines` (`VehiclePlanLine`, materializadas) — linhas do escopo nunca materializadas não têm `TransitTrip` pra puxar de qualquer forma, então incluí-las no filtro do solver seria um no-op. Mantém a intenção "o solver reblocka o que eu já carreguei neste plano", não "tudo que existe no escopo".
- **`activate()` (linha 1075-1101)**: troca a checagem de conflito — não precisa mais de `include: { lines: ... }`:
  ```ts
  const conflict = await this.prisma.vehiclePlan.findFirst({
    where:  { id: { not: planId }, scopeId: plan.scopeId, dayTypeId: plan.dayTypeId, status: 'ACTIVE' },
    select: { id: true, description: true },
  })
  ```
- **`switchLineSchedule()` (linha 962-1016)**: vira upsert — hoje falha com `NotFoundException` se a linha ainda não foi adicionada ao plano (`vehiclePlanLine.findUnique` + throw, linha 970-973); essa é a trava exata que impede materializar uma linha nova pela UI. Remove o throw, adiciona validação de que a linha pertence ao escopo do plano, e troca o `update` final por `upsert`:
  ```ts
  const line = await this.prisma.transitLine.findUnique({ where: { id: lineId }, select: { scopeId: true } })
  if (!line || line.scopeId !== plan.scopeId) throw new BadRequestException('Linha não pertence ao escopo deste planejamento')
  // ...
  await this.prisma.vehiclePlanLine.upsert({
    where:  { vehiclePlanId_lineId: { vehiclePlanId: planId, lineId } },
    create: { vehiclePlanId: planId, lineId, lineScheduleId, isDrifted: false },
    update: { lineScheduleId, isDrifted: false },
  })
  ```
- **`addLine()` / `removeLine()` (linha 890-912)**: remove — hoje são código morto (nenhuma tela chama `POST :id/lines` ou o `DELETE :id/lines/:lineId` original; confirmado via grep no frontend). `removeLine` é substituído semanticamente pela ação "limpar linha do plano", que já existe como `clearLinesFromPlan()` (linha 918-955) mas não é exposta — o controller passa a chamar ela direto no lugar do antigo `removeLine`.
- **`duplicate()` (linha 490-604)**: propaga `scopeId: plan.scopeId` no `create` do novo plano (linha 518-528).
- **`getGanttData()` (linha 1018-1073)**: hoje a lista de linhas do plano vem só de `VehiclePlanLine` (`include: { lines: {...} }`, linha 1023-1029) — passa a vir do `Scope`, com merge por cima dos dados de materialização:
  ```ts
  const plan = await this.prisma.vehiclePlan.findUnique({
    where:   { id: planId },
    include: {
      dayType: { select: { id: true, name: true, code: true } },
      scope:   { include: { lines: { orderBy: { code: 'asc' }, select: { id: true, name: true, code: true, metrics: true } } } },
      lines:   { include: { lineSchedule: { select: { id: true, status: true, approvalRef: true } } } },
    },
  })
  if (!plan) throw new NotFoundException('VehiclePlan not found')

  const materializedByLineId = new Map(plan.lines.map(l => [l.lineId, l]))
  const lines = plan.scope.lines.map(line => {
    const materialized = materializedByLineId.get(line.id)
    return {
      lineId:         line.id,
      line,
      lineScheduleId: materialized?.lineScheduleId ?? null,
      lineSchedule:   materialized?.lineSchedule ?? null,
      isDrifted:      materialized?.isDrifted ?? false,
    }
  })
  ```
  O formato de cada item continua `{ lineId, line, lineScheduleId, lineSchedule, isDrifted }` — o mesmo shape que `LinesPanel`, `SwitchLineScheduleModal` e `AddTripModal` já consomem hoje. **Nenhum tipo de frontend muda por causa disso** (só pela remoção de `version`, já prevista no proposal de approval-ref).
  (`version: true` já sai do `select` de `lineSchedule` por causa do proposal de approval-ref.)

**`apps/api/src/modules/transit/timetabling/vehicle-plan/vehicle-plan.controller.ts`**:
- Remove `POST :id/lines` (`addLine`, linha 100-104).
- `DELETE :id/lines/:lineId` (linha 106-109) passa a chamar um novo método `clearLine(planId, lineId)` no service — thin wrapper que chama `clearLinesFromPlan(planId, [lineId], plan.dayTypeId)` e depois `vehiclePlanLine.delete` (ignorando se não existir).

## 7. Backend — import (`vehicle-plan-import.controller.ts` + `.service.ts`)

**`vehicle-plan-import.controller.ts`**:
- `getFields()` (linha 16-95) ganha um campo `scopeId` (`required: true`, `widget: 'select'`, `resource: 'scope'`, `domain: 'transit'`, `labelField: 'name'`), posicionado antes de `dayTypeId`.
- `import()` (linha 102-121) recebe `@Body('scopeId') scopeId: string` e repassa pro service.

**`vehicle-plan-import.service.ts`**:
- `import()`/`execute()` (linha 47-91) ganham o parâmetro `scopeId`. Quando `planId` é passado (reimport em plano existente), `scopeId` do body é ignorado — usa o `scopeId` já gravado no plano (mesmo padrão que já existe pra `dayTypeId`, linha 81-88).
- Validação de linha fora do escopo: depois de resolver `transitLines` por código (linha 108-118), filtra as que têm `scopeId` diferente do escopo do plano (ou do `scopeId` recebido, se plano novo) e empurra um erro por linha nesse formato — mesmo padrão do erro de linha não cadastrada (linha 114-118): `` `Linha ${code} não pertence ao escopo deste planejamento` `` — sem abortar o import inteiro, só pulando as linhas ofensoras (mesmo tratamento que erros de linha já recebem no restante do parser).
- Criação de plano novo (linha 181-190, sem `planId`): adiciona `scopeId` no `data` do `create`.
- Resto (`resolveApprovedLineSchedule` com semântica de reaproveitamento por `approvalRef`, `lineScheduleByLineId` virando `Map<string, {id, reused}>`, match de `LineDeparture` reaproveitada por chave composta) conforme `line-schedule-approval-ref.md` §3, sem mudança adicional por causa do Scope.

**`line-schedule.service.ts`** — conforme `line-schedule-approval-ref.md` §3: remove `nextVersion()`, `create()` usa `approvalRef` direto, `duplicate()` usa `generateDraftRef()`, `approve()` troca `select` de `{id, version}` pra `{id, approvalRef}`.

## 8. Frontend

**`apps/web/src/app/transit/vehicle-plan/page.tsx`** (`handleAction`, linha 59-87) — no case `'import'`, guarda também `scopeId`/nome do escopo da linha clicada (mesmo padrão de `importDayTypeId`/`importDayTypeName`, linha 62-63), e passa como `readonlyFields` adicional pro `SyncModal` (linha 108-110) junto de `dayTypeId`.

**`[id]/page.tsx` — `NewPlanForm` (linha 201-288)**: adiciona um segundo `<select>` de escopo (query em `/transit/scope`), obrigatório, antes do de `dayTypeId`. `handleCreate` (linha 223-242) inclui `scopeId` no body do `POST /transit/vehicle-plan`.

**`components/LinesPanel.tsx`**: a prop `planLines` já é alimentada por `ganttData.plan.lines` (linha 1845, 2657 do `[id]/page.tsx`) — com a mudança da Etapa 6 no `getGanttData`, ela automaticamente passa a listar todas as linhas do escopo, materializadas ou não. Nenhuma mudança estrutural na busca de dados do componente é necessária. Duas adições:
- Cada linha ganha um indicador visual leve (ex. um ponto/badge) diferenciando "com viagens neste plano" (`lineScheduleId != null` ou tem trips) de "ainda não carregada" — sinal, não bloqueio: marcar o checkbox de uma linha sem dados só não desenha nada no Gantt (comportamento correto e já automático via `plottedData`, `[id]/page.tsx:433-442`, que filtra blocos por linha selecionada).
- Um ícone de ação por linha (ex. lixeira, visível só quando a linha tem `lineScheduleId` ou `isDrifted`) que chama `DELETE /transit/vehicle-plan/:id/lines/:lineId` (novo `clearLine`, Etapa 6) — a via de "tirar uma linha do plano" hoje inexistente na UI.
- Selecionar uma linha sem `lineSchedule` e abrir "Versões" (menu já existente, `[id]/page.tsx:1909-1914`) é o caminho natural pra materializar: `SwitchLineScheduleModal` já trata `lineSchedule: null` como "Em análise" (linha 192-196) e `history.length === 0` como "Nenhuma versão disponível" (linha 201-202) — únicas mudanças necessárias nesse componente são as do approval-ref (abaixo), não da materialização em si.

**`components/SwitchLineScheduleModal.tsx`** — conforme `line-schedule-approval-ref.md` §5: remove `version` de `LineScheduleRow`/`PlanLineInfo`, remove agrupamento por `approvalRef` com múltiplos badges e o `<select>` de grupo (`groupKey`/`NO_REF_KEY`/`groupOverride`, linha 48-52, 162-179, 205-220), vira lista simples ordenada por `createdAt`/`approvedAt` desc, badge mostra `approvalRef` direto em vez de `v{version}`.

**`views/vehicles.view.ts`** — remove `version: number` do tipo `VehiclePlanGanttData`.

**Resources `Scope`/`ScopeOperator`**: nenhuma tela custom — `AutoList`/`AutoForm` genéricos cobrem os dois (mesmo caminho de qualquer resource novo do projeto).

## 9. Verificação

- `pnpm --filter @nyx/schemas build`, depois `pnpm --filter api exec tsc --noEmit` e `pnpm --filter web exec tsc --noEmit`.
- Criar um `Scope`, associar 2+ linhas a ele (`TransitLine.scopeId`), criar um `VehiclePlan` novo nesse escopo → `LinesPanel` deve listar as linhas do escopo, todas sem dados.
- Abrir "Versões" numa linha sem `LineSchedule` aprovado → modal mostra "Em análise"/"Nenhuma versão disponível", sem erro.
- Importar arquivo com `LineSchedule` aprovado pra uma dessas linhas, selecionar a versão em "Versões", aplicar → `VehiclePlanLine` é criada (upsert), viagens materializadas, badge no `LinesPanel` muda.
- Tentar mudar `scopeId` de uma linha já materializada em algum plano → bloqueado com a mensagem da Etapa 5.
- Tentar apagar um `Scope` com linhas ou planos vinculados → bloqueado por `onDelete: Restrict`.
- Ativar dois planos do mesmo `(scopeId, dayTypeId)` → segundo dispara o fluxo de conflito/substituição já existente na UI (`handleActivate`, `[id]/page.tsx:870-907`), agora comparando só escopo+dayType.
- Importar um arquivo com uma linha de código pertencente a outro escopo → import completa, com erro reportado só pra aquela linha, resto materializado normalmente.
- Repetir os testes de idempotência de reimport (`approvalRef` repetido não duplica `LineDeparture`) do proposal original.

## 10. Riscos residuais (aceitos)

- **Mudança retroativa de escopo em plano `ACTIVE`**: como a lista de linhas do `LinesPanel` é sempre "tudo que está em `Scope.lines` agora", editar `TransitLine.scopeId` (adicionar uma linha nova ao escopo) muda o universo visível de um plano `ACTIVE` sem nenhuma ação nesse plano — isso é intencional (novas linhas do escopo ficam disponíveis pra materializar em qualquer plano daquele escopo, incluindo o ativo), mas vale ter em mente que "quantas linhas o escopo tem" não é mais uma foto fixa por plano.
- **Domínio do resource `Scope`**: colocado em `transit` porque é o único consumidor hoje. Se a escala de motoristas (mencionada como uso futuro) acabar vivendo em outro domínio, pode fazer sentido mover `Scope`/`ScopeOperator` pra um domínio mais neutro depois — não bloqueia esta implementação.
- **`ScopeOperator.share`**: fica como campo solto (`Float?`, sem validação de soma = 100% entre os operadores de um mesmo escopo) — não há regra de negócio definida ainda pra isso, e não é usado por nenhum fluxo nesta proposta.
- Riscos já listados em `line-schedule-approval-ref.md` §7 (match de `LineDeparture` reaproveitada por `(routeId, departureMinutes)`, contador `DRAFT-000N` não gapless) continuam válidos e não mudam com esta proposta.
