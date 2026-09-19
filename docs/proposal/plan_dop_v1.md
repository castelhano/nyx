# Proposta — Dados Operacionais Previstos (DOP)

Objetivo: um card no domínio `transit`, sem CRUD, abrindo um dashboard que resume os
indicadores operacionais **previstos** para um período (em geral um mês) — km planejada,
percentual de ociosidade, frota, entre outros — a partir dos `VehiclePlan` vigentes nesse
período. Documento vivo: ainda falta fechar bastante coisa, principalmente a seção de
indicadores.

---

## O que já existe (peças reaproveitáveis)

| Peça | Onde | Estado |
|---|---|---|
| `VehiclePlan.validFrom`/`validTo` | `transit.prisma:437,439` | Recém-adicionado — carimbado em `VehiclePlanService.activate()` (`vehicle-plan.service.ts:1367-1389`), mesmo padrão de supersessão do `LineSchedule.approve` |
| `VehiclePlanSummary` (nível plano) | `vehicle-plan.schema.ts:10-23` | `fleetCount`, `score`, `deadrunKm`, `productiveKm`, `totalKm`, `deadrunMinutes`, `productiveMinutes`, `totalMinutes` — populado pelo solver, persistido em `VehiclePlan.summary` |
| `VehiclePlanLineSummary` (por linha) | `vehicle-plan.schema.ts:25-43` | `fleetSize`, `dailyTrips`, `operatingHours`, `dailyKm`, `avgSpeed`, `occupancyIndex`, `serviceFrequencyIndex`, `peakPassengersPerHour`, headways de pico/entrepico — populado por `computeLineSummary` (`plan-scoring.calc.ts:359-398`), persistido em `VehiclePlanLine.summary` |
| `VehicleBlockSummary` (por bloco) | `vehicle-block.schema.ts` | `totalMinutes`, `productiveMinutes`, `deadrunMinutes`, `totalKm`, `productiveKm`, `deadrunKm` — granularidade mais fina que o resumo do plano, fonte natural pra derivar ociosidade |
| `DayTypeService.resolveDayType(date, lineId)` | `day-type.service.ts` | Já implementado, **nunca chamado por ninguém ainda** — resolve o dayType efetivo de uma linha numa data, considerando `LineCalendarException` incondicional e condicional (`sourceDayTypeId`). É a peça-chave pra expandir "1 plano por dayType" em série diária de um período |
| `DayType.pattern` | `transit.prisma:242-263` | `weekdays` / `month_window` — permite contar quantos dias do período caem em cada dayType, pra projetar totais mensais a partir dos totais diários do plano |
| `resourceRegistry` sem `modelName` | `resource-registry.ts` | Precedente de resource registrado só com schema (sem tabela dedicada) — usado hoje pelos singletons de `Settings` (`base-settings.service.ts:38-39`). DOP vai um passo além: nem a tabela genérica de Settings, puramente computado |
| `VehiclePlan.duplicate()` | `vehicle-plan.service.ts:554-599` | Action "Duplicar" já existente — cobre o caso de "reativar" um plano antigo sem precisar de vigência multi-período |

---

## Decisões já consolidadas

1. **Vigência simples no `VehiclePlan`** (`validFrom`/`validTo`, um único intervalo, sem
   histórico multi-período) — mesmo padrão do `LineSchedule`. Reativar um plano antigo depois
   de ativar outro no meio se resolve duplicando o plano (`Duplicar` já existe) e ativando a
   cópia — não via reabertura do registro original. Decidido porque o caso de reativação é
   atípico e a alternativa (tabela de períodos por plano) complica sem necessidade real hoje.

2. **DOP não terá modelo Prisma.** É computado on-the-fly a partir dos `VehiclePlan`/
   `VehiclePlanLine`/`VehicleBlock` vigentes quando o usuário abre um período — sem tabela de
   snapshot. Trade-off aceito: reabrir "março" depois de editar um plano pode mudar os números
   retroativamente (não há congelamento do que foi "previsto" no passado).

3. **Card sem CRUD no domínio `transit`.** Registrado manualmente em `resourceRegistry` só com
   um schema (label/ícone/subject do CASL) — sem estender `BaseController`/`BaseService`, já
   que não há create/update/delete/list, só um GET computado.

