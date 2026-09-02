# Proposta — Exportador de OSO (xlsx + pdf) a partir do VehiclePlan

Objetivo: gerar a Ordem de Serviço Operacional (OSO) — documento oficial exigido pelo órgão
gestor (hoje montado manualmente em Excel, uma aba por linha) — diretamente a partir dos dados
do `VehiclePlan`, em dois formatos: `.xlsx` (fiel ao layout hoje usado, com logo/assinatura) e
`.pdf` (uma linha, um grupo de linhas ou um scope inteiro, gerando um único arquivo com todas as
linhas selecionadas).

Referência real analisada (arquivos do usuário, fora do repo):
`/home/rafael/Documentos/Planejamento/Controles/Tabelas/Oficial/OSOs_U.xlsx` — 57 abas (uma por
linha/família), inspecionadas via ExcelJS para extrair merges, fórmulas, `printArea` e posição da
logo. 5 exemplos de layout impresso (PDF) foram conferidos: `A07` (simples, 3 colunas por ciclo),
`206`/`206B` (múltiplos carros, duas bandas empilhadas), `309` (round-trip com ponto
intermediário), `311` (ida/volta/chegada), `A22B` (um carro denso com colunas dobradas + vários
carros "reforço" de rota mais curta, 2 colunas) — este último foi o que revelou que o shape de
colunas varia **por carro**, não por linha (ver "Regras de negócio", item 3).

---

## O que já existe

| Peça | Onde | Estado |
|---|---|---|
| `TransitLine.parentLineId` | `transit.prisma:80-131` | Já modela família de linhas (206B filha de 206) — candidato natural para agrupar sub-linhas no RESUMO da OSO |
| `TransitLine.metrics.extensionKm` | `line.schema.ts:92-97` | Já guarda extensão por sentido (OUTBOUND/INBOUND/CIRCULAR) — mapeia direto pro "Extensão Útil (km)" do rodapé, não precisa de campo novo |
| `TransitRoute` (variantes por `ordinal`) | `transit.prisma:137-174` | Uma linha pode ter várias rotas por sentido (mesmo `lineId`+`direction`, disambiguadas por `ordinal`) — é a base do shape por carro: um carro "reforço" roda uma rota mais curta/diferente da rota principal, cada uma com sua própria topologia |
| `RouteLocality` | `transit.prisma:179-208` | Sequência de paradas por rota (reais + waypoints), pernas com `deltaMinutes`/`deltaKm` — dado usado tanto pra montar o `includeInOso` quanto pra derivar o horário de ponto intermediário |
| `VehicleBlock` / `BlockTrip` / `BlockDeadrun` / `BlockInterval` | `transit.prisma:505-597` | Dado bruto do plano — carros, viagens, recolhidas (RECO), intervalos (INTERV). Mesma estrutura que o Gantt (`useGanttEditor.ts`) já percorre |
| `VehicleBlock.branchId` | `transit.prisma:508` | Operadora do carro — mapeia pra linha "E" de cada grupo de coluna na planilha legada |
| `Scope` | `transit.prisma:441-453` | Universo de linhas/operadores de um domínio de gestão — todo `VehiclePlan` pertence a exatamente um `Scope`, que na prática corresponde a um único órgão gestor — base natural pra config de assinatura/logo da OSO |
| `Employee.photoUrl` (widget `avatar`) | `employee.schema.ts:78-82`, `employee.service.ts:25-37` | Padrão já testado de upload de imagem (`File` → URL via `/upload/image`) com limpeza do arquivo antigo no `update()` — reaproveitável tal e qual pra logo do órgão gestor |
| `vehicle-plan-import.*` | `apps/api/src/modules/transit/timetabling/vehicle-plan/` | Par natural pro novo módulo de export — mesmo diretório, convenção de nomes |
| `exceljs@4.4.0` | `apps/api/package.json:36` | Já instalado — cobre estilo de célula, merge, largura de coluna e imagem (logo) nativamente |

---

## Arquitetura proposta (pipeline em camadas)

