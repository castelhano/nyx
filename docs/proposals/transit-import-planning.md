# Importação de Programação de Veículos — Análise e Plano

**Arquivo referência:** `progVparUTIL.txt` (exportação do ERP de escala de veículos)  
**Script de referência:** `docs/proposals/process_file.js`  
**Schema alvo:** `apps/api/prisma/schema/transit.prisma`

---

## 1. Formato do Arquivo

Delimitado por `;`, dois formatos possíveis:

| Cols | Formato |
|------|---------|
| 21 | Planejamento puro (sem escala de veículo/motorista) |
| 27–28 | Planejamento + escala (com veículo e motorista atribuídos) |

O script original (`process_file.js`) valida `row_size` entre 27 e 29 — ou seja, **o arquivo de 21 colunas NÃO é compatível com o script original**. Para o Nyx, importar primeiro o formato de 21 colunas (planejamento) é suficiente para popular `TransitTrip`, `VehicleBlock` e `BlockTrip`.

---

## 2. Mapeamento de Colunas

| Col | Campo | Notas |
|-----|-------|-------|
| `0` | Código da linha (`TransitLine.code`) | Ex: `105`, `308B`, `A14` |
| `1` | Sempre `1` | Provavelmente versão/flag fixo — ignorar |
| `2` | Código ERP interno | Ex: `105U01`. Pode ser vazio (`308B` não tem). Ignorar ou salvar em `notes` |
| `3` | Sempre vazio no arquivo de planejamento | Ignorar |
| `4` | Tab / peça de trabalho | Ex: `01A`, `01B`, `02A`. Primeiro tab do bloco = `01A`. Cada letra indica uma peça do mesmo bloco de veículo |
| `5` | Localidade de origem da viagem (`TransitLocality.code`) | Vazio = terminal padrão da direção |
| `6` | Localidade de destino da viagem | Vazio = terminal padrão da direção |
| `7` | Sequência dentro do tab (1, 2, 3…) | Usado só para ordenação interna |
| `8` | Tipo de entrada (**ver seção 3**) | `''`, `2`, `3`, `11` |
| `9` | Flag produtiva | `1` = viagem com passageiros / `0` = movimento vazio |
| `10` | Direção | `I` = INBOUND / `V` = OUTBOUND (mapa → `RouteDirection`) |
| `11` | Horário de partida `HHMM` | Ex: `0625` |
| `12` | Horário de chegada `HHMM` | Ex: `0748`. O script original subtrai 1 min na chegada (col 12 −1 min) — **verificar se o Nyx deve fazer o mesmo** |
| `13` | Dia operacional de partida | `1` = dia corrente, `2` = após meia-noite |
| `14` | Dia operacional de chegada | `1` = dia corrente, `2` = após meia-noite |
| `15–18` | Sempre vazios no arquivo de planejamento | Ignorar |
| `19` | Tipo/tamanho de veículo (valor decimal) | Ex: `14`, `25.5`, `81.5`. **Precisa de tabela de mapeamento** para `VehicleType` enum — ver seção 5 |
| `20` | Sempre `0` no arquivo analisado | Ignorar |
| `21` | (último col) | Sem conteúdo — artefato do split |
| `22` | Número/prefixo do veículo escalado | Só no formato 27–28 cols. Usado pelo `process_file.js` como `prefixo` |
| `23` | Código do motorista | Só no formato 27–28 cols |

---

## 3. Col 8 — Tipo de Entrada

| Valor | col 9 | Significado | Ação no import |
|-------|-------|-------------|----------------|
| `''` (vazio) | `1` | Viagem produtiva normal | `BlockTrip.isDeadhead = false` |
| `''` (vazio) | `0` | Deadhead de reposicionamento entre produtivas (dentro do tab) | `isDeadhead = true` |
| `11` | `0` | Deadhead de ponto de relevo / troca de tripulação | `isDeadhead = true` |
| `2` | `0` | Fim do tab atual → transição para próximo (ex: `01A` → `01B`) | Ignorar — é um marcador de limite de tab, duração zero |
| `3` | `0` | Fim absoluto do bloco (veículo retorna à garagem) | Ignorar ou registrar como deadrun final |

