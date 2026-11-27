# Plano — Planejamento por meta (frota ou km)

**Status: etapas 0 e 1 feitas (2026-11-26); próxima, etapa 2.** A fórmula do custo foi validada só
no banco de teste (ver seção 13).

Convenções: comentários em snippets TS em inglês; texto em pt-BR; minutos do dia operacional
(`> 1440` = madrugada seguinte); "faixa" = intervalo do dia com frota constante numa linha
(`GenWindow` do gerador por linha).

---

## Objetivo

Gerar a oferta das linhas a partir de uma meta, em vez de a partir das janelas de cada linha:

- **frota**: reduzir ou aumentar em X carros. "Reduzir 10" com uma frota de 100 quer dizer que
  **nenhum momento do dia** consome mais de 90 carros;
- **km produtiva**: reduzir ou aumentar em Y%, no dia todo, só fora do pico ou só entre x–y.

A rotina analisa as linhas (o plano todo, as linhas escolhidas ou as de uma ou mais empresas),
sugere onde ajustar (as linhas e faixas em que o ajuste pesa menos para o passageiro) e, depois
que o usuário aprova a sugestão, gera as tabelas no próprio plano. Como os outros geradores, só
roda em plano **rascunho**: para ajustar um plano ativo, o usuário cria uma cópia antes.

É uma rotina de **geração de oferta**, separada do gerador por linha e do solver, com tela
própria. Ela reaproveita a lógica do gerador por linha. A otimização (solver) é uma etapa
posterior, que o usuário roda se quiser.

## Decisões

| Tema | Decisão |
|---|---|
| Meta | Exclusiva: frota **ou** km, nunca as duas na mesma geração |
| Frota da linha | Medida pela frequência, sem olhar blocos: `ciclo ÷ headway` em cada faixa; no instante, as viagens iniciadas no último ciclo (seção 2) |
| Frota do plano | Soma das frotas das linhas em cada momento. A meta é um teto sobre essa curva |
| Empresas | A geração é sobre o plano, mas a sugestão pode ser limitada a uma ou mais empresas. A frota e a km de referência passam a ser só as dessas empresas (seção 3.4) |
| Linha compartilhada | Sempre ajustada por inteiro. A frota nova é dividida entre as empresas na proporção que tinham, com alerta do efeito nas empresas fora do filtro (seção 3.4) |
| Km | Só a produtiva. A ociosa fica com o solver |
| Faixas da meta de km | Dia todo, só fora do pico, ou entre x–y. A faixa da linha é recortada nos limites do filtro |
| OSO | Cortar sempre diverge da OSO. A linha fica `isDrifted`, e o usuário gera a nova OSO depois |
| Linhas sem demanda | Candidatas de última opção. Entram só quando as linhas com demanda não bastam, sempre com alerta |
| Marcos | Garantidos pelo gerador, que ancora uma partida em cada janela. A análise avisa quando o intervalo novo fica maior que a janela do marco (pode deslocar partidas ou pedir reforço) |
| Alertas na linha | Viagens em bloco travado, em grupo de viagens, ou viagens fora do gerador (reforço avulso, edição manual): a linha entra na sugestão com ícone de alerta, e o usuário decide se segue com ela |
| Tipo de dia | O do plano. Plano especial sem dados próprios usa o tipo de dia base (`baseDayTypeId`) |
| Capacidade do veículo | Configuração de planejamento por tipo de veículo, única fonte para o score de linha, o gerador e a análise (seção 8.1) |
| Solver | Fora desta rotina. A geração entrega o plano com blocos por linha. Otimizar depois é decisão do usuário |
| Onde grava | No próprio plano, que precisa ser rascunho (bloqueado em plano ativo, como os demais geradores). A rotina não duplica o plano |
| Tela | Página própria com três passos, não um modal |
| Lógica do gerador | Sai de `apps/web` para `packages/schemas` e passa a ser usada pela tela atual e pela rotina nova (seção 8) |

## Fora deste plano