```
1. oso-assembler.ts        — VehiclePlan + lineId(s) → view model bruto (carros × eventos)
2. oso-layout.resolver.ts  — resolve o shape+packing de CADA carro, a partir da(s) rota(s) que ele executa
3. oso-banding.ts          — bin-packing por largura: agrupa carros em bandas até o orçamento de colunas da página
4. oso-summary.ts          — recalcula em TS os agregados hoje feitos em fórmula Excel
5. oso-observations.ts     — texto do quadro "OBSERVAÇÃO" (v1: só manual; futuro: + inferido)
6. oso-workbook.renderer.ts — única camada que toca exceljs (chassi comum + banda, iterando o layout de cada carro)
7. scope-oso-config         — Scope.logoUrl + Scope.osoConfig (assinaturas, nome do órgão)
8. vehicle-plan-export.*    — controller/service: xlsx (1 ou N sheets) e pdf (via LibreOffice)
```

Camadas 1, 4, 5, 6 e 8 são agnósticas de shape — a única coisa que muda de um carro pro outro é o
`OsoCarroLayout` resolvido na camada 2, que a camada 6 itera genericamente. A resolução (2) e o
empacotamento em bandas (3) são as únicas camadas que precisam pensar "por carro".

```ts
type OsoColumn = {
  direction:       'OUTBOUND' | 'INBOUND'
  routeLocalityId: string              // RouteLocality real: ponta do ciclo, ou includeInOso = true
  timing?:         'DEPARTURE' | 'ARRIVAL'  // só nas duas pontas do ciclo — ver regra 2
}

type OsoCarroLayout = {
  columns:     OsoColumn[]   // shape herdado da(s) rota(s) que o carro efetivamente executa
  tripsPerRow: 1 | 2         // packing decidido por carro (viagens do carro vs. orçamento de linhas da banda)
}
```

### Onde mora

Schema (edições em arquivos existentes, não arquivo novo):
- `packages/schemas/transit/route-locality.schema.ts` — campo `includeInOso`
- `packages/schemas/transit/scope.schema.ts` — campos `logoUrl` (widget `avatar`) e `osoConfig`
  (widget `object-editor`)
- `apps/api/prisma/schema/transit.prisma` — os dois campos nos models `RouteLocality`/`Scope` +
  `pnpm db:migrate`

Form do `Scope` já é genérico (schema → form automático) — não precisa de página nova no
frontend só pra editar logo/assinatura.

Backend — pipeline OSO em subpasta nova dentro de `vehicle-plan/`, mesmo padrão de `scoring/` e
`solver/` que já existem ali:

```
apps/api/src/modules/transit/timetabling/vehicle-plan/
├── oso/
│   ├── oso-assembler.ts
│   ├── oso-layout.resolver.ts
│   ├── oso-banding.ts
│   ├── oso-summary.ts
│   ├── oso-observations.ts
│   └── oso-workbook.renderer.ts
├── vehicle-plan-export.controller.ts   ← irmão de vehicle-plan-import.controller.ts (já existe)
├── vehicle-plan-export.service.ts      ← orquestra as camadas de oso/, chama o LibreOffice pro pdf
├── vehicle-plan-import.controller.ts   (já existe)
├── vehicle-plan-import.service.ts      (já existe)
└── vehicle-plan.module.ts              ← registra o novo controller/service aqui
```

Frontend — item novo `OSO` no menu do botão "Linhas" (`page.tsx:274-280`), mesmo padrão do item
`Versões` que já existe ali (abre modal, opera sobre linhas do plano). Modal próprio,
`ExportOsoModal.tsx`, sem gate nenhum (`canEdit`/`editBarOpen`/pending changes não se aplicam — é
leitura pura, mesmo raciocínio já aplicado ao `LineFreqPanel` nesta mesma sessão):

- Lista **todas** as `TransitLine` do scope do plano — independente do que estiver marcado no
  painel "Linhas" (`selectedLineIds` não é usado aqui).
