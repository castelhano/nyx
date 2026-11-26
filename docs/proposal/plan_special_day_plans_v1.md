# Plano — Planejamentos de dias especiais (Férias, Especial)

**Status: implementado em 2026-11-26** (etapas 0–7, 9 e 10; a 8 não exige código). A migração ainda
precisa ser rodada. Diferenças em relação ao plano original estão em "Ajustes na implementação", no fim.

**Produção:** existe base de produção. As colunas novas são opcionais e não precisam de preenchimento:
os planejamentos U/S/D ficam com `baseDayTypeId = null`, que é o certo para eles. Antes de migrar,
confirmar em produção que não há planejamento F/E (quebraria a regra da etapa 2) nem exceção de
calendário. No dump de 2026-11-26 não havia nenhum dos dois.

Convenções: comentários em snippets Prisma/TS em inglês; texto em pt-BR.

---

## Objetivo

Montar o planejamento de um dia especial (Férias, Especial) a partir de um planejamento convencional
(Útil, Sábado, Domingo). Só algumas linhas mudam; as outras continuam seguindo a OSO do dia
convencional, **sem duplicar essa OSO**.

O planejamento especial é **completo**: tem todas as linhas do escopo, com carros, interlinhas e
escala próprios. Assim o solver remonta o dia inteiro, e o diário usa um planejamento só nos dias
especiais.

## Como está hoje

- `DayType` F e E têm `pattern = null`: só entram em vigor por `LineCalendarException`, nunca pela data.
- O diário ([daily-materialize.ts](../../apps/api/src/modules/transit/daily/daily-materialize.ts))
  resolve o tipo de dia por linha e já monta dias mistos (várias origens em `DailyOperation.sources`).
  Um planejamento F só com as linhas alteradas funciona, mas parte os interlinhas e as jornadas que
  cruzam os dois planejamentos, e o solver nunca vê o dia inteiro.
