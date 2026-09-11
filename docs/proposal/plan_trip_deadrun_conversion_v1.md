# Proposta — Conversão Viagem ↔ Deadrun (DISPLACEMENT)

Registro da discussão e avaliação de código feita antes de qualquer
implementação real. Nada foi alterado ainda — este documento existe pra
guiar a implementação futura.

---

## Contexto

Hoje não existe nenhum jeito de transformar uma viagem produtiva
(`TransitTrip`) que na prática não vai rodar (reservada, cancelada
pontualmente etc.) num deslocamento (`BlockDeadrun.type = 'DISPLACEMENT'`) —
e vice-versa, transformar um deslocamento que passou a ser necessário como
viagem produtiva. O planejador tem que apagar manualmente e recriar do zero
em cada direção, perdendo contexto (linha, sentido, horário) no processo.

Ambos os fluxos ficam inteiramente no client, como pendings — nenhum
endpoint novo é necessário, porque `apply-diff` já aceita `tripDeletes` +
`adds` (kind `'deadrun'` sem `type`, i.e. DISPLACEMENT) e `deadrunDeletes` +
`adds` (kind `'trip'`) no mesmo payload.

---

## Direção 1 — Viagem → Deadrun

### Fluxo

1. Usuário aciona "Reservado" numa viagem selecionada
   (ação nova, não um valor do `stopPattern`, ver §UI abaixo).
2. Sistema monta o `BlockDeadrun` (DISPLACEMENT):
   - `departureMinutes` = `departureMinutes` original da viagem.
   - `originLocality`   = origem da própria viagem
     (`bt.trip.route.originLocality`).
   - destino/duração: busca o tempo de percurso na `TravelTimeMatrix`
     (`getTravelTime`, `apps/web/.../travel-time.ts`) até a localidade de
     origem do **próximo evento do bloco** (viagem, deadrun ou intervalo —
     o que vier primeiro cronologicamente; a leitura literal seria só
     "próxima viagem", mas confirmado que o caso de o próximo evento não
     ser uma viagem é raro porém possível, então generalizei). Se a matriz
     não tiver essa combinação (`getTravelTime` retorna `null`), cai no
     fallback: repete a duração original da viagem
     (`arrivalMinutes - departureMinutes`).
   - Se a viagem for a última do bloco (sem próximo evento), não há o que
     buscar na matriz — usa direto o fallback (duração original).
3. `queueTripDeletes([tripId])` + `handlePendingAdd(deadrunEntry)` — ambos
   empilhados juntos na mesma ação, não em dois passos do usuário.
4. Viagens posteriores nunca são deslocadas — mas o novo deadrun também
   nunca pode invadir o horário do próximo evento. Se a duração calculada
   (matriz ou fallback) ultrapassar `next.departureMinutes`, o
   `arrivalMinutes` do deadrun é limitado a `next.departureMinutes - 1`, e
   um alerta informa a redução ("duração reduzida de X para Y min por
   colisão com a próxima viagem"). Se o resultado for um gap (deadrun mais
   curto que o espaço disponível), não é problema — fica como está, sem
   ajuste. Essa mesma regra de clamp vale para a Direção 2 (viagem nova
   criada a partir de um deadrun): nenhum elemento novo, em nenhuma das
   duas direções, pode gerar overlap.

### Cascata de dependências — comportamento confirmado, sem aviso

`BlockInterval` e `BlockDeadrun` (ACCESS/RETURN/DISPLACEMENT) se ancoram
posicionalmente à viagem (sem FK) — `findIntervalIdsAnchoredToTrips` e
`findDeadrunIdsAnchoredToTrips` (`block-interval.utils.ts`,
`block-deadrun.utils.ts`). Um `BlockDeadrun` nunca pode virar âncora de um
`BlockInterval` (a busca de âncora só olha `blockTrip`/`transitTrip`) — ou
seja, converter uma viagem que tem intervalo/acesso/recolhida grudado nela
**destrói esses registros** quando a viagem é apagada, sem chance de o
deadrun novo herdar a âncora.

