# Proposta — Exportador GTFS para o Goal (feed completo gerado pelo nyx)

**Status: implementado (Etapas 2 a 5), aguardando migração e validação na tela.** Feed A testado no
Goal; há decisões pendentes (seção 8). Mudanças feitas na implementação estão na seção 9.

Substitui `docs/proposal/brainchild/plan_gtfs_export_v1.md`. As decisões da v1 continuam valendo,
exceto as listadas na seção 3.

Análise feita em 2026-11-04, comparando o feed exportado do Goal
(`gtfs-17491667598751170420_1793729379576`) com o banco de teste do nyx (planos `ACTIVE`, dia útil).

---

## 1. Objetivo

Hoje, cada alteração de linha obriga a ajustar o GTFS à mão antes de importar no Goal. O objetivo é
que o nyx gere o **feed completo**, em um passo, nos dois casos:

- alterou **horário** de uma linha → gera o feed e importa;
- alterou **traçado** de uma linha → gera o feed e importa.

O Goal exige o feed inteiro: as linhas que não mudaram precisam constar no arquivo.

**Por que gerar tudo, e não remendar o feed do Goal:** o nyx já tem linhas, traçados, viagens,
blocos e vigências. O que falta são os pontos de ônibus. O uso operacional deles é nulo hoje, mas o
Goal mede a quilometragem por eles (seção 2.7), e esse é o maior risco do plano. Remendar exigiria
guardar um feed base e manter dois lados sincronizados.

---

## 2. O que a análise encontrou

### 2.1 O feed é por operador, não por escopo

O feed do Goal tem 22 linhas e 1.285 viagens. O plano `ACTIVE` de dia útil tem 52 linhas e 3.088
viagens, porque o escopo "Urbano Cuiaba" tem dois operadores (VPAR e RAPIDO). O `service_id` do feed
é `RAPIDO_UTIL`, e os blocos da RAPIDO somam 1.289 viagens.

- O filtro certo é `VehicleBlock.branchId`. Todas as viagens estão em bloco e todo bloco tem operador.
- `LineOperator` não serve: só cobre as 41 viagens de uma linha da VPAR.
- A diferença de 4 viagens está explicada na seção 2.4.

### 2.2 Horários

| Situação | Linhas |
|---|---|
| Partidas 100% iguais | 206, 206B, 309, 313, 319, 340, 721, A06, A06B, A07, A08, A10, A15, A20 |
| Partidas iguais, mas agrupadas em outra linha | 311 + 311B (74 viagens) |
| Partidas diferentes | 380 (4 de 42 iguais), F01 (19 de 38), 032/033/034 (0 de 6) |
| Goal contido no nyx | 031 (7 do Goal + 2 só no nyx) |

**Duração:** nas 1.182 viagens casadas por linha, sentido e partida, 895 (76%) têm exatamente
**5 min a menos no nyx** e 245 (21%) são iguais. A causa é conhecida: o Goal foi carregado do Globus,
onde o fim de uma viagem é o início da próxima, e o nyx normaliza deixando pelo menos 5 min entre
elas. **A duração do nyx é a correta** (D1).

### 2.3 Traçados

**34 dos 65 shapes do Goal são retas de parada em parada.** Eles têm exatamente os pontos da
sequência de paradas, e por isso medem de 10% a 20% menos que o nyx. Onde o Goal tem traçado real
(313 volta, 319, A10), os km ficam próximos dos do nyx. Portanto, a diferença de km geral é efeito
das retas, e não erro do nyx.

Para medir sem esse efeito, a comparação usou a distância dos pontos do Goal até a linha do nyx:

| Situação | Sentido |
|---|---|
| Ok: p95 de até ~30 m | maioria |
| Revisar: desvio real | 311 ida e volta (p95 > 300 m), 380 volta (máx. 1,07 km; 21,7 km no Goal × 18,4 no nyx), 313 ida (34,9 km × 14,9 km), A10 ida (15 de 90 pontos > 50 m), A07 volta, A08 volta |
| Goal sem traçado (ponto repetido, 0 km) | 032, 033, 034 — o nyx já tem traçado real |
| Itinerário não mapeado no nyx | F01 |

**F01:** o nyx tem as mesmas 17 + 7 variantes do Goal, mas só com origem e destino, sem waypoints.
O OSRM escolhe o caminho mais curto, enquanto o Goal tem itinerários reais de até 34,6 km contra
17,3 km no nyx. A exportação funciona, mas o traçado só fica fiel depois de adicionar waypoints.

### 2.4 Divergências encontradas no banco de teste

Esta lista veio do banco de teste (D4). A versão vigente, com a base oficial, está na seção 2.8.