4. **Página custom, não genérica.** Rota estática (`app/transit/dop/page.tsx`), 100%
   hand-rolled (cards, gráficos) — mesmo raciocínio de `vehicle-plan/[id]/page.tsx`, não
   `AutoList`/`AutoForm`.

5. **Resolução por linha, não por scope.** O cálculo itera por (dia, linha) usando
   `resolveDayType`, não por (dia, scope). Isso cobre de graça o caso de duas linhas do mesmo
   scope divergirem numa exceção pontual — cada linha aponta pro seu próprio `VehiclePlan`
   ativo (mesmo scope, dayType efetivo dela) naquele dia, sem caso especial.

---

## Em aberto

- Formato exato do dashboard (quais gráficos, layout dos cards) — não desenhado ainda.
- Seletor de escopo/período na UI (por `Scope`? período livre ou só mês fechado?).
> RESPOSTA: Entendo que ambos, seletor de mes/ano para uma competencia, sempre carregado com o mes corrente, permitindo selecionar periodo diferente, aqui periodo máximo limitado a 12 meses
> DÚVIDA: confirmando — é sempre 1 competência (1 mês) por vez, só mudando qual mês/ano, nunca um intervalo de vários meses somados? E o "máximo 12 meses" é uma janela de navegação (ex.: só é possível voltar até 12 meses atrás do mês corrente) — pra frente também vale, ou só passado?
> RESPOSTA: ao selecionar um mês altera início e fim para primeiro e último dias deste mês; se usuário quiser período diferente, insere datas direto nos controles de início/fim; ao tentar selecionar período maior que 12 meses, emite toast de alerta informando período máximo e busca dados.
> DÚVIDA: resolvido no essencial — só uma ponta: quando estoura os 12 meses, o toast avisa e o sistema **clampa automaticamente** um dos dois campos (ex.: empurra o "fim" pra `início + 12 meses`) e busca com esse intervalo ajustado, ou ele busca com o intervalo exatamente como o usuário digitou (sem clamp), só avisando que passou do recomendado? Preciso saber qual lado clampar (fixa o "início" e ajusta o "fim", ou o contrário) pra implementar certo.
> RESPOSTA: não ajusta, busca exatamente o digitado — o campo mês/ano é só um atalho pra agilizar a seleção de início/fim; se o usuário quiser período diferente, especifica direto nos controles, e a busca é sempre exata no período informado (o toast é só aviso, não bloqueia nem clampa). ✅ Fechado.
- `resolveDayType` precisa de uma versão em lote antes de entrar em uso real: hoje faz até 2
  queries por (dia, linha) chamado individualmente — para um mês × N linhas isso não escala.
  Ideia (não decidida): carregar todas as `LineCalendarException` do período + todos os
  `DayType.pattern` de uma vez, resolver tudo em memória.
- O que fazer quando falta `VehiclePlan` ACTIVE para (scope, dayType) num dia do período
  (nunca ativado, ou vigência não cobre a data) — erro, zero, ou omitir o dia do total?
> RESPOSTA: dados zerados para o dia, tem linhas que não operam aos sabados ou domingos, nenhum problema, dados zerados nela. Se nenhum plano ativo para o scope / daytype, apenas mostra zerado estes dados
- Indicadores "previsto vs. realizado": fora de escopo por enquanto — DOP é só o previsto, não
  há dado de operação real no sistema hoje pra comparar.
> RESPOSTA: DOP é dados PREVISTOS, nada de realizado aqui

---

## Indicadores e fórmulas

Convenção: **Fórmula/Fonte** em branco = ainda não decidido — não inferir, aguardar o usuário
preencher ou descrever.

