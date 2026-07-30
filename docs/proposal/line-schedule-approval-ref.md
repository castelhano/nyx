# LineSchedule: `approvalRef` (OSO) como chave de negócio, remoção de `version`

Status: proposto (não implementado).
Escopo: `apps/api/prisma/schema/transit.prisma`, `apps/api/src/modules/transit/timetabling/line-schedule/**`, `apps/api/src/modules/transit/timetabling/vehicle-plan/vehicle-plan-import.service.ts`, `apps/api/src/modules/transit/timetabling/vehicle-plan/vehicle-plan.service.ts`, `packages/schemas/transit/line-schedule.schema.ts`, `packages/schemas/transit/line-departure.schema.ts`, `apps/web/src/app/transit/vehicle-plan/[id]/**`.

## 1. Contexto e objetivo

`LineSchedule` tem hoje `version Int` (serial auto-incremental por `lineId+dayTypeId`) com `@@unique([lineId, dayTypeId, version])`. Levantamento no código confirmou que `version` não tem nenhuma função de lógica de negócio — "qual é a vigente" sempre é resolvido via `status: 'APPROVED'`, nunca comparando números de versão. Os únicos usos hoje são: satisfazer o unique constraint, e servir de rótulo decorativo (`nameField` do resource, badge "v{n}" no modal de troca de quadro de horários do vehicle-plan).

`approvalRef` (hoje `String?`) é o identificador real — o número da OSO (Ordem de Serviço) emitido pelo órgão gestor. Hoje só é preenchido automaticamente pelo fluxo de import de arquivo (terceira coluna do arquivo, ex. `105U01`); fica `null` em criação/duplicação manual pela UI.

Decisão: `approvalRef` vira a identidade de negócio do `LineSchedule` — obrigatório e único por `(lineId, dayTypeId)`. `version` é removido por completo (campo, badge, agrupamento multi-versão no modal). Reimportar um arquivo cuja OSO já existe para aquela linha/dayType **não cria nova linha nem toca nas `LineDeparture` já existentes** — apenas reaproveita o registro (idempotente, assume conteúdo idêntico ao já cadastrado). Criação manual (form genérico) e duplicação ("Nova Versão") passam a exigir um `approvalRef`: no form genérico o campo já existe, só vira obrigatório; na duplicação, o backend gera um placeholder único `DRAFT-000N` que o usuário renomeia depois, antes ou no momento da aprovação real.

## 2. Schema + migração

**`apps/api/prisma/schema/transit.prisma:220-244`**
- Remove `version Int`.
- `approvalRef String?` → `approvalRef String`.
- `@@unique([lineId, dayTypeId, version])` → `@@unique([lineId, dayTypeId, approvalRef])`.

**Migração (SQLite dev)** — não deixar o `prisma migrate dev` gerar o diff cru direto, porque precisa de backfill antes do `NOT NULL`:
1. `prisma migrate dev --create-only --name drop_line_schedule_version`.
2. Editar o SQL gerado, nesta ordem:
   a. `UPDATE transit_line_schedules SET approvalRef = 'LEGACY-' || substr(id,1,8) WHERE approvalRef IS NULL OR approvalRef = ''` — no dev.db atual: 62 linhas, 31 com `approvalRef` vazio, 0 colisões entre as 31 preenchidas, então o backfill não colide com nada.
   b. Drop do índice único antigo.
   c. Drop da coluna `version`.
   d. Rebuild da coluna `approvalRef` como `NOT NULL` (SQLite recria a tabela — deixar o Prisma gerar essa parte a partir do schema já editado).
   e. Criar o novo índice único `(lineId, dayTypeId, approvalRef)`.
3. `prisma migrate dev` (aplica) e `prisma generate`.

## 3. Backend

### `line-schedule.service.ts`
- `create()`: remove a chamada a `nextVersion()`; usa `data.approvalRef` (já obrigatório via Zod) direto. Colisão de `approvalRef` estoura P2002, já tratado genericamente por `AllExceptionsFilter` — sem tratamento novo necessário.
- Remove `nextVersion()`.
- `duplicate()`: troca `nextVersion()` por `generateDraftRef(lineId, dayTypeId)` — busca `approvalRef` existentes com prefixo `DRAFT-` para aquele `(lineId, dayTypeId)`, pega o maior sufixo numérico +1, retorna `DRAFT-000N`.
- `approve()`: troca `select: { id, version }` no conflito retornado por `select: { id, approvalRef }`. Confirmado que nenhum frontend consome o corpo da resposta de `/approve` hoje (ação genérica one-click) — mudança sem efeito colateral visível.

