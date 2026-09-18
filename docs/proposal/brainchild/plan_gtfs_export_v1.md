# Proposta — Exportador GTFS (zip único) a partir do cadastro de trânsito

**Status: decisões fechadas, implementação adiada** (prioridade menor no momento).

Objetivo: gerar um feed **GTFS Schedule** padrão (`.zip` com os `.txt` CSV oficiais) a partir do
cadastro atual (`TransitLine`/`TransitRoute`/`RouteLocality`/`TransitTrip`/...), substituindo (ou
complementando) o exportador atual de `db:export-transit`, que **não é GTFS** — é um snapshot JSON
interno de cadastro, usado só para sobreviver a `prisma migrate reset` (ver "O que já existe").

Referência: [gtfs.org/schedule/reference](https://gtfs.org/schedule/reference/).

---

## O que já existe

| Peça | Onde | Estado |
|---|---|---|
| `db:export-transit` / `db:import-transit` / `db:reset` | `apps/api/prisma/transit-export.ts`, `transit-import.ts`, `package.json:14-16` | Snapshot JSON de cadastro (localidades, dayTypes, scopes/operadoras, linhas, rotas, geometria, settings) por chave natural — **não cobre** `LineSchedule`/`TransitTrip`/`VehiclePlan`, não é GTFS, não muda com esta proposta |
| `TransitLocality` | `transit.prisma:54-81` | `lat`/`lng` nullable, `isDepot` — candidato a `stops.txt`, filtrando `isDepot=false` |
| `TransitLine` | `transit.prisma:86-132` | `code`/`name` → `route_short_name`/`route_long_name`; `type: LineType` (URBAN/METROPOLITAN/RURAL/SPECIAL) não é vocabulário GTFS `route_type` |
| `TransitRoute` | `transit.prisma:138-175` | Uma trajetória por sentido (`direction`) + variante (`ordinal`); `originLocalityId`/`destinationLocalityId` |
| `RouteLocality` | `transit.prisma:180-215` | Sequência ordenada de paradas por rota, com `deltaMinutes`/`deltaKm` por perna e `geometry` (GeoJSON LineString da perna anterior→esta, `null` em `sequence=1`) |
| `DayType.pattern` | `transit.prisma:242-263` | União discriminada: `{type:"weekdays", days:number[]}` (ISO 1-7) ou `{type:"month_window", ...}` — só o primeiro tipo tem tradução direta pra `calendar.txt` |
| `DayTypeService.resolveDayType(date, lineId)` | `day-type/day-type.service.ts:33` | **Já resolve**, por linha e data, o `DayType` efetivo considerando `LineCalendarException` — reaproveitável 1:1 pra gerar `calendar_dates.txt` |
| `LineCalendarException` | `transit.prisma:268-295` | Override de dayType por linha e janela de data — mapeia pra `calendar_dates.txt`, não pra `calendar.txt` (ver abaixo) |
| `TransitTrip` | `transit.prisma:358-386` | `departureMinutes`/`arrivalMinutes` por viagem; `dayTypeId` é **sempre** cópia de `VehiclePlan.dayTypeId` (confirmado em `vehicle-plan.service.ts:585,882` e `vehicle-plan-import.service.ts:254`) — um plano só tem um dayType |
| `VehiclePlan` | `transit.prisma:430-460` | `scopeId`+`dayTypeId`+`status` (DRAFT/ACTIVE); **sem `validFrom`/`validTo` hoje**; no máximo um ACTIVE por `(scope, dayType)` — garantido em `VehiclePlanService.activate()` (`vehicle-plan.service.ts:1367-1385`), não por `@@unique` |
| `VehicleBlock`/`BlockTrip` | `transit.prisma:533-605` | Já modela o bloco físico do veículo — mapeia direto pra `block_id` de `trips.txt` (bônus, não é exigido pelo GTFS) |
| `Scope.osoConfig` (Json) | `transit.prisma:472`, `scope.schema.ts:33-45` | `{organName?, signatures:[{role,name}]}` — widget `object-editor` já generalizado (recursivo) desde a Fase 0 do `plan_oso_export_v1.md` |
| `VehicleType` | `fleet.prisma:17-23` | `STANDARD/ARTICULATED/BI_ARTICULATED/MICRO_BUS/MINIBUS/VAN` — **toda a frota é rodoviária**, não existe trem/metrô/balsa/VLT no schema |

---

## Resposta aos pontos levantados

**1) `stop_times.txt` só ida/volta, inferido do início/fim da viagem** — não é bem isso, e dá pra
fazer melhor: `RouteLocality.deltaMinutes` já existe por perna, então dá pra calcular o horário de
**cada** parada real (não só origem/destino) andando a partir de `TransitTrip.departureMinutes`,
somando os deltas em sequência. O GTFS aceita horário só nas pontas (interpolação via
`shape_dist_traveled`), mas como o dado já existe, gerar hora exata em toda parada é estritamente
melhor — mais preciso pra qualquer consumidor (Google Maps, roteirizadores). Ponto de atenção: a
soma dos deltas pode não bater exatamente com `arrivalMinutes` da viagem (deltas manuais/OSRM vs.
horário aprovado) — proposta: caminhar pelos deltas normalmente, mas **forçar a última parada a
`arrivalMinutes` exato** (valor autoritativo), pra não deixar drift acumulado no ponto que mais
importa. `RouteLocality` com `localityId=null` (waypoint) nunca vira linha de `stop_times.txt`.