| # | Problema | Efeito se exportar assim |
|---|---|---|
| 1 | 46 viagens da 311B estão nas rotas da 311; as rotas da 311B têm 0 viagens | a 311B some do Goal |
| 2 | 032/033/034 às 00:30 no nyx e 24:30 no Goal | intencional (D2); as durações ainda divergem |
| 3 | 031 tem 13 min de duração no nyx e 25–30 min no Goal, além de 2 viagens a mais | viagem irreal no Goal |
| 4 | 380: 38 de 42 partidas diferem, a maioria em ~2 min, e há 1 viagem a mais | decidir qual lado está certo |
| 5 | F01: 37 viagens no nyx e 38 no Goal, metade das partidas diferente | idem |
| 6 | C02 é da VPAR, mas tem 2 viagens em bloco da RAPIDO (bloco 110) | linha nova aparece no feed |

Sem esses acertos, a conta de viagens fica 1.285 no Goal contra 1.289 no nyx: +2 da 031, +1 da 380,
−1 da F01 e +2 da C02.

### 2.5 Pontos

- As viagens têm 2 ou 3 localidades no nyx (717 e 572 viagens). Os waypoints não contam.
- `stop_times.txt` cai de 45 mil para ~3,2 mil linhas.
- Das 40 localidades usadas, só 19 ficam a menos de 30 m de um ponto do Goal, então não dá para
  reaproveitar os IDs automaticamente. A premissa é que o Goal aceite IDs novos (Etapa 0).
- A F01 já mostra que o Goal exporta viagem com 2 pontos e traçado denso, independentes entre si.
  **Isso não prova que ele aceita o mesmo na importação.**

### 2.6 Tempos intermediários

Todas as 1.226 pernas têm `deltaSource = OSRM`, isto é, tempo de carro sem carga. A soma dos deltas
bate com a duração em só 26 de 1.289 viagens; em 1.172 a duração é maior. Isso muda a regra da v1
(ver seção 3).

### 2.7 O que a API do Goal mostrou (2026-11-04)

Foto só de leitura do cenário `MTU_RAPIDO_UTIL` (3990), salva fora do repositório em
`~/Downloads/goal-snapshot-2026-11-04/`.

- **O feed é o cenário.** `timetable` tem 45.181 registros, iguais às linhas de `stop_times.txt`, e
  os `tripCode` são os `trip_id`. Os cenários são por empresa e tipo de dia, o que confirma a seção
  2.1. As 1.285 viagens têm veículo e serviço, ou seja, uma solução de escala amarrada.
- **Os pontos do Goal são reais.** São 1.350 locais comerciais com nome ("Emeb 8 de Abril"). No GTFS
  o nome sai igual ao código, o que dava a falsa impressão de serem só coordenadas.
- **Toda rota tem 2 locais `main`** (os terminais), nos 132 casos.
- **O km do Goal vem dos pontos.** A distância por trecho, somada na viagem, coincide com as retas
  entre paradas (99,5%), mesmo com shape detalhado: 313 ida tem shape de 34,9 km, retas de 29,5 km e
  29,45 km no Goal. A F01 é a exceção: com 2 pontos, 20,78 km contra shape de 20,99 km e reta de
  16,01 km. Nela, porém, há valores sem sentido (0,34 km para 12 km de reta).

| Base de km (RAPIDO, dia útil) | Total | Em relação ao traçado |
|---|---|---|
| Traçado do nyx | 18.052 | referência |
| Goal hoje, soma do `timetable` | 16.550 | −8% |
| Retas pelos pontos do nyx, com waypoints | 14.705 | −19% |
| Retas só pelas localidades do nyx | 10.369 | −43% |

A dúvida é se a importação calcula o km pelo shape (como a F01 sugere) ou pelos pontos (como as
demais sugerem). Isso decide a D8.

**De-para de locais:** das 40 localidades, 20 ficam a menos de 30 m de um local `main` do Goal; outras
ficam a quilômetros e precisam de revisão manual, ou não existem lá. Linhas: fora `031`–`034`, os
códigos batem; só `A06C` não existe no Goal. Veículos: 81 no Goal, 83 blocos no nyx.

### 2.8 Auditoria da base oficial (`apps/api/bkp/nyx_oficial.dump`, 2026-11-04)

Base candidata a oficial, comparada com os seis cenários do Goal (U, S, D × RAPIDO, VPAR).

**Íntegro:** nenhuma viagem fora de bloco, em dois blocos, com chegada antes da partida, em rota
inativa ou duplicada; nenhuma perna sem geometria ou tempo; nenhuma localidade sem coordenada;
nenhum bloco com sobreposição real de horário. 113 das 144 combinações de linha, dia e empresa têm
partidas 100% iguais às do Goal.