- `VehiclePlanLine.lineScheduleId` só aceita OSO do tipo de dia do planejamento
  ([vehicle-plan.service.ts:661](../../apps/api/src/modules/transit/timetabling/vehicle-plan/vehicle-plan.service.ts#L661)).
- `duplicate()` mantém o `dayTypeId` e não tem parâmetro para trocá-lo.
- O `update` genérico deixa trocar o `dayTypeId` do planejamento sem tocar nas viagens nem nos
  vínculos, o que deixa o planejamento inconsistente.

## Decisões

| Tema | Decisão |
|---|---|
| Tipo de dia da OSO vs. do planejamento | Separados. As viagens têm sempre o tipo de dia do planejamento (quando rodam); o vínculo da linha diz qual OSO as governa |
| Tipo base | `VehiclePlan.baseDayTypeId`, no planejamento e não no `DayType` (um Especial pode derivar de U, S ou D) |
| Quem pode misturar | Só planejamentos de tipo de dia **sem padrão**. O tipo base precisa **ter padrão**. Planejamentos U/S/D ficam como hoje (`baseDayTypeId = null`) |
| OSO que uma linha pode vincular | Do tipo de dia do planejamento ou do tipo base |
| OSO emprestada | Nunca é escrita a partir do planejamento especial (propagação bloqueada). Se diverge, a saída é criar a OSO do tipo especial |
| Nova OSO no planejamento especial | Sempre do tipo de dia do planejamento (já é o comportamento de `createLineSchedule` / `activateNewLineSchedule`) |
| Duplicar | Aceita `dayTypeId` de destino: o mesmo da origem (como hoje) ou um tipo sem padrão quando a origem tem padrão (vira `baseDayTypeId`) |
| Troca de tipo de dia depois de criado | Proibida no `update` (`dayTypeId` e `baseDayTypeId`) |
| Linhas do especial | O planejamento especial é a referência do dia inteiro: linha fora dele **não opera** nos dias desse tipo |
| Ativação do especial | Avisa (sem bloquear) as linhas ativas do escopo que ficaram fora do planejamento, para pegar esquecimento |
| Vigência do especial | Como hoje: aberta a partir de uma data. Quem decide os dias em que roda é a exceção de calendário |
| Exceção de calendário | Ganha `scopeId` opcional: vale para todas as linhas do escopo, inclusive as criadas depois. Férias usa `sourceDayTypeId = U`, para sábados e domingos do período continuarem S e D |
| Linha sem planejamento no tipo resolvido | Não opera no dia (comportamento atual do diário). **Sem fallback** para o tipo do padrão: ele faria voltar a rodar uma linha removida das férias |
| Dia misto | A exceção pode mandar só parte das linhas para o especial. O diário junta os planejamentos como já faz hoje; interlinhas e jornadas entre eles vêm quebrados e o reparo é feito na escala diária |

## Fluxo do usuário

1. No planejamento U, **Duplicar como dia especial** → escolhe Férias. Sai uma cópia completa com
   `dayTypeId = F`, `baseDayTypeId = U`, viagens com `dayTypeId = F`, e todos os vínculos nas OSOs U.
2. Remove do planejamento as linhas que não operam nas férias.
3. Nas linhas que mudam:
   - **a OSO F já existe** → troca de OSO (`SwitchLineScheduleModal`), que lista as OSOs F e U da
     linha. Escolhendo a F, as viagens são recriadas a partir dela;
   - **a OSO F não existe** → edita as viagens; a linha diverge da OSO U; **Nova OSO** cria uma F em DRAFT.
4. Roda o solver de veículos e depois o de escala sobre o planejamento F.
5. Cadastra a exceção de calendário do período: escopo inteiro, `sourceDayTypeId = U`,
   `overrideDayTypeId = F`.
6. Ativa o planejamento F. O aviso lista as linhas do escopo que não operam nele.

Nos dias úteis do período todas as linhas resolvem para F, e o diário usa só o planejamento F: as
linhas que seguem a OSO U estão nele, as alteradas estão com a OSO F, as que não operam estão fora.

---

## Etapas

### 0. Migração

```prisma
model VehiclePlan {
  // ...
  // the conventional day type a special plan (dayType without pattern) derives from — its lines may
  // pin this day type's OSOs as well as their own. null on conventional plans (U/S/D)
  baseDayTypeId String?
  baseDayType   DayType? @relation("VehiclePlanBaseDayType", fields: [baseDayTypeId], references: [id])
}

model DayType {
  // ...
  vehiclePlans     VehiclePlan[]
  baseVehiclePlans VehiclePlan[] @relation("VehiclePlanBaseDayType")
}

model LineCalendarException {
  // ...
  // set → applies to every line of the scope (lines left empty); null → the listed lines only
  scopeId String?
  scope   Scope?  @relation(fields: [scopeId], references: [id])
}
```

A relação já existente `VehiclePlan.dayType` passa a precisar de nome explícito (duas relações com
`DayType`). No `Scope`, adicionar o lado inverso `calendarExceptions LineCalendarException[]`.

`pnpm db:migrate` fica com o usuário.

### 1. Schema Zod

[packages/schemas/transit/vehicle-plan.schema.ts](../../packages/schemas/transit/vehicle-plan.schema.ts):

- `baseDayTypeId: z.uuid().nullable().optional()` com `widget: 'select'`, `resource: 'day-type'`,
  label "Tipo de dia base", `listVisibility: 'hidden'`. Só leitura no form (o valor sai da criação ou
  do duplicar).
- `dayTypeId`: só leitura no form de edição (fica editável só na criação).

[calendar-exception.schema.ts](../../packages/schemas/transit/) (achar o arquivo do `calendarExceptionSchema`):
`scopeId` opcional (select de escopo). Validação: `scopeId` **ou** linhas, nunca os dois e nunca nenhum.

### 2. Regra dos tipos de dia (backend)

Um helper novo, por exemplo `vehicle-plan/plan-day-type.utils.ts`:

```ts
// a plan's day type pair: conventional (patterned, no base) or special (no pattern, patterned base)
export async function assertPlanDayTypes(db, dayTypeId: string, baseDayTypeId: string | null): Promise<void>

// the day types whose OSOs the plan's lines may pin
export function pinnableDayTypeIds(plan: { dayTypeId: string; baseDayTypeId: string | null }): string[] {
  return plan.baseDayTypeId ? [plan.dayTypeId, plan.baseDayTypeId] : [plan.dayTypeId]
}
```

Regras do `assertPlanDayTypes`:
- tipo **com** padrão → `baseDayTypeId` precisa ser `null`;
- tipo **sem** padrão → `baseDayTypeId` obrigatório, e o tipo base precisa ter padrão.

Onde aplicar:
- `VehiclePlanService.create`: valida o par.
- `VehiclePlanService.update` ([:119](../../apps/api/src/modules/transit/timetabling/vehicle-plan/vehicle-plan.service.ts#L119)):
  remove `dayTypeId` e `baseDayTypeId` do DTO, como já faz com `summary`/`constraints`/`settings`.
  Recusar com 400 se vierem diferentes do atual é mais claro que ignorar em silêncio.

### 3. Duplicar com tipo de dia de destino

`POST /vehicle-plan/:id/duplicate` aceita body opcional `{ dayTypeId?: string }`.

Em `duplicate()` ([:474](../../apps/api/src/modules/transit/timetabling/vehicle-plan/vehicle-plan.service.ts#L474)):
- sem `dayTypeId`, ou igual ao da origem → como hoje (copia também o `baseDayTypeId` da origem);
- diferente → só aceita se o destino **não** tem padrão e a origem **tem** padrão. O novo planejamento
  recebe `dayTypeId = destino` e `baseDayTypeId = origem.dayTypeId`. Qualquer outra combinação → 400
  (F → E, por exemplo, fica fora da v1);
- as viagens criadas usam `dayTypeId` do novo planejamento, e não `bt.trip.dayTypeId` (linha 563 hoje);
- os vínculos (`lineScheduleId`, `isDrifted`, `hasAttributeDrift`) são copiados como estão: as OSOs da
  origem são do tipo base, que é permitido;
- `description` padrão: `"<descrição> (Férias)"` com o nome do tipo de destino, em vez de "(cópia)".

O `summary`, os `issues` dos blocos e a escala não mudam com a troca de tipo de dia: copiar como hoje.

### 4. Vínculo da linha com OSO de outro tipo de dia

Trocar a igualdade `schedule.dayTypeId === plan.dayTypeId` por `pinnableDayTypeIds(plan).includes(...)`:

- `copyLineFrom` ([:661](../../apps/api/src/modules/transit/timetabling/vehicle-plan/vehicle-plan.service.ts#L661)):
  a OSO escolhida pode ser do tipo base. A checagem de `approvalRef` duplicado (linha 665) continua com
  `plan.dayTypeId`, porque a OSO nova é sempre do tipo do planejamento.
- O caminho que grava a troca de OSO (o `apply-diff` chamado pelo `switch-schedule-logic.ts`): achar
  onde o novo `lineScheduleId` é validado e aplicar a mesma regra.
- Front, [SwitchLineScheduleModal.tsx:142](../../apps/web/src/app/transit/vehicle-plan/[id]/components/SwitchLineScheduleModal.tsx#L142):
  busca as OSOs da linha nos dois tipos (duas queries, ou `f_dayTypeId` com lista se o `BaseService`
  aceitar). Cada OSO mostra um selo com o tipo de dia. A prop `dayTypeId` do modal vira a lista de
  `pinnableDayTypeIds` (ou recebe também o `baseDayTypeId`).

Sem mudança, conferir só se não filtram por `plan.dayTypeId` no lugar errado:
- `createLineSchedule` e `activateNewLineSchedule` criam com `plan.dayTypeId`: correto, a OSO nova é F.
- `syncLineSchedule` ("Sincronizar" na troca de OSO) vai do planejamento para a OSO: reescreve em
  DRAFT as partidas da OSO vinculada. **Recusa** uma OSO de outro tipo de dia; numa linha emprestada,
  a reconciliação cria uma OSO do tipo do planejamento (`activateNewLineSchedule`).
- `recomputeLineDrift` / [trip-mutation.utils.ts:44](../../apps/api/src/modules/transit/timetabling/trip/trip-mutation.utils.ts#L44):
  filtra as viagens por `plan.dayTypeId`, e as viagens do especial são F. Compara com as partidas da
  OSO vinculada, seja qual for o tipo dela.

### 5. Bloquear a propagação para a OSO emprestada

Em `applyDiff` ([:986–1015](../../apps/api/src/modules/transit/timetabling/vehicle-plan/vehicle-plan.service.ts#L986)),
os `pins` que recebem propagação ganham `lineSchedule: { status: { in: [...] }, dayTypeId: plan.dayTypeId }`
(carregar o `dayTypeId` do planejamento no início do `applyDiff`, se ainda não estiver). A viagem
continua alterada no planejamento; a linha fica com `hasAttributeDrift`.

No payload das linhas do planejamento (perto de [:1612](../../apps/api/src/modules/transit/timetabling/vehicle-plan/vehicle-plan.service.ts#L1612)),
adicionar `lineScheduleDayTypeId` (ou `isBorrowed: boolean`). No front:
- a opção de propagar some para essas linhas;
- a linha mostra o selo "OSO de <tipo base>" ao lado da OSO.

### 6. Ativação

Em `activate()` ([:1683](../../apps/api/src/modules/transit/timetabling/vehicle-plan/vehicle-plan.service.ts#L1683)), quando o planejamento tem `baseDayTypeId`:
- **avisa**, no preview da ativação (`PlanActivationPreview`, ao lado dos `requirementWarnings`), as
  linhas ativas do escopo (`transitLine` com `scopeId` e `isActive`) que não estão no planejamento:
  "não operam neste planejamento: 501, 720". Não bloqueia: linha fora do especial é linha que não opera;
- `uncoveredRequirementWarnings`: agrupar as linhas pelo tipo de dia da OSO vinculada e chamar uma vez
  por grupo. As linhas emprestadas são checadas contra os requisitos do tipo base, e linhas sem OSO
  usam `plan.dayTypeId`.

A regra de vigência (`activationEffect`, por escopo + `dayTypeId`) não muda.

### 7. Exceção de calendário para o escopo inteiro

`DayTypeService.resolveDayType` e `buildDayTypeResolver`
([day-type.service.ts](../../apps/api/src/modules/transit/timetabling/day-type/day-type.service.ts)):
a condição `lines: { some: { lineId } }` passa a ser
`OR: [{ lines: { some: { lineId } } }, { scopeId: line.scopeId }]`.

- `resolveDayType(date, lineId)` precisa do `scopeId` da linha: uma consulta a mais, ou receber o
  `scopeId` como parâmetro opcional (o diário já tem).
- `buildDayTypeResolver(from, to, lineIds)` carrega os `scopeId` das linhas uma vez. No filtro em
  memória, `e.scopeId === scopeOf(lineId) || e.lines.some(...)`.
- Precedência (incondicional → padrão → condicional) e desempate (`validFrom desc`): iguais.

Se uma exceção de linha e uma de escopo valem no mesmo dia para a mesma linha, a regra atual já
resolve: a mais recente por `validFrom` ganha, dentro de cada passo.

Para férias, a exceção é **condicional** (`sourceDayTypeId = U`). Uma incondicional
(`sourceDayTypeId = null`) transformaria em F também os sábados e domingos do período.

### 8. Diário e DOP — sem mudança

Linha que resolve para F e não está no planejamento F em vigor não entra no dia: é o `continue` atual
de [daily-materialize.ts](../../apps/api/src/modules/transit/daily/daily-materialize.ts#L39), e é o
comportamento certo para "não opera nas férias". **Não** adicionar fallback para o planejamento do tipo
do padrão: ele faria voltar a rodar, pelo planejamento U, uma linha removida das férias.

O dia misto (a exceção manda só parte das linhas para F, ou mistura U, F e E) continua como hoje: o
diário junta os planejamentos, cada um trazendo só as viagens das próprias linhas; interlinhas e
jornadas entre eles vêm quebrados (`BLOCK_REMOVED`), e o reparo é feito na escala diária.

### 9. Pontos menores

- [console.input.ts:189](../../apps/api/src/modules/transit/console/console.input.ts#L189):
  `linesWithoutPlan` cruza OSO com planejamento pelo tipo de dia. Revisar para que uma linha emprestada
  não apareça como sem planejamento.
- Comparativo (`getLineComparison` / `getPlanComparison`): continua comparando com o planejamento ativo
  do mesmo tipo de dia. Para o primeiro planejamento F não há comparativo, o que é aceitável na v1.

### 10. Front — duplicar como dia especial

A `rowAction` "Duplicar" do schema não pede parâmetro (`RowActionInput` não tem formulário) e fica
como está.

Na página do planejamento (`apps/web/src/app/transit/vehicle-plan/[id]/page.tsx`), ação nova na
topbar, **Duplicar como dia especial**, visível só quando o tipo de dia do planejamento tem padrão:
- modal com um select dos tipos de dia **sem padrão**;
- chama `POST /duplicate` com `{ dayTypeId }` e abre o planejamento criado;
- modal hand-rolled, sem lib de primitivos.

O cabeçalho do planejamento especial mostra o tipo base ("Férias · base Útil").

---

## Fora do escopo

- **GTFS:** a exportação recusa tipo de dia sem padrão
  ([gtfs-export.service.ts:126](../../apps/api/src/modules/transit/timetabling/gtfs/gtfs-export.service.ts#L126)).
  Exportar dias especiais pediria `calendar_dates` gerado a partir das exceções. Fica para depois.
- Duplicar entre dois especiais (F → E) e reaproveitar as OSOs F nessa cópia.
- Revincular em lote as linhas emprestadas quando a OSO base ganha versão nova. Na v1 cada linha
  mostra que a OSO vinculada foi substituída, como em qualquer planejamento.

## Testes

- `assertPlanDayTypes`: as quatro combinações (com/sem padrão × com/sem base) e base sem padrão.
- `duplicate` U → F: `dayTypeId`/`baseDayTypeId` do novo planejamento, viagens com `dayTypeId = F`,
  vínculos preservados; F → E e U → S recusados.
- `update`: troca de `dayTypeId` recusada.
- Vínculo: OSO do tipo base aceita no especial, recusada num planejamento U; OSO de terceiro tipo recusada.
- `applyDiff`: com `propagateTripIds` numa linha emprestada, a OSO U não muda e a linha fica com
  `hasAttributeDrift`.
- `activate`: especial sem uma linha ativa do escopo ativa normalmente, com o aviso listando a linha;
  requisitos das linhas emprestadas checados contra o tipo base.
- `buildDayTypeResolver`: exceção por escopo pega linha do escopo e ignora linha de outro escopo;
  precedência com exceção de linha.
- `materializeDay`: com exceção de escopo `U → F`, um dia útil do período usa só o planejamento F; uma
  linha fora do planejamento F não entra no dia (não cai no U); um sábado do período continua no S.

## Ajustes na implementação

- **`syncLineSchedule`** escreve na OSO (plano → OSO), ao contrário do que a etapa 4 dizia. Recusa OSO
  emprestada, e o modal de troca usa "Nova OSO" (`activate-new-schedule`) nas linhas emprestadas.
- **`applyDiff`** passou a validar `lineSchedulePins`: a OSO precisa ser da linha e de um tipo de dia
  vinculável. Antes não havia checagem nenhuma.
- **Console** (etapa 9): sem mudança. Ele cruza as OSOs de cada tipo de dia com o planejamento do
  mesmo tipo; a linha emprestada não aparece como sem planejamento.
- **Importação de planejamento:** criar um planejamento novo por importação só vale para tipo de dia
  com padrão. Para um especial, criar o planejamento antes e importar nele.
- **Novo planejamento** (`NewPlanForm`): com um tipo sem padrão, pede o tipo base.
- **Exceção de calendário:** o form genérico não tinha como escolher linhas, então o `scopeId` é hoje o
  único jeito de cadastrar uma exceção pela tela.
- **Payload do Gantt:** traz `plan.baseDayType` e `lines[].isBorrowed`. A linha emprestada mostra o selo
  "OSO de <base>" na troca de OSO, e a propagação de atributos não é oferecida para ela.