- Cada linha é um badge toggleável (grid + "Selecionar: Todos/Nenhum"), visual e comportamento
  iguais ao `RelationMultiSelect` (`FieldRenderer.tsx:494-565`) — **não reaproveitado
  literalmente** (é acoplado ao `Control` do react-hook-form do `AutoForm`), só replicado como
  componente próprio, já que o modal precisa de estado local simples e de `disabled` por item
  (que o widget original não suporta).
- Linha fica `disabled` quando não tem nenhum `BlockTrip` no plano atual — sem viagem gerada não
  tem o que exportar.
- Atalhos de seleção em massa por `LineGroup` do scope (botão por grupo aplica seu `lineIds` de
  uma vez) — cobre o caso "agrupar por empresa" sem precisar inferir nada (ver "Regras de negócio
  definidas"; `TransitLine` não tem `branchId` próprio, só `VehicleBlock.branchId`, então
  agrupamento por operadora ficaria ambíguo se calculado na hora).
- Seletor de formato (`xlsx` / `pdf`) e botão de processar.

### PDF — via LibreOffice headless, não renderer próprio

Converter o xlsx gerado (1 sheet por linha selecionada, cada sheet com `printArea`/`orientation`
corretos) via `soffice --headless --convert-to pdf`, em vez de construir um segundo renderer
PDF-nativo. Cada sheet do workbook vira página(s) do PDF final, na ordem do workbook — "um PDF com
N linhas" sai de graça de um `xlsx` multi-sheet.

Implicações de infra:
- Dependência de **binário de sistema** (LibreOffice), não pacote npm — precisa entrar na imagem
  de deploy da API.
- Concorrência: `soffice` headless não escala bem em paralelo (contenção de profile/CPU/memória).
  Pra v1, um limitador simples in-process (semáforo/fila de Promises na própria service) resolve —
  não há fila/broker (BullMQ, Redis) no stack hoje, e introduzir um só pra isso é desproporcional
  até o volume de export justificar.

### Config do órgão gestor — no `Scope`, não em `Settings`

- **`Scope.logoUrl`** — campo próprio (`String?`), widget `avatar`, mesmo padrão de
  `Employee.photoUrl`. Fica fora de `osoConfig` (Json) porque o swap de `File` pra URL no submit
  do form genérico (`AutoForm.tsx:241-256`) só varre o nível raiz do payload, nunca desce dentro
  de um campo Json.
- **`Scope.osoConfig`** (Json) — nome do órgão e assinaturas:
  ```ts
  type ScopeOsoConfig = {
    organName:  string
    signatures: Array<{ role: string; name: string }>
  }
  ```
  Editado via `ObjectEditorWidget` no form genérico do Scope. Pré-requisito: o
  `ObjectEditorWidget` (`apps/web/src/core/ObjectEditorWidget.tsx`) hoje serve só
  `TransitLine.metrics` e despacha por shape-sniffing hand-rolled — o próprio arquivo já assinala
  (linhas 3-10) que uma segunda forma é o gatilho pra virar um renderer recursivo de verdade. Esse
  refactor entra na Fase 0, como sub-etapa própria (mexe num widget compartilhado — checkpoint:
  confirmar que o editor de `TransitLine.metrics` continua funcionando).

---

## Regras de negócio definidas

1. **Shape base = uma coluna de partida por sentido, sempre presente**: 1 coluna (CIRCULAR) ou 2
   (dep-ida, dep-volta) — incondicional, não depende de nada cadastrado. Cada
   `RouteLocality.includeInOso = true` na(s) rota(s) que o carro executa soma **mais uma coluna**,
   sem distinção entre ponto intermediário de verdade e a própria chegada final do ciclo — CHEGADA
   é só o caso de `includeInOso` marcado no destino da rota de volta, não é um tratamento especial
   à parte. Confirmado com os casos reais: A07 (sem `includeInOso`) = 2 colunas; 311
   (`includeInOso` no destino da volta) = 3 colunas, com CHEGADA sendo sempre a chegada da volta,
   nunca da ida. Waypoints da rota (`RouteLocality` com `localityId` null) não interferem na
   rotulagem de coluna, só na geometria/tempo de perna.

