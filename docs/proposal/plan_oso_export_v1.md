# Proposta — Exportador de OSO (xlsx + pdf) a partir do VehiclePlan

Objetivo: gerar a Ordem de Serviço Operacional (OSO) — documento oficial exigido pelo órgão
gestor (hoje montado manualmente em Excel, uma aba por linha) — diretamente a partir dos dados
do `VehiclePlan`, em dois formatos: `.xlsx` (fiel ao layout hoje usado, com logo/assinatura) e
`.pdf` (uma linha, um grupo de linhas ou um scope inteiro, gerando um único arquivo com todas as
linhas selecionadas).

Referência real analisada (arquivo do usuário, fora do repo):
`/home/rafael/Documentos/Planejamento/Controles/Tabelas/Oficial/OSOs_U.xlsx` — 57 abas (uma por
linha/família), inspecionadas via ExcelJS para extrair merges, fórmulas, `printArea` e posição da
logo. 4 exemplos de layout impresso (PDF) foram conferidos: `A07` (simples), `206`/`206B`
(múltiplos carros, duas bandas empilhadas), `309` (round-trip com ponto intermediário), `311`
(ida/volta/chegada).

---

## O que já existe

| Peça | Onde | Estado |
|---|---|---|
| `TransitLine.parentLineId` | `transit.prisma:80-131` | Já modela família de linhas (206B filha de 206) — candidato natural para agrupar sub-linhas no RESUMO da OSO |
| `TransitLine.metrics.extensionKm` | `line.schema.ts:92-97` | Já guarda extensão por sentido (OUTBOUND/INBOUND/CIRCULAR) — mapeia direto pro "Extensão Útil (km)" do rodapé, não precisa de campo novo |
| `TransitRoute` / `RouteLocality` | `transit.prisma:137-208` | Topologia da rota (paradas reais + waypoints, pernas com `deltaMinutes`/`deltaKm`) — é o dado que permite inferir se uma linha tem "ponto intermediário" (caso 309/311) |
| `VehicleBlock` / `BlockTrip` / `BlockDeadrun` / `BlockInterval` | `transit.prisma:505-597` | Dado bruto do plano — carros, viagens, recolhidas (RECO), intervalos (INTERV). Mesma estrutura que o Gantt (`useGanttEditor.ts`) já percorre |
| `VehicleBlock.branchId` | `transit.prisma:508` | Operadora do carro — mapeia pra linha "E" de cada grupo de coluna na planilha legada |
| `Settings` (model + padrão) | `core.prisma:156`, `transit-general-config.service.ts` | Padrão de singleton por `key`/`scope` já usado (`TransitGeneralConfigService`) — reaproveitável pra config fixa de assinatura/logo da OSO |
| `vehicle-plan-import.*` | `apps/api/src/modules/transit/timetabling/vehicle-plan/` | Par natural pro novo módulo de export — mesmo diretório, convenção de nomes |
| `exceljs@4.4.0` | `apps/api/package.json:36` | Já instalado — cobre estilo de célula, merge, largura de coluna e imagem (logo) nativamente |

---


## Arquitetura proposta (pipeline em camadas)

```
1. oso-assembler.ts        — VehiclePlan + lineId(s) → view model bruto (carros × eventos)
2. oso-layout.resolver.ts  — decide o "shape" de colunas por linha (override ou inferência)
3. oso-banding.ts          — empilha carros em bandas de até 10 por página
4. oso-summary.ts          — recalcula em TS os agregados hoje feitos em fórmula Excel
5. oso-observations.ts     — texto do quadro "OBSERVAÇÃO" (v1: só manual; futuro: + inferido)
6. oso-workbook.renderer.ts — única camada que toca exceljs (chassi comum + banda por shape)
7. transit-oso-config       — settings singleton (assinaturas, logo, nome do órgão)
8. vehicle-plan-export.*    — controller/service: xlsx (1 ou N sheets) e pdf (via LibreOffice)
```

