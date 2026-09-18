# Proposta — Filtro de blocos por horário no Gantt de plano veicular

Página: `apps/web/src/app/transit/vehicle-plan/[id]/page.tsx`

**Motivação**: ao realocar viagens de um bloco pra outro, hoje o único jeito de achar um bloco
candidato é rolar visualmente o Gantt inteiro. A ideia é um filtro que restrinja a lista de
blocos exibidos (e a navegação) aos que atendem um critério de horário, olhando só viagens
produtivas (`blockTrips`, ignorando `blockDeadruns`).

Decisões já fechadas com o usuário antes deste documento:
- **Um critério ativo por vez** (não combinável) — trocar o critério substitui o anterior.
- **Painel no topo, oculto por padrão**, sobreposto ao Gantt (não fica visível o tempo todo).

---

## 1. Critério de filtro

Um único filtro ativo, composto por três seletores:

- **Campo**: início (`departureMinutes` da viagem) ou término (`arrivalMinutes`)
- **Relação**: depois de / antes de
- **Horário**: `<input type="time">` (mesmo padrão já usado em
  `LineScheduleGeneratorModal.tsx:1454-1459` — `minutesToLabel`/`labelToMinutes`)

Isso cobre as 4 combinações citadas (início após, início antes, término após, término antes)
como uma única struct: `{ field: 'start' | 'end', relation: 'after' | 'before', minutes: number }`.

**Regra de match**: um bloco aparece no filtro se **ao menos uma** viagem produtiva
(`block.blockTrips`) satisfaz o critério. `blockDeadruns` e `blockIntervals` nunca entram na
comparação — nem como critério, nem pra decidir visibilidade.

---

## 2. Blocos ocultos vs. bloco fixado (pin)

Blocos que não atendem o critério **somem da grid** (não ficam apenas esmaecidos) — é isso que
permite a regra "navegação só nos blocos filtrados" pedida. A posição/alturas das linhas do
Gantt já são recalculadas a partir do array `blocks` recebido (`vehiclesView.getRows`), então
remover entradas do array é suficiente — não precisa de um estado novo de "linha oculta" no
engine/renderer.

**Fixar bloco (pin)**: ícone novo na barra esquerda do label do bloco (`RowList.tsx:20-68`),
antes do `Icons.Info` — usar `Icons.Eye`/`Icons.EyeOff` (não existe ícone de pin dedicado no
`icons.ts`, só `MapPin`, que soa deslocado aqui). Bloco fixado aparece sempre, independente do
filtro. Esse ícone só é renderizado quando **existe um filtro ativo** — sem filtro, todos os
blocos já aparecem, então o controle não teria função e só adicionaria ruído visual.

Estado: `pinnedBlockIds: Set<string>` novo, dono natural é `useGanttEditor.ts` (mesmo lugar que
já guarda `selectedLineIds`, `moveTargetBlockId` etc.). Pins não são persistidos no servidor —
resetam ao trocar de plano/recarregar a página. Não precisam ser limpos ao desligar o filtro
(inofensivo manter marcado; se o filtro for reativado depois, o pin volta a ter efeito).

`visibleBlockIds = filtro === null ? todos : blocosQueDãoMatch ∪ pinnedBlockIds`

---

## 3. Onde o filtro se aplica (e onde não)

O filtro só afeta o que é renderizado/navegável **dentro do Gantt desta página**. Não deve
vazar pra outras funcionalidades que também recebem a lista de blocos, porque elas têm
propósitos diferentes (ex.: escolher bloco de destino ao gerar linha, ou export de OSO
cobrindo o plano inteiro). Concretamente:

- **Filtra**: o array `data.blocks` passado pro `GanttBoard` (hoje `boardData`, calculado a
  partir de `mergedPlottedData` em `page.tsx:170-173`) e o array usado pra navegação por
  teclado (`navBlocks`/`useVehiclePlanShortcuts`).
- **Não filtra**: `mergedPlottedData` em si (segue completo, é a fonte de verdade dos dados),
  nem os consumidores que recebem blocos diretamente pra outros fins —
  `AddTripModal.plottedBlocks`, `OsoCoverageModal.blocks`, `RedistributeModal.blocks`,
  `SwitchLineScheduleModal.blocks`, `LineSummaryView`.

Ou seja: `mergedPlottedData` continua sendo passado como está pra tudo que já existe; só o
`boardData` (o que vai pro Gantt) passa a ser derivado de uma versão filtrada.

---

## 4. Navegação restrita aos blocos filtrados

`navBlocks` (`useGanttEditor.ts:453-461`) é hoje derivado de `mergedPlottedData.blocks`
completo e serve dois papéis:
1. Recuperação de foco quando os dados mudam sob o usuário (`useGanttEditor.ts:525-539`)
2. Navegação ↑/↓ entre blocos e PageUp/Down entre viagens do mesmo sentido, em
   `useVehiclePlanShortcuts.ts`

