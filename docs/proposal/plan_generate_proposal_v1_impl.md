# Plano de implementação — Geração de planejamento (grade de horário de linhas)

Baseado em `docs/proposal/plan_generate_proposal_v1.md`. Este documento reorganiza aquele
levantamento em fases executáveis, com arquivos afetados, dependências e ordem sugerida.

Estado atual verificado no código (2026-08-19):
- `LineScheduleGeneratorModal.tsx` + `line-generator-logic.ts` já cobrem: janelas de ciclo
  unificadas (ida/volta), tolerância de mescla, dimensionamento de frota por demanda +
  índice de renovação, aba Ajuste (intervalo, acesso/recolhida, transição suavizada,
  índice de renovação por sentido), aba Frota (capacidade, garagens), gráfico Oferta×Demanda.
- `estimateGeneration()` é só uma prévia agregada (viagens totais, pico de frota) — **não existe
  ainda o algoritmo real de geração de viagens/blocos** descrito no "Estágio 1".
- O botão "Gerar" do solver (`page.tsx:244`, `GenerateModal.tsx`, `useSolverController.ts`,
  endpoint `POST /transit/vehicle-plan/:id/generate`) e o botão "Gerar" do gerador por linha
  (`page.tsx:187`, `LineScheduleGeneratorModal`) já convivem hoje com um comentário no código
  reconhecendo a ambiguidade (`page.tsx:184-186`) — confirma o problema descrito na seção
  "Definições iniciais" do documento original.
- `TransitRoute.layoverPolicy`, `TransitRoute.homeDepot` e `TransitSettings.defaultLayoverPolicy`
  **não existem** no Prisma schema nem em `route.schema.ts` — são novos.

---

## Fase 0 — Desambiguação "Gerar" vs "Otimizar"

Pré-requisito de todas as fases seguintes: evita que features novas herdem o nome ambíguo.

**Renomear o fluxo do solver (fora do modo de edição) para "Otimizar":**

| Camada | Item | Ação |
|---|---|---|
| Frontend | `page.tsx:244` label `'Gerar'`/`'Gerando…'` | → `'Otimizar'`/`'Otimizando…'` |
| Frontend | `components/GenerateModal.tsx` | renomear para `OptimizeModal.tsx` |
| Frontend | `hooks/useSolverController.ts`: `generateModalOpen`, `setGenerateModalOpen`, `handleGenerate` | → `optimizeModalOpen`, `setOptimizeModalOpen`, `handleOptimize` |
| Frontend | `SolverParams` (importado de `GenerateModal`) | mantém o nome do tipo (`SolverParams`) |
| Backend | `POST /transit/vehicle-plan/:id/generate` | → `/optimize` (`vehicle-plan.controller.ts`, `vehicle-plan.service.ts`) |
| Backend | métodos/variáveis internas que referenciam "generate" no fluxo do solver | revisar em `vehicle-plan.service.ts` e no diretório `solver/` |

**Manter "Gerar" exclusivamente para o gerador por linha** (`LineScheduleGeneratorModal`,
`handleAdjustCycle`, `page.tsx:187`) — já está correto, não precisa mexer.

Remover o comentário-ressalva em `page.tsx:184-186` após o rename (deixa de ser necessário).

⚠️ Mudar a rota do endpoint é breaking change de API — checar se algo além do frontend chama
`/generate` (jobs assíncronos, testes, scripts) antes de renomear.

---

## Fase 1 — Modelo de dados

### 1.1 `TransitRoute` (`apps/api/prisma/schema/transit.prisma`)

```prisma
enum LayoverPolicy {
  DEFAULT
  HOLD
  DEPOT
}

model TransitRoute {
  ...
  layoverPolicy LayoverPolicy @default(DEFAULT)
  homeDepotId   String?
  homeDepot     TransitLocality? @relation("RouteHomeDepot", fields: [homeDepotId], references: [id])
  ...
}
```

- `homeDepot` aponta para `TransitLocality` (mesma entidade usada como depósito via
  `isDepot: true`, ver `depots` query no modal: `f_isDepot=true`) — precisa da relação inversa
  em `TransitLocality` (`routesAsHomeDepot TransitRoute[] @relation("RouteHomeDepot")`).
- `DEFAULT` = herda de `TransitSettings.defaultLayoverPolicy`; `HOLD`/`DEPOT` = override explícito
  por rota.

### 1.2 `TransitSettings` → `generalSettingsSchema` (`packages/schemas/transit/settings-general.schema.ts`)

```ts
defaultLayoverPolicy: z.enum(['HOLD', 'DEPOT']).default('HOLD'),
```

Local escolhido: `settings-general`, não `settings-schedule` — este último já tem um campo
`layover` (`settings-schedule.schema.ts:5`) mas é um **critério ponderado do solver**
(range criterion para otimização de folga/descanso do motorista), semântica diferente de
`defaultLayoverPolicy` (comportamento determinístico do gerador de viagens). Confirmar essa
distinção com o usuário antes de implementar — ver "Dúvidas" no final.

### 1.3 `route.schema.ts`