- Meta combinada (frota e km ao mesmo tempo, ou frota com teto de km).
- Otimização dos blocos depois da geração: é o solver, chamado pelo usuário (ver seção 7.5).
- Frequência combinada por tronco comum (linhas variantes ou trechos compartilhados): entra como
  melhoria do custo na etapa 4.
- Modo "desbaste" (tirar viagens mantendo os horários atuais o mais perto possível): a primeira
  versão regenera a linha inteira. Fica para a etapa 4.

---

## 1. O que já existe

| Recurso | Onde | Uso aqui |
|---|---|---|
| Ciclo por faixa (ida, volta, intervalos) | `buildUnifiedWindows`, `absorbPartialGaps`, `mergeByTolerance`, `totalCycleMinutes` (`line-generator-logic.ts`) | Frota e headway de cada faixa |
| Frota por faixa a partir da demanda | `deriveFleetBands`, `fleetNeededForHour` | Frota "necessária" de cada faixa, referência do custo |
| Geração das viagens e marcos | `generateRounds` (marcos como âncoras, com reforço quando preciso), `assignRoundsToBlocks` | Gera a linha ajustada, já com os blocos |
| Garagem dos blocos gerados | `depotAllocations`, `resolveNearestDepot` (modal) | Garagem dos blocos novos |
| Demanda | `TransitLine.metrics.demand[dayTypeCode][direction][hora]` (embarques) | Ocupação antes e depois |
| Critérios de linha | `settings.line.demandMatch`, `headwayRegularity`, `maxGap` | Faixas ideais e tetos do custo |
| Frota por pico da linha | `VehiclePlanLineSummary.peakFleet*` (`bandFleets`) | Conferência da frota medida pela frequência |
| Comparação de planos | `GET compare`, `PlanCompareModal` | Resultado final, rascunho × plano de onde foi copiado |
| Log de geração | `POST :id/lines/:lineId/log-generation` | Registro das linhas regeneradas |

---

## 2. Conceitos