> na pratica uma viagem que ja contem um deadrun de qualquer tipo nao
> costuma virar um deadrun, se usuario tentar transformar uma e apagar os
> deadrun ancorados nela acho inclusive que eh o comportamento correto,
> destroi os demais ancorados, nem precisa de aviso pra isso

Confirmado: **sem confirm, sem bloqueio** — é o comportamento esperado, já
replicado pelo `applyTripRemoval` do backend hoje para exclusão comum de
viagem.

### Bug pré-existente a corrigir (pré-requisito)

Hoje, `queueTripDeletes` (`useGanttEditor.ts:1738`) só popula
`pendingDeletes`/`pendingChanges` — não popula `pendingDeadrunDeletes` nem
`pendingIntervalDeletes` para os registros que ficarão órfãos. O cascade
só acontece de fato no `applyDiff` do backend, no Salvar. Resultado: o
deadrun/intervalo ancorado **continua aparecendo no grid** depois que a
viagem já foi marcada para exclusão, até o Salvar — visualmente
inconsistente, e fica pior com a nova ação (o deadrun novo, criado no lugar
da viagem, vai conviver na tela com o deadrun órfão antigo até salvar).

> o certo seria ele ser removido para o pending junto com a viagem assim
> que ela eh removida (ambos ja vao para o pending)

Fix: em `queueTripDeletes`, calcular os órfãos client-side e empilhar nos
sets de pending-delete corretos, na hora:
- `findAnchoredBreakIds(block, tripIds)` já existe (mirror do backend,
  hoje só usado no fluxo de mover bloco, `useGanttEditor.ts:1597`) — dá pra
  reusar direto para `pendingIntervalDeletes`.
- Não existe hoje um mirror client-side de `findDeadrunIdsAnchoredToTrips`
  — precisa ser escrito (mesma regra: ACCESS → primeira viagem do bloco
  por `sequence`, RETURN → última, DISPLACEMENT → viagem anterior mais
  próxima cronologicamente) para popular `pendingDeadrunDeletes`.

Isso não é exclusivo da conversão — vale para qualquer exclusão de viagem
pelo Gantt (`handleDeleteTrips`), então o fix mora em `queueTripDeletes`
mesmo, beneficiando os dois fluxos.

### UI — por que não o `stopPattern`

Considerada a ideia de usar o select de "Perfil de embarque" (`stopPattern`,
`TripDetailsModal`) como gatilho, já que viagem reservada não tem perfil
mesmo. Avaliação: **não elegante**, motivo estrutural — os outros três
valores desse campo (`LOCAL`/`LIMITED`/`EXPRESS`) descrevem um atributo e
resultam num PATCH comum; "virar deslocamento" é uma ação destrutiva
(apaga o `TransitTrip`, cria um `BlockDeadrun`), não um valor de atributo.
Não daria pra modelar como um 4º membro real do enum `stopPattern` (nunca
seria persistido, a viagem já foi apagada antes do PATCH rodar), e misturar
"comando" com "valor" no mesmo `<select>` é confuso na prática (o que fica
selecionado depois, se a viagem deixou de existir?).

Proposta: ação dedicada, rótulo **"Reservado"** com um ícone que sugira a
ideia (a definir), disponível só para seleção de uma única viagem — a
lógica de "próximo evento" é por viagem, não generaliza limpo pra seleção
em lote. Dois pontos de entrada, ambos obrigatórios já nesta primeira
versão:

- Botão na barra de ações da viagem selecionada, mesmo padrão de
  `makeAccessAction`/`makeReturnAction`/`makeAddIntervalAction` em
  `vehicles.actions.ts`.
