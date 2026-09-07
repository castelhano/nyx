# Proposta — Inserção automática de BlockInterval em paradas longas

Registro da discussão e da avaliação de código feita antes de qualquer
implementação real. Nada foi alterado ainda — este documento existe pra
guiar a implementação futura.

---

## Contexto

Um bloco (carro) pode ficar parado por horas entre duas viagens produtivas —
caso real observado no plano `c9cacb1c-bf5d-4d01-a4b0-39c9c6edabe7`, bloco "8º":
chegada às 08:16 (PRAEIRO), próxima saída só às 13:54 (AMBEV), ~5h38 de vazio.
Hoje o grid do Gantt (`apps/web/src/app/transit/vehicle-plan/[id]/page.tsx`) e a
exportação OSO (`apps/api/.../vehicle-plan/oso/`) mostram as duas viagens em
sequência direta, sem nenhuma indicação visual da parada — como se o carro
seguisse ininterrupto. O real deveria separar isso com uma linha de intervalo
("INTERV"), como confirmado manualmente comparando com uma OSO real.

## O que já existe (avaliação de código, sem mudança necessária)

`BlockInterval`/`IntervalType` já é modelo de 1ª classe, ponta a ponta — **o
problema não é falta de modelagem, é falta de gente/processo que crie o registro**:

- Prisma: `IntervalType` (`transit.prisma:388`) e `BlockInterval`
  (`transit.prisma:409`) — `isPaid`, `minMinutes`/`maxMinutes` (informativos,
  só sinalizam "irregular" na UI, nunca bloqueiam).
- Zod: `packages/schemas/transit/block-interval.schema.ts`.
- Criação manual: `AddIntervalModal` + `handleConfirmAddInterval` em
  `useGanttEditor.ts:1380` — hoje é o único jeito de um `BlockInterval` nascer
  fora do fluxo abaixo.
- Visual no Gantt: `vehicles.view.ts:269` (`fillStyle: isPaid ? 'solid' :
  'outline'`), texto em `TripSummaryPanel.tsx:47` e `SegmentTooltip.tsx:86`
  ("não remunerado").
- Exportação OSO: `block-interval.utils.ts` (`findIntervalIdsAnchoredToTrips`,
  ancoragem posicional — sem FK, vincula ao trip produtivo anterior mais
  próximo) e `oso-workbook.renderer.ts:294,330,555` (célula `INTERV`, fundo
  laranja, igual tratamento de `RECO`).
- **Já existe precedente de detecção automática de gap → `BlockInterval`
  real**: `LineScheduleGeneratorModal.tsx:529`, função `maybeInsertBreak` —
  ao gerar uma linha, calcula o gap entre ciclos e só converte em intervalo se
  o gap couber dentro de `[minMinutes, maxMinutes]` do `IntervalType`
  escolhido pelo usuário na tela. Fora da faixa, não insere nada.

Ou seja: a peça que falta não é arquitetura nova, é estender esse mesmo
comportamento (que hoje só existe na geração por linha) para outros dois
pontos de entrada.

## Onde NÃO mexer

O solver (`apps/api/.../vehicle-plan/solver/*.worker.ts`) nunca cria
`BlockInterval` — confirmado por grep, zero referências. Seria o lugar mais
óbvio de corrigir, mas:

> solver nao esta sendo usado no momento, será refatorado quase por completo
> no futuro, nao quero me preocupar ali

Fora de escopo. Da mesma forma, o módulo `oso/` (assembler/layout/renderer)
está correto como está — ele só renderiza fielmente o que existe no banco;
não é ele que deveria "inferir" nada, o problema é upstream (falta o
`BlockInterval` ser criado antes de chegar lá).

## Pontos de entrada onde a criação deve ser automática

> Porem a criação destes interval deve ocorrer de maneira "automatica" em
> alguns pontos: 1) ao importar um planejamento, deve identificar estes casos
> (posso detalhar as regras) e inserir esse intevalo. 2) na tela do grid ao
> "finalizar plano" (atalho q+w+g), hoje eh inserido acessos e recolhidas,
> deve inserir estes intervalos também

1. **Import** — `apps/api/.../vehicle-plan/vehicle-plan-import.service.ts`.
   O arquivo já reclassifica `BlockDeadrun` por posição relativa às viagens
   produtivas (linhas ~389-484: DISPLACEMENT vira ACCESS/RETURN conforme a
   posição no bloco) antes do `createMany`. O passo de intervalo é irmão
   desse: percorrer o `BlockEntry[]` já ordenado por bloco, achar gaps entre
   eventos produtivos/deadrun consecutivos, aplicar o gate de
   `[min,max]` (ver abaixo) e empilhar em `blockIntervalRows` para um
   `blockInterval.createMany` análogo ao `blockDeadrun.createMany` da linha
   484. Regras finas específicas do import (bloco que troca de linha no meio
   do gap, família de linhas, etc.) ficam para detalhamento numa próxima
   rodada — este documento registra só a decisão de mecanismo.

2. **Finalizar Plano** — `useGanttEditor.ts:584`, `handleFinalizePlan`
   (atalho `q+w+g`). Hoje monta candidatos só de ACCESS/RETURN via
   `canAddAccess`/`canAddReturn` (linhas 602-603) e empilha em `pendingAdds`
   para revisão antes do `Salvar`. Adicionar um terceiro passe: para cada
   bloco, varrer trips+deadruns já ordenados, achar gaps internos, aplicar o
   mesmo gate, gerar `PendingAddInterval` — mesmo tipo que
   `LineScheduleGeneratorModal`/`AddIntervalModal` já produzem, então
   `handleConfirmAddInterval`/`Salvar` já sabe persistir sem mudança de
   contrato. Nenhum endpoint novo necessário.

