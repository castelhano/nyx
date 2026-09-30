# Plano — Empresa × Depósito no bloco, e "Modificar depósito"

Objetivo: separar de forma clara, na interface e nos fluxos que criam blocos, as duas coisas a
que um `VehicleBlock` está vinculado: a **Empresa** que opera o carro e o **Depósito** de onde ele
sai e para onde recolhe. Em seguida, criar a ação em lote "Modificar depósito" no plano de
veículos. A Fase 1 precisa estar concluída antes da Fase 2.

---

## Situação atual

| Conceito | Campo | Tipo | Rótulo hoje |
|---|---|---|---|
| Empresa | `VehicleBlock.branchId` | `Branch?` (opcional) | "Operador" (popover do bloco, `vehicle-block.schema.ts`), "Filial" (importação) |
| Depósito | `VehicleBlock.depotId` | `TransitLocality` com `isDepot` (obrigatório) | "Garagem" |

No modelo de dados, os dois conceitos já estão separados. Os problemas estão em outros pontos:

- **Nomes.** "Garagem" é usado para o local físico em vários lugares: bloco, cadastro de local
  ("É Garagem"), trajeto ("Garagem Preferencial"), `AccessModal`, "Frota por Garagem" no gerador
  de linha e as mensagens da importação. Já a empresa aparece como "Operador" ou "Filial",
  conforme a tela.
- **Blocos sem empresa.** Só a importação, a duplicação de plano e o popover gravam `branchId`.
  Estes fluxos criam blocos sem empresa:
  - otimizador (`vehicle-plan.service.ts:344`);
  - bloco novo criado pelo `applyDiff`, via `resolveOrCreateBlock` (`vehicle-plan.service.ts:758`),
    que atende a inclusão de viagem, deadrun ou intervalo num bloco novo e o `q+w+n` (bloco vazio).
- **Depósito herdado de qualquer bloco.** Em `resolveOrCreateBlock`, o bloco novo herda o
  depósito do **último bloco do plano**, que pode ser de outra empresa.
- **Validação.** `block-validation.ts` compara acesso e recolhida com o `depotId` do bloco. Essa
  parte está correta e continua igual.

## Decisões

1. **Vocabulário.** Empresa = `Branch`. Depósito = o local físico (`TransitLocality.isDepot`). Na
   interface, "Garagem" vira **"Depósito"** e, no bloco, "Operador"/"Filial" vira **"Empresa"**.
2. **Sem vínculo entre depósito e empresa.** Uma empresa pode usar o depósito de outra (hoje,
   carros da VPAR saem do depósito da Rápido). Amarrar os dois geraria alertas falsos e não
   impediria erros reais. Fica em aberto para o futuro um vínculo **linha+empresa** e/ou
   **linha+depósito**, cuja base já existe em `TransitRoute.homeDepotId`. Não entra agora.
3. **Um bloco tem sempre uma empresa** e quase sempre um único depósito. Mudar o depósito não
   mexe na empresa, e mudar a empresa não mexe no depósito.
4. **"Modificar depósito"** altera **todos** os acessos e recolhidas dos blocos afetados. Um bloco
   que sai de um depósito e recolhe em outro também passa a usar o depósito informado nas duas
   pontas.
5. **Sem migração de banco na Fase 1.** Os nomes `depotId`, `isDepot` e `homeDepotId` continuam
   iguais, e só os rótulos mudam.

---

## Fase 1 — Nomes e empresa no bloco

### 1.1 Renomear na interface: "Garagem" → "Depósito"

| Arquivo | Alteração |
|---|---|
| `packages/schemas/transit/vehicle-block.schema.ts` | `depotId`: "Garagem" → "Depósito"; `branchId`: "Operador" → "Empresa" |
| `packages/schemas/transit/locality.schema.ts` | `isDepot`: "É Garagem" → "É Depósito" |
| `packages/schemas/transit/route.schema.ts` | `homeDepotId`: "Garagem Preferencial" → "Depósito Preferencial" |
| `packages/schemas/transit/block-validation.ts` | rótulos das issues que citam garagem |
| `apps/web/.../vehicle-plan/[id]/components/AccessModal.tsx` | campo "Garagem" → "Depósito" |
| `apps/web/.../vehicle-plan/[id]/components/BlockDetailPopover.tsx` | "Garagem" → "Depósito", "Operador" → "Empresa" |
| `apps/web/.../vehicle-plan/[id]/components/LineScheduleGeneratorModal.tsx` | "Frota por Garagem" → "Frota por Depósito" |
| `apps/web/.../vehicle-plan/[id]/hooks/useGanttEditor.ts` | toasts e textos que citam garagem |
| `apps/web/.../crew-plan/[id]/board.types.ts`, `VehicleSwapModal.tsx` | textos que citam garagem |
| `apps/web/src/app/transit/settings/page.tsx` | textos que citam garagem |
| `apps/api/.../vehicle-plan/vehicle-plan-import.{controller,parser,service}.ts` | "saída de garagem" → "saída do depósito"; "Filial" → "Empresa" no formulário de importação |