| Indicador | Nível | Fonte | Fórmula | Status |
|---|---|---|---|---|
| Frota (nº de carros) | Plano | `VehiclePlanSummary.fleetCount` | valor direto | ✅ |
| Km produtiva (dia) | Plano | `VehiclePlanSummary.productiveKm` | valor direto | ✅ |
| Km ociosa/deadrun (dia) | Plano | `VehiclePlanSummary.deadrunKm` | valor direto | ✅ |
| Km total (dia) | Plano | `VehiclePlanSummary.totalKm` | valor direto | ✅ |
| Minutos produtivos/deadrun/total (dia) | Plano | `VehiclePlanSummary.{productive,deadrun,total}Minutes` | valor direto | ✅ |
| Score do plano | Plano | `VehiclePlanSummary.score` | valor direto | ✅ |
| Frota por linha | Linha | `VehiclePlanLineSummary.fleetSize` | valor direto | ✅ |
| Variação frota entre pico | Linha | cálculo novo — `peakVehicleRequirement()` por banda, excluindo bloco "reforço isolado" (ver Dúvidas) | frotaEntrePico / frotaPicoManha * 100   | ✅ regra definida |
| Variação frota pico tarde | Linha | idem acima | frotaPicoTarde / frotaPicoManha * 100   | ✅ regra definida |
| Viagens/dia por linha | Linha | `VehiclePlanLineSummary.dailyTrips` | valor direto | ✅ |
| Horas de operação por linha | Linha | `VehiclePlanLineSummary.operatingHours` | valor direto | ✅ |
| Km/dia por linha | Linha | `VehiclePlanLineSummary.dailyKm` | valor direto | ✅ |
| Velocidade média por linha | Linha | `VehiclePlanLineSummary.avgSpeed` | valor direto | ✅ |
| Índice de ocupação (demanda/capacidade) | Linha | `VehiclePlanLineSummary.occupancyIndex` | valor direto | ✅ |
| Índice de frequência de serviço | Linha | `VehiclePlanLineSummary.serviceFrequencyIndex` | valor direto | ✅ |
| Passageiros/hora no pico | Linha | `VehiclePlanLineSummary.peakPassengersPerHour` | valor direto | ✅ |
| Headway pico manhã/tarde/entrepico | Linha | `VehiclePlanLineSummary.{peakMorningInterval,peakAfternoonInterval,offPeakInterval}` | valor direto | ✅ |
| **Percentual de ociosidade** | Linha (+ consolidado plano/scope) | Linha: rateio de `BlockDeadrun` por bloco (ver [1]). Plano/scope: `VehiclePlanSummary.deadrunKm`/`totalKm` direto, sem rateio | [1] | ✅ regra definida |
| Km planejada no período (mês) | Período | `VehiclePlanSummary`/`VehiclePlanLineSummary` × contagem de dias por dayType | | ⬜ em aberto — depende de fechar a agregação por `resolveDayType` |
| PMM (percurso médio mensal) | Linha | `frotaOperacional` = max(frotaPicoManha, frotaPicoTarde) da linha (ver linhas de frota-por-pico acima) | kmTotalMes / frotaOperacional | ⬜ depende de "Km planejada no período" |
| HVM (horas veiculo mes) | Plano | `frotaOperacional` = max(frotaPicoManha, frotaPicoTarde) do plano | totalHorasOperacionais / frotaOperacional | ⬜ depende de "Km planejada no período" |
| | | | | ⬜ |

[1] % Ocioso por linha: em cada `VehicleBlock`, `ACCESS`/`RETURN` são rateados entre as linhas do
bloco proporcionalmente à participação de cada uma na km produtiva daquele bloco; `DISPLACEMENT`
vai 100% pra linha das duas viagens que conecta quando é a mesma linha, ou 50%/50% quando conecta
viagens de linhas diferentes. `% ocioso da linha = kmOciosaAtribuída / (kmOciosaAtribuída +
kmProdutivaDaLinha)`, agregado no período. O consolidado de plano/scope não usa esse rateio — é
direto de `VehiclePlanSummary.deadrunKm`/`totalKm`.

### Dúvidas nos apontamentos

- **Variação frota entre pico / Variação frota pico tarde**: `frotaPicoManha`, `frotaPicoTarde` e
  `frotaEntrePico` não existem hoje como campo — `VehiclePlanLineSummary.fleetSize` é um único
  número (frota da linha no dia inteiro), sem quebra por faixa horária. Pra existir, precisaria de
  uma métrica nova em `computeLineSummary` (`plan-scoring.calc.ts:359-398`) rodando
  `peakVehicleRequirement()` (`plan-scoring.calc.ts:41-59`) restrito às viagens de cada banda —
  mesmo princípio que `bandHeadway` já usa pra calcular headway por banda, só que aplicado à frota
  concorrente em vez do intervalo entre partidas. Confirma que é isso (frota **concorrente máxima**
  dentro da banda), e que topa que isso é cálculo novo, não campo existente?