**2) `agency.txt` a partir do `Scope.osoConfig`** — confirmo o `Scope` como unidade certa (é o
"órgão gestor" no sentido do OSO, e não existe hoje nenhum vínculo `TransitLine`→`ScopeOperator`/
`Branch` que permita granularidade menor — ver tabela acima). ~~Concordo em reaproveitar o campo,
mas sugiro não empilhar tudo sob o nome `agency`~~ — ver decisão abaixo.

> CONSIDERAÇÂO: ao invez de usar exportConfig pensei em algo como serviceMetadata (ou algo do tipo), não limitar a ideia de exportação, e queria não adicionar muitos deps, se não me engano meu cadastro de Scope eh generic page, e acho que adicionar mais deps vai complicar a leitura do FieldRenderer, sem contar que campos como nome do orgão gestor seria duplicado para cada escopo, acho que aqui não adicionar esse dep seria o melhor caminho, me confirme

> **RESPOSTA:** Concordo, e reparei num problema que meu aninhamento causava: separando em
> `oso`/`agency`/`feedInfo` o "nome do órgão gestor" viraria **dois campos** (`oso.organName` e
> `agency.agency_name`) pro mesmo dado — obrigando a digitar duas vezes ou sincronizar na mão. Pior
> que o aninhamento em si. **Decisão: `osoConfig` → `serviceMetadata`, flat (sem sub-chaves)**,
> juntando o que já existe (`organName`, `signatures[]`) com os campos novos de `agency.txt`/
> `feed_info.txt` no mesmo nível. `agency_name` no export usa `serviceMetadata.organName` (fallback
> `Scope.name` se `organName` vazio) — sem campo novo duplicado.


**3) `route_type` como campo no `Scope`** — aqui eu diverjo: `route_type` no GTFS é campo de
**rota** (bus/tram/rail/subway/ferry...), não de agência. Mas o achado relevante é outro: `VehicleType`
(`fleet.prisma:17-23`) só tem variações de ônibus — não existe nenhuma modalidade não-rodoviária
cadastrada em lugar nenhum do schema. Ou seja, `route_type` vai ser **sempre 3 (Bus)** pra toda
rota do sistema hoje. ~~Minha recomendação: não criar campo nenhum — fixar a constante `3` no
exportador pra v1~~ — ver decisão abaixo.

> CONSIDERAÇÂO: Por que eu sugeri fechar isso no Scope: Scope hoje eh "Urbano cuiabá" e toda modalidade é somente urbano, ao invez de deixar isso hardcoded prefiro adicionar isso no json, se no futuro mudar a abordagem basta remover este campo do json (sem migração)

> **RESPOSTA:** Concordo, e revejo minha posição — eu tinha em mente um campo Prisma dedicado
> (migração pra algo que hoje só tem 1 valor possível), mas como `serviceMetadata` já vai ganhar
> campos novos de qualquer forma, adicionar `routeType` ali custa ~zero (nem schema novo, nem
> widget novo), e sua lógica de reversibilidade bate: tirar uma chave do json não pede migração;
> um campo Prisma pediria. **Decisão: `serviceMetadata.routeType` (número GTFS, default `3`)** —
> aplicado a todas as rotas exportadas daquele Scope.