**Regra geral:** processar apenas `col 8 ≠ '2'` E `col 8 ≠ '3'` como `BlockTrip`. Os marcadores `2` e `3` delimitam a estrutura de tabs mas não representam viagens.

---

## 4. Cols 13 e 14 — Dia Operacional (Travessia de Meia-Noite)

**Descoberta crítica:** as colunas indicam em qual "dia operacional" ocorre a partida e chegada.

```
col 13 = 1, col 14 = 1  →  partida e chegada no mesmo dia         (minutos < 1440)
col 13 = 1, col 14 = 2  →  viagem cruza meia-noite                (arrivalMinutes > 1440)
col 13 = 2, col 14 = 2  →  ambas após meia-noite do dia anterior  (departure e arrival > 1440)
```

**Conversão para o schema:**
```ts
departureMinutes = parseHHMM(row[11]) + (Number(row[13]) - 1) * 1440
arrivalMinutes   = parseHHMM(row[12]) + (Number(row[14]) - 1) * 1440
```

Isso está alinhado com o comentário no schema:
```prisma
// values > 1440 indicate overnight trips
departureMinutes Int
arrivalMinutes   Int
```

Exemplos confirmados no arquivo: linhas `302`, `203`, `308`, `410`, `800` com viagens partindo ~23:xx e chegando ~00:xx.

---

## 5. Col 19 — Tipo de Veículo

Os valores encontrados no arquivo são **decimais** (ex: `3`, `6`, `14`, `15.5`, `25.5`, `81.5`). Não são diretamente o enum `VehicleType` do schema (que tem `BUS`, `ARTICULATED`, `BI_ARTICULATED`, `MICRO_BUS`, `MINIBUS`, `VAN`).

Valores observados:
```
3, 6, 13, 13.5, 14, 15, 15.5, 17.5, 19.5, 20.5, 22.5, 23, 24,
25.5, 29.5, 31, 33, 39, 41.5, 43, 47, 49, 58.5, 65.5, 81.5, 84.5
```

**Hipótese mais provável:** capacidade de passageiros sentados (ou métrica derivada do ERP). Valores menores (~3–6) correspondem a linhas rurais pequenas; valores maiores (~81.5) a linhas urbanas com ônibus articulados.

**Dúvida em aberto:** qual tabela de mapeamento usar? Ex:
```
≤ 10  → VAN / MINIBUS
≤ 20  → MICRO_BUS
≤ 50  → BUS
≤ 70  → BUS (frota específica?)
> 70  → ARTICULATED
```

**A confirmar com o usuário antes de implementar.**

---

## 6. Estrutura de Tabs e Blocos

```
Bloco de veículo = conjunto de tabs com mesmo identificador de bloco
  Tab 01A → Tab 01B → Tab 01C ...   (mesmo veículo, peças de trabalho consecutivas)
  Tab 02A → Tab 02B ...             (bloco diferente, mesmo veículo no dia)
```

- Cada tab começa com sequência `1` e termina com `col 8 = '2'` (transição) ou `col 8 = '3'` (fim do bloco).
- A troca de tab pode ter uma lacuna de tempo (pausa do veículo) ou ser imediata.
- Dentro de um tab, `col 13/14` vai de `1;1` → `2;2` → `3;3` à medida que trocas de tripulação ocorrem. Isso representa o número do segmento de jornada do motorista dentro do tab.

---

## 7. Interoperação entre Linhas (Cross-Line)

Blocos podem conter viagens de **mais de uma linha** no mesmo tab. Exemplo no arquivo: linha `308` tem deadheads até o ponto `BISPO`, e a linha `308B` (código diferente) parte exatamente de `BISPO`. O veículo opera ambas as linhas sequencialmente.

`308B` **não tem col 2 preenchido** (sem código ERP). O parser deve aceitar código de linha como string simples, sem derivar nada do código.

---

## 8. Schema — Lacunas Identificadas