Para achar todas as ocorrências: `grep -rni "garagem" apps/web/src apps/api/src packages`.
Comentários de código já estão em inglês ("depot") e não precisam mudar.

**Fora do escopo desta fase:** "Operador" em escala e tripulação (`duty.schema.ts`,
`DutyPanel.tsx`, `CrewFilterBar.tsx`) e o resource `ScopeOperator` ("Operador"/"Filial"). Esses
nomes descrevem o papel da empresa dentro do escopo, e não o bloco. A troca por "Empresa" pode ser
revista numa passada de nomenclatura separada.

### 1.2 Empresa sempre preenchida em bloco novo

- **`resolveOrCreateBlock`** (`vehicle-plan.service.ts:758`): herdar `branchId` **e** `depotId`
  de um bloco de referência, na seguinte ordem:
  1. o bloco da origem da operação, quando houver. No caso de mover viagens para um bloco novo,
     é o bloco de onde elas saíram. Para isso, a entrada pendente precisa levar `sourceBlockId`
     (ver 1.4);
  2. o último bloco do plano (comportamento atual, agora incluindo `branchId`);
  3. sem referência: empresa, se o escopo do plano tiver **um único** `ScopeOperator`; depósito,
     primeiro local com `isDepot`, como hoje.
- **Otimizador** (`vehicle-plan.service.ts:344`):
  - se o escopo tiver um único `ScopeOperator`, preencher `branchId` com ele;
  - se tiver várias empresas, deixar `null`. O otimizador não sabe de qual empresa é cada
    carro, e sem vínculo linha+empresa não há como deduzir. A validação (1.3) acusa esses
    blocos.
- **Bloco vazio (`q+w+n`)**: no front, o bloco vazio pendente
  (`pendingNewBlockIds` → `buildFake…`, `useGanttEditor.ts:367`) já copia `branchId` do primeiro
  bloco para a renderização. O servidor passa a fazer o mesmo pelo item 1.

### 1.3 Validação: "Bloco sem empresa"

- `block-validation.ts`: nova issue `NO_COMPANY`, rotulada "Bloco sem empresa". A entrada
  `validateBlock` recebe `branchId`.
- `block-issues.utils.ts` e `VehiclePlanService.recalculate`: incluir `branchId` no select e
  repassar para a validação.
- Aparece no filtro "Com pendências" e nas marcações do plano de veículos e da escala, que já
  existem.
- Tornar `branchId` obrigatório no banco fica **fora** desta fase. Pode ser feito depois que os
  planos existentes estiverem preenchidos, com uma migração `NOT NULL` que o usuário roda.

### 1.4 Ajustes de apoio

- `packages/schemas/transit/vehicle-plan-diff.schema.ts`: entradas `adds` com `blockId`
  ausente, que criam bloco novo, aceitam um `sourceBlockId` opcional para herdar empresa e
  depósito.
- O popover do bloco continua gravando `depotId`/`branchId` na hora, com `PATCH` direto e fora
  das pendências. Não muda nesta fase.

### Verificação da Fase 1

- `pnpm tsc` em `apps/web` e `apps/api`.
- Em qualquer plano: popover, cadastro de local, trajeto e importação mostram "Depósito" e
  "Empresa".
- Incluir uma viagem num bloco novo e usar o `q+w+n`: depois de salvar, o bloco tem empresa e
  depósito iguais aos do bloco de referência.
- Otimizar um plano de escopo com uma empresa: blocos preenchidos. Com duas empresas: blocos
  acusam "Bloco sem empresa".

---

## Fase 2 — "Modificar depósito"

### Fluxo

1. O usuário seleciona uma ou mais linhas em "Linhas".
2. Topbar → dropdown **Gerar** → novo item **"Modificar depósito"**. Ele fica desabilitado sem
   linha selecionada ou com o plano bloqueado, pela mesma regra de `canEdit` dos outros itens.
3. Um modal simples abre com um campo: Depósito, com os locais que têm `isDepot`. O
   `AccessModal` pode ser reaproveitado, recebendo `title`.
4. Ao confirmar, todas as alterações entram como **pendentes** e só vão para o servidor ao
   Gravar (`alt+g`).

### Regras

- **Blocos afetados:** todo bloco com **pelo menos uma** viagem das linhas selecionadas,
  incluindo blocos que também têm viagens de outras linhas.