Adicionar os dois campos com `.meta()`, seguindo o padrão do arquivo:
```ts
layoverPolicy: z.enum(['DEFAULT', 'HOLD', 'DEPOT']).default('DEFAULT').meta({
  label: 'Política de Recolhida', widget: 'select', ...
  optionLabels: { DEFAULT: 'Padrão (config. geral)', HOLD: 'Aguardar no ponto', DEPOT: 'Recolher à garagem' },
}),
homeDepotId: z.uuid().nullable().optional().meta({
  label: 'Garagem Preferencial', widget: 'select', resource: 'transit-locality', domain: 'transit',
  labelField: 'name', filter: { field: 'isDepot', value: true }, // se o widget suportar filtro fixo
}),
```

### 1.4 Migration

`pnpm db:migrate` após ajustar o `.prisma` — nome sugerido: `add_route_layover_policy`.

---

## Fase 2 — Parametrização do modal (itens `[ + ]` e `[ _ ]` pendentes)

Arquivo: `LineScheduleGeneratorModal.tsx` (aba "Ajuste" é o lugar natural) +
`line-generator-logic.ts` (novos parâmetros puros).

### 2.1 Sentido para primeira/última viagem
- Novo estado `firstTripDirection` / `lastTripDirection`, default `OUTBOUND` (ou `CIRCULAR` se
  a linha não tiver `OUTBOUND`) para início, `INBOUND` (ou `CIRCULAR`) para fim.
- Select por sentido, populado a partir de `lineRoutes` (já calculado no modal) — mesma lista
  usada na seção de índice de renovação.
- Precisa entrar em `estimateGeneration()` / futuro algoritmo real (Fase 3) para determinar
  onde a primeira viagem do bloco 1 realmente começa.

### 2.2 Margem de manobra
- Novo campo numérico (int, default 3 min) na aba Ajuste.
- Usado só pelo algoritmo real de distribuição em blocos (Fase 3, passo 3.3) — não afeta a
  prévia agregada atual.

Ambos os campos são parâmetros de input puro, sem dependência de Fase 1 — podem ser
implementados em paralelo com o Estágio 1.

---

## Fase 3 — Algoritmo de geração real (Estágio 1)

Este é o núcleo do documento original e o maior trabalho. Substitui/complementa
`estimateGeneration()`, que hoje é só uma estimativa agregada sem gerar viagens/blocos de fato.

### 3.1 Geração de frequência (passo 1)
- Para cada `GenWindow`, gerar horários corridos de partida por sentido, buscando
  equidistância dentro da janela (`totalCycleMinutes(w) / fleetCount` já é a frequência-base —
  reaproveitar).
- Já existe boa parte da lógica de janela; o que falta é **materializar os horários de partida**,
  não só a frequência agregada.

### 3.2 Estrutura de viagem conceitual (passo 2)
- Aplicar o ciclo (ida/volta + intervalos) a cada partida gerada, produzindo hora de início/fim
  e demais atributos de uma viagem — usar `outboundMinutes`/`outboundInterval`/
  `inboundMinutes`/`inboundInterval` de `GenWindow` como fonte.
- `layoverPolicy`/`homeDepot` **não** entram aqui — só são resolvidos depois da distribuição em
  blocos, ver 3.4.

### 3.3 Distribuição em blocos (passo 3)
- Algoritmo round-robin: primeira viagem → bloco 1, início = horário de operação (ajustado por
  `firstTripDirection`, Fase 2.1).
- Para cada viagem seguinte: verifica se algum bloco aberto consegue receber (usa a margem de
  manobra, Fase 2.2, para "apertar" a viagem anterior do bloco antes de abrir um novo bloco).
- Mudança de patamar de frequência com `smoothTransition = true`: distribuir a variação em até
  2–3 viagens (o switch já existe na UI, mas hoje é só decorativo — comentário em
  `LineScheduleGeneratorModal.tsx:668-670` confirma que ainda não afeta nada além da prévia).
- Comentário em `estimateGeneration()` (linha 436-439) já aponta esse algoritmo como "próximo
  passo", espelhando `handleAdjustCycle` em `page.tsx` — vale revisar essa função existente antes
  de desenhar a nova, para reaproveitar padrões de manipulação de bloco/viagem já validados no
  editor manual do Gantt.

### 3.4 Resolução de HOLD/DEPOT (após distribuição em blocos)
Passo deliberadamente separado do 3.2/3.3 — rodar sobre a estrutura final de blocos, não durante
a montagem, para não poluir a análise da distribuição com uma decisão que ainda pode mudar.

- Para cada parada intermediária de cada bloco já fechado: consulta `layoverPolicy` da rota
  (ou `defaultLayoverPolicy` da config geral, se `DEFAULT`) e decide HOLD vs DEPOT.
- Quando `DEPOT`: usa `homeDepot` da rota se definido; senão, a garagem disponível mais próxima
  por tempo/distância de viagem via `TravelTimeMatrix` (OSRM) — mesma infra que a Fase 4
  (multilinha) já vai usar para o delta entre linhas. Se o par local↔garagem não tiver
  mapeamento na matriz, tratar como garagem indisponível (cai no caso abaixo).