### 8.1 `VehiclePlan` sem campo de data
O modelo atual:
```prisma
model VehiclePlan {
  dayTypeId String  // vínculo com DayType (dia útil, sábado, domingo...)
  // sem campo de data concreta
}
```
O arquivo de programação representa um dia de operação específico. Para importação histórica ou planejamento com data definida, pode ser necessário adicionar:
```prisma
validDate DateTime?  // data concreta da programação (opcional — deixa NULL para programações genéricas)
```
**Decisão pendente:** importar como programação genérica por `DayType` (sem data) ou adicionar `validDate`.

### 8.2 `BlockTrip` sem `driverId`
O formato de 27–28 colunas inclui código do motorista (`col 23`). O modelo atual não tem campo de motorista em `BlockTrip`. Se a importação do arquivo completo (com escala) for necessária futuramente, será preciso adicionar:
```prisma
driverId String?
driver   Employee? @relation(...)
```
**Não urgente** para a importação de planejamento (21 colunas).

### 8.3 `VehicleBlock.blockNumber` é `Int`
O identificador do bloco no arquivo é composto: `row[4]` = `01A`, `01B`, `02A`... A parte numérica (`01`, `02`) mapearia para `blockNumber`, e a letra (`A`, `B`, `C`) identifica o tab dentro do bloco.

**Dúvida:** salvar `blockNumber = 1` e ignorar a letra (o tab é implícito pela sequência de `BlockTrip`), ou adicionar um campo `tabLetter String?` no `VehicleBlock`?

---

## 9. Estratégia de Importação Proposta

### Pré-requisitos no banco
Antes de importar o arquivo de programação, devem existir:
1. `TransitLine` — uma por código de linha encontrado no arquivo
2. `TransitRoute` — ao menos uma por linha (OUTBOUND e INBOUND), com `originLocalityId` e `destinationLocalityId`
3. `TransitLocality` — todos os pontos encontrados nos cols 5 e 6 do arquivo
4. `DayType` — pelo menos um registro para vincular o `VehiclePlan`

### Fluxo do parser
```
Para cada linha do arquivo:
  1. Agrupar por col[0] (código de linha) + col[4] (tab)
  2. Filtrar col[8] ≠ '2' e col[8] ≠ '3'
  3. Calcular departureMinutes e arrivalMinutes com ajuste de dia (cols 13/14)
  4. Identificar col[10] (I/V) → RouteDirection → buscar TransitRoute
  5. Criar/reusar TransitTrip por (routeId, departureMinutes, arrivalMinutes)
  6. Agrupar tabs em VehicleBlock por (col[0], número do tab sem letra)
  7. Criar BlockTrip com sequence, isDeadhead (col[9] = '0'), vehicleBlockId, tripId
```

### Ordem de criação no banco
```
VehiclePlan → VehiclePlanLine (por linha) → VehicleBlock → BlockTrip
TransitTrip (upsert por rota+horários)
```

---

## 10. Dúvidas Abertas (A Confirmar)

| # | Pergunta | Impacto |
|---|----------|---------|
| 1 | O `arrivalMinutes` deve ser `HHMM − 1 min` como faz o script original? | Consistência com dados existentes |
| 2 | Col 19 → `VehicleType`: qual tabela de mapeamento usar? | Necessário para criar `VehicleBlock` |
| 3 | Adicionar `validDate DateTime?` em `VehiclePlan`? | Migrações de schema |
| 4 | Salvar `tabLetter` no `VehicleBlock` ou apenas `blockNumber`? | Rastreabilidade do tab |
| 5 | Importar deadheads (`isDeadhead = true`) como `BlockTrip` ou apenas as viagens produtivas? | Volume de dados e utilidade operacional |
| 6 | `TransitTrip` deve ser criado com `upsert` (reutilizando viagens de mesma rota+horário de outros blocos) ou sempre novo registro? | Integridade referencial entre blocos |
| 7 | O formato de 27–28 cols (com motorista/veículo) será importado também? Se sim, quando? | Escopo do import |

---

## 11. Arquivos Relevantes

| Arquivo | Propósito |
|---------|-----------|
| `apps/api/prisma/schema/transit.prisma` | Schema alvo completo |
| `apps/api/prisma/schema/fleet.prisma` | Enum `VehicleType` |
| `docs/proposals/process_file.js` | Script JS de referência do ERP (apenas produtivas, 27–28 cols) |
| `docs/proposals/transit-import-planning.md` | Este documento |
