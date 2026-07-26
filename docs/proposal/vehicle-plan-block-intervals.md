# Intervalos de bloco (paradas) no Vehicle Plan

Status: implementado (pendente `pnpm db:migrate` para aplicar o schema e regenerar o Prisma client).
Escopo: `apps/web/src/app/transit/vehicle-plan/[id]/**`, `apps/api/src/modules/transit/**`, `packages/schemas/transit/**`, `apps/api/prisma/schema/transit.prisma`.

## 1. Contexto e objetivo

O grid de blocos (Gantt) hoje representa só dois tipos de segmento por linha (bloco): viagem produtiva (`BlockTrip`/`TransitTrip`) e deslocamento vazio (`BlockDeadrun`, tipado por enum `DeadrunType`). Precisamos de um terceiro tipo, **intervalo** (parada do veículo/motorista — refeição, troca, aguardo etc.), com:

- Tipo cadastrável pelo usuário (não um enum fixo como `DeadrunType`), com nome, se é remunerado, e duração mínima/máxima **informativas** (não bloqueantes).
- Comportamento no grid igual a viagem/vazio: aparece como segmento na timeline do bloco, pode ser movido (arrastar horário), redimensionado, navegado por teclado, selecionado, incluído em seleção de intervalo (range), e excluído — tudo dentro do fluxo de pending/edit-bar já existente.
- Identidade visual **sutil e distinta** de viagem e de vazio — não deve competir visualmente com os blocos de serviço.
- Quando a duração real foge do min/max cadastrado no tipo, o segmento deve indicar visualmente "irregular", destacando especificamente a faixa que excede o definido (ex.: tipo com máximo 120 min, intervalo de 130 min → destacar os 10 min excedentes, não o bloco inteiro).
- Intervalo **vive junto da viagem produtiva que o antecede** no bloco (confirmado com o usuário — §7): sem ponteiro/FK para essa viagem, a associação é sempre posicional (a viagem produtiva mais próxima antes dele na sequência do bloco). Excluir essa viagem, ou movê-la sem levar o intervalo junto, exclui o intervalo. Sem lock próprio — quem trava é a viagem-âncora.

## 2. Modelo de dados

### 2.1 `IntervalType` — novo resource CRUD (lookup cadastrável pelo usuário)

Ao contrário de `DeadrunType` (enum fixo), o pedido é explícito: tipo cadastrado via *modelo* — precisa ser tabela, porque `isPaid`/min/max variam por tipo definido pelo usuário.

```prisma
model IntervalType {
  id         String   @id @default(uuid())
  code       String   @unique
  name       String
  isPaid     Boolean  @default(false)
  minMinutes Int?
  maxMinutes Int?
  notes      String?
  createdAt  DateTime @default(now())
  updatedAt  DateTime @updatedAt

  blockIntervals BlockInterval[]

  @@map("transit_interval_types")
}
```

### 2.2 `BlockInterval` — child hidden, espelha `BlockDeadrun`

```prisma
model BlockInterval {
  id               String   @id @default(uuid())
  vehicleBlockId   String
  intervalTypeId   String
  departureMinutes Int
  arrivalMinutes   Int
  createdAt        DateTime @default(now())
  updatedAt        DateTime @updatedAt

  vehicleBlock VehicleBlock @relation(fields: [vehicleBlockId], references: [id], onDelete: Cascade)
  intervalType IntervalType @relation(fields: [intervalTypeId], references: [id])

  @@map("transit_block_intervals")
}
```

`VehicleBlock` ganha `blockIntervals BlockInterval[]`, igual a `blockDeadruns`.

Não guardamos "irregular" como coluna — é sempre derivado em runtime (`arrivalMinutes - departureMinutes` vs `intervalType.minMinutes/maxMinutes`), igual ao resto do sistema (nada de estado duplicado).