2. **Horário de cada coluna extra**: quando o ponto marcado é o próprio destino da rota (a
   chegada final do ciclo), é o `arrivalMinutes` real da viagem — direto, sem cálculo. Quando é um
   ponto intermediário de verdade (nem origem nem destino da rota), o horário é derivado, nunca
   armazenado: soma o delta OSRM/matrix (`RouteLocality.deltaMinutes`, fallback
   `TravelTimeMatrix`) a partir do `arrivalMinutes` real da viagem, andando pra trás até o ponto —
   evita drift entre o horário agendado e a soma das pernas cadastradas. Nesse caso sempre resulta
   num instante único; por isso `timing` (DEPARTURE/ARRIVAL) só existe nas colunas de partida-base
   e na própria chegada final, nunca nos pontos intermediários do meio.

3. **Shape de colunas é resolvido por carro, não por linha.** Um carro herda o shape da(s) rota(s)
   que ele efetivamente executa naquele dia — caso real (`A22B`): o carro principal roda a rota
   completa (com ponto `includeInOso`, shape de 3 colunas) enquanto os carros "reforço" rodam uma
   `TransitRoute` variante mais curta (mesma linha, `ordinal` diferente, sem esse ponto → shape de
   2 colunas). Não existe "shape da linha" — só shape por rota, herdado pelo carro que a executa.
   Carro que mistura mais de uma rota no mesmo dia é caso de borda a tratar quando aparecer.

4. **Empacotamento (`tripsPerRow`) também é por carro** — compara o nº de viagens daquele carro
   especificamente com o orçamento de linhas da banda; só um carro com viagens de sobra "abre" um
   segundo bloco de colunas (dobra a largura do seu próprio grupo) pra caber na altura disponível,
   sem afetar os carros vizinhos.

5. **Banding é bin-packing por largura, não contagem fixa de carros.** `oso-banding.ts` percorre
   os carros na ordem de exibição e soma a largura real (nº de colunas) de cada grupo; fecha a
   banda quando a próxima adição estourar o orçamento de colunas da página. Carros estreitos
   (shape simples) empacotam vários por banda; carros largos/densos sozinhos já podem ocupar boa
   parte da largura — resultado varia por linha, não é mais "até 10 carros por banda" fixo.

6. **Numeração dos carros ("1º", "2º"...)** segue a ordem sequencial pelo início da primeira
   viagem produtiva do carro, sem relação direta com `blockNumber`.

7. **RECO/INTERV na grade** — RECO mapeia pra `BlockDeadrun.type = 'RETURN'`, INTERV pra
   `BlockInterval`. `DeadrunType.ACCESS` e `DISPLACEMENT` não aparecem na OSO — a grade do carro
   inicia na primeira viagem produtiva.

8. **Carro que atende mais de uma linha da família** — a OSO de cada linha lista só os trechos
   que pertencem a ela; viagens de aproveitamento de outra linha do mesmo bloco não aparecem.

9. **Extensão Ociosa (km)** — média por carro da própria família da linha (não do plano
   inteiro), **modelada**, não medida a partir do `BlockDeadrun` real do bloco: para cada carro,
   acesso = garagem → origem do sentido da sua **primeira** viagem dentro do recorte, recolhida =
   destino do sentido da sua **última** viagem dentro do recorte → garagem, usando a rota
   canônica de cada sentido (`TransitRoute.originLocalityId`/`destinationLocalityId`) e o
   `VehicleBlock.depotId` real do carro. Deliberadamente ignora o `BlockDeadrun` de verdade
   porque ele é ancorado ao primeiro/último evento do bloco no **dia inteiro** (regra 8) — num
   bloco de aproveitamento isso pode ser de outra linha, então não representa o recorte desta
   OSO. Validado contra conta manual real (linha 250): 27,66 km somados em 2 carros = 13,83 km
   de média, batendo com o pipeline.