**4) `calendar.txt` a partir do `VehiclePlan` (não do `LineCalendarException`)** — confirmo, e o
achado em `vehicle-plan.service.ts` reforça: como `TransitTrip.dayTypeId` é sempre cópia de
`VehiclePlan.dayTypeId`, o "serviço" GTFS já nasce no grain (scope, dayType) via o plano ATIVO —
`validFrom`/`validTo` (a implementar) viram `calendar.txt.start_date`/`end_date` direto.
`LineCalendarException` fica pra `calendar_dates.txt`, como você intuiu — e o achado que fecha essa
ponta é que **`DayTypeService.resolveDayType(date, lineId)` já existe e já resolve isso por linha**:
dá pra iterar dia a dia na janela de vigência do plano, por linha, comparar o resultado com o
dayType-base do plano e emitir `ADDED`/`REMOVED` só nas datas em que diverge. Isso também resolve
um problema que eu ia levantar sozinho: como o `calendar_dates.txt` é uma exceção por
`service_id` e a exceção do `LineCalendarException` é **por linha** (não pelo plano inteiro), o
`service_id` de `calendar.txt` não pode ser só `dayTypeId` — precisa ser por `(linha, dayType)`
pra uma exceção conseguir afetar só as linhas certas sem mexer nas outras do mesmo plano. Ver
"Perguntas em aberto" (isso multiplica linhas em `calendar.txt`: uma por linha × dayType, não uma
por dayType).

**5) `RouteLocality.geometry` tem tudo pra `shapes.txt`** — confirmo. Concatenando o
`geometry` (GeoJSON LineString) de cada perna em sequência, na ordem de `RouteLocality.sequence`,
sai a lista ordenada de pontos pro `shape_id` (= `TransitRoute.id`); `shape_pt_sequence` é o índice
cumulativo; `shape_dist_traveled` (opcional) dá pra computar via Haversine acumulado entre pontos
consecutivos, sem depender de `deltaKm` (que é só o total da perna, não por ponto). Único cuidado:
o primeiro ponto do shape (origem da rota, `sequence=1`) não tem `geometry` — vem do
`lat`/`lng` da própria `TransitLocality` (ou do waypoint, se for o caso). E se alguma perna nunca
teve `geometry` gerado pelo OSRM (só delta manual), o exportador precisa de um fallback de linha
reta entre os dois pontos — vale validar quantas pernas estão nessa situação hoje antes de assumir
cobertura total.

> RESPOSTA: Perfeito, nenhuma rota esta manual (todas com geometry pelo OSRM), ao final da geração iremos emitir um relatório de saida, aqui so avisar que rotas X e Y nã geradas devido a nao ter gemotria traçada

> **CONFIRMO:** sem fallback de linha reta então — se `geometry` faltar numa perna fora de
> `sequence=1`, a rota inteira fica de fora do `shapes.txt` (e das `trips`/`stop_times` que
> dependem dela) e entra no relatório final de saída. Ajusto a Fase 0 e o builder pra esse
> comportamento (skip + report), não fallback.

**6) `frequencies.txt` fora do v1** — concordo, sem headway no sistema (só horário fixo via
`LineDeparture`/`TransitTrip`), não faz sentido gerar.

**7) `feed_info.txt` também no `Scope`** — concordo com o `Scope` como limitador (é a unidade
natural de "um feed exportável"), mas ver o ponto 2: proponho como sub-chave `feedInfo` dentro do
`exportConfig` renomeado, não misturado dentro de um campo chamado `agency`. `feed_publisher_name`/
`feed_publisher_url`/`feed_lang` cabem bem aqui; `feed_version` pode ser gerado automaticamente
(timestamp da exportação) sem precisar de campo cadastrado.

**8) `CIRCULAR` → `direction_id=0`** — confirmo, é a escolha pragmática (GTFS não tem terceiro
valor; tratar como "ida" é o que menos distorce, já que não existe "volta" separada numa circular).

Ponto que não estava na sua lista e que vale alinhar: **`route_id` do GTFS deveria mapear pra
`TransitLine`, não pra `TransitRoute`**. O GTFS espera uma linha por `route_id` (ex. "308"), com as
duas direções (ida/volta) representadas por `direction_id` dentro do mesmo `route_id` — se eu
mapear `TransitRoute` (que já é por sentido) direto pra `route_id`, cada sentido vira uma "linha"
GTFS separada, o que tecnicamente valida no schema mas quebra a expectativa de qualquer consumidor
(Google Maps, roteirizador) de agrupar ida+volta sob o mesmo código de linha. Proposta:
`route_id = TransitLine.id`, `shape_id = TransitRoute.id` (cada variante/sentido mantém seu próprio
traçado), `direction_id` derivado de `TransitRoute.direction`.

