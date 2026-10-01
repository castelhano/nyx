# Proposta — Sincronização de atributos plano ⇄ OSO

Objetivo: manter atributos das viagens do plano (`TransitTrip`) alinhados com as partidas da OSO
(`LineDeparture`). **Somente atributos** — horários e o conjunto de partidas continuam fora deste
escopo (troca de OSO e "Sincronizar OSO" do modal de Versões já cuidam disso).

- **OSO → plano** (`requiredVehicleType`, `stopPattern`, `markings`): ação explícita
  "Atualizar da OSO" no dropdown de Linhas.
- **Plano → OSO** (`stopPattern`, `markings`): decidido no Salvar do Gantt, a partir do diff
  pendente.

Supersede a regra 7 de `docs/proposal/trash/plan_trip_markings_v1.md` (markings unidirecional
OSO → plano, só na materialização).

---

## Decisões consolidadas

1. **Casamento viagem ↔ partida por valor:** `routeId + departureMinutes`, contra a
   `LineSchedule` pinada em `VehiclePlanLine.lineScheduleId` — mesma chave de
   `recomputeLineDrift` e `computeOsoCoverage`. Viagem sem par é ignorada (e reportada na
   prévia do fluxo 1). Linha sem OSO pinada é ignorada pelos dois fluxos, sem aviso.
2. **Duplicatas da mesma chave na linha:** OSO → plano aplica em todas; plano → OSO usa a última
   editada no diff.
3. **`markings` é copiado por inteiro** (o array substitui o outro lado) — sem merge por entrada.
4. **Status do plano:** os dois fluxos seguem o gate do `applyDiff` / `canEditGantt` —
   `DRAFT` ou `ACTIVE`. `SUPERSEDED` não participa.
5. **Status da OSO (plano → OSO):** `DRAFT` e `APPROVED` recebem a alteração; `SUPERSEDED` e
   `ARCHIVED` nunca (histórico). OSO aprovada aparece destacada na confirmação. O
   "congelamento" de OSO aprovada passa a valer só para o **conjunto de partidas e horários** —
   `stopPattern` e `markings` ficam editáveis. Hoje esse congelamento nem é imposto no código (só em
   comentários e em guards pontuais de `syncLineSchedule`/delete/approve), então não há regra
   a remover — só o comentário do `LineDeparture` em `transit.prisma` a atualizar.
6. **Sem rastreamento** da alteração em OSO aprovada (nem nota, nem log) por ora.
7. **OSO → plano entra como pendência do Gantt**, não grava direto — o Salvar persiste e o
   `alt+l` desfaz.
8. **O fluxo 1 não dispara o fluxo 2:** valores que vieram do "Atualizar da OSO" não contam como
   alteração a replicar no Salvar (ver Fluxo 2, filtro).
9. **`requiredVehicleType` é só OSO → plano.** É a exigência da OSO, não o carro que opera
   (`VehicleBlock.vehicleType`). O solver só encaixa a viagem em bloco do tipo exigido, e o
   scoring mede o descumprimento (`specialTripCount`, `scoring/block-aggregate.ts:20`). Trocar o
   tipo do bloco (`BlockDetailPopover`, `PATCH` imediato) **não** propaga para as viagens nem para
   a OSO, e continua assim. O canvas não ganha editor para o campo da viagem.

---

## Lacunas no que já existe

| Peça | Onde | Lacuna |
|---|---|---|
| `syncLineSchedule` ("Sincronizar OSO" rascunho) | `vehicle-plan.service.ts:1241` | Só cria/remove partidas por chave; não atualiza `stopPattern`/`markings` das que casam; não copia `markings` nas criadas |
| `activateNewLineSchedule` ("Nova versão") | `vehicle-plan.service.ts:1328` | Não copia `markings` |
| `LineScheduleService` nova versão a partir de outra | `line-schedule.service.ts:74-84` | Não copia `markings` |
| `recomputeLineDrift` | `trip-mutation.utils.ts:19` | Só compara chaves; divergência de atributos não aparece |
| `applyDiff` passo 9 | `vehicle-plan.service.ts:1064` | `linesToRecheck` não inclui linhas cujos atributos mudaram |
| `vehiclePlanDiffSchema.tripUpdates` / `TripPatch` | `vehicle-plan-diff.schema.ts`, `useGanttEditor.ts:137` | Sem `requiredVehicleType` — necessário só para o fluxo 1 entrar como pendência |