Esses dois papéis precisam se separar quando o filtro está ativo: o papel (1) precisa
continuar enxergando **todos** os blocos (senão uma seleção/foco num bloco recém-oculto pelo
filtro dispararia um reset de foco indevido). O papel (2) precisa enxergar só os blocos
**visíveis** (filtrados ∪ fixados), que é exatamente o pedido de "navegação só nos blocos
filtrados".

Proposta: manter `navBlocks` como está (base completa) e adicionar `visibleNavBlocks` — mesma
forma, calculado a partir dos blocos visíveis — e passar esse novo array pro
`useVehiclePlanShortcuts` no lugar de `navBlocks` pra fins de navegação ↑/↓. Sem filtro ativo,
`visibleNavBlocks === navBlocks` (mesma referência, sem custo extra).

**Cycle de bloco-alvo pra mover** (`moveTargetBlocks`/`stepMoveTarget`,
`useGanttEditor.ts:572-591`) reusa as mesmas teclas ↑/↓ enquanto há seleção de viagem ativa —
e é literalmente o caso de uso descrito (filtrar pra depois escolher o destino do "mover").
Faz sentido que `moveTargetBlocks.allBlockIds` também passe a vir de `visibleBlockIds` em vez
de `mergedPlottedData.blocks` completo, quando o filtro estiver ativo.

---

## 5. UI do painel de filtro

Novo componente, ex. `components/BlockFilterBar.tsx`, seguindo o padrão visual de
`HeadwayRangeBar.tsx` (barra flutuante com `position: absolute`, `shadow-lg`, borda) mas
ancorada no topo da área do Gantt em vez de embaixo. Conteúdo:

- Select campo (Início / Término)
- Select relação (depois de / antes de)
- `<input type="time">`
- Contador "N blocos" (feedback de quantos deram match, sem contar os fixados)
- Botão limpar filtro (some a barra e volta a mostrar tudo)

**Toggle**: botão na topbar/edit-bar (ícone `Icons.Filter`, ou similar — checar `icons.ts`) com
atalho de teclado livre — `F6` e `F9` já usados (`LinesPanel`/edit-bar); sugiro **F7**. Abrir a
barra não aplica filtro nenhum sozinho (some vazia); o filtro entra em vigor assim que os três
campos tiverem valor.

**Fechar a barra (F7 de novo, ou Esc) limpa o filtro** — mais simples e previsível do que
manter um filtro "invisível" ativo em segundo plano; ver consideração abaixo se preferir o
contrário.

---

## 6. Considerações / decisões menores em aberto

- **Fechar a barra limpa o filtro, ou só esconde os controles e mantém o filtro rodando?**
  Proposta acima é limpar junto (mais simples de raciocinar, evita blocos "sumidos" sem
  explicação visível na tela). Se preferir manter o filtro ativo com a barra fechada, precisa
  de algum indicador visual permanente (ex. badge no botão da topbar) pra não parecer bug.
- **Seleção/foco atual, ao ligar o filtro**: se a viagem selecionada/focada está num bloco que
  não dá match e não está fixado, ela fica "órfã" (bloco some da tela). Proposta: ao ativar o
  filtro, fixar automaticamente o bloco da seleção/foco atual (se houver), evitando que o
  usuário perca contexto sem entender por quê. Alternativa mais simples: apenas limpar a
  seleção/foco ao ativar o filtro.
- **Contagem de blocos "N blocos"**: incluir ou não os blocos fixados na contagem exibida na
  barra — sugiro mostrar separado ("N no filtro + M fixados") pra não confundir com o total
  realmente visível.
- Filtro e fixações são estado só de UI (não persistem, resetam ao recarregar) — confirmar que
  isso é aceitável (parece ser, dado o uso pontual descrito).

---

## 7. Arquivos afetados (estimativa)

- `page.tsx` — novo estado de toggle da barra, novo `boardData` derivado da versão filtrada,
  wiring do novo componente
- `hooks/useGanttEditor.ts` — estado `blockFilter`, `pinnedBlockIds`, derivação de
  `visibleBlockIds`/`visibleNavBlocks`, ajuste em `moveTargetBlocks`
- `hooks/useVehiclePlanShortcuts.ts` — troca de `navBlocks` por `visibleNavBlocks` nos
  handlers de navegação ↑/↓; novo atalho F7
- `components/BlockFilterBar.tsx` — novo
- `components/RowList.tsx` — novo botão eye/pin na coluna de ícones, antes do `Info`
- `components/GanttBoard.tsx` — thread de `pinnedBlockIds`/`onTogglePin` até o `RowList`
- `lib/icons.ts` — garantir `Icons.Filter` (ou equivalente) mapeado, se ainda não estiver