> RESPOSTA: perfeito

---

## Mapeamento por arquivo GTFS

| Arquivo | Fonte | Observação |
|---|---|---|
| `agency.txt` | `Scope` (1 linha por Scope exportado) | `agency_id=Scope.id`, `agency_name=serviceMetadata.organName` (fallback `Scope.name`), resto vem de `serviceMetadata` (novos campos) |
| `feed_info.txt` | `Scope.serviceMetadata` (novos campos) + timestamp da exportação | |
| `stops.txt` | `TransitLocality` onde `isDepot=false` e `lat`/`lng` não nulos | localidades com coordenada nula ficam de fora — reportar no export |
| `routes.txt` | `TransitLine` | `route_type=serviceMetadata.routeType` (default `3`, ver ponto 3); `route_color` fica em aberto (ver "Perguntas") |
| `trips.txt` | `TransitTrip` | `route_id=line`, `shape_id=route`, `service_id=dayTypeId`, `direction_id` de `TransitRoute.direction`, `block_id=VehicleBlock.id` (via `BlockTrip`) quando a trip estiver num bloco |
| `stop_times.txt` | `TransitTrip` × `RouteLocality` (onde `localityId` não nulo) | horário calculado por deltas cumulativos, última parada forçada a `arrivalMinutes` |
| `calendar.txt` | `VehiclePlan` (status ACTIVE) × `DayType.pattern` tipo `weekdays` | `service_id=dayTypeId`; dayTypes `month_window` **não** entram aqui (só via `calendar_dates.txt`) |
| `calendar_dates.txt` | `matchesPattern(date, pattern)` (`day-type.service.ts:85`, promover a público) iterado na janela do plano ACTIVE | só datas de `DayType` tipo `month_window` — sem exceção por linha em v1 (`LineCalendarException` fora do escopo) |
| `shapes.txt` | `RouteLocality.geometry` concatenado por rota | sem fallback — rota sem `geometry` completo é **excluída** do export e entra no relatório final |
| `frequencies.txt`, `fare_attributes.txt`, `fare_rules.txt`, `transfers.txt` | — | fora do escopo v1 (pontos 6 e 7) |

---

## Onde mora

Schema (edições em arquivos existentes):
- `apps/api/prisma/schema/transit.prisma` — `VehiclePlan.validFrom`/`validTo`; rename
  `Scope.osoConfig` → `Scope.serviceMetadata` (`pnpm db:migrate`, roda com o usuário)
- `packages/schemas/transit/scope.schema.ts` — schema do `serviceMetadata`, flat: mantém
  `organName`/`signatures[]` (OSO) + novos campos de `agency.txt`/`feed_info.txt` (`agencyUrl`,
  `agencyTimezone`, `agencyLang`, `agencyPhone`, `agencyEmail`, `agencyFareUrl`,
  `feedPublisherName`, `feedPublisherUrl`, `feedLang`) + `routeType` (default `3`)
- `packages/schemas/transit/vehicle-plan.schema.ts` — `validFrom`/`validTo`
- `ROUTE_COLOR_PALETTE`/`getRouteColor` (`apps/web/src/app/transit/transit-route/types.ts:91-116`)
  — mover pra `packages/types` (ou reexportar de lá), pra `apps/api` e `apps/web` compartilharem a
  mesma paleta sem duplicar (ver ponto 2 de "Perguntas em aberto")

Backend — módulo novo, mesmo padrão do `oso/` dentro de `vehicle-plan/`
(`plan_oso_export_v1.md`, "Arquitetura proposta"):

```
apps/api/src/modules/transit/network/scope/
└── gtfs/
    ├── gtfs-agency.builder.ts        — agency.txt + feed_info.txt
    ├── gtfs-stops.builder.ts         — stops.txt
    ├── gtfs-routes.builder.ts        — routes.txt
    ├── gtfs-shapes.builder.ts        — shapes.txt (concat de RouteLocality.geometry)
    ├── gtfs-calendar.builder.ts      — calendar.txt + calendar_dates.txt
    ├── gtfs-trips.builder.ts         — trips.txt + stop_times.txt (mesma passada, precisa do dayType resolvido)
    ├── gtfs-zip.writer.ts            — única camada que sabe empacotar CSV → zip
    └── gtfs-export.service.ts        — orquestra, recebe scopeId (+ opcional filtro de dayType/plano)
scope.controller.ts                   — GET :id/gtfs/export → stream do .zip
```