**Sem coluna de ligação para a viagem-âncora.** Nem `precedingBlockTripId` nem qualquer FK equivalente — decisão explícita do usuário (§7.1/§7.2): o intervalo não é requisito de consistência para o gerador (solver), que vai simplesmente descartá-lo quando reprocessar o plano (e como `BlockInterval` já cai em `onDelete: Cascade` a partir de `VehicleBlock`, isso acontece de graça quando o solve recria os blocos, sem código extra). "Ligado" à viagem quer dizer *posicional*: a viagem produtiva mais próxima que o antecede na sequência cronológica do bloco — o mesmo conceito de `prevProd` já usado no push/pull de horário em `page.tsx`. Cascata de exclusão (ver §4.3) é a única consequência prática dessa ligação; não existe leitura/gravação de um campo de vínculo em nenhum lugar do código.

### 2.3 Migração

`pnpm db:migrate` depois dos dois modelos. Sem dado de seed obrigatório — tipos são cadastrados pelo usuário via tela padrão do resource, mas vale sugerir 1–2 tipos de exemplo (ex.: `REF` remunerado=false, min 30/max 60) no seed de dev se o projeto já tiver seed de transit.

## 3. Backend

### 3.1 `packages/schemas/transit/interval-type.schema.ts`

Segue o padrão de `day-type.schema.ts` (resource normal, lista/form completos):

```ts
export const intervalTypeSchema = withMeta(
  z.object({
    id:         z.uuid().meta({ listVisibility: 'hidden' }),
    code:       z.string().min(1).max(10).meta({ label: 'Código', listVisibility: 'visible', keybind: 'c' }),
    name:       z.string().min(2).meta({ label: 'Nome', listVisibility: 'visible', keybind: 'n' }),
    isPaid:     z.boolean().default(false).meta({ label: 'Remunerado', listVisibility: 'visible', keybind: 'r' }),
    minMinutes: z.number().int().min(0).nullable().optional().meta({ label: 'Mínimo (min)', helpText: 'Informativo — não bloqueia o lançamento', keybind: 'i' }),
    maxMinutes: z.number().int().min(0).nullable().optional().meta({ label: 'Máximo (min)', helpText: 'Informativo — não bloqueia o lançamento', keybind: 'x' }),
    notes:      z.string().optional().meta({ label: 'Observações', listVisibility: 'hidden' }),
    createdAt:  z.date().meta({ showInForm: false, listVisibility: 'never' }),
    updatedAt:  z.date().meta({ showInForm: false, listVisibility: 'never' }),
  }),
  { label: 'Tipo de Intervalo', labelPlural: 'Tipos de Intervalo', nameField: 'name', icon: 'Coffee' },
)
```

`packages/schemas/transit/block-interval.schema.ts` espelha `block-deadrun.schema.ts` (`hidden: true`, sem tela própria).

### 3.2 `IntervalType` — os 4 arquivos padrão

`apps/api/src/modules/transit/.../interval-type/interval-type.service.ts` (estende `BaseService`) + controller (estende `BaseController`) + registro no módulo `transit`. Resource aparece sozinho no sidebar/discovery — zero config extra, conforme convenção do projeto.

### 3.3 `BlockInterval` — endpoints aninhados (mesmo padrão de `blockDeadruns`)

Em `vehicle-block.controller.ts` / `vehicle-block.service.ts`, ao lado de `updateDeadruns`/`deleteDeadruns`:

```
PATCH  /transit/vehicle-block/:id/intervals   { updates: { id, departureMinutes, arrivalMinutes }[] }
DELETE /transit/vehicle-block/:id/intervals   { ids: string[] }
```

Em `vehicle-plan.controller.ts`, ao lado de `add-deadrun`:

```
POST /transit/vehicle-plan/:id/add-interval   { intervalTypeId, departureMinutes, arrivalMinutes, blockId? }
```

Sem endpoint de "move entre blocos" — assim como deadrun hoje (`moveTrip` só aceita `blockTripIds`), intervalo não deveria migrar de bloco sozinho; isso é consistente com o pedido de "movimentado e editado da mesma forma" (tempo, não bloco).

**Cascata de exclusão (§7.1).** Dois pontos do backend precisam derrubar junto o(s) `BlockInterval` cuja viagem produtiva antecedente (posicional, não FK — ver §2.2) é a viagem afetada:

- `TransitTripService`/fluxo de `DELETE /transit/transit-trip/:id` — antes (ou na mesma transação) de excluir a viagem, localizar `BlockInterval`s do bloco cuja viagem-âncora é essa e excluí-los.
- `VehicleBlockService.moveTrip` — ao mover `blockTripIds` para outro bloco, qualquer `BlockInterval` ancorado numa dessas viagens e **não incluído** na mesma chamada é excluído junto (dado que intervalo não migra de bloco sozinho).

Time-shift (arrastar horário no mesmo bloco) não passa por `moveTrip` — é feito via `PATCH /transit/transit-trip/:id` direto. A cascata desse caso é responsabilidade do frontend (ver §4.3), que já decide isso na hora de montar os pending changes, antes de mandar qualquer patch.

## 4. Frontend — engine e estado

### 4.1 `GanttSegment`/`LayoutSegment`: trocar `isDeadhead: boolean` por `kind`

Hoje `isDeadhead` é o único discriminador de tipo em `engine/gantt.types.ts` e `engine/layout/layout.types.ts`, consumido em 7 arquivos (`renderer.ts`, `GanttBoard.tsx`, `SegmentTooltip.tsx`, `vehicles.view.ts`, `vehicles.actions.ts`, `page.tsx`, os dois `.types.ts`). Proposta: substituir por

```ts
kind: 'trip' | 'deadhead' | 'interval'
```

e ajustar cada consumidor (`seg.isDeadhead` → `seg.kind === 'deadhead'`). É mecânico, mas toca bastante arquivo — é o preço de ter um terceiro tipo de verdade em vez de forçar o intervalo dentro do booleano ou de reaproveitar `BlockDeadrun` (que misturaria semântica de remunerado/min/max com deslocamento vazio, que não tem nada disso).

**Atenção a colisão de nome**: `Selection.type` já usa o literal `'interval'` para "seleção em faixa" (`{ type: 'interval'; rowId; segments; from; to }` em `gantt.types.ts:47`, construído por `buildInterval()` em `vehicles.actions.ts`) — é um conceito de UI (múltiplos segmentos selecionados em sequência), sem relação com o novo domínio. Para não confundir os dois "interval" no código, o `kind` do segmento de parada deve usar outro literal — sugiro `'break'` internamente (rótulo em PT-BR continua "Intervalo" na UI). Ou seja: `kind: 'trip' | 'deadhead' | 'break'`, mantendo `Selection.type: 'trip' | 'interval'` intocado.

### 4.2 `vehicles.view.ts` — `getSegments`

Novo loop ao lado do de `blockDeadruns`, produzindo segmentos com id sufixado `:bk` (paralelo ao `:dr` dos deadruns), `kind: 'break'`, cor derivada do tipo (ver §5) e `data` carregando o `BlockInterval` + `intervalType` embutido (para o tooltip e o cálculo de irregularidade não precisarem de outro fetch).

### 4.3 `page.tsx` — estado pendente e navegação

Réplica do que já existe para deadrun, um a um:

- `pendingIntervalChanges: Map<id, Patch>`, `pendingIntervalDeletes: Set<id>`, `pendingAdds` ganha variante `_kind: 'break'`.
- `handleSavePending`: bloco `PATCH .../intervals`, `DELETE .../intervals`, `POST add-interval`, seguindo exatamente os blocos existentes de deadrun (linhas 1137–1184 e 1206–1222 hoje).
- `clearAllPending`, `navBlocks`/push-pull de horário (`TItem`/`DItem` → precisa de `BkItem`, hoje é união fechada de 2 kinds em ~6 pontos entre as linhas 832–1050) e o `setDr`-equivalente (`setBk`) para mover o intervalo ao arrastar/deslocar viagens adjacentes.
- `handleSelectionChange`/`resolveSelection`/`buildInterval` (já cobre range que atravessa deadrun — precisa cobrir `:bk` do mesmo jeito, ver §4.4).

**Cascata de exclusão no client (§7.1).** Dois pontos:

- `handleDelete`/exclusão de viagem: ao marcar uma `TItem` como `pendingDelete`, localizar (via `prevProd`, mesmo helper do push/pull) qualquer `BlockInterval` cuja âncora é essa viagem e adicioná-lo a `pendingIntervalDeletes` também — mesmo que o usuário não tenha selecionado o intervalo.
- Time-shift de viagem (`setTrip`, drag no mesmo bloco): se a viagem arrastada tinha um intervalo ancorado nela e esse intervalo **não faz parte da seleção atual** (não é um `selection.type === 'interval'` incluindo ambos), o intervalo entra em `pendingIntervalDeletes` no mesmo momento em que o patch da viagem é registrado — nunca fica com gap/posição inconsistente. Se o intervalo *está* na seleção (arrasto de viagem+intervalo juntos), ele recebe o mesmo delta de `setTrip` via `setBk`, preservando a duração.

### 4.4 `vehicles.actions.ts`

- `resolveSelection`: hoje `:dr` clicado sempre vira seleção single (`{ type: 'trip', segment: clicked }`), nunca inicia range. Mesmo comportamento para `:bk` — clique simples seleciona só o intervalo.
- `buildInterval`: filtro atual é só `!s.id.endsWith(':dead')` (exclui só o ghost de move-target), então um range que atravessa viagens já inclui deadruns no meio — intervalos devem se comportar igual (nenhuma mudança de filtro necessária, só extensão dos type guards que hoje testam `endsWith(':dr')`).
- `getActions`: para seleção single de `:bk`, ações = lock (se fizer sentido reaproveitar constraints) + excluir. Provavelmente **sem** lock (intervalo não tem `departureMinutes`/`cycleTime` travável do jeito que viagem tem) — só excluir + (se o tempo permitir) editar tipo inline.
- Novo dep `onDeleteInterval`/reaproveitar `onDeleteDeadruns` renomeando para algo genérico, ou dep dedicado `onDeleteBreaks`.

### 4.5 Criação

Reaproveitar a casca do `AddTripModal.tsx` (ou um `AddIntervalModal.tsx` novo, mais simples: só `intervalTypeId` + horário) — mesmo fluxo de pending-add que trip/deadrun hoje.

## 5. Identidade visual

Objetivo do usuário: **sutil**, **bem distinta** de viagem (bloco cheio, cor da linha) e de vazio (cinza sólido em baixa opacidade, altura cheia da row). Proposta:

### 5.1 Forma — silhueta, não só cor

Em vez de preencher a altura toda da row como trip/deadhead, o intervalo é desenhado como uma **pílula fina, centralizada verticalmente** (~50–55% da altura da row, `roundRect` com raio maior, quase capsule). É a diferença que mais salta aos olhos num Gantt denso — de longe já dá pra distinguir "isto não é serviço" sem precisar ler cor.

### 5.2 Cor — remunerado vs não remunerado

Sem cor de linha (intervalo não pertence a uma linha). Paleta neutra, fora da `PALETTE` de linhas e fora do cinza do deadhead:

- **Remunerado** (`isPaid: true`): preenchimento sólido `slate-500` (`#64748b`), texto branco — comunica "conta como jornada".
- **Não remunerado**: mesmo tom, mas **contorno tracejado** sobre preenchimento bem claro/quase transparente (`rgba(100,116,149,0.12)` fill + stroke tracejado `#64748b`) — comunica "não conta".

Label (quando largura > 30px, mesmo threshold do renderer atual): código do tipo (`REF`, `TROCA`...), texto pequeno centralizado.

### 5.3 Irregularidade — min/max informativos, destaque só na faixa excedente

Min/max nunca bloqueiam o lançamento (conforme pedido). Cálculo em runtime, sem novo campo persistido:

- `duration = arrivalMinutes - departureMinutes`
- **Acima do máximo**: desenha o segmento normalmente até `departureMinutes + maxMinutes`; o trecho restante (`+maxMinutes` até `arrivalMinutes` — os "10 min excedentes" do exemplo) é desenhado por cima com hachura/listras diagonais em âmbar (`#f59e0b`), reaproveitando a técnica de overlay que o `renderer.ts` já usa para o move-target (fill + stroke por cima do desenho base, `MOVE_TARGET_*`). Isso destaca literalmente só a parte fora do combinado, não o intervalo inteiro.
- **Abaixo do mínimo**: não há "sobra" espacial pra destacar (o segmento já termina antes) — o bloco inteiro recebe contorno âmbar tracejado (2px) substituindo o contorno normal, sinalizando "curto demais" sem inventar espaço que não existe no tempo.
- Em ambos os casos, um pequeno indicador (reaproveitar o padrão do `LOCK_DOT` — círculo pequeno no canto superior direito, mas em âmbar) fica sempre visível mesmo com o segmento muito estreito (zoom out), pra não depender só da hachura sumir em blocos pequenos.
- Tooltip (`SegmentTooltip.tsx`) ganha um terceiro branch (`kind === 'break'`) mostrando tipo, duração real, e — só quando irregular — uma linha extra tipo "⚠ 10 min acima do máximo (120 min)".

### 5.4 Resumo da regra de cor

| Estado | Preenchimento | Borda |
|---|---|---|
| Remunerado, regular | `#64748b` sólido | nenhuma |
| Não remunerado, regular | `#64748b` a 12%, tracejado | `#64748b` tracejado |
| Qualquer, acima do máximo | como acima + hachura âmbar na faixa excedente | + dot âmbar |
| Qualquer, abaixo do mínimo | como acima | contorno âmbar tracejado no lugar do normal + dot âmbar |

## 6. Etapas sugeridas

1. `prisma/schema/transit.prisma`: `IntervalType` + `BlockInterval` + relação em `VehicleBlock` → `pnpm db:migrate`.
2. `packages/schemas/transit`: `interval-type.schema.ts` (resource completo) + `block-interval.schema.ts` (hidden).
3. Backend: módulo `interval-type` (4 arquivos padrão) + endpoints `intervals`/`add-interval` em `vehicle-block`/`vehicle-plan` + cascata de exclusão em `TransitTripService`/`moveTrip` (§3.3).
4. Engine: `isDeadhead` → `kind: 'trip' | 'deadhead' | 'break'` nos 7 arquivos afetados.
5. `vehicles.view.ts`: `getSegments` para `blockIntervals`, cor/estado conforme §5.
6. `renderer.ts`: shape de pílula + overlay de irregularidade + dot âmbar.
7. `vehicles.actions.ts`: `resolveSelection`/`buildInterval`/`getActions` cobrindo `:bk`.
8. `page.tsx`: estado pendente, push-pull de horário, save/delete, modal de criação.
9. `SegmentTooltip.tsx`: branch de intervalo com aviso de irregularidade.
10. Teste manual no grid: criar, mover, redimensionar, excluir, salvar; validar que min/max nunca bloqueia e que o destaque aparece só na faixa/õ contorno certos.

## 7. Decisões confirmadas

- **7.1 — Vínculo e cascata**: intervalo vive junto da viagem produtiva que o antecede no bloco. Sem FK/ponteiro persistido — vínculo é posicional (viagem produtiva mais próxima antes dele, mesmo conceito de `prevProd` do push/pull atual). Excluir essa viagem exclui o intervalo junto; mover a viagem sem incluir o intervalo na mesma operação também exclui o intervalo (nunca fica órfão/deslocado). Detalhado em §2.2/§3.3/§4.3.
- **7.2 — Lock**: intervalo não tem lock próprio. Quem trava é a viagem-âncora, via o mecanismo de `constraints.locked` que já existe em `TransitTrip` — nada novo a implementar aqui. Sem amarração forte de dado porque o solver não precisa (nem deve) manter consistência do intervalo: ao gerar/regerar um plano, os intervalos existentes são simplesmente descartados junto com os blocos recriados (via `onDelete: Cascade`), sem nenhum código de sincronização geração↔intervalo.
- Refactor de `isDeadhead` → `kind` é mecânico mas toca 7 arquivos; pode ser feito num commit isolado antes de somar a lógica de intervalo, pra manter o diff de cada etapa revisável.
