### TODO

---
# Outros
> Aumentar horario de inicio ideal turnos (2P em especial) para evitar mostrar alertas de fora do ideal


## Alto
[ ] Tela de ajuste de ciclo, adicionar controle para filtro de daytype (somente dias uteis;sabados;etc) e ja integrar com layout Cittati
[ ] Edição da escala diária
## Medio
[ ] Demanda linha, registrar data de atualização e algum eventual metadado relevante
[ ] Tipar parâmetro db/tx (PrismaService | Prisma.TransactionClient) nos services/utils que hoje usam `any` pra aceitar os dois — eslint tem no-unsafe-* desligado em apps/api por causa disso (eslint.config.mjs)

## Baixo
[ ] Separar conceito de preparo e conclusao de servico
[-] Unificar metodo de geração de CSV entre listpages (fragmentado em cada pagina hoje)


## Pendencias
- VehiclePlan, menu Gerar > item Ajustar Ciclo : no caso de ciclo maior (que não cabe nas viagens) sistema esta tratando correto? avisando corretamente os casos?
- VehiclePlan, menu Gerar > item Redistribuir  : avaliar se recurso eh valido (talvez valha remover), ideia era redistribuir viagens de uma linha ao carregar uma oso adicionando margem de manobra, mais fica confuso e hoje quase nunca mostra enable (se tiver bloco com outras linhas ja nao ativa)

---
# Notas — Ajuste de ciclo (`transit/transit-line/cycle-map`) com dados Cittati

> Análise feita em 2026-11-19, ainda sem implementação. Referência do BI: `docs/integrations/cittati/README.md`.
> Hoje a tela só aceita o CSV da Sonda (`csv-parser.ts`).

## Arquivo Cittati analisado (export "Viagens", amostra em ~/Downloads/data.csv)
- UTF-8 **com BOM**, separador `,`, campos entre aspas, 24 colunas, ~9,9 mil linhas
- Só Rápido Cuiabá, 17 linhas, **9 dias (10 a 18/11)**, incluindo sábado 14/11 e domingo/feriado 15/11
- Cabeçalho: Empresa, Data, Linha, Atendimento, Posição, Veículo, Sentido, Ponto Início, Prev. Início, Real. Início, Status, Dif., Ponto Fim, Prev. Fim, Real. Fim, Dif., Status, Tempo Prev., Tempo Real., Dif., Motorista, Cobrador, Motivo, Viagem Extra
  - `Dif.` aparece 3x e `Status` 2x (início/fim) → mapear por posição ou pela primeira ocorrência
- Mapeamento → `RawTrip`
  - date ← `Data` (dd/mm/aaaa)
  - lineCode ← `Linha` antes de " - " (ex.: "206 - TERM CPA 1 x CENTRO")
  - direction ← `Sentido` (só IDA/VOLTA; circular tem que vir do cadastro nyx)
  - departureTime/Hour ← `Real. Início` (HH:MM)
  - cycleMinutes ← `Tempo Real.` (minutos inteiros; bate com Real. Fim − Real. Início em ~99% das linhas, já trata a virada da meia-noite)
  - vehicle ← `Veículo`; driver ← `Motorista` (`Cobrador` sempre vazio)
  - edited ← não se aplica: viagem com ponto inicial/final diferente do mais frequente do dia, ou com `Motivo` preenchido, é **descartada** (ver regras abaixo)
- Observado
  - 1.885 linhas sem `Tempo Real.`: viagens não realizadas, 498 delas com início e sem fim → descartar
  - `Tempo Real.` mín 1, p1 9, mediana 47, p99 89, máx 118 → há ciclos curtos espúrios (provável falha de GPS)
  - `Motivo` preenchido em só 18 linhas: "#03 - FEZ 50pp TRAJETO", "704 - ITINERARIO", "#01 - GPS INOPERANTE", "#02 - GPS COM FALHA"
  - `Viagem Extra` sempre "Não"
  - Códigos de linha alfanuméricos: 031, 206, 206B, A06, A06B, A07, A08, A10, A15, A20, ...
  - É o mesmo dado do BI (FT_ViagensBI) exportado → **o mesmo mapeamento serve para arquivo e BI**

## Problemas no parser atual
- Lê com `readAsText(file, 'latin1')`: no arquivo Cittati estraga os acentos e põe o BOM no nome da 1ª coluna, então a detecção falha → detectar o BOM ou tentar UTF-8 estrito e cair para latin1
- `String(Number(raw))` no código da linha: "031" vira "31", e códigos como "A06" e "206B" não seguem a mesma regra → confirmar como estão cadastrados no nyx e só tirar os zeros à esquerda
- `sampleDate` = 1ª viagem: no arquivo Cittati a 1ª linha é de sábado (14/11), então a tela sugeriria o DayType Sábado para um arquivo quase todo de dias úteis

## Regras de dados sugeridas (Cittati)
- Considerar só viagens com `Tempo Real.` > 0
- **Edição na Cittati**: não se cria nem se altera viagem; a única interação é trocar o ponto inicial e/ou final (ex.: veículo não completou a linha → o ponto final vira o último ponto atendido). Viagem com ponto trocado = `edited`
  - O arquivo (e o BI: `nomePontoTP`/`nomePontoTS`) só traz o ponto efetivo, não o planejado → a referência é o ponto mais frequente de cada **(data, linha, sentido)**
  - Agrupar por data, não só por linha+sentido: a A07 trocou o nome do terminal no cadastro ("T CPA 1" em 10–11/11, "TERMINAL CPA I" a partir de 12/11); por linha+sentido isso marcaria 48 viagens como editadas sem que tivessem sido
  - Resultado na amostra: 53 viagens realizadas com ponto trocado (~0,7%), concentradas em 10–12/11 e 14–15/11 (fase de implantação), quase todas com ciclo bem abaixo do previsto. O ciclo de 1 min (206 IDA 12/11 22:54, fim em "R.OBIDOS") e o de 5 min (309 IDA 11/11 19:52, início em "DROGARIA ESTER") estão entre elas
  - Caso a observar: 309 VOLTA com fim em "PN204355385" se repete 12x em 10–12/11 com ciclos próximos do previsto → pode ser uma variante legítima, não edição