> RESPOSTA: Sobre o calculo ja fazemos algo parecido no modal de resumo do plano para frequencia nos picos, acho que ambos os camos podem (para facilitar) serem inclusos no summary do plano, ao gravar plano ja adiciona estes dados calculados, aqui so tem o trabalho de ler (me corrija se eu estiver errado); Aqui, da mesma forma como ocorre para frequencia, deve desconsiderar atendimentos extra, exemplo, linha opera com frequencia média de 10 min no pico da manha (06 as 08) com 6 carros, mais tem uma viagem extra as 06h05 (com um carro que entra somente para este reforço), tanto a frequencia pico manha deve ser mostrada 10 quanto a frota deve ser mostrada 6, essa incidencia isolada nao pode virar a referencia do pico inteiro, se ainda nao conseguir deixar claro me questione mais

> DÚVIDA (correção, não achei o que você descreve): fui conferir `LineSummaryView.tsx`, `FrequencyPanel.tsx`, `LineFreqPanel.tsx` e o `bandHeadway` (`plan-scoring.calc.ts`) que hoje alimenta `peakMorningInterval`/`peakAfternoonInterval` — não achei nenhuma lógica que já descarte uma viagem de reforço isolada. `bandHeadway` hoje é média simples de **todos** os gaps consecutivos da banda: no seu exemplo (freq 10min/6 carros + 1 reforço às 06h05), o resultado atual **já sairia distorcido** pra baixo, não 10. Se eu não achei o lugar certo, me aponta o arquivo; se não existe ainda, então isso não é "só ler" — são duas coisas novas: (1) fix no `bandHeadway` existente pra excluir o reforço, e (2) a métrica nova de frota usando a mesma regra. Preciso da regra exata de "isolado": meu palpite é *bloco que faz só 1 viagem dentro daquela banda específica* conta como reforço e sai tanto do cálculo de headway quanto do de frota da banda — é isso, ou tem outro critério (ex.: baseado em `requiredVehicleType`, em marcação manual, ou em nº de viagens no dia inteiro do bloco, não só na banda)?
> RESPOSTA: confirmado que é este local mesmo (`bandHeadway`) — a dúvida que eu tinha era justamente se o cálculo já previa essa exclusão; o próprio cálculo de frequência nos picos deve ser revisto pra incorporar a ideia. No caso da frequência é menos crítico gerar uma média distorcida; na frota isso é mais problemático (superestimar frota necessária é um erro grande).
> DÚVIDA: ok, então os dois (headway existente + frota nova) vão usar a mesma regra de exclusão — falta só confirmar qual é essa regra. Meu palpite continua de pé: **bloco que faz só 1 viagem dentro daquela banda específica (pico manhã/tarde) conta como reforço isolado e sai do cálculo de headway e de frota daquela banda.** Confirma esse critério, ou prefere outro (ex.: nº de viagens no dia inteiro do bloco, não só na banda; ou baseado em `requiredVehicleType`/marcação manual)?
> RESPOSTA: pode ser — mas o limiar é por sentido, não por viagem: bloco que faz **até 1 viagem por sentido** dentro da banda (ou seja, no máximo uma ida + uma volta) ainda conta como reforço isolado; só passa a contar pra referência do pico quando faz mais que isso (2+ ciclos na banda).
> Restatement pra confirmar que entendi certo: dentro da banda, olhando por bloco — se o bloco tem ≤1 viagem OUTBOUND **e** ≤1 viagem INBOUND naquela banda (equivale a no máximo um round-trip; numa linha CIRCULAR, ≤1 viagem no total, já que só tem um sentido), ele é reforço isolado e fica de fora tanto do `bandHeadway` quanto da frota-por-pico daquela banda. Fechado assim? ✅ (me corrija se eu errei em algum canto)
> RESPOSTA: confirmado. ✅ Fechado.

- **Percentual de ociosidade**: a linha da tabela marca o nível como Plano/Bloco, mas a nota [1]
  fala em "km da linha". Em `VehiclePlanSummary` a km ociosa (`deadrunKm`) só existe agregada pro
  plano inteiro — em `VehiclePlanLineSummary` não tem contrapartida de ociosa por linha, porque um
  mesmo `VehicleBlock` pode atender mais de uma linha no dia (aproveitamento) e `BlockDeadrun` não
  tem `lineId` — não dá pra atribuir a km ociosa de um carro compartilhado a uma linha específica
  sem uma regra de rateio. Esse indicador é só em nível de plano/scope mesmo, ou precisa por linha?
  Se for por linha, como ratear o ocioso de um carro que atende mais de uma linha?