- Se nenhuma garagem estiver disponível: não insere acesso/recolhida (gera o planejamento normal,
  equivalente a `HOLD` implícito) e sinaliza com toast de alerta ao final da geração.

### 3.5 Onde materializar
Roda 100% no frontend, junto com o resto do modal (`line-generator-logic.ts`) — sem endpoint
dedicado no backend. O resultado (viagens + blocos gerados) entra como pendência local, mesmo
mecanismo que o Gantt já usa para edições manuais (`pendingCount`/`handleSavePendingWithConfirm`
em `page.tsx`), e só é persistido quando o usuário aciona "Salvar".


---

## Fase 4 — Atendimento multilinha

Escopo maior, depende da Fase 3 estar funcional (a geração multilinha é uma variação da geração
single-line com um critério extra de intercalação).

1. **Modal de geração** — permitir escolher um ponto de intercalação por sentido, ao gerar mais
   de uma linha simultaneamente. Precisa suportar seleção multi-linha no modal (hoje
   `LineScheduleGeneratorModal` recebe um único `lineId`).
2. **`FrequencyPanel.tsx`** — alternar visualização entre frequência de uma linha isolada e
   frequência do "delta" (intercalado).
3. **`LineFreqPanel.tsx`** — entrada "Multilinha" no seletor; cálculo do delta busca tempo na
   matriz OSRM (`TravelTimeMatrix`, já existe no schema — ver `transit.prisma:52-53`); se não
   houver mapeamento na matriz, exibir toast de alerta em vez de falhar silenciosamente.
4. Critério de agrupamento: linhas compartilham origem OU destino OU delta mapeado.

Esta fase tem escopo de UI e lógica significativamente maior que as anteriores — recomendo
tratá-la como uma sub-iniciativa própria, com plano detalhado à parte, depois que o Estágio 1
single-line estiver validado em produção.

---

## Fase 5 — Funções auxiliares de comparação

Duas comparações distintas, ambas de leitura (sem escrita):

1. **Parametrização atual × proposta** — antes mesmo de gerar, dentro do próprio modal de
   parametrização. Compara o `plan` ativo da linha (janelas/frota já persistidas) com os valores
   editados no modal (`windows`, `opStart`/`opEnd`, etc. — já estão todos em estado local).
   Implementação: um painel/diff simples dentro do modal, sem necessidade de nova chamada de API
   além do que já é carregado (`line`, rotas).
2. **Plano atual × plano gerado** — depois de gerar, comparar métricas agregadas: viagens, km
   total, produtivo, ocioso, horas trabalhadas. Precisa que a Fase 3 já produza essas métricas
   (hoje `estimateGeneration` só retorna `trips`/`peakFleet` — insuficiente para essa comparação).
   Provavelmente reaproveita cálculos que já existem em outro lugar do editor (Gantt/plan
   summary) — checar `TripSummaryPanel.tsx` antes de duplicar lógica de métricas.

Ambas ficam para o final do trabalho (depois da Fase 3 e, se aplicável, da Fase 4) e devem ser
prototipadas em `/playground` antes de landar no app real — mesmo padrão já usado para validar
`line-generator-logic.ts` (ver comentário no topo do arquivo).

---

## Ordem de implementação sugerida

```
Fase 0 (rename) ──┐
                   ├──> Fase 3 (algoritmo real) ──> Fase 5 (comparação plano×proposta)
Fase 1 (modelo) ───┤         │
Fase 2 (params) ───┘         └──> Fase 4 (multilinha)
```

- Fases 0, 1 e 2 são independentes entre si — podem ser feitas em paralelo ou em qualquer ordem.
- Fase 3 é o gargalo: nada de "geração de verdade" existe até ela estar pronta, e as Fases 4 e 5
  dependem dela.
- Fase 5.1 (comparação de parametrização) não depende da Fase 3 e pode ser antecipada se for
  valiosa isoladamente.

---

## Considerações finais

- O código existente já está bem preparado para essa evolução: `line-generator-logic.ts` é
  puro e testável, e a UI do modal já expõe (mesmo que parcialmente) quase todos os parâmetros
  necessários. O trabalho real está concentrado na Fase 3 (algoritmo de distribuição em blocos),
  que é onde o documento original também reconhece a maior lacuna.
- `smoothTransition` já existe como toggle na UI mas está deliberadamente desconectado de
  qualquer efeito real (comentário explícito no código) — é o único parâmetro da Fase 2 que já
  tem "casa" pronta na interface, só falta o algoritmo consumir.
- Fase 3 confirmada como 100% client-side (geração e distribuição em blocos rodam no navegador,
  persistência só ao "Salvar", via o mesmo mecanismo de pendências do Gantt) — mantém a Fase 3
  simétrica ao resto de `line-generator-logic.ts`, sem introduzir um endpoint novo no backend.

## Dúvidas em aberto

Nenhuma pendente — todos os pontos foram confirmados nesta revisão. Plano pronto para execução
na ordem descrita em "Ordem de implementação sugerida".