Dependência nova: não há lib de zip no projeto hoje (só `exceljs`) — precisa de `archiver` (streaming,
já é o padrão de mercado pra isso em Node) adicionada ao `apps/api/package.json`.

Frontend: botão "Exportar GTFS" no `Scope` (lista ou detalhe), sem modal — é um único formato de
saída, sem opções pra escolher (diferente do OSO que tem xlsx/pdf/seleção de linhas). Dá pra avaliar
se cabe até só como link direto em vez de botão com estado de loading.

---

## Ordem de implementação sugerida

**Fase 0 — Fundamentos de dados**
- `VehiclePlan.validFrom`/`validTo` (schema + migration) — pré-requisito de `calendar.txt`
- `Scope.osoConfig` → `Scope.serviceMetadata` (rename, flat, + campos novos de agency/feed/routeType)
- Validar cobertura de dados: quantas `TransitLocality` sem lat/lng, quantas `RouteLocality` sem
  `geometry` fora do `sequence=1` — confirmado hoje que é zero (todas as pernas via OSRM), mas
  o exportador precisa do relatório de skip mesmo assim, pra não regredir silenciosamente se
  alguém cadastrar uma perna manual no futuro

**Fase 1 — Builders "estáticos" (sem depender de trip/calendar)**
- `gtfs-agency.builder.ts`, `gtfs-stops.builder.ts`, `gtfs-routes.builder.ts`,
  `gtfs-shapes.builder.ts`