**Bloqueia a exportação:**

- Os 3 planos estão em `DRAFT`, sem vigência, e há 0 planos de tripulação. O feed depende de plano em
  vigor (seção 4.5).
- O banco está 2 migrações atrás do código: `20261030222030` e `20261031022141`.
- `externalCodes` está vazio em todas as linhas: `031`–`034` ainda sem o código `31`–`34`.

**Divergências de viagens com o Goal:**

| Dia | Empresa | Linha | Goal | nyx | Observação |
|---|---|---|---|---|---|
| U | RAPIDO | 311 / 311B | 28 / 46 | 74 / 0 | total igual; viagens da 311B na rota da 311 |
| S | RAPIDO | 311 / 311B | 52 / 4 | 36 / 20 | total igual; divisão diferente |
| D | RAPIDO | 311 / 311B | 52 / 4 | 56 / 0 | total igual |
| U | RAPIDO | 380 | 42 | 43 | só 4 partidas iguais; 23 intervalos abaixo de 3 min |
| U, S | RAPIDO | F01 | 38 | 37 | ~metade das partidas iguais |
| S, D | RAPIDO | A15 | 62 | 50 | só 3 partidas iguais |
| U | RAPIDO | C02 | 0 | 2 | 2 viagens em bloco da RAPIDO; na VPAR, 44 × 42 |
| todos | RAPIDO | 031 | 7 | 9 | 13 min no nyx, 25–30 min no Goal |
| S | RAPIDO | 032, 033 | 4 | 2 | |
| todos | RAPIDO | 032, 033, 034 | | | durações diferem de 10 a 40 min |
| U | VPAR | A02 | 38 | 36 | |
| todos | VPAR | A17 | 58–59 | 59–60 | 1 viagem a mais no nyx |
| U | VPAR | A22B | 54 | 54 | 49 partidas iguais |
| D | VPAR | R03 | 0 | 4 | linha sem viagens no Goal aos domingos |

**Dúvidas esclarecidas:**

- **Intervalo entre viagens:** o ideal é no mínimo 5 min, mas valores menores podem existir. Dia útil
  tem 5 min (2.374 casos), sábado e domingo têm 3 min (2.774), e há 34 intervalos de 0 a 2 min (23 na
  380, 6 na 410). O exportador não valida nem altera intervalos.
- **`operationalDayStartHour = 3`:** nada usa hoje, além da tela de configurações. Fica como está,
  para uso futuro.
- **`share` dos operadores** soma 54% porque há mais duas operadoras fora do nyx e do Goal, por ora.

**Pendências fora do GTFS:**

- **`BlockTrip.sequence` não é cronológico** em 46 blocos (821 viagens): mover uma viagem de bloco a
  coloca no fim (`max + 1`, `block-mutation.utils.ts`), sem reordenar. O exportador ordena por horário.
  O efeito real está em `block-deadrun.utils.ts` e `findAnchoredDeadrunIds` (`useGanttEditor.ts`): a
  viagem de referência de `ACCESS` e `RETURN` é a primeira e a última por `sequence`. Em bloco fora de
  ordem, editar uma viagem pode levar o deslocamento errado junto. O ponto de `DISPLACEMENT` já ordena
  por horário. `block-issues` já recebe a ordem por `sequence`, e não foi analisado a fundo.
- **Dump versionado:** `nyx_oficial.dump` está no git e contém a base inteira.

Os totais do cadastro são iguais aos do banco de teste (55 linhas, 136 rotas, 1.226 pernas). A
comparação de traçados da seção 2.3 não foi refeita linha a linha.

---

## 3. O que muda em relação à v1

| Tema | v1 | v2 | Motivo |
|---|---|---|---|
| Unidade do feed | Scope | **Scope + operador** | seção 2.1 |
| Quais planos | `ACTIVE` | **em vigor no início do período** (`inForceOn`) | `validFrom`/`validTo` já existem; `ACTIVE` pode começar no futuro |
| Horário intermediário | somar deltas e forçar a chegada | **escalar deltas pela duração** | a v1 jogaria todo o atraso na última perna (seção 2.6) |
| `stops.txt` | só `isDepot=false` | **toda localidade usada** | 032/033/034 saem da garagem |
| `route_id` | `TransitLine.id` | **código externo com fallback em `code`** | o Goal identifica as linhas por código |
| `service_id` | `dayTypeId` | **`<operador>_<dia>_V<versão>`** (`RAPIDO_UTIL_V012`) | o Goal exige nome único por carga, e a versão facilita achar a última |
| `block_id` | sempre | **opção, desligada por padrão** | hoje o feed não tem blocos (D3) |
| UI | botão sem modal | **modal com opções e prévia** | agora há operador e período |
| Módulo | `network/scope/gtfs` | `timetabling/gtfs` | lê planos de vários tipos de dia |