- **Sem piso fixo ou percentual de ciclo**: as linhas alimentadoras curtas têm ciclo real legítimo de 7–14 min (A07, A15 VOLTA com 8 de 26 previstos, A20, A08); um piso cortaria viagens válidas. O filtro de ciclo espúrio passa a ser o flag de edição
- `Motivo`: só 18 linhas preenchidas ("FEZ 50pp TRAJETO", "ITINERARIO", "GPS INOPERANTE/COM FALHA"); tratar como `edited` também
- **Decisão: viagem editada é descartada** (não só marcada) — distorce muito o ciclo. Mostrar na tela quantas foram descartadas e por quê
- Empate no ponto mais frequente (linha com poucas viagens no dia, ex.: 031 com ~5/sentido) → não marcar ninguém como editada
- **Referência pelo cadastro nyx não compensa** (conferido no banco em 2026-11-20): os pontos terminais existem em `TransitRoute.originLocality/destinationLocality`, mas com outros códigos/nomes (nyx "Est Bispo A" / B1014-001 × Cittati "PN204353598"; "Term Cpa 1 - A" × "TERMINAL CPA I")
  - A coluna `Atendimento` do arquivo parece com o nome da origem no nyx ("Res Picolli", "Altos da Gloria 2"), mas não bate sempre (A07: Atendimento "Term Cpa 3"/"Est Bispo", nyx Term Cpa 1 / S Dourada) e não muda quando o ponto é editado → não serve
  - Daria para mapear o nome Cittati em `TransitLocality.externalCodes` (`{ CITTATI }`, já existe para GLOBUS), mas são ~70 nomes e quebra quando a Cittati renomeia ponto (caso A07); o ponto mais frequente do dia se adapta sozinho
- `Viagem Extra` = "Sim": marcar ou excluir (decidir quando aparecer)
- No BI: viagemRealizada='Sim', tempoViagemRealizado > 0, excluir problemaHardware=1

## Arquitetura proposta
1. **Adapters de layout (fase 1, já viável)**
   - Cada layout (`sonda`, `cittati`) tem `detect(header)` e `parse(rows) → RawTrip[]`; depois um agrupamento comum gera o `CsvData` (talvez renomear para TripData), e a tela não muda
   - Detecção: Sonda = `Trajeto` + `Partida Real` + `Tempo Viagem`; Cittati = `Sentido` + `Real. Início` + `Tempo Real.`
   - Se nenhum layout bater: erro claro listando as colunas esperadas
2. **Fonte BI (fase 2)**
   - Seletor de fonte na tela: "Arquivo" | "Cittati BI"
   - Backend NestJS faz a consulta (as credenciais ficam só no servidor, sem CORS): query builder + decoder DSR + checagem de schema
   - Endpoint tipo `GET /api/transit/.../trips?from&to&company&lines` devolve `RawTrip[]` já normalizado; o front reaproveita o agrupamento
   - Filtros: período (limite ~31 dias), empresa (padrão Rápido; BI tem as 6 operadoras), linhas ou grupo de linhas vindos do nyx (GrupoLinha do BI está vazio)
   - "Endpoints predefinidos": hoje só existe essa fonte → lista fixa no código, sem cadastro de fontes
   - Volume: ~1,2 mil viagens/dia na Rápido, ~4,6 mil realizadas/dia com todas as empresas; paginação com RT (a página seguinte repete a última linha → remover a duplicata), ~1 s por dia consultado → um mês leva dezenas de segundos: mostrar progresso; cache por dia no backend (dado D-1, não muda)
3. **Filtro de tipo de dia (fase 3, ou junto da fase 1)**: é o item Alto acima
   - Filtrar pelas datas que casam com `pattern.days` do DayType do nyx, não pelo `nomeTipoDia` do BI (inconsistente: 16/11, segunda, tem 71 viagens marcadas como 'Domingo')
   - Sugerir o DayType predominante no período, não o da 1ª data
   - Feriados contaminam a amostra (15/11 caiu em domingo; 20/11 Consciência Negra) → pelo menos permitir excluir datas, se o nyx não tiver calendário de feriados
   - Ganho: vários dias dão clusters por hora mais estáveis do que o arquivo de um dia só da Sonda

## Riscos
- O endpoint do viewer do BI não é documentado e pode mudar → manter o upload de arquivo como plano B, isolar o cliente, e falhar com erro claro em vez de carregar dados errados
- Dados do BI começam em 03/11/2026 e só ficam confiáveis a partir de ~meados de novembro; refresh diário às 02:00 (D-1)

## Pendente para decidir
- ~~Códigos de linha~~: conferido no banco — o nyx guarda igual ao arquivo ("031", "206B", "A06"...); o adapter Cittati só faz trim, sem `Number()`. As 17 linhas do arquivo existem no nyx, com rotas OUTBOUND/INBOUND (206B só OUTBOUND)