**Frota da linha numa faixa**: `ciclo ÷ headway`, arredondado para cima. Uma linha com ciclo de
75 min e partidas a cada 15 min consome 5 carros, não importa em quantos blocos essas viagens
estejam. É assim que a operação enxerga a linha ("7 carros no pico da manhã, 4 no entrepico, 6 no
pico da tarde"), e é o mesmo `fleetCount` que o gerador por linha já usa em cada faixa.

- **Antes**: o ciclo cadastrado da faixa (`metrics.windows`) ÷ o headway **médio** das viagens do
  plano nessa faixa.
- **Depois**: o ciclo ÷ o headway que resulta do ajuste. É exatamente o que o gerador vai produzir.

Antes e depois usam a mesma conta. Por isso a diferença entre eles é só o efeito do ajuste, mesmo
numa linha com partidas irregulares (10, 20, 10, 20 dá headway médio de 15).

Medir é direto e não depende de blocos nem do encadeamento entre linhas. Como conferência, a
tela mostra ao lado a frota em serviço do resumo da linha (`peakFleetMorning`, `peakFleetAfternoon`,
`peakFleetOffPeak`). Quando os dois diferem em mais de 1 carro, a linha recebe um alerta de
headway irregular. O número da análise continua sendo o do headway médio.

**Curva de frota do plano**: os carros na rua a cada meia hora, somados entre as linhas. A meta de
frota é um teto sobre essa curva. Interlining e encadeamento entre linhas não entram, porque são
otimização (solver).

Os carros de uma linha num instante são as viagens que ela iniciou no último ciclo antes dele
(partidas por minuto de cada faixa × minutos da faixa dentro dessa janela). Numa faixa mais longa
que o ciclo, isso dá exatamente `ciclo ÷ headway`. Num pico mais curto que o ciclo, conta os carros
que ainda estão na rua da frequência menor anterior, em vez de um ciclo inteiro de headway de pico.

Por que não a soma das frotas por faixa: no plano de dia útil do banco de teste, com 184 blocos, a
soma de `ciclo ÷ headway` dava 215 carros às 06:00. A linha 319, por exemplo, tem ciclo de 145 min e
um pico de 1 h com 5 partidas, o que dá 13 carros, mas só 7 estão em serviço. Com a janela do ciclo,
o pico do plano dá 181 às 07:00.

Cada faixa mostra as duas medidas: a `frota` (`ciclo ÷ headway`, de onde a alavanca tira carro) e o
`pico` (o máximo de carros na rua dentro da faixa, pela janela). O alerta de headway irregular
compara o pico com a frota em serviço dos blocos.

**Alavanca**: a unidade de ajuste, **linha × faixa × ±1 carro**. Para cada alavanca a análise
calcula, sem gerar viagens:

| Medida | Cálculo |
|---|---|
| Ganho na frota | a queda da curva onde as viagens da faixa estão na rua (até um ciclo depois dela). Só conta nas meias horas acima do teto |
| Ganho em km | viagens a menos na faixa × extensão por sentido (`metrics.extensionKm`) |
| Headway | `ciclo ÷ frota`, antes e depois |
| Ocupação | demanda da hora ÷ oferta (viagens × capacidade × renovação), por sentido, antes e depois |
| Maior intervalo | depois do ajuste, comparado com `maxGap` |
| Marcos | se a faixa tem marco e se o headway novo ainda o atende |

**Custo**: um número que resume o impacto da alavanca para o passageiro (seção 5). A sugestão
escolhe as alavancas de menor custo por unidade de ganho até bater a meta.

---

## 3. Meta de frota

### 3.1 Excesso

1. Montar a curva de frota do plano (ou das empresas do filtro).
2. Referência = o pico da curva. Teto = `referência − X`. Toda meia hora acima do teto tem um
   excesso a eliminar.
3. Em geral o excesso fica nos dois picos. Quando os picos são parecidos, é preciso cortar nos
   dois, senão a frota não cai.

### 3.2 Alavancas candidatas

As faixas cujas viagens ainda estão na rua em alguma meia hora com excesso: uma faixa de 05:00–06:00
de uma linha de ciclo longo ajuda no excesso das 07:00. O teto é do conjunto, então serve qualquer
linha.

### 3.3 Seleção

Gulosa, com recálculo a cada passo:

```
while some slot above ceiling:
  candidates = levers touching an excess slot, not blocked by a hard rule
  pick the lowest cost / (excess slots it relieves)
  apply it to the estimate (line fleet, curve, occupancy, headway)
  the lever's line/band gets its next −1 lever, with costs recalculated
```

O custo de cortar de novo a mesma faixa sobe sozinho, porque a ocupação aumenta e o headway
alonga. Isso já evita tirar tudo de uma linha só. Um teto configurável por linha (seção 6)
completa o controle.

As linhas sem demanda formam um segundo grupo: só entram quando as alavancas com demanda acabam
ou passam do teto de custo (seção 5.3).

### 3.4 Filtro de empresas

Com uma ou mais empresas selecionadas, a análise trabalha só com o que é delas:

- **frota de cada linha por empresa**: a frota da faixa (`ciclo ÷ headway`) dividida entre as
  empresas na proporção das viagens da faixa em blocos de cada uma (`VehicleBlock.branchId`). Em
  linha de uma só empresa, é a frota inteira;
- **curva e referência**: só as frotas das empresas do filtro. "Reduzir 10" passa a ser 10 carros
  dessas empresas;
- **km de referência**: só a km produtiva das viagens dessas empresas;
- **linhas candidatas**: as que têm viagens em blocos dessas empresas;
- **linha compartilhada**: a linha é sempre ajustada por inteiro, porque ajustar só a parte de uma
  empresa quebraria a frequência da linha. A alavanca continua sendo "linha × faixa × ±1 carro", e a
  frota nova é dividida entre as empresas na proporção que elas tinham na faixa (maior resto).
  Então:
  - o ganho que conta para a meta é só a parte que cai nas empresas do filtro;
  - a alavanca mostra um alerta com o efeito nas outras empresas ("linha compartilhada: B passa de
    2 para 1 carro no pico da manhã").

Arredondar a divisão em carros inteiros tem um efeito: numa linha com A = 3 e B = 2 carros, tirar 1
carro deixa 4, e a proporção (2,4 e 1,6) arredonda para A = 2 e B = 2. O carro sai de A. Já com
A = 2 e B = 3, ele sairia de B, e o ganho para o filtro A é zero. A análise calcula o ganho depois
do arredondamento, então uma alavanca assim simplesmente não é escolhida para a meta de A,
enquanto houver opções melhores.

---

## 4. Meta de km produtiva

1. Filtro de faixas: dia todo, fora do pico (entre `PEAK_HOURS`), ou x–y informado pelo usuário.
   A faixa da linha que cruza um limite do filtro é recortada nele.
2. Alavancas: todas as linha × faixa dentro do filtro.
3. Seleção gulosa pelo menor custo por km de ganho, até atingir Y% da km produtiva de referência.
4. Restrição: a curva de frota nunca pode passar do pico atual.

Para reduzir km, as faixas fora do pico costumam ser as mais baratas, porque o headway já é longo e
a ocupação baixa. Com o filtro "fora do pico", o pico de frota fica igual por construção.

### Aumentos

É a mesma seleção ao contrário: +1 carro onde a ocupação mais passa do `idealMax` do
`demandMatch`, ou onde o headway mais passa do `maxGap`. Para aumentar a frota, o teto vira um
piso no pico; para aumentar a km, entram as faixas do filtro.

---

## 5. Custo da alavanca

### 5.1 Componentes (redução)

| Componente | Peso de referência | Ideia |
|---|---|---|
| Ocupação depois | `demandMatch` | Sai barato enquanto a ocupação fica dentro de `idealMin`–`idealMax`. Sobe depressa até `ceiling` |
| Perda relativa de frequência | — | `1 / frota da faixa`: tirar 1 de 12 pesa menos que tirar 1 de 3 |
| Headway depois | `maxGap` | Passar de `idealMax` custa. Passar de `ceiling` bloqueia a alavanca, salvo se o usuário permitir |
| Marco | alerta | O gerador ancora uma partida na janela. A alavanca avisa quando o intervalo novo passa da largura da janela |

Os pesos partem dos `modifier` dos critérios de linha (`settings.line`). Assim, a régua da
sugestão é a mesma do score que o usuário já configura.

Implementado (`goal-analysis.ts`): cada componente cresce devagar até o `idealMax` (quanto mais
folga, mais barato) e 4× mais rápido depois dele. A perda relativa é `1 / frota antes`, com peso
fixo 20. O custo é a média ponderada dos componentes ativos. A seleção compara o custo pelo alívio
que a alavanca dá nas meias horas acima do teto: um carro a menos numa faixa baixa a curva onde as
viagens dela ainda estão na rua, inclusive depois do fim da faixa.

### 5.2 Folga como sinal principal

Uma linha com ocupação de 40% no pico tem folga: o corte tira oferta que não é usada. Esse é o
caso que mais interessa, e o componente de ocupação deve dominar quando há demanda.

### 5.3 Linhas sem demanda

- O custo usa só a perda relativa e o headway.
- Entram num **segundo grupo**: só são usadas quando as linhas com demanda acabaram ou passaram
  do teto de custo.
- Sempre com o alerta "Demanda não disponível: impacto na ocupação não avaliado".

### 5.4 Transparência

Cada alavanca mostra de onde vem o custo (ocupação, headway, só frequência) para o usuário
entender a sugestão antes de aceitar.

---

## 6. Configurações da meta

| Campo | Valores |
|---|---|
| Tipo | Frota \| Km produtiva |
| Empresas | Todas \| uma ou mais empresas do escopo |
| Sentido | Reduzir \| Aumentar |
| Valor | Carros (frota) \| % (km) |
| Escopo | Plano todo \| linhas escolhidas |
| Faixas (só km) | Dia todo \| fora do pico \| entre x–y |
| Máximo por linha | Carros que uma linha pode perder ou ganhar (opcional) |
| Headway máximo | Teto absoluto de headway depois do ajuste (padrão: `maxGap.ceiling`) |
| Linhas travadas | Linhas que a análise não toca |
| Usar linhas sem demanda | Automático (só quando faltar) \| nunca |

---

## 7. Fluxo

### 7.1 Passo 1 — Meta

Formulário da seção 6.

### 7.2 Passo 2 — Sugestões

`POST transit/vehicle-plan/:id/goal/analyze` (sem estado, não grava nada):

1. **Curva de frota** de referência, com o teto da meta.
2. **Alavancas escolhidas**, agrupadas por linha: faixa, frota antes → depois, headway, ocupação,
   km, componentes do custo, alertas.
3. **Total contra a meta**: atingida ou o quanto falta. Quando não dá para atingir sem passar dos
   tetos, a resposta diz por quê.

O usuário pode tirar, acrescentar ou alterar alavancas (por exemplo, −2 em vez de −1), e o total
é recalculado. Recalcular só a soma pode ficar no cliente, desde que a lógica esteja em
`packages/schemas` (seção 8).

### 7.3 Passo 3 — Geração

`POST transit/vehicle-plan/:id/goal/generate` com as alavancas aceitas. Só em plano rascunho.
Roda no backend, em uma transação, sem job (é só o gerador por linha, sem busca). A sugestão do
passo 2 já é a proposta: o usuário a revisa ali, e gerar grava no plano.

1. Para cada linha com alavanca: monta as faixas como o modal faz hoje, aplica o ajuste de frota
   nas faixas, gera as viagens (`generateRounds`, com os marcos como âncoras) e os blocos da
   linha (`assignRoundsToBlocks`), e substitui as viagens e os blocos da linha no plano. As
   outras linhas ficam como estão.
2. **Empresa e garagem dos blocos novos.** Hoje o gerador cria blocos sem empresa (o `branchId` do
   diff está reservado e não é usado), e o solver é quem decide depois. Como o solver não faz parte
   desta rotina, a geração atribui:
   - **empresa**: em cada faixa, a frota nova da linha dividida como na análise (proporção que cada
     empresa tinha, maior resto, seção 3.4);
   - **garagem**: a de cada empresa usada pela linha antes da geração, na mesma proporção, como o
     `depotAllocations` do modal.
3. Linhas que o usuário manteve apesar do alerta: as viagens em bloco travado ou em grupo
   (`bundleId`) são substituídas como as outras. O bloco travado fica sem elas (e sai, se ficar
   vazio), e o grupo que tinha alguma delas é desfeito, como já acontece ao remover uma viagem de
   grupo. Reforços avulsos e viagens editadas à mão também saem. O alerta do passo 2 diz isso.
4. A linha fica `isDrifted`, e a geração é registrada no log.
5. Recalcula o plano (`recalculate`) e volta para ele.

Um bloco gerado atravessa faixas, e a frota de cada empresa pode mudar de uma faixa para outra (A
com 3 no pico e 2 no entrepico). Por isso a empresa é escolhida bloco a bloco: cada bloco fica com
a empresa que tem carros sobrando em todas as faixas em que ele roda, começando pelos blocos mais
longos.

### 7.4 Verificação

A resposta da geração traz a curva de frota e a km produtiva do plano gerado, medidas como na
análise (seção 2), contra a meta. Não depende de blocos. Uma diferença só aparece quando o
gerador não conseguiu o headway pedido, por exemplo por causa de um reforço de marco. Nesse caso,
a tela mostra a linha e oferece voltar ao passo 2.

### 7.5 Depois da geração

O plano fica com os blocos que o gerador montou para cada linha. Combinar linhas no mesmo bloco é
otimização: o usuário pode rodar o solver depois.

Com filtro de empresa, vale um aviso na tela final: o solver decide a empresa de cada bloco e
tenta cumprir as cotas (`ScopeOperator.share`). Se a redistribuição entre empresas estiver
ligada, ele pode devolver carros à empresa que acabou de perder. Isso é responsabilidade do
usuário ao configurar o solver, e não desta rotina.

---

## 8. Refatoração da lógica do gerador

`line-generator-logic.ts` (1.289 linhas) e o que ele usa de `vehicles.view.ts`
(`resolveCycleWindow`, tipos `CycleWindow` e `LineMetrics`) não dependem de React. Hoje estão em
`apps/web`, e a análise e a geração precisam deles no backend.

Proposta: mover para `packages/schemas/transit/line-generator/`, como já foi feito com
`block-validation.ts`. É uma mudança mecânica, sem alterar comportamento. O modal atual passa a
importar do pacote.

Pontos a revisar na mudança:

- `crypto.randomUUID()` nos ids de faixa: funciona no Node 19+ e no navegador. Conferir a versão
  do Node da API.
- `TARGET_OCCUPANCY = 0.8` está fixo no código. A análise usa a mesma constante, para a sugestão e
  a geração concordarem.
- A montagem das faixas e das ociosas fica hoje no modal (`seedWindows`, `resolveNearestDepot`, e
  as chamadas que buscam rotas, localidades, garagens e tempos da matriz). Essa parte vai para
  funções do pacote que recebem os dados já carregados, com a consulta à matriz passada como
  função. O backend lê os mesmos dados pelo Prisma.

**Feito na etapa 0:** `line-generator.ts` e `cycle-window.ts` em `packages/schemas/transit/line-generator/`,
exportados pela raiz do pacote; `seedLineWindows` (faixas a partir de janelas e demanda) e
`lineVehicleCapacity` no pacote; o tsconfig do pacote declara `types: ["node"]` (o TypeScript 6
não inclui mais os `@types` sozinho). As ociosas e a garagem (`resolveNearestDepot`, consulta à
matriz) continuam no modal e vão para o pacote na etapa 2, quando a geração passar ao backend.

### 8.1 Capacidade por tipo de veículo

Hoje o modal começa com `vehicleCapacity = 80` fixo (`makeInitialLineState`), editável por linha
na tela. A análise precisa de um valor para cada linha sem intervenção.

**Onde guardar: nas configurações de planejamento (transit), por tipo de veículo.**

```ts
// packages/schemas/transit/settings-planning.schema.ts
// nominal passengers per vehicle type (seated + standing) — supply in the line generator
// and the goal analysis; the plan works with types, never with a physical vehicle
vehicleCapacity: z.record(z.enum(VEHICLE_TYPES), z.number().int().min(1))
  .default({ STANDARD: 80, ARTICULATED: 120, BI_ARTICULATED: 160, MICRO_BUS: 30, MINIBUS: 20, VAN: 15 }),
```

Motivos:

- o plano trabalha com o **tipo** (`VehicleType`), não com o veículo físico: não sabe qual carro
  vai rodar a tabela;
- `planningSettingsSchema` já é por escopo, com cópia por plano (`VehiclePlan.settings`). Assim
  cada escopo ou plano pode ter seus valores, e não precisa de migração (é JSON, com default);
- `Vehicle.totalCapacity` (fleet) é do carro físico e varia por modelo. Serve para outra coisa
  (por exemplo, uma ação "sugerir a partir da frota", com a média da capacidade dos carros ativos
  de cada tipo). Não deve ser a fonte do planejamento.

Na linha, a capacidade é a do tipo preferido (`vehicleTypes.preferred`), senão a de `STANDARD`.
O modal atual passa a começar com esse valor em vez de 80.

**Unificada na etapa 1:** a API tinha uma tabela fixa (`VEHICLE_TYPE_CAPACITY`, em
`vehicle-plan.constants.ts`) usada pelo score de linha (ocupação) e pelo gráfico oferta × demanda.
Ela foi removida, e esses cálculos passaram a ler a configuração. Os valores padrão são os da tabela
antiga, para nenhum score mudar sem alguém alterar a configuração.

---

## 9. Tela

- Rota: `/transit/vehicle-plan/[id]/goal`, aberta por uma ação no topbar do plano.
- Mantém `useTopbarActions`, `AutoBreadcrumb`, `FORM_ID` e os atalhos `alt+g` (avançar ou gerar),
  `alt+v` (voltar ao plano) e `alt+l` (limpar a meta).
- Passo 2: tabela de alavancas por linha, expansível por faixa, com o total da meta fixo no topo.
  Cada linha mostra a frota por faixa ("7 / 4 / 6" → "6 / 4 / 5"). O gráfico oferta × demanda do
  modal pode ser reaproveitado no detalhe da linha.
- Em plano ativo, a ação aparece desabilitada, com a mesma mensagem dos outros geradores (criar uma
  cópia rascunho).

---

## 10. Endpoints

| Endpoint | |
|---|---|
| `POST :id/goal/analyze` | `{ goal }` → `{ curve, levers[], total, reachable, reasons[] }` |
| `POST :id/goal/generate` | `{ goal, levers[] }` → `{ curve, total, deviations[] }` (só rascunho) |

Schemas novos em `packages/schemas/transit/vehicle-plan-goal.schema.ts`. Sem tabela nova na
primeira versão: a meta fica registrada no log de geração de cada linha.

---

## 11. Etapas

| Etapa | Conteúdo | Entrega |
|---|---|---|
| 0 | Mover a lógica do gerador para `packages/schemas`; capacidade por tipo nas configurações | Modal atual funcionando igual, importando do pacote e começando com a capacidade configurada |
| 1 | Análise da meta de frota (frota por frequência, curva, alavancas, custo, seleção, filtro de empresas) e passos 1–2 da tela | Feita: `GET :id/goal/options`, `POST :id/goal/analyze`, tela `/transit/vehicle-plan/[id]/goal` |
| 2 | Geração no plano rascunho (blocos com empresa e garagem) + verificação | Fluxo completo para frota |
| 3 | Meta de km (filtros de faixa) e aumentos | Os quatro tipos de meta |
| 4 | Frequência combinada por tronco no custo; modo desbaste | Sugestão mais fina, menos divergência da OSO |

Testes: a análise é pura e cabe em spec com planos sintéticos (frota por frequência, curva,
seleção, linhas sem demanda, marco bloqueando alavanca, linha de duas empresas). A etapa 2 pode
ganhar um bench no formato do `vehicle:solver-bench`: meta → sugestão → geração → verificação,
sem gravar.

---

## 12. Dúvidas e considerações

1. **Custo**: a fórmula da seção 5 é um ponto de partida. A validação real é a etapa 1: rodar no
   banco de teste e comparar com as linhas que você escolheria cortar.
2. **Empresa bloco a bloco** (seção 7.3): quando a proporção entre as empresas muda ao longo do dia,
   algum bloco pode não caber inteiro na sobra de uma empresa só. Nesse caso ele fica com a empresa
   que tem mais sobra no seu trecho mais longo, e a diferença aparece na verificação. A etapa 2
   mede com que frequência isso acontece no banco de teste.

---

## 13. Resultado da etapa 1 no banco de teste

Plano de dia útil ativo (184 blocos, 53 linhas), meta de −10 carros, sem filtro:

- pico de 181 carros às 07:00, teto de 171, meta atingida;
- 25 cortes em 19 linhas, todos com ocupação dentro do teto do `demandMatch`. Exemplos: 306 de 16 a
  17 h, de 7 para 4 carros (ocupação de 29% para 52%); 313 de 6 a 7 h, de 13 para 11 (65% → 77%);
- 14 linhas com alerta de headway irregular, 6 sem ciclo em parte do dia, 6 sem demanda, 5 com
  grupos de viagens;
- análise em 0,6 s; com −60 carros, 5 s (a seleção recalcula a curva das linhas a cada carro).

Com filtro de uma empresa (82 carros no pico), −5 carros: 8 cortes, só em linhas dessa empresa.

Para validar com quem conhece a operação: se as linhas e faixas escolhidas são as que seriam
cortadas na prática, e se o corte espalhado entre manhã e tarde faz sentido. Um carro a menos às
07:00 sai de viagens iniciadas desde as 05:00, por causa do ciclo.