- **Em cada bloco afetado:**
  - `depotId` passa a ser o novo depósito. A empresa não muda;
  - **acesso** (`ACCESS`): a origem passa a ser o novo depósito. A **chegada é mantida** e a
    saída passa a ser `chegada − tempo da matriz (novo depósito → destino do acesso)`;
  - **recolhida** (`RETURN`): o destino passa a ser o novo depósito. A **saída é mantida** e a
    chegada passa a ser `saída + tempo da matriz (origem da recolhida → novo depósito)`;
  - vale para **todos** os acessos e recolhidas do bloco, inclusive os do meio do dia
    (`[recolhe][intervalo][acesso]`);
  - deslocamentos (`DISPLACEMENT`) não mudam.
- **Par sem tempo na matriz:** mantém a duração atual do deadrun e troca só o depósito. No fim,
  um único toast de alerta informa a quantidade e os blocos afetados.
- **Sobreposição:** se o novo tempo invadir o item anterior (acesso) ou o seguinte (recolhida),
  o deadrun é criado assim mesmo, sem encurtar. A validação acusa `OVERLAP` e um toast avisa.
- **Não cria deadruns.** Bloco sem acesso ou recolhida só muda de depósito. Para criar os que
  faltam, já existe "Validar e consolidar plano".
- **Depósito já igual:** blocos e deadruns que já estão no depósito informado são ignorados. Se
  nada mudar, um toast informa isso.

### Alterações

**Schema do diff** — `packages/schemas/transit/vehicle-plan-diff.schema.ts`
- `deadrunUpdates`: aceitar `originLocalityId?` e `destinationLocalityId?` opcionais, além de
  `departureMinutes`/`arrivalMinutes`.
- Novo `blockUpdates: [{ id, depotId?, branchId? }]`. `branchId` fica previsto para uma futura
  ação "Modificar empresa" e não é usado nesta fase.

**Backend** — `vehicle-plan.service.ts`, `applyDiff`
- No passo 2 (patches de deadrun), gravar `originLocalityId`/`destinationLocalityId` quando
  vierem no patch.
- Novo passo para `blockUpdates`, que atualiza `depotId` e marca `isStale`.
- O `recalculate()` no fim da transação já recalcula as issues. `DEPOT_MISMATCH` e `OVERLAP`
  refletem o resultado.

**Frontend** — `apps/web/src/app/transit/vehicle-plan/[id]/`
- `hooks/useGanttEditor.ts`:
  - `DeadrunPatch` ganha `originLocality?`/`destinationLocality?` (`{ id, name }`, usados na
    renderização);
  - novo estado `pendingBlockChanges: Map<blockId, { depotId }>`, somado a `pendingCount`,
    aplicado em `mergedPlottedData`, enviado em `handleSavePending` e limpo em
    `clearAllPending`/descartar;
  - `handleChangeDepot(lineIds, depot)`: aplica as regras acima, busca os tempos com
    `getTravelTime` (em paralelo, com o cache que já existe), grava em
    `pendingDeadrunChanges` e `pendingBlockChanges` e emite os toasts.
  - Deadruns **pendentes** (adicionados e ainda não salvos) dos blocos afetados são alterados
    direto na entrada de `pendingAdds`, e não por patch.
- `page.tsx`: item "Modificar depósito" no `menu` do botão Gerar, e estado e render do modal.
- `components/AccessModal.tsx`: rótulo "Depósito" (Fase 1); `title` já é parâmetro.

### Verificação da Fase 2

- Linha com blocos de acesso e recolhida conhecidos: trocar o depósito para um par mapeado
  na matriz. Conferir no Gantt, antes de gravar, as novas origens e destinos e os horários
  recalculados (acesso ancorado na chegada, recolhida na saída).
- Par sem matriz: duração mantida e toast com a contagem.
- Bloco com `[recolhe][intervalo][acesso]` e depósito mais distante: sobreposição criada,
  toast emitido e, depois de gravar, issue `OVERLAP` no bloco.
- Bloco misto (linha selecionada + outra linha): todos os acessos e recolhidas do bloco
  mudaram.
- Descartar pendências: tudo volta ao estado do servidor, inclusive o depósito do bloco no
  popover.
- Gravar e recarregar: `depotId` do bloco e deadruns persistidos, e `DEPOT_MISMATCH` ausente
  nos blocos alterados.

---

## Fora do escopo / futuro

- Vínculo linha+empresa e/ou linha+depósito, para preencher a empresa no otimizador multiempresa
  e sugerir o depósito em bloco novo.
- Ação "Modificar empresa" em lote, usando o `blockUpdates.branchId` já previsto.
- Tornar `VehicleBlock.branchId` obrigatório no banco.
- Revisão de nomenclatura de "Operador" em escala e tripulação e em `ScopeOperator`.