**Mantido da v1:** `Scope.osoConfig` → `serviceMetadata` (flat), `routeType` default 3, sem fallback
de linha reta, relatório de saída, `CIRCULAR` → `direction_id=0`, `LineCalendarException` fora do
escopo, `frequencies`/tarifas fora do escopo, paleta cíclica por ordem natural com texto por
luminância, biblioteca `archiver`.

**Informações da v1 que ficaram velhas:** `VehiclePlan` já tem vigência, e a ativação agora marca o
plano anterior como `SUPERSEDED` em vez de voltar a `DRAFT`.

---

## 4. Definições

### 4.1 Arquivos gerados

| Arquivo | Fonte | Regra |
|---|---|---|
| `agency.txt` | `Scope.serviceMetadata` | `agency_id` configurável (hoje `1045`), nome com fallback em `Scope.name`, timezone `America/Cuiaba` |
| `routes.txt` | `TransitLine` | `route_id` e `route_short_name` = código externo; `route_long_name` = `<código> - <nome>`; `route_type` de `serviceMetadata`; cores pela paleta |
| `stops.txt` | `TransitLocality` usadas nas rotas exportadas | `stop_id` e `stop_code` = código externo; `stop_name` = nome. Waypoints nunca entram |
| `shapes.txt` | `RouteLocality.geometry` por rota | pernas concatenadas sem repetir o ponto de junção; `shape_id` = `TransitRoute.id` |
| `trips.txt` | `TransitTrip` | ver 4.2 |
| `stop_times.txt` | viagem × localidades da rota | ver 4.3 |
| `calendar.txt` | `DayType.pattern` tipo `weekdays` + período | um `service_id` por tipo de dia exportado |
| `calendar_dates.txt` | `DayType.pattern` tipo `month_window` | só se houver |

`feed_info.txt` da v1 sai desta versão: o feed do Goal não tem esse arquivo. Pode voltar se o Goal
aceitar e houver uso.

### 4.2 Identificadores de viagem

| Campo | Formato | Exemplo |
|---|---|---|
| `service_id` | `<ScopeOperator.abbr>_<DayType.name>_V<versão com 3 dígitos>` | `RAPIDO_UTIL_V012` |
| `trip_id` | `<DayType.code>_<route_id>_<blockNumber>_<posição da viagem no bloco, por horário>` | `U_A20_12_3` |
| `trip_short_name` | igual ao `trip_id` | como no feed atual |
| `direction_id` | `OUTBOUND`/`CIRCULAR` = 0, `INBOUND` = 1 | |
| `block_id` (opcional) | `<DayType.code>_<blockNumber>` | `U_12` |

`trip_id` é único porque a posição é única dentro do bloco, e ela vem da ordem por `departureMinutes`,
não de `sequence` (seção 2.8). Ele não é estável entre versões do plano, o que basta enquanto o Goal receber sempre o feed inteiro. A Etapa 0 confirma isso.

**Nome único por carga:** o Goal recusou o feed A porque `RAPIDO_UTIL` já existia, e cada carga
precisa de um nome inédito. Ao gerar o cenário, é preciso achar o último serviço na lista, por isso
o nome leva uma versão sequencial em vez de carimbo de data. Limites de tamanho e de caracteres do
nome ainda não são conhecidos; `RAPIDO_UTIL_202611041725A` foi aceito.

A versão é persistida numa tabela de histórico de exportações, uma linha por feed baixado:

```prisma
model GtfsExport {
  id              String   @id @default(uuid())
  scopeOperatorId String
  version         Int
  periodStart     DateTime @db.Date
  periodEnd       DateTime @db.Date
  // vehicle plan used per day type: [{ dayTypeId, vehiclePlanId }]
  plans           Json
  // output report, section 4.6
  report          Json?
  createdAt       DateTime @default(now())

  @@unique([scopeOperatorId, version])
}
```

- **Uma versão por operador, por carga.** Um feed com vários tipos de dia usa a mesma versão em todos
  (`RAPIDO_UTIL_V012`, `RAPIDO_SAB_V012`), então a versão identifica a carga. Se a carga levar só um
  tipo de dia, os outros pulam o número, sem problema.
- **Só a geração final consome versão.** A prévia não grava nada.
- **O modal sugere a última + 1, e o campo é editável.** Isso cobre a troca do banco de teste pelo
  oficial, um serviço com versão já usada no Goal ou uma carga recusada.