- Toggle **"Reservado"** dentro do `TripDetailsModal`: ao marcar, os
  demais campos do modal (marcações, perfil de embarque, notas) somem ou
  ficam desabilitados/readonly — não fazem sentido pra algo que vai
  deixar de ser uma viagem. A conversão em si só é efetivada no **Salvar**
  do próprio modal (mesmo botão que hoje despacha `onUpdateMarkings`/
  `onUpdateStopPattern`/`onUpdateNotes`), não no instante em que o toggle é
  marcado — desmarcar antes de salvar volta ao estado normal do modal sem
  deixar nada pendente.

O botão da barra de ações dispara `handleConvertToDeadrun` direto, sem
abrir modal — mesmo padrão instantâneo das outras ações rápidas
(Acesso/Recolhida/Intervalo). O toggle do `TripDetailsModal` é um segundo
ponto de entrada independente, não uma consequência do primeiro.

---

## Direção 2 — Deadrun → Viagem

### Fluxo

1. Usuário aciona "Produtiva" num deadrun selecionado (mesmo
   padrão de ação dedicada — hoje um deadrun selecionado só tem "Excluir"
   disponível, `vehicles.actions.ts` linha ~52-57).
2. Abre o `AddTripModal` (`apps/web/.../components/AddTripModal.tsx`) num
   modo "seed": `blockId` do deadrun, `departureMinutes` pré-carregado do
   deadrun, e linha/sentido **sugeridos** (ver inferência abaixo) — mas
   totalmente editáveis antes de confirmar. Diferente da Direção 1 (ação
   instantânea), esse é um fluxo de formulário: o sistema acerta ~99% dos
   casos, a confirmação final é sempre do usuário.

   > o sistema pode inferir (99% dos casos) mais a efetivação (confirmação)
   > seria do usuario, se tivesse que alterar a linha, ou sentido ele
   > alterava manualmente antes de gravar

3. Ao confirmar no modal, dois pendings juntos: `handlePendingAdd(novaViagem)`
   + `queueDeadrunDeletes([deadrunId])` — só acontece no submit, não ao
   simplesmente abrir o modal (cancelar não deve deixar nada pendente).

### Inferência de linha/sentido

Sem `lineId`/`routeId` no `BlockDeadrun` (só origem/destino de localidade),
a inferência não é 1:1 — usa contexto do bloco:

> minha ideia era ... olha a viagem anterior (ou na ausencia a posterior)
> replica a linha ... e so altera o sentido (se a viagem vizinha for IDA
> sugere volta, e vise versa, se for circular apenas repete)

Regra: olhar a viagem produtiva mais próxima cronologicamente antes do
deadrun no mesmo bloco (`GanttBlockTrip` já embarca `trip.route.line` — sem
fetch extra); na ausência, cair pra viagem seguinte. Sugerir a mesma linha,
e resolver o sentido da rota-alvo a partir do sentido da viagem vizinha:
`OUTBOUND` → sugere rota `INBOUND` da mesma linha, `INBOUND` → sugere
`OUTBOUND`, `CIRCULAR` → sugere `CIRCULAR` de novo. Se não achar nenhuma
viagem vizinha no bloco (bloco só com deadruns, caso raro), abre em branco
— comportamento atual do modal.

### Por que `AddTripModal` e não um modal novo

Já resolve praticamente tudo que esse fluxo precisa: cálculo de ciclo via
`LineMetrics`/matriz (`resolveCycle`, linha 329-361), seleção de
linha/rota/horário, e emite exatamente o formato (`PendingAddTrip`) que o
resto do pipeline já consome. O trabalho é só adicionar um prop de seed
opcional (`initial?: { blockId: string; departureMinutes: number;
lineId?: string; routeId?: string }`) que popula o estado inicial do form
em vez de abrir em branco — o modal não precisa saber que está "convertendo"
nada; quem orquestra o `queueDeadrunDeletes` é o chamador (`page.tsx`/
`useGanttEditor`), mantendo o modal genérico.

---

