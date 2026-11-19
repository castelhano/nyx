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
  - edited ← não existe; o mais próximo é `Motivo` preenchido
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
- Piso para ciclo espúrio: descartar abaixo de X% do `Tempo Prev.` (ex.: 40%) ou abaixo de um mínimo fixo
- Excluir viagens com `Motivo` "FEZ 50pp TRAJETO" e "ITINERARIO"; marcar `Motivo` preenchido como `edited`, para a interface continuar igual
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
- Como os códigos 031, A06 e 206B estão cadastrados no nyx
- Critério final de piso de ciclo e de exclusão por `Motivo`
- Equivalente de "editada" com a Cittati (confirmar com eles o significado de justificaViagem/justificadoInicio e `Motivo`)