> RESPOSTA: Varios indicadores (esse eh um deles) eu quero ver tanto por linha quanto um consolidado geral, o certo aqui eh tratar por linha e ao contruir a page apenas consolida o total (entendo)

> DÚVIDA: isso confirma o nível (linha, consolidando na página), mas não resolve o problema técnico em si — como ratear a km ociosa de um `VehicleBlock` que atende **mais de uma linha** no dia entre essas linhas? `BlockDeadrun` não guarda `lineId`, só pertence ao bloco inteiro. Três jeitos possíveis, preciso saber qual (ou se é outro):
> 1. Proporcional ao nº de viagens de cada linha no bloco (linha com 8 das 10 viagens do bloco leva 80% da km ociosa dele)
> 2. Proporcional à km produtiva de cada linha no bloco (em vez de nº de viagens)
> 3. Km ociosa do bloco vai inteira pra "linha principal" do bloco (a que tem mais viagens), zero pras demais
> Sem essa regra não dá pra fechar o indicador por linha — só o consolidado do plano (que já é bem definido, sem rateio nenhum).
> RESPOSTA: acho que proporcional a km produtiva — se kmProdutiva do bloco é 80% da linha X, usa esse mesmo 80% na fatia da ociosa do bloco. Avaliar se vale persistir isso no summary (acho que sim) pra página só consumir.
> DÚVIDA/AVALIAÇÃO: sim, entendi certo — é a opção 2 (rateio pela participação de cada linha na km produtiva **daquele bloco**, não do plano inteiro). É internamente consistente e sempre fecha 100% da ociosa do bloco entre as linhas que o usam. Um ponto a considerar antes de fechar: esse rateio é "cego" à origem de cada trecho — um `ACCESS`/`RETURN` é fisicamente ligado à linha da primeira/última viagem do bloco (é o deslocamento pra buscar ou devolver aquele carro), e um `DISPLACEMENT` conecta duas viagens específicas (possivelmente de linhas diferentes). Um rateio por participação em km produtiva do dia inteiro pode empurrar o custo de "ir buscar/deixar" pra uma linha que não foi a causa direta daquele trecho (ex.: bloco majoritariamente da linha A com uma única viagem extra da linha B longe do depósito — o `RETURN` até o depósito, gerado só por causa da B, seria rateado maioria pra A). Isso é mais preciso de resolver via atribuição posicional (`ACCESS`→linha da 1ª viagem, `RETURN`→linha da última, `DISPLACEMENT`→dividido entre as duas viagens que ele conecta), só que dá mais trabalho de implementar. Pra v1, o rateio proporcional que você propôs é razoável e bem mais simples — só quero confirmar que você aceita essa imprecisão no caso de borda acima, ou prefere já ir pro rateio posicional.
> Sobre persistir: sim, bate com o padrão já usado em todo o resto (`computeLineSummary` grava `VehiclePlanLine.summary` na geração/recálculo do plano — `plan-scoring.calc.ts:359-398`, chamado de `vehicle-plan.service.ts`); a página só lê. Mesma lógica serve pra frota-por-pico do item acima.
> RESPOSTA: esse é um bom ponto — ACCESS e RETURN rateiam pelo percentual (sem dúvida aqui), mas os DISPLACEMENTs eu acho que o ideal é jogar 100% pra "a linha linkada nele", faz mais sentido.
> DÚVIDA: falta só um detalhe pra fechar — um `DISPLACEMENT` conecta **duas** viagens (`transit.prisma:611-612`: "between two disconnected trips"), e pela regra 8 do doc da OSO um bloco pode legitimamente misturar linhas no mesmo dia (aproveitamento). Quando as duas viagens que o displacement conecta são da **mesma linha**, "a linha linkada" é óbvio e sem ambiguidade. Mas quando a viagem **antes** do displacement é da linha A e a viagem **depois** é da linha B — qual das duas é "a linha linkada"? Duas leituras possíveis:
> 1. A viagem **anterior** (A) — o deslocamento é o custo de "sair" do serviço de A
> 2. A viagem **seguinte** (B) — o deslocamento é o custo de "chegar" pra atender B
> Preciso saber qual das duas (ou se você tinha as duas viagens da mesma linha em mente e esse caso misto nem deveria acontecer na prática).
> RESPOSTA: nesse caso, 50% para cada. ✅ Fechado — regra final de rateio de ociosidade por linha: ACCESS/RETURN proporcional à participação de cada linha na km produtiva do bloco; DISPLACEMENT 100% pra linha de ambas as viagens quando é a mesma, ou 50%/50% quando conecta viagens de linhas diferentes.