## Configuração — qual IntervalType usar

> para isso acredito que o sistema tenha que saber qual intervaltype usar,
> talvez configurar isso no transit settings (um apontador para o type
> correto)

Adicionar `defaultIntervalTypeId` em `generalSettingsSchema`
(`packages/schemas/transit/settings-general.schema.ts`), não em
`planningSettingsSchema` — este último é puramente pesos/bandas de score do
solver, que será reescrito; `generalSettingsSchema` já guarda defaults
estruturais reaproveitados por múltiplos geradores (ex. `defaultLayoverPolicy`,
linha 17). Um campo `widget: 'select'`, `resource: 'interval-type'`, `domain:
'transit'` (mesmo padrão de `block-interval.schema.ts:15`) resolve, e reaproveita
o endpoint `/transit/settings/general` que `LineScheduleGeneratorModal.tsx:211`
já consulta via `useQuery(['transit','settings','general'])` — mesma query key
a reusar em `useGanttEditor.ts`.

Um único apontador serve os dois pontos de entrada (import e finalizar-plano),
assumindo que não há necessidade de classificar diferente entre eles — não
foi levantado motivo em contrário até aqui.

## Gate de inserção (quando um gap vira BlockInterval)

Reaproveitar exatamente a regra de `maybeInsertBreak`: só converte o gap em
`BlockInterval` se ele couber dentro de `[minMinutes, maxMinutes]` do
`IntervalType` configurado como default. Fora da faixa — gap curto demais
(virada normal de terminal) ou longo demais (provável erro de modelagem, ex.
viagem faltando) — fica de fora do automático, disponível para o planejador
adicionar manualmente via `AddIntervalModal` se realmente for o caso.

### `IntervalType` novo — ainda não existe

> esse interval ainda nao existe, eu imaginaria criar um bem abrangente para
> cobrir todos os cenarios, minimo de 30min e máximo de 10horas, o que
> acha?? talvez esse minimo deveria ser maior ainda para nao pegar falsos
> intervalos

Rodada uma consulta diagnóstica (script ad-hoc, não commitado — ver seção
abaixo) contra dados reais de produção de uma empresa inteira: 204 blocos,
3.450 gaps não marcados entre eventos consecutivos do mesmo bloco.

**Resultado:**
- **3.106 gaps (90%) são exatamente 5 minutos** — buffer fixo de virada de
  terminal aplicado sistematicamente na geração, não é parada real.
- Cauda decrescente e orgânica até ~25min (10, 11, 13, 14, 15, 16, 17...
  minutos, contagens caindo) — ainda virada normal.
- **Vazio total entre 70min e 118min — zero ocorrências.**
- População real de intervalo começa limpa em 118min e sobe (118, 137,
  290...min) até o máximo observado, 610min (~10h10).
- Faixa 30-90min: só 22 ocorrências, em pares (provável ida/volta do mesmo
  bloco) — população pequena e ambígua demais para calibrar por ela.
- Percentis dos gaps não marcados: p10=p25=p50=p75=5min, p95=15min,
  p99=217min.

**Conclusão:** 30min como piso ficaria dentro da faixa ambígua (30-70min) sem
necessidade — o vazio real nos dados está entre 70 e 118min. Recomendação:

| | Proposta inicial | Recomendado (com dados) |
|---|---|---|
| `minMinutes` | 30 | **90** |
| `maxMinutes` | 600 (10h) | **600 (10h)** — mantido, cobre 610min observado quase por completo (só 2 outliers ficam de fora, candidatos a revisão manual mesmo) |

90min fica com folga acima de toda virada normal (morre em ~25min) e da faixa
ambígua (termina em 70min), sem chegar perto da população real (começa em
118min).

## Onde implementar — resumo por arquivo

1. `packages/schemas/transit/settings-general.schema.ts` — campo
   `defaultIntervalTypeId` (opcional, `widget: 'select'`, `resource:
   'interval-type'`, `domain: 'transit'`) em `generalSettingsSchema`.
2. Cadastro de dado (não código) — criar o novo `IntervalType` abrangente via
   `/transit/interval-type` (ou seed), com `minMinutes: 90`, `maxMinutes: 600`.
   Nome/código e `isPaid` ainda em aberto (ver abaixo).
3. `apps/api/.../vehicle-plan/vehicle-plan-import.service.ts` — passo de
   detecção de gap + `blockInterval.createMany`, ao lado da reclassificação
   de deadruns já existente (linhas ~389-484).
4. `apps/web/.../hooks/useGanttEditor.ts` — `handleFinalizePlan` (linha 584),
   terceiro passe de candidatos gerando `PendingAddInterval`, reaproveitando
   `pendingAdds`/`Salvar` sem endpoint novo. Buscar `defaultIntervalTypeId`
   via `useQuery(['transit','settings','general'])`.

## Em aberto

- Nome/código do novo `IntervalType` abrangente e se `isPaid` deve ser `true`
  ou `false` por padrão (provavelmente `false`, mas não confirmado).
- Regras finas do import (bloco que troca de linha no meio do gap, família de
  linhas, etc.) — usuário sinalizou que vai detalhar depois.
- Se realmente um único `defaultIntervalTypeId` basta para os dois pontos de
  entrada, ou se import/finalizar-plano precisam de configs distintas no
  futuro.
- O script de diagnóstico do histograma de gaps não foi commitado (rodou
  contra produção a partir do scratchpad da sessão); se for útil reter como
  ferramenta, vale recriá-lo como script versionado (padrão de
  `apps/api/prisma/transit-export.ts`) em vez de descartável.