## Onde implementar — resumo por arquivo

Só frontend — nenhuma mudança de backend/schema é necessária (`apply-diff`
já suporta os dois formatos de pending usados aqui).

1. `apps/web/.../hooks/useGanttEditor.ts`
   - Fix de pré-requisito: `queueTripDeletes` populando
     `pendingDeadrunDeletes`/`pendingIntervalDeletes` a partir dos ids
     ancorados (novo util de deadrun + `findAnchoredBreakIds` já
     existente).
   - Novo util `findAnchoredDeadrunIds(block, tripIds)`, mirror de
     `block-deadrun.utils.ts` (ACCESS/RETURN por posição first/last do
     `block.blockTrips`, DISPLACEMENT por viagem anterior mais próxima).
   - Novo handler `handleConvertToDeadrun(tripId, blockId)` — monta o
     `PendingAddDeadrun`, resolve matriz com fallback, chama
     `queueTripDeletes` + `handlePendingAdd`.
   - Novo handler `handleOpenConvertToTrip(deadrunId, blockId)` — resolve a
     sugestão de linha/sentido a partir do bloco, abre `AddTripModal` com
     seed; on-submit encadeia `queueDeadrunDeletes`.
2. `apps/web/.../views/vehicles.actions.ts` — `onConvertToDeadrun`/
   `onConvertToTrip` em `VehiclesActionDeps`, novas `makeConvertToDeadrunAction`/
   `makeConvertToTripAction`, adicionadas à lista de ações de viagem única
   e de deadrun único respectivamente.
3. `apps/web/.../components/AddTripModal.tsx` — prop `seed?: { blockId,
   departureMinutes, lineId?, direction? }` opcional pra seed do formulário.
   Usei `direction` em vez de `routeId` (proposto inicialmente): resolver o
   `routeId` da direção sugerida exige a lista de rotas da linha, que o
   modal já busca sozinho (`useQuery(['transit','transit-route','by-line',lineId])`)
   — duplicar essa query em `useGanttEditor` só pra devolver um `routeId`
   pronto seria redundante. O modal casa `direction` contra essa lista
   assim que ela carrega, mesmo padrão do prefill de `reference` já
   existente.
4. `apps/web/.../components/TripDetailsModal.tsx` — toggle **"Reservado"**
   no header/corpo do modal: ao marcar, desabilita/esconde
   marcações+perfil de embarque+notas; `handleSave` passa a, quando o
   toggle está marcado, chamar `handleConvertToDeadrun` em vez do fluxo
   normal de patch — mesmo botão "Salvar" do modal, comportamento
   ramificado pelo estado do toggle.

## Bug encontrado na implementação (não previsto no desenho)

`vehiclesActionSpec` (`useGanttEditor.ts`) era memoizado só em `canEditGantt`
(`useMemo(..., [canEditGantt])`, com eslint-disable) — como `canEditGantt`
vira `true` uma única vez, cedo, o memo nunca recalculava depois disso, e
todo handler embutido nele ficava congelado na closure daquele render
inicial. Invisível pros handlers existentes (só escrevem estado via
`setX(prev => ...)`), mas `handleConvertToDeadrun`/`handleOpenConvertToTrip`
leem `mergedPlottedData` direto da closure — presa num snapshot antigo
(`blocks: []`, antes de qualquer linha selecionada), toda chamada via barra
de ações resultava em no-op silencioso (`!block` → return). O mesmo
congelamento já afetava o cascade de `queueTripDeletes` (item novo desta
proposta) quando disparado via barra de ações, mesmo em exclusão comum de
viagem — bug latente, não só da conversão. Corrigido removendo o `useMemo`
(nada depende da identidade do objeto entre renders; a factory é barata).

## Em aberto

- ~~Ícone dos botões "Reservado"/"Produtiva" — a definir.~~ `Ban` e `Bus`
  (ambos já no map `Icons`, sem lucide novo a registrar). 