### `vehicle-plan-import.service.ts` (ponto de maior risco/complexidade)
- `resolveApprovedLineSchedule(lineId, dayTypeId, approvalRef)` passa a retornar `{ id: string; reused: boolean }`:
  - Se já existir `LineSchedule` com `(lineId, dayTypeId, approvalRef)`: retorna `{ id: existing.id, reused: true }` — sem create, sem supersede, sem tocar em `LineDeparture`. Se o registro encontrado não estiver `APPROVED` (ex. `SUPERSEDED`), reaproveita mesmo assim, mas empilha um aviso informativo (não bloqueante) avisando que a OSO reimportada não é a vigente atual da linha.
  - Se não existir: mantém a lógica atual (supersede do `APPROVED` anterior da linha+dayType, cria novo já `APPROVED`), retorna `{ id: created.id, reused: false }`.
  - Linha do arquivo sem `blockCode` (OSO vazia): erro de linha, pula — mesmo padrão já usado para outras linhas malformadas no parser.
- `lineScheduleByLineId` vira `Map<string, { id: string; reused: boolean }>`; ajustar os pontos que hoje leem o valor direto como string (upsert/create de `vehiclePlanLine`, criação do `plan`) para usar `.id`.
- Antes do loop principal de `tabRows`, para linhas cujo schedule foi reaproveitado, pré-carregar as `LineDeparture` existentes daquele(s) `lineScheduleId` e indexar por `` `${lineScheduleId}:${routeId}:${departureMinutes}` ``.
- No loop, para `row.isProductive` de uma linha com schedule `reused`: resolve `lineDepartureId` por essa chave composta em vez de `randomUUID()` + push em `lineDepartureRows`. Sem correspondência (arquivo diverge do quadro já aprovado) → erro de linha, pula a trip em vez de linkar errado. Linhas com schedule novo (`reused === false`) mantêm o comportamento atual inalterado.

### `vehicle-plan.service.ts`
- `getGanttData()` (~linha 1018-1029): remove `version: true` do `select` de `lineSchedule`.

## 4. Zod schemas

**`packages/schemas/transit/line-schedule.schema.ts`**
- Remove o campo `version`.
- Remove `.optional()` de `approvalRef` (mantém `label: 'OSO'`, `placeholder`).
- `nameField: 'version'` → `nameField: 'approvalRef'`.

**`packages/schemas/transit/line-departure.schema.ts`** — breadcrumb `nameField: 'version'` → `'approvalRef'`.

## 5. Frontend

**`SwitchLineScheduleModal.tsx`**
- Remove `version` de `LineScheduleRow` e `PlanLineInfo.lineSchedule`.
- Remove o agrupamento por `approvalRef` com múltiplos badges dentro do grupo e o `<select>` de grupo — cada `approvalRef` agora é 1 registro só, vira lista simples: um card/badge por schedule, ordenado por `createdAt`/`approvedAt` desc.
- Remove `groupKey`/`NO_REF_KEY`/`groupOverride`.
- Texto de resumo (`v${version}`) e badge (`v{h.version}`) trocam para exibir `approvalRef` diretamente.
- Linha de status: `` `${approvalRef ?? 'Sem referência'} V${version} - ${status}` `` → `` `${approvalRef} - ${STATUS_LABELS[status]}` `` (approvalRef sempre presente agora).

**`vehicles.view.ts`** — remove `version: number` do tipo `VehiclePlanGanttData`.

## 6. Verificação

- `pnpm --filter @nyx/schemas build` antes de checar api/web, para os tipos propagarem.
- `pnpm --filter api exec tsc --noEmit` e `pnpm --filter web exec tsc --noEmit` — pega qualquer `.version` residual.
- Importar um arquivo de exemplo duas vezes seguidas (mesma linha/dayType, mesma OSO): 1ª vez cria `LineSchedule` `APPROVED` + `LineDeparture`s novas; 2ª vez não cria linha nem duplica `LineDeparture` (mesma contagem antes/depois), só cria `TransitTrip`/`VehicleBlock` do novo plano linkando nas `LineDeparture` já existentes.
- Criar `LineSchedule` pelo form genérico sem `approvalRef` → deve bloquear (campo obrigatório).
- "Nova Versão" numa linha existente → cria registro com `approvalRef` tipo `DRAFT-0001` sem colidir.
- Abrir o modal "Trocar quadro de horários" numa linha com múltiplas OSOs históricas e conferir que a lista aparece sem os badges de versão.

## 7. Riscos residuais (aceitos)

- Match de `LineDeparture` reaproveitada por `(routeId, departureMinutes)` assume que não há duas partidas idênticas na mesma OSO — não deveria ocorrer em arquivos válidos, mas não há trava explícita contra isso.
- O contador `DRAFT-000N` do `duplicate()` não é gapless (renomear/apagar um `DRAFT-000N` pode liberar o número para reuso) — sem problema prático, é só um placeholder temporário.