Camadas 1-5 são funções puras, testáveis sem abrir Excel. A costura que evita duplicar renderer
por variação de layout é o `OsoLayout.columns` resolvido na camada 2 — a camada 6 itera sobre ele
genericamente, nunca hardcoda "3 colunas" ou "4 colunas".

```ts
type OsoLayout = {
  columns: Array<{ role: 'DEP' | 'ARR'; localityRef: 'origin' | 'dest' }>
  tripsPerRow: 1 | 2   // 1 = IDA|VOLTA|CHEGADA (padrão), 2 = IDA|VOLTA|IDA|VOLTA (linhas densas)
}
```

> No caso da 309 (referencia intermediaria) a linha pode ter N locais de passagem mais nem todos vão para OSO, precisa definir abordagem para o gerador saber quais locais devem ser incluidos na OSO, o ajuste que vem a minha cabeça num primeiro momento eh adicionar campo em RouteLocality similar ao allowsCrewChange (algo como displayOnOSO) (oso eh abbr de order de serviço, esrou misturando ingles com portugues se tiver nome melhor me sugira), se true lista no sentido, acho que da claresa e controle assim, se tiver outra ideia quero ouvir


### `TransitLine.osoLayout` (campo novo)

Enum opcional em `packages/schemas/transit/line.schema.ts` + Prisma — só relevante numa linha sem
`parentLineId` (filhas herdam da pai). `null`/ausente = infere pela topologia da rota.

```
osoLayout: 'IDA_VOLTA_CHEGADA' | 'IDA_VOLTA_IDA_VOLTA' | null
```
> valores do enum (pelos menos os persistidos) em ingles para manter coerencia com demais
> Mais estou pensando que talvez esse layout seja todo inferido: esse caso do "IDA_VOLTA_IDA_VOLTA" pode ser inferido olhando para quantidade de viagens máximas nos carros (qual carro tem a maior quantidade de viagens) e a quantidade de carros do plano.. se layout padrao entregar em torno de 20 linhas, e um dos carros tem 30 viagens (mais somente 2 carros na linha) gerador "escolhe" o layout IDA_VOLTA_IDA_VOLTA.. não existe um motivo para querer forçar um layout em detrimento do outro, esse escolha eh feita pensando em qual layout melhor organiza o plano em uma unica folha (nao tem um certo ou errado aqui).. estou achando que aqui será sempre inferido pelo gerador, me de sua opnião

### PDF — via LibreOffice headless, não renderer próprio

Decisão já tomada na conversa: converter o xlsx gerado (1 sheet por linha selecionada, cada sheet
com `printArea`/`orientation` corretos) via `soffice --headless --convert-to pdf`, em vez de
construir um segundo renderer PDF-nativo. Cada sheet do workbook vira página(s) do PDF final, na
ordem do workbook — "um PDF com N linhas" sai de graça de um `xlsx` multi-sheet.

Implicações de infra:
- Dependência de **binário de sistema** (LibreOffice), não pacote npm — precisa entrar na imagem
  de deploy da API.
- Rodar `soffice` concorrente pode conflitar por profile lock — mitigar com
  `-env:UserInstallation=file:///tmp/lo-<uuid>` por chamada, ou serializar conversões numa fila.
- Wrapper npm opcional (`libreoffice-convert`) só empacota o `child_process.spawn`, se quiser
  evitar lidar com isso na mão — o binário continua sendo a dependência real.

---

## Ordem de implementação sugerida

**Fase 0 — Fundamentos de dados (sem UI, sem Excel)**
- `TransitLine.osoLayout` (schema + migration)
- `transit-oso-config` settings (assinatura, logo, nome do órgão)
- `oso-assembler.ts` — view model bruto, com fixture de um caso real simples (tipo A07)
- `oso-summary.ts` — validar números calculados contra a planilha legada da mesma linha