- **Serve de rastreio:** mostra qual plano virou qual versão. Sem `userId`: o projeto pode usar a
  auditoria padrão, se existir, ao implementar.
- `db:export-transit` não cobre essa tabela. Num `db:reset`, a versão volta a 1, e o campo editável
  resolve isso.

### 4.3 Horários

- Origem = `departureMinutes`; última localidade = `arrivalMinutes`. Esses dois valores mandam.
- Localidades intermediárias: fração acumulada de `deltaMinutes` da rota, **incluindo as pernas de
  waypoints**, aplicada à duração da viagem:

  ```
  horário(i) = partida + (soma dos deltas até i / soma de todos os deltas) × (chegada − partida)
  ```

- `arrival_time` = `departure_time`, como no feed atual.
- Saída em segundos, no formato `HH:MM:SS`, com horas acima de 24 para viagens da madrugada.
- Se a soma dos deltas for zero, a rota entra no relatório como erro.

### 4.4 Códigos externos

Campo opcional, como você definiu: em branco, usa o `code` do registro. `resolveExternalCode` já
funciona assim.

**Cuidado na implementação:** `EXTERNAL_SYSTEMS` alimenta o seletor do `PlanExportModal` e o
`Record` de `EXPORT_LAYOUTS`. Colocar `GOAL` ali faria o Goal aparecer como layout do export Globus.
Por isso:

- novo `EXTERNAL_CODE_SYSTEMS = ['GLOBUS', 'GOAL']`, usado por `externalCodesSchema` e
  `resolveExternalCode`;
- `EXTERNAL_SYSTEMS` continua sendo só a lista de layouts de plano.

As linhas `031`–`034` precisam de código externo `31`–`34`, ou de renomeação no nyx.

**Locais: o nyx é a origem oficial.** Todo `stop_id` usa o `code` da localidade, sem de-para com os
códigos antigos do Goal. Localidade nova no nyx vira local novo no Goal na carga seguinte. Os locais
antigos ficam no catálogo, sem uso nas novas rotas.

### 4.5 Escolha do que exportar

Entradas: escopo, operador, período (início e fim) e tipos de dia. Padrão: todos os tipos de dia que
tenham plano em vigor.

1. Para cada tipo de dia, pegar o plano não-`DRAFT` em vigor no início do período.
2. Se outro plano entrar em vigor dentro do período, **bloquear** com aviso: um feed só representa
   uma versão por tipo de dia.
3. Pegar as viagens dos blocos do operador.
4. `FERIAS` e `ESPECIAL` não têm `pattern`, e entram no relatório se forem selecionados.

O período é sempre informado, porque planos em vigor costumam ter `validTo` nulo e o GTFS exige data
final.

### 4.6 Relatório

| Nível | Casos | Efeito |
|---|---|---|
| Erro | rota com perna sem `geometry`, localidade sem coordenada, soma de deltas zero, IDs duplicados | item fica de fora; **pede confirmação**, pois o Goal recebe o feed inteiro e uma linha ausente pode sumir de lá |
| Bloqueio | dois planos no período, nenhum plano em vigor | não gera |
| Aviso | código externo em fallback, linha com poucas viagens no operador (caso C02), viagem com duração não positiva | só informa |

A confirmação é o ajuste à decisão "pular e avisar" da v1.

---

## 5. Arquitetura

```
packages/schemas/transit/plan-export/external-system.ts     EXTERNAL_CODE_SYSTEMS, chave GOAL
packages/schemas/transit/scope.schema.ts                    serviceMetadata
packages/schemas/transit/gtfs-export.schema.ts              requisição + prévia (novo)
packages/types                                              ROUTE_COLOR_PALETTE (movida do web)

apps/api/src/modules/transit/timetabling/gtfs/
├── gtfs-export.controller.ts     POST /transit/gtfs/preview | POST /transit/gtfs/export
├── gtfs-export.service.ts        orquestra e monta o zip
├── gtfs-export.loader.ts         único arquivo com acesso ao Prisma
├── gtfs-feed.builder.ts          funções puras: dados carregados → linhas de cada arquivo + relatório
├── gtfs-times.ts                 regra da seção 4.3
├── gtfs-csv.ts                   serialização CSV
└── *.spec.ts

apps/web/src/app/transit/vehicle-plan/components/GtfsExportModal.tsx
```

O builder puro permite testar sem banco, seguindo a separação assembler/profile do export Globus. A
prévia e o export usam o mesmo builder, para o relatório nunca divergir do arquivo.

**Entrada na UI:** ação "Exportar GTFS" na lista de planos de veículo, porque o feed cobre vários
planos. Se o modal crescer, vira página própria. O modal segue os padrões de atalhos do projeto.