- **PMM e HVM**: `frotaOperacional` não está definida em lugar nenhum — qual frota entra no
  denominador? A do dayType de qual dia (o plano tem frota diferente por dayType — dia útil
  normalmente tem frota diferente de sábado/domingo)? Além disso, os dois dependem de
  `kmTotalMes`/`totalHorasOperacionais`, que por sua vez dependem de fechar a agregação por período
  (linha "Km planejada no período", ainda em aberto).

> Frota do maior pico (manha ou tarde), aqui usando o mesmo critério para desconsiderar carros de reforço que entra para fazer uma viagem extra por exemplo

> Isso fecha PMM/HVM assim que a dúvida da "Variação frota entre pico" acima (regra de detecção de reforço) for respondida — sem regra, não dá pra saber qual é `frotaPicoManha`/`frotaPicoTarde`.


---

## Ordem de implementação sugerida

**Fase 0 — Protótipo visual em `/playground`**
- Reaproveita `apps/web/src/app/playground/page.tsx` (hoje com um protótipo antigo do
  `FrequencyPanel`, sem relação — pode apagar o conteúdo). Dados sintéticos hardcoded, sem
  chamada de API nenhuma — só layout: cards de indicador, agrupamento por linha/plano/período,
  gráficos (headway, ocupação, ociosidade etc.), grid responsivo. Foco 100% visual, zero
  preocupação com usabilidade/interatividade real (sem seletor de período funcional, sem dados
  de verdade) — o objetivo é validar a composição visual antes de acoplar dado real.
- Só depois de aprovar o visual aqui é que entra a Fase 3 (página de verdade), reaproveitando o
  que for validado.

**Fase 1 — Fundamentos de dado previsto (backend, sem endpoint novo ainda)**
- Versão em lote de `resolveDayType`: carregar `LineCalendarException` + `DayType.pattern` do
  período de uma vez, resolver em memória por (dia, linha) — sem 1 query por par.
- Agregação por período ("Km planejada no período" e dependentes: PMM, HVM): para cada dia do
  período × linha, resolve o dayType efetivo, localiza o `VehiclePlan` ACTIVE vigente
  (scope + dayType + `validFrom`/`validTo`) que materializa aquela linha, soma os
  `VehiclePlanLineSummary` do dia; dia sem plano ativo entra como zero (decidido).
- Estende `computeLineSummary` (`plan-scoring.calc.ts:359-398`) com os campos novos por banda:
  frota de pico manhã/tarde/entrepico (via `peakVehicleRequirement()` restrito às viagens da
  banda) e a exclusão de bloco "reforço isolado" (≤1 viagem por sentido na banda) — mesma regra
  vale pro `bandHeadway` existente, que precisa do mesmo fix. Persistido em
  `VehiclePlanLine.summary` na geração/recálculo, junto dos campos já existentes.
- Rateio de ociosidade por linha (ACCESS/RETURN proporcional à km produtiva do bloco,
  DISPLACEMENT 100%/mesma linha ou 50%/50% entre linhas diferentes — nota [1]), também
  persistido no `summary` da linha e do plano.

**Fase 2 — Resource "pseudo" + endpoint computado**
- Registro manual em `resourceRegistry` (schema só pra label/ícone/subject do CASL, sem
  `modelName`) — sem estender `BaseController`/`BaseService`.
- Controller/service enxutos com um único `GET` (scope + período) que orquestra a Fase 1 e
  devolve os indicadores já prontos — nada persistido pelo próprio DOP (decisão consolidada:
  on-the-fly, sem snapshot).

**Fase 3 — Página real**
- `app/transit/dop/page.tsx`, herdando a composição visual validada na Fase 0, agora com
  seletor de mês/ano (atalho pra início/fim, sem clamp — decidido) e consumindo o endpoint da
  Fase 2 de verdade.

**Fase 4 — Polish (fora do escopo inicial)**
- Usabilidade do seletor de período, estados de loading/erro, exportação (se vier a ser
  pedido) — deliberadamente adiado; Fase 0/3 focam em visual e dado real, não nisso.