**Fase 1 — Layout resolver + banding (ainda sem exceljs)**
- `oso-layout.resolver.ts` só com override manual (`osoLayout` explícito) — adiar inferência
  automática pra depois de mais casos observados
- `oso-banding.ts`
- Validar o view model completo (camadas 1-5) contra 1-2 linhas reais

**Fase 2 — Renderer xlsx (chassi + shape padrão)**
- `oso-workbook.renderer.ts`: chassi (cabeçalho, logo, RESUMO, assinaturas) + banda pro shape
  `IDA_VOLTA_CHEGADA`
- Endpoint `.xlsx` pra 1 linha
- Comparação visual lado a lado com o exemplo real

**Fase 3 — Multi-linha/scope + PDF**
- Endpoint aceita lista de `lineId` ou `scopeId`
- Workbook com N sheets
- Conversão pra PDF via LibreOffice (infra: instalar `soffice`, testar concorrência)

**Fase 4 — Segundo shape (`IDA_VOLTA_IDA_VOLTA`) + inferência automática**
- Packing de 2 ciclos por linha de tabela
- Heurística de inferência de shape pela topologia da rota (quando `osoLayout` não setado)

**Fase 5 (depende de outra implementação em andamento) — Observações estruturadas**
- Aguarda o modelo de notas por viagem/bloco (mencionado como próximos dias)
- `oso-observations.ts` ganha a parte automática (ex.: viagens reservadas)

---

## Dúvidas e pendências para construir o layout

1. **Cálculo de "CHEGADA"** no shape padrão (3 colunas) — é o `arrivalMinutes` da perna de volta
   do mesmo ciclo (par ida+volta do mesmo carro), certo? Waypoints da rota (`RouteLocality` com
   `localityId` null) não interferem na rotulagem de coluna, só na geometria/tempo de perna?

> RESPOSTA: Sim, chegada eh o arrivalMinutes da volta

2. **Packing do shape `IDA_VOLTA_IDA_VOLTA`** — dado um carro com N viagens no dia, o
   agrupamento em pares por linha da tabela é sequencial (viagem 1+2 na linha 1, 3+4 na linha 2...)
   ou pareia por "meia-jornada" (ex.: manhã+noite, como parecia ser o caso no formato antigo da
   A07 com 2 pares bem espaçados no dia)?

> RESPOSTA: Se a duvida seria com a aba oculta "A07_A10" isso eh um layout experimental (obsoleto) juntando duas linhas, apenas desconsiderar. No layout IDA_VOLTA_IDA_VOLTA as viagens segue normalmente a sequencia IDA_VOLTA (duas primeiras colunas) e se "abre" as novas colunas se faltou espaço (linhas), não sei se ficou claro

3. **Linha sem ponto intermediário e sem override** — quando a topologia não sugere 3 nem 4
   colunas (ida/volta simples, sem leg extra), a inferência cai pra 2 colunas (IDA|VOLTA, sem
   CHEGADA) ou o padrão é sempre repetir o horário de volta na coluna CHEGADA mesmo sem leg
   extra? Preciso de uma regra fechada pra não sobrar um "shape não documentado".

> RESPOSTA: Na seção de osoLayout eu destaco uma questão que pode (talvez) suprimir este campo, por padrão quero usar o layout de IDA_VOLTA_CHEGADA


4. **Numeração dos carros ("1º", "2º"...)** — é a ordem de `blockNumber` do plano, ou existe
   renumeração por linha quando um mesmo bloco atende mais de uma linha da família (ex.: um carro
   roda trips de 206 e de 206B — ele conta como "carro 1" nas duas OSOs, ou é reindexado por
   linha)?

> RESPOSTA: ordem sequencial dos carros, não tem relação direta com o numero do bloco, organiza carros pelo inicio (primeira viagem) 1o carro eh o que inicia primeiro