**Dependência nova:** `archiver` em `apps/api`. Não há biblioteca de zip no projeto hoje.

---

## 6. Etapas de implantação

### Etapa 0 — Prova de importação no Goal

**É a etapa mais importante: valida as premissas sem escrever código de produto.** Um script avulso
gera os dois arquivos, e você importa num ambiente de teste do Goal.

| Feed | Conteúdo | Serve para |
|---|---|---|
| A | feed atual com só a A20 trocada pelos dados do nyx | testar mudança isolada |
| B | feed todo gerado pelo nyx, com os dados como estão | testar o caso real |
| C | igual ao B, com `block_id` | testar o efeito dos blocos (D3) |

Resultado parcial: os três feeds passaram na validação inicial da prévia de importação do Goal, sem
gravar nada. Ao tentar carregar o feed A, o Goal recusou o nome `RAPIDO_UTIL` por já existir (seção
4.2). Os feeds precisam ser gerados de novo com nome único. Os itens abaixo seguem em aberto até a
importação em ambiente de teste.

Modelo do Goal, pela especificação `ext-common`:

- Rota = lista ordenada de locais (`SortedPlaces`). Trecho = par de locais com `sectionDistance` e
  tempo por faixa horária (`SectionDto`). **Nenhum schema tem traçado**: a coordenada só existe no
  local (`PlaceDto`), que tem `placeCode` imutável.
- `lineCode` é identificador imutável: isso reforça o código externo em `031`–`034`.
- Não há importação de GTFS pela API. `GtfsFileBuildDto` serve para **gerar** GTFS no Goal.
- Há escrita de locais, rotas e trechos (`POST /ext/v1/place`, `/ext/v2/route`, `/ext/v2/section`),
  ainda não testada. A consulta `GET /ext/v2/section` veio vazia.

Após a importação, repetir a foto da seção 2.7 e comparar.

**Feed A carregado em 2026-11-04** (`RAPIDO_UTIL_202611041725A`, serviço 865 no Goal, tenant 1045, o
mesmo dos cenários publicados). Comparação em `~/Downloads/goal-snapshot-pos-feed-a/`:

- Carregou sem erro. O Goal aceitou 2 pontos em linha regular e `trip_id` e `stop_id` novos.
- A carga **acrescenta, não substitui**: rotas de 132 para 134 (`A20_1_2`, `A20_2_2`) e locais de
  1.352 para 1.354 (`A0519-002`, `A0320-001`). As rotas antigas da A20 seguem ativas. As demais 21
  linhas não geraram rota nova: a sequência de pontos igual reaproveita a rota existente.
- Cenário 3990: métricas idênticas às de antes, e a A20 segue com 61 viagens. Os seis cenários seguem
  com o mesmo status e o mesmo número de linhas.
- **O Goal usou o traçado para medir o km.** A tela do serviço 865 mostra, para a A20, 61 viagens,
  389,2 km e 17:48 h. O feed dá 389,9 km pelo traçado (99,8%) e 125,2 km pelas retas entre os pontos;
  o tempo bate exato. A API não mostra esse dado: `timetable` só existe em cenário, e
  `GET /ext/v1|v2/section` veio vazio.
- Como locais têm `placeCode` imutável, cada carga com código novo deixa resíduo no catálogo. Isso
  pede o de-para de localidades (`externalCodes.GOAL`), mas com o cuidado abaixo.
- **O km acompanha o traçado em recarga.** Excluído o serviço 865, as rotas e os locais novos ficaram.
  Uma nova carga (serviço 890) com os mesmos pontos e 1 km a mais no traçado da ida deu 419,1 km
  (196,2 + 222,9), contra 419,9 km esperados pelo shape. Editar traçado no nyx e recarregar funciona.
- **Fluxo no Goal:** GTFS → serviço (oferta de horários) → cenário → escala lógica → escalas diárias.
  O serviço só pode ser usado em cenário depois de publicado, e aí não pode mais ser excluído:
  publicar só com a base oficial revisada. Um cenário é gerado a partir de um ou mais serviços e não
  tem ligação com outros cenários nem com o serviço depois de gerado. Portanto, o cenário novo convive
  com o 3990, e `trip_id` novos não afetam escalas existentes.
- Ainda sem explicação: por que linhas antigas, como a 313 ida, têm km diferente do shape no cenário
  3990. Não bloqueia o plano, porque as cargas novas seguem o shape.

Verificar:

- [x] **Km da A20:** usou o traçado (389,2 km na tela, contra 389,9 km esperados).
- [x] O km acompanha o shape quando os locais já existem no Goal (D8).
- [ ] O cenário 3990 e a escala amarrada a ele continuam intactos?
- [x] Importar só a RAPIDO não afeta a VPAR: no Goal, cada empresa tem cenário e GTFS próprios.
- [ ] Aceita viagens com 2–3 pontos em linhas regulares?
- [ ] Usa o `shapes.txt` recebido ou recalcula a partir dos pontos?
- [ ] Aceita `stop_id` novos? O que acontece com os antigos?
- [ ] A reimportação substitui ou duplica linhas, viagens e pontos? A exigência de nome único sugere
      que cada carga cria algo novo, então é preciso ver o que acontece com as cargas anteriores.
- [ ] O `route_id` amarra a linha? E o `service_id`?
- [ ] Os `trip_id` novos causam perda de algo já composto no Goal, como escalas?
- [ ] Com `block_id`, ele trava ou prende a composição das escalas?

**Saída:** o resultado do km decide a D8. Se o Goal rejeitar poucos pontos ou medir por eles, este
plano muda conforme a opção escolhida.

### Etapa 1 — Revisão da base oficial

Feita por você, antes da primeira carga oficial, e sem depender do código. Pode correr em paralelo.
Usar a seção 2.4 como referência: viagens da 311B na rota certa, duração da 031, horários da 380 e
da F01, viagens de outra empresa em bloco, traçados da seção 2.3 e waypoints da F01.

`db:export-transit` não cobre viagens, e um `db:reset` as perderia.

**Saída:** contagem de viagens por linha igual à do Goal, ou diferenças conhecidas e aceitas.

### Etapa 2 — Fundamentos

- `EXTERNAL_CODE_SYSTEMS` + chave `GOAL`.
- Tabela `GtfsExport` (seção 4.2). A migração é rodada por você.
- `osoConfig` → `serviceMetadata` com os campos novos (6 arquivos usam o nome atual). A migração é
  rodada por você.
- Tornar `matchesPattern` público, ou extrair como função pura.
- Mover `ROUTE_COLOR_PALETTE` para `packages/types`.
- Preencher `31`–`34` e `agencyId = 1045`.

**Saída:** OSO e Globus funcionando como antes.

### Etapa 3 — Geração

Loader, builder, `gtfs-times.ts` e CSV, com specs para:

- escala de horários: delta zero, viagem > 24h, viagem com 2 localidades;
- concatenação do shape;
- filtro por operador;
- seleção de plano por vigência;
- IDs.