- Testar contra um `Scope` real, validar no [validador oficial](https://gtfs-validator.mobilitydata.org/)
  antes de seguir (esses arquivos sozinhos já validam sem trips)

**Fase 2 — Calendar**
- `gtfs-calendar.builder.ts` — `calendar.txt` a partir de `VehiclePlan` ACTIVE (`service_id=dayTypeId`),
  `calendar_dates.txt` via `matchesPattern` (promovido a público) pra dayTypes `month_window`
- Promover `DayTypeService.matchesPattern` de `private` pra público (ou extrair função pura)

**Fase 3 — Trips + stop_times**
- `gtfs-trips.builder.ts` — a parte que depende de tudo anterior (route_id/shape_id/service_id já
  resolvidos)
- Validar o cálculo de horário por delta contra alguns casos reais (comparar com o horário que o
  Gantt já mostra pra mesma viagem)

**Fase 4 — Empacotamento + endpoint + UI**
- `gtfs-zip.writer.ts` (`archiver`)
- `GET /transit/scope/:id/gtfs/export`
- Botão no frontend
- Rodar o zip final no validador oficial GTFS de ponta a ponta

---

## Perguntas em aberto

~~1. Nome do campo / aninhamento~~ — **resolvido:** `Scope.serviceMetadata`, flat (ver ponto 2).
~~2. `route_type` fixo vs. campo~~ — **resolvido:** `serviceMetadata.routeType`, default `3` (ver ponto 3).

1. **Granularidade de `service_id` em `calendar.txt`** — proposta é `(line, dayType)` pra permitir
   `LineCalendarException` afetar só as linhas certas via `calendar_dates.txt`. Isso multiplica
   linhas em `calendar.txt` (uma por linha × dayType, não uma por dayType). Alternativa mais
   enxuta: `service_id = dayTypeId` puro (uma linha em `calendar.txt` por dayType), e as exceções
   de `LineCalendarException` **não** entram no GTFS (ficam só nas telas internas) — mais simples,
   mas perde fidelidade se algum consumidor externo do feed precisar saber que uma linha específica
   muda em feriado. Qual eu sigo?

> RESPOSTA: Escopo mais simples (apenas dayType) e LineCalendarException desconsiderado aqui, outra questão só p ficar claro, apenas plan ACTIVE devem ser exportados aqui

> **CONFIRMO:** `service_id = dayTypeId`. Fechado — já estava certo em só exportar `VehiclePlan`
> ACTIVE, isso não muda. Um ajuste técnico que essa decisão implica: como `LineCalendarException`
> saiu do escopo, `calendar_dates.txt` **não** usa mais `DayTypeService.resolveDayType(date, lineId)`
> (aquele já resolve exceção por linha, que agora é desnecessário) — usa só o `matchesPattern(date,
> pattern)` interno (`day-type.service.ts:85`, hoje `private`), pra materializar as datas de um
> `DayType` tipo `month_window`. Precisa virar público (ou uma função pura extraída) pra o builder
> conseguir chamar. `calendar_dates.txt` fica só com isso — sem linha de exceção pontual nenhuma
> em v1.

2. **`route_color`/`route_text_color`** — `TransitRoute.color` existe mas é por sentido/variante,
   não por linha (que é o novo `route_id` proposto no ponto 8 da minha resposta). Uso a cor da rota
   `isPrimary` de cada linha, deixo em branco, ou prefere outro critério?

> RESPOSTA: aqui eu queria inferir isso de maneira automatica na exportação, talvez mapear N pares de cores (bg;text) e ir "usando" no momento da exportação, se lista acabar repete do inicio

> **CONSIDERAÇÃO:** boa notícia — já existe exatamente essa paleta cíclica no app:
> `ROUTE_COLOR_PALETTE` (`apps/web/src/app/transit/transit-route/types.ts:91-99`), 8 pares
> `{value, mark}` colorblind-safe, já usada pra colorir sentido/rota no mapa. Reaproveitar em vez
> de inventar uma paleta nova mantém o feed visualmente consistente com o que o usuário já vê no
> app. Dois ajustes ao seu pedido literal:
> 1. **`mark` não serve como `route_text_color`** — é só um tom mais escuro da mesma cor (pensado
>    pra contorno/marcador sobre o traço no mapa), não tem contraste garantido como texto (ex.:
>    o par amarelo `#eda100`/`#ab7400` — texto branco ou preto lê muito melhor que essa combinação
>    marrom-sobre-amarelo). Prefiro calcular `route_text_color` por luminância (`FFFFFF` ou
>    `000000` conforme o `value` de cada cor) — funciona pra qualquer paleta, inclusive se ela
>    mudar no futuro.
> 2. **Local do arquivo** — `ROUTE_COLOR_PALETTE` hoje mora em `apps/web/src` (frontend puro), e o
>    builder GTFS roda no `apps/api`. Preciso mover (ou duplicar, mas prefiro mover) pra um pacote
>    compartilhado, provavelmente `packages/types`, e importar dos dois lados — assim a cor exportada
>    nunca diverge da cor mostrada no app.
> 3. **Ordem de atribuição** — cicla por quê? Proponho: `TransitLine` ordenada por `code` (natural
>    sort), índice `i` → `ROUTE_COLOR_PALETTE[i % 8]`. Determinístico — reexportar o mesmo Scope sem
>    mudar linhas sempre dá as mesmas cores, mesmo se a ordem de iteração do banco mudar entre
>    execuções.
>
> Concorda com os três ajustes, ou prefere `mark` mesmo como texto (aceitando contraste pior em
> alguns pares) pra não precisar de cálculo de luminância?

> RESPOSTA: perfeito, concordo com tudo.

3. **Múltiplos `VehiclePlan` ACTIVE simultâneos pro mesmo `(scope, dayType)`** — o schema não
   impede (comentário em `transit.prisma:429`), mas `calendar.txt` só faz sentido com um por
   combinação. Trato como erro de validação no export (bloqueia e avisa) ou pego o mais recente
   silenciosamente?

> RESPOSTA: Errado, sistema hoje já impede mais de um plano active para um dayType, somente um active por dayType, conforme isso por favor 

> **CONFIRMO, eu estava errado:** achei só o comentário em `transit.prisma:429` ("nothing enforces
> a single ACTIVE one") e não cavei o service — `VehiclePlanService.activate()`
> (`vehicle-plan.service.ts:1367-1385`) já garante isso: antes de ativar, busca conflito
> `{scopeId, dayTypeId, status: 'ACTIVE'}` e, numa transação, rebaixa o ACTIVE anterior pra DRAFT
> antes de promover o novo. O comentário no schema fala do nível de banco (sem `@@unique`), não do
> nível de aplicação — e é a aplicação que garante o invariante aqui. **Ajuste:** o comentário da
> tabela "O que já existe" (linha do `VehiclePlan`) fica impreciso, vou corrigir. Exportador pode
> assumir sem checagem extra: no máximo um `VehiclePlan` ACTIVE por `(scope, dayType)`.

4. **Escopo do endpoint de export** — um `.zip` por `Scope` inteiro (todas as linhas, todos os
   dayTypes vigentes) é o objetivo, ou também quer poder filtrar por linha/dayType específico como
   o export de OSO permite?

> RESPOSTA: perfeito, um zip por Scope, sempre retornar apenas um Scope