---

## Fluxo 1 — "Atualizar da OSO" (OSO → plano)

**Entrada:** item no `menu` de "Linhas" (`page.tsx:362`), visível com `canEditGantt`. O menu de
Linhas só existe fora do modo de edição, mas pendências e Salvar só existem dentro dele — então:

- Escopo = **linhas selecionadas** em "Linhas" que têm OSO pinada (mesmo requisito do item
  "Versões"; sem seleção → toast). O modo de edição e `mergedPlottedData` já são filtrados pelas
  linhas selecionadas, então isso mantém visível no Gantt tudo o que vira pendência. Para
  atualizar o plano inteiro, seleciona-se todas as linhas.
- "Aplicar" na prévia grava as pendências **e abre o modo de edição** (`setEditBarOpen(true)`),
  onde o usuário revisa e salva (ou descarta com `alt+l`).

**Backend** — um endpoint de leitura, uma query:

- `GET /transit/vehicle-plan/:id/oso-departures` → `{ lineId, lineScheduleId, approvalRef,
  status, departures: [{ routeId, departureMinutes, requiredVehicleType, stopPattern,
  markings }] }[]` para todas as linhas do plano com `lineScheduleId`.
- Evita N chamadas ao CRUD genérico de `line-departure` (padrão de `useOsoCoverage`).

**Frontend:**

- `oso-attribute-sync-logic.ts` (novo, puro, testável): recebe as partidas e as viagens de
  `mergedPlottedData` (já com edições pendentes aplicadas) e devolve, por linha:
  `patches: Map<tripId, Pick<TripPatch, 'requiredVehicleType'|'stopPattern'|'markings'>>`
  (só campos que diferem), `unmatchedTripIds` e contagens por campo.
- `SyncFromOsoModal.tsx` (novo): prévia por linha (OSO, nº de viagens alteradas por campo,
  nº sem par) → "Aplicar".
- `useGanttEditor`: `handleApplyOsoAttributes(patches)` mescla em `pendingChanges` e grava um
  snapshot `osoSyncedValues: Map<tripId, patch>` (estado novo, limpo junto com o resto em
  `clearAllPending` e após salvar).

**Comparação de `markings`:** `JSON.stringify` do array (a ordem importa — regra 4 de
`plan_trip_markings_v1.md`, primeira entrada por canal vence). `null` e `[]` contam como iguais.

---

## Fluxo 2 — Plano → OSO no Salvar

**Filtro (frontend, sem requisição)** — em `handleSavePendingWithConfirm`
(`useGanttEditor.ts:1716`), sobre `pendingChanges`:

- o patch tem `stopPattern` ou `markings`, **e** o valor difere do
  snapshot em `osoSyncedValues` (decisão 8);
- a viagem não é nova (`pendingAdds`) e não tem `departureMinutes` no mesmo patch;
- a linha da viagem tem `lineSchedule` com status `DRAFT` ou `APPROVED` (já vem em
  `ganttData.plan.lines`).

Nenhuma candidata → confirmação de hoje, inalterada.

**Confirmação** — o `confirm()` atual (`lib/confirm-context.tsx`) só devolve `boolean`; precisa
de um modal próprio com três saídas (ou estender `ConfirmModalOptions` com uma ação
secundária):

> 7 viagens em 3 linhas alteraram embarque ou marcações.
>
> **OSOs em rascunho:** OSO 123, OSO 456 — 4 viagens
> ⚠ **OSOs aprovadas:** OSO 789 — 3 viagens, usada em 2 outros planos
>
> [Salvar e replicar] [Salvar só no plano] [Cancelar]

"Usada em N outros planos": `getGanttData` passa a devolver `sharedPlanCount` por linha — um
`groupBy` em `vehiclePlanLine` por `lineScheduleId` na mesma requisição.

**Backend** — `vehiclePlanDiffSchema` ganha `propagateTripIds: z.array(z.string()).default([])` —
exatamente as viagens que o filtro encontrou (uma lista, não um booleano: assim o backend não
replica também edições que o filtro descartou, como uma marcação alterada e desfeita).
No `applyDiff`, novo passo após o 1 (patches de viagem), na mesma transação:

- para cada `tripUpdate` em `propagateTripIds`, com `stopPattern` ou `markings` e sem
  `departureMinutes`: resolve linha + `lineScheduleId` pinado;
  revalida status da OSO (`DRAFT | APPROVED`, ignora o resto em silêncio);
  `lineDeparture.updateMany({ where: { lineScheduleId, routeId, departureMinutes }, data })`
  com os valores **atuais da viagem** (pós-update) — nunca `requiredVehicleType`.
- Lookup de linha/pin em lote (um `findMany` das viagens + um dos `vehiclePlanLine`), não por
  viagem.

**Outros planos:** a OSO alterada pode estar pinada em outros planos. As viagens deles **não**
mudam — quem quiser alinhar usa "Atualizar da OSO" no próprio plano. Só o indicador
(`recomputeLineDrift` → `hasAttributeDrift`) é recomputado nesses `(planId, lineId)`, na mesma
transação, para que eles passem a sinalizar a divergência.


---

## Drift de atributos

`recomputeLineDrift` passa a comparar, para as chaves que casam, os três atributos
(`requiredVehicleType` incluso: só diverge quando a OSO muda, e sinaliza que cabe um "Atualizar
da OSO").

Resultado em coluna nova, separada do `isDrifted` — divergência de partidas e de atributos são
problemas de grau diferente: `VehiclePlanLine.hasAttributeDrift Boolean @default(false)`. O
`LinesPanel` mostra estado distinto ("horários ok, atributos divergem") e o `OsoCoverageModal`
continua só sobre cobertura. Exige migração.

Passo 9 do `applyDiff` passa a incluir em `linesToRecheck` as linhas de `tripUpdates` que
mexem em algum dos três campos.

---

## Arquivos

| Arquivo | Mudança |
|---|---|
| `packages/schemas/transit/vehicle-plan-diff.schema.ts` | `requiredVehicleType` em `tripUpdates` (fluxo 1); `propagateTripIds` |
| `apps/api/prisma/schema/transit.prisma` | comentário do `LineDeparture` (regra nova); `hasAttributeDrift` |
| `apps/api/.../vehicle-plan/vehicle-plan.service.ts` | `applyDiff` (patch de `requiredVehicleType`, passo de propagação, `linesToRecheck`); `getOsoDepartures` (novo); `getGanttData` (`sharedPlanCount`); `syncLineSchedule` (`stopPattern` + `markings`) e `activateNewLineSchedule` (`markings`) |
| `apps/api/.../vehicle-plan/vehicle-plan.controller.ts` | `GET :id/oso-departures` |
| `apps/api/.../trip/trip-mutation.utils.ts` | `recomputeLineDrift` compara atributos |
| `apps/api/.../line-schedule/line-schedule.service.ts` | nova versão copia `markings` |
| `apps/web/.../vehicle-plan/[id]/page.tsx` | item "Atualizar da OSO" no menu de Linhas |
| `apps/web/.../hooks/useGanttEditor.ts` | `TripPatch.requiredVehicleType` (só preenchido pelo fluxo 1); `osoSyncedValues`; `handleApplyOsoAttributes`; filtro + modal no Salvar; `propagateTripIds` no body |
| `apps/web/.../oso-attribute-sync-logic.ts` | novo |
| `apps/web/.../components/SyncFromOsoModal.tsx` | novo |
| `apps/web/.../components/SaveWithOsoModal.tsx` (ou extensão do `ConfirmModal`) | novo |
| `apps/web/.../components/LinesPanel.tsx` | estado de drift de atributos |

---

## Ordem sugerida

1. Backend base: migração `hasAttributeDrift`, `requiredVehicleType` no diff, `recomputeLineDrift` com atributos,
   `linesToRecheck`, cópia de `markings` em `activateNewLineSchedule`/nova versão,
   `stopPattern`/`markings` em `syncLineSchedule`.
2. Fluxo 1: endpoint `oso-departures` → logic → modal → item no menu.
3. Fluxo 2: `propagateTripIds` no `applyDiff` (+ drift de outros planos) →
   `sharedPlanCount` → filtro e modal no Salvar.

## Fora de escopo

- Guard no CRUD genérico de `LineDeparture` (`PATCH /transit/line-departure/:id` altera hoje
  horários de OSO aprovada sem restrição).
- Rastreamento de alterações em OSO aprovada.
- Propagar `VehicleBlock.vehicleType` para as viagens ou para a OSO.