**Saída:** gerar o feed da RAPIDO pelo service e passar no
[validador oficial](https://gtfs-validator.mobilitydata.org/).

### Etapa 4 — Endpoints e zip

`POST preview`, `POST export`, `archiver`.

**Saída:** zip baixado via API, igual ao gerado na Etapa 3.

### Etapa 5 — Interface

Modal com escopo, operador, período, tipos de dia, versão (sugerida e editável) e opção de
`block_id`, mais prévia por linha, relatório e download.

### Etapa 6 — Validação ponta a ponta

Testar os dois cenários do objetivo: alterar o horário de uma linha, gerar e importar; alterar o
traçado de outra, gerar e importar. Conferir no Goal que as demais linhas seguem intactas.

### Ordem e dependências

Etapa 0 → (1 e 2 em paralelo) → 3 → 4 → 5 → 6.

**Parar na Etapa 0** se o resultado invalidar a premissa. As Etapas 1 a 6 só fazem sentido depois.

---

## 7. Fora do escopo

- `LineCalendarException` e `calendar_dates.txt` por linha.
- `frequencies`, `fares`, `transfers`, `feed_info`.
- Pontos de ônibus reais no nyx.
- Publicação direta na API do Goal.
- Comparação com o feed anterior (diff).

---

## 8. Decisões pendentes

| # | Pergunta | Recomendação |
|---|---|---|
| D3 | **`block_id` ligado ou não?** | Desligado até a Etapa 0 mostrar o efeito. 31 dos 83 blocos da RAPIDO cruzam linhas, então ligar pode amarrar o Goal |
| D9 | **Rotas com o mesmo par de locais e km diferentes:** 031 × 309 (10,8 e 16,0 km; 8,1 e 11,8 km) e 311 × 311B (13,1 e 14,1 km; 15,4 e 15,9 km). O teste da A20 não cobre duas rotas do mesmo par no mesmo feed | Conferir na carga completa. Se uma herdar o km da outra, criar localidade própria no nyx em uma das duas |
| D6 | **Exportar plano em rascunho?** A decisão da v1 é "apenas ativos", mas testar um rascunho no Goal antes de ativar pode ser útil | Manter só planos em vigor. Rever se fizer falta |
| D7 | **Cores:** o catálogo de linhas do Goal manteve as cores após a carga. Falta ver se o serviço mostra a cor do feed | Manter a v1, se a cor for só cosmética no Goal |

### Decididas

- **D1 — duração:** vale a do nyx. Os 5 min vêm da carga do Globus no Goal (fim de uma viagem = início
  da próxima), e o nyx normaliza isso de propósito.
- **D5 — pontos:** o uso é só início e fim de escala, sem detalhe de pontos, e o km não depende deles,
  então 2–3 pontos por viagem atendem. Se for preciso ter os pontos corretos, eles serão cadastrados
  no nyx como localidades.
- **D8 — km:** o Goal mede pelo `shapes.txt`, na primeira carga e em recarga com os mesmos locais.
  Testado só na A20.
- **D2 — 032/033/034:** ficam às 00:30, de propósito, para o Goal gerar as sugestões de complemento
  no mesmo dia. Só a 031 passa de 1440 min, porque inicia às 23:30 e vira o dia. O feed exporta o
  horário do nyx como está.
- **D4 — C02 e dados de teste:** o banco atual do nyx não é oficial e tem dados de teste, então
  divergências como essa não serão corrigidas nele. Servem só para validar o processo.

---

## 9. Implementação (2026-11-04)

Validado num banco descartável com o dump oficial, planos ativados e metadados preenchidos: feed da
RAPIDO com 2.478 viagens (1.289 U, 689 S, 500 D) e 23 linhas. Versão repetida é recusada, e plano fora
da vigência bloqueia. No validador oficial do GTFS (`gtfs-validator` 7.1.0), o único erro foi a URL de
teste `https://mtu`. Os avisos são `feed_info` ausente, `route_long_name` contendo o código (formato
do Goal) e período sem cobertura nos próximos 7 dias.

Diferenças em relação às seções anteriores:

- **Código externo `GOAL` só na linha** (`lineExternalCodesSchema`). Localidades e tipos de ausência
  seguem com `externalCodesSchema`, porque o `stop_id` é sempre o `code` da localidade.
- **`route_text_color` não é exportado.** O Goal nunca recebeu essa coluna, então o feed mantém as
  colunas já testadas. O cálculo por luminância da v1 fica de fora.
- **Sem aviso de código externo em fallback:** com o nyx como origem, o normal é o fallback, e o aviso
  sairia em quase todas as linhas.
- **Metadados de agência obrigatórios:** `agencyId`, `agencyUrl` e `agencyTimezone` em branco bloqueiam
  a exportação.
- **`agency_name` vem de `organName`:** na base oficial é "Semob", e no feed do Goal é "MTU.". Sem
  efeito conhecido, mas não testado.
- **`GET /transit/gtfs/options`** foi acrescentado, para a lista de operadores e a próxima versão.
- **Tipos de dia sem padrão** (`FERIAS`, `ESPECIAL`) não aparecem no modal.
- **Migração `20261104230000_gtfs_export`** escrita à mão com `RENAME COLUMN`: a gerada pelo Prisma
  apagaria `osoConfig`.

### Primeira carga pelo modal (2026-11-04)

`RAPIDO_UTIL_V001`, `RAPIDO_SABADO_V001` e `RAPIDO_DOMINGO_V001`, período de 2026-10-01 a 2026-12-04,
importados sem erro. Pela API: rotas de 134 para 201 (67 novas, com 2 ou 3 pontos), locais de 1.354 para
1.392 (os 40 do feed presentes), catálogo de linhas e cores sem mudança, seis cenários sem mudança e km
do 3990 igual. Os km e viagens do serviço só podem ser conferidos na tela.

Tela do Goal, serviço 915: A20 com 61 viagens, 389,2 km e 17:48, iguais ao esperado. Os serviços ficam
como "Validado" até a publicação.

**Em aberto:** a A20 foi a única linha com rota repetida: `A20_1_3` e `A20_2_3` têm os mesmos pontos e o
mesmo `shape_id` de `A20_1_2` e `A20_2_2`. O serviço 890 já tinha sido excluído, então não foi trava. A
diferença é o nome e a cor em `routes.txt`: o feed A levava os do Goal, e o V001 leva os do nyx
("A20 - Alim Cpa 1 • Vila Da Serra"). Hipótese: esses campos entram na identidade da rota, e uma carga
igual reaproveita. Confirmar recarregando sem alterar nada (V002): as rotas devem seguir em 201.

**Escrita pela API:** a especificação tem 115 operações de escrita, entre elas `POST /ext/v1/place`,
`/ext/v2/route`, `/ext/v2/section` e `/ext/v3/trip`. O e-mail do Goal lista só consultas, e o token não
traz permissão que indique leitura ou escrita. Nenhuma escrita foi tentada.