5. **RECO/INTERV na grade** — mapeiam direto pra `BlockDeadrun.type = 'RETURN'` (RECO) e
   `BlockInterval` (INTERV)? Existe algum caso de `DeadrunType.ACCESS`/`DISPLACEMENT` que também
   deveria aparecer textualmente nessas colunas, ou fica de fora por não ser imprimível ali?

> RESPOSTA: sim, horarios de recolhida e intervalo no carro, acesso não aparece na OSO, inicia da primeira viagem produtiva, DISPLACEMENT tbm não aparece aqui


6. **Carro que atende mais de uma linha da família** — a OSO da linha "206" deve listar, para
   esse carro, só os trechos que pertencem à 206 (filtrando trips de outras linhas do mesmo
   bloco), ou a linha inteira do carro aparece (incluindo trechos de linhas fora da família)?

> RESPOSTA: listar apenas viagem da linha, se tem viagens de aproveitamento de outra linha não aparece aqui


7. **Extensão Ociosa (km)** — no arquivo legado aparece ao lado da Extensão Útil, mas
   `TransitLine.metrics.extensionKm` só cobre a útil. Ociosa vem de soma de deslocamento morto
   (`BlockDeadrun`, via `TravelTimeMatrix` origem↔destino) calculado no momento do export, ou é
   outro dado manual como a útil?

> RESPOSTA: Hoje é feito a soma das duas pernas GARAGEM -> PONTO INICIAL + PONTO INICIAL -> GARAGEM, porém alguns detalhes entram aqui, tem linhas (308 eh um exemplo) em que parte dos carros inicia no sentido IDA e parte no VOLTA, mesma ideia para as recolhidas, como estamos informatizando queria ja fazer da forma correta, somar todos os acessos e recolhidas (km) e gerar uma média

8. **"Tempo de Viagem (minutos)"** — no legado aparece como texto concatenado tipo `126' 120'
   114'` (múltiplos valores). É a duração planejada por sentido/rota da linha (ex.: um valor por
   `TransitRoute` ativa), ou outra unidade de agrupamento?

> RESPOSTA: São os tempos de ciclo verificados na linha (ida + volta) em geral colocamos apenas os ciclos mais comuns (que mais se repetem) e os que mais apresentam variação, não costumo listar todos, seria proximo do que temos nas janelas de geração do modal (ciclo ida + intervalo ida + ciclo volta + intervalo volta) usados para calcular a frequencia


9. **Config de assinatura (`transit-oso-config`)** — singleton global (uma prefeitura só) ou por
   `Scope` (múltiplos municípios/projetos no mesmo Nyx)? Decide se a chave do `Settings` é
   `scope: 'global'` fixo ou parametrizada por `scopeId`.

> RESPOSTA: interessante ja configurar isso no scope, adicionar um json no modelo que vai armazenar estes dados, me diga o que acha



10. **"OSO Nº" / "AUTORIZAÇÃO Nº" / ano** — no legado, esses campos apareciam em branco ou
    preenchidos manualmente na maioria das abas conferidas. Ficam de fora do v1 (usuário
    completa à mão após exportar/imprimir), ou existe algum campo (`LineSchedule.approvalRef`?)
    que já deveria alimentar isso automaticamente?

> RESPOSTA: numero é gerado pelo orgão gestor, deixar sempre em branco


11. **Ordem das linhas no PDF multi-linha** — segue a ordem de seleção do usuário na UI, ordena
    por código da linha, ou segue alguma hierarquia de `Scope`/`LineGroup`?

> RESPOSTA: ordem EMPRESA (operadora) > code da linha

12. **Enum `osoLayout`** — fico só com os dois valores discutidos (`IDA_VOLTA_CHEGADA`,
    `IDA_VOLTA_IDA_VOLTA`), ou você já tem em mente outras variações de forma (mais colunas, mais
    pontos) que ainda não apareceram nos 4 exemplos?