10. **"Tempo de Viagem (minutos)"** é o **ciclo completo** (ida + folga na ponta + volta +
    folga antes da próxima partida), não a duração de uma perna só — corrigido depois de dar
    37' numa linha com ciclo real de ~85'-92' (a perna sozinha, sem o ciclo inteiro). Calculado
    por carro: cada ida pareia com a viagem seguinte (qualquer sentido — um carro com um único
    round-trip no recorte já contribui uma amostra), estendendo até a partida da próxima viagem
    do mesmo carro quando existir (só o último ciclo do dia do carro cai pra chegada da volta,
    por não ter próxima partida pra medir). CIRCULAR usa a própria duração da viagem, que já é o
    ciclo completo. Amostras são agrupadas por padrão de rota (a rota da ida usada) e então
    **clusterizadas por proximidade** dentro de cada padrão — uma linha pode genuinamente rodar
    mais de um tempo de ciclo real (pico vs. fora-pico), e o RESUMO mostra os vários valores, não
    um só. Clusterização é por densidade/semente (não encadeada): a cada rodada, semeia no valor
    mais frequente do que resta, absorve só o que está a até `CLUSTER_GAP_MINUTES` (4) dessa
    semente e remove do conjunto — encadear pelo vizinho ordenado (single-linkage) mescla tudo
    numa linha cujo ciclo deriva gradualmente ao longo do dia, engolindo picos reais.
    Cluster com menos de `CLUSTER_MIN_TRIPS` (3) viagens é ruído e é descartado. No máximo 6
    valores, mantendo os clusters de maior volume — e **deduplicado**: dois clusters que caem no
    mesmo valor só aparecem uma vez.

11. **Config de assinatura** fica no `Scope`, não em `Settings` — `Scope.logoUrl` +
    `Scope.osoConfig` (`organName`, `signatures[]`). Ver seção "Config do órgão gestor" acima.

12. **"OSO Nº" / "AUTORIZAÇÃO Nº" / ano** — número é gerado pelo órgão gestor; fica sempre em
    branco no v1, preenchido à mão pelo usuário após exportar/imprimir.

13. **Ordem das linhas no PDF multi-linha** segue EMPRESA (operadora) > código da linha, com
    natural sort (o que for só número comparado numericamente, mesmo quando a linha tem letra:
    `31 < 301 < A10`).

---

## Ordem de implementação sugerida

**Fase 0 — Fundamentos de dados (sem UI, sem Excel)**
- `RouteLocality.includeInOso` (schema + migration)
- `Scope.logoUrl` (avatar) + `Scope.osoConfig` (Json) — schema + migration; inclui generalizar o
  `ObjectEditorWidget` pra um renderer recursivo de verdade (hoje só serve `TransitLine.metrics`)
- `oso-assembler.ts` — view model bruto, com fixture de um caso real simples (tipo A07)
- `oso-summary.ts` — validar números calculados contra a planilha legada da mesma linha

**Fase 1 — Layout resolver por carro + banding por largura (ainda sem exceljs)**
- `oso-layout.resolver.ts` — shape e packing por carro (regras 3 e 4)
- `oso-banding.ts` — bin-packing por largura (regra 5)
- Validar contra `A22B` (carro denso + reforços) e um caso simples de carro único — os dois
  extremos de shape na mesma execução

**Fase 2 — Renderer xlsx (chassi + bandas)**
- `oso-workbook.renderer.ts`: chassi (cabeçalho, logo, RESUMO, assinaturas) + banda, iterando o
  `OsoCarroLayout` de cada grupo de carro
- Endpoint `.xlsx` pra 1 linha
- Comparação visual lado a lado com os exemplos reais

**Fase 3 — Multi-linha/scope + PDF**
- Endpoint aceita lista de `lineId` ou `scopeId`
- Workbook com N sheets
- Conversão pra PDF via LibreOffice (infra: instalar `soffice`, testar concorrência)

**Fase 4 (depende de outra implementação em andamento) — Observações estruturadas**
- Aguarda o modelo de notas por viagem/bloco (mencionado como próximos dias)
- `oso-observations.ts` ganha a parte automática (ex.: viagens reservadas)
