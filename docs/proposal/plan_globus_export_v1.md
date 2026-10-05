# Proposta — Exportação do planejamento para sistemas externos (v1: Globus)

Gera, a partir de um `VehiclePlan`, o arquivo TXT posicional que o Globus importa como
**programação**. Substitui o script `flow/oso_export` (planilha → `engine.js` → `export.js`):
carros, viagens, intervalos, acessos e recolhidas vêm do plano, e as trocas de turno vêm da
escala (`CrewPlan`).

O fluxo é genérico. O Globus é um **perfil**, com layout, códigos e regras de nomeação próprias.
Um novo sistema (ex.: Transnet) entra como um valor novo no enum e um perfil novo. O
identificador "globus" só aparece no que é específico do formato de saída.

---

## 1. Fluxo de UI

1. Planejamento → dropdown **Linhas** → **Exportar Planejamento**. Só abre com linhas
   selecionadas no painel (toast como em "Versões") e sem edições pendentes no Gantt. Aceita
   plano em qualquer status.
2. Modal `PlanExportModal` com três abas. O visual segue o padrão do Nyx (mesmo esqueleto do
   `ExportOsoModal` + `components/ui/tabs.tsx`); o modal do script é só referência de conteúdo.
   - **Schema**: layout do sistema escolhido, com Campo · Pos · Tam · Máscara. Os campos
     disponíveis no sistema que não estão no layout aparecem esmaecidos.
   - **Exportar**:
     - aviso fixo: "a programação precisa existir no Globus antes da importação";
     - **Sistema**: select do enum (só `GLOBUS`);
     - **Escala**: escalas do plano, com a `ACTIVE` pré-selecionada. Sem escala, o modal
       bloqueia;
     - **Operador**: um por exportação, entre os operadores dos blocos das linhas
       selecionadas. Se houver blocos sem operador, um alerta informa que N carros não serão
       exportados;
     - **Programações**: uma por linha raiz selecionada, no formato linha → código (input,
       máx. 8). O código vem pré-preenchido com o `approvalRef` da `LineSchedule` pinada
       (`VehiclePlanLine.lineScheduleId`); sem ela, usa `${line.code}${dayType.code}`;
     - botão **Gerar Preview**.
   - **Preview**: só tem conteúdo depois do Gerar Preview. Mudar qualquer parâmetro da aba
     Exportar invalida o preview e pede confirmação se houver edições. O botão **Gerar**
     (`alt+g`) baixa `<plano>.txt` montado **exatamente** do preview, com as edições.

### Preview

- A estrutura é Programação → Carro → Tabela. Cada tabela mostra nome, período, início, fim,
  pegada, preparo e saída da garagem, e expande para mostrar as linhas.
- Os avisos aparecem junto da tabela ou linha afetada.
- As linhas que usaram fallback de código externo (§3.6) recebem uma marca discreta.
- **Editáveis**: nome da tabela (único na programação) e período; por linha, atividade, local
  (texto livre) e linha.
- **Não editáveis**: horários, tempos de acesso e recolhida, sentido, seq. Horário errado se
  corrige no plano.
- As edições vivem só enquanto o modal está aberto e não são persistidas.
- Valores inválidos (tamanho excedido, nome de tabela duplicado) bloqueiam o Gerar e são
  apontados no campo.

---

## 2. Formato Globus

### 2.1 Layout (62 caracteres, CRLF, ASCII)

| Campo | Pos | Tam | Pad | Máscara | Nível | Editável |
|---|---|---|---|---|---|---|
| COD_PROGRAMAÇÃO | 1 | 8 | ` ` L | | programação | — |
| SERVICO_TAB | 9 | 5 | ` ` L | | tabela | ✓ |
| TURNO | 14 | 1 | ` ` L | | tabela | ✓ |
| INICIO_SERVICO | 15 | 5 | ` ` L | HH:MM | tabela | |
| FIM_SERVICO | 20 | 5 | ` ` L | HH:MM | tabela | |
| COD_LOCAL_MOT | 25 | 6 | `0` R | | tabela | |
| PREPARO_MOT | 31 | 2 | `0` R | | tabela | |
| SAIDA_GAR | 33 | 5 | ` ` L | HH:MM | tabela | |
| SENTIDO | 38 | 1 | ` ` L | | linha | |
| COD_VIAGENS | 39 | 2 | `0` R | | linha | |
| HORARIO_SAIDA | 41 | 5 | ` ` L | HH:MM | linha | |
| HORARIO_CHEGADA | 46 | 5 | ` ` L | HH:MM | linha | |
| COD_ATIVIDADE | 51 | 2 | `0` R | | linha | ✓ |
| COD_LOCALIDADE | 53 | 6 | `0` R | | linha | ✓ |
| COD_LINHA | 59 | 4 | ` ` R | | linha | ✓ |

- Os campos de nível "tabela" se repetem em todas as linhas da tabela.
- Horários saem com `% 1440`; o Globus resolve a virada do dia pela ordem das linhas.
- Valor maior que o campo é **erro**, nunca truncamento (o script truncava em silêncio).
- Campos disponíveis no Globus e fora do layout, mostrados só na aba Schema: `COD_LOCAL_COB`,
  `PREPARO_COB`, `RETORNO_GAR`, `ENTREGA_FERIAS`, `DURACAO_ATIVIDADE`, `SUFIXO`,
  `TIPO_HORARIO`, `DUPLA_PEGADA`, `IDENTIFICADOR`, `SERV_RENDICAO`.

### 2.2 Amostra (saída real do script, `importacaoV6.xlsx`), referência byte a byte para os testes

```
410U07  01A  105:0013:490000510504:38I1005:0005:2101000020      ← 1ª viagem; SAIDA_GAR 04:38
410U07  01A  105:0013:490000510504:38V1105:2106:2001000061
410U07  01A  105:0013:490000510504:38I2213:4913:4907000007      ← intervalo
410U07  01C  215:3523:3200002005     I1015:3516:1701000020      ← pós-intervalo: letra C
410U07  01C  215:3523:3200002005     I2023:1023:3211000011      ← recolhe 23:10 → 23:32
410U07  02A  105:2011:310000510504:50I1005:2005:4501000057A22B  ← viagem de outra linha
410U07  02A  105:2011:310000510504:50I1811:3111:3110000010      ← TT
410U07  02B  211:3116:2300002005     I1011:3112:0701000020      ← pós-TT: letra B
```

---

## 3. Regras

### 3.1 Programações e trechos

- **Linhas**: as selecionadas no painel, normalizadas para a raiz. Uma filha selecionada vale
  como a pai. Cada raiz é uma programação e inclui as filhas (`parentLineId`).
- **Trecho**: para cada programação P e cada bloco B, o trecho vai da 1ª à última viagem da
  família de P em B.
  - Tudo o que está **dentro** do trecho entra: viagens de qualquer linha, deslocamentos e
    intervalos.
  - Tudo o que está **fora** é ignorado, inclusive deslocamentos para outra linha.
- **Disputa**: quando os trechos de duas programações se sobrepõem no mesmo bloco, fica com o
  bloco a programação com mais viagens nele. As viagens da perdedora dentro do trecho
  vencedor saem com `COD_LINHA`; as que ficam fora dele são descartadas, com aviso. Entre pai
  e filha não há disputa, porque são a mesma programação.
- Exemplos:
  - X 04–14 → intervalo → Y 15–22: com X e Y selecionadas, são dois carros, um em cada
    programação. Só com X selecionada, o trecho termina às 14:00.
  - X 04–22 com uma viagem Y às 08:00: a viagem Y entra na programação de X com
    `COD_LINHA` = Y. Os deslocamentos de ida e volta para ela também entram.

### 3.2 Carros e operador

- **Número do carro** = posição do bloco na OSO da linha raiz (ordem de `assembleOso`, pela 1ª
  viagem, todos os operadores juntos).
- O filtro de operador é aplicado **depois** da numeração. Se o operador faz os carros 1 e 3,
  o arquivo tem `01A` e `03A`, e o `02` fica sem uso.
- Blocos sem `branchId` nunca são exportados. O alerta da aba Exportar mostra quantos são.

### 3.3 Cortes de tabela

- **Intervalo**: todo `BlockInterval` dentro do trecho corta a tabela.
- **Troca de turno**: cada fronteira entre `DutyPiece`s consecutivas e não-stale da escala no
  bloco, no instante `t` = `startMinutes` da peça seguinte:

  | Onde cai `t` | Resultado |
  |---|---|
  | dentro de um `BlockInterval` | nada (o intervalo já corta) |
  | entre duas viagens (chegada ≤ t ≤ partida) | a tabela anterior termina na **chegada** e a seguinte começa na **partida** da próxima viagem |
  | no meio de uma viagem | a viagem é dividida em duas: a 1ª vai da partida até `t` (destino = `startLocality` da peça), a 2ª vai de `t` até a chegada (origem = `startLocality`). TT em `t` |
  | dentro de um deslocamento | corta antes do deslocamento, com aviso |

  O `DutyPiece` define só **onde** corta; os horários vêm das viagens.
- Peças stale são ignoradas, com aviso. Partes do bloco sem motorista não cortam a tabela,
  com aviso.

### 3.4 Linhas do arquivo (mapa de atividades)

| Situação | Ativ. | Local | SENTIDO | Saída → Chegada | Corta |
|---|---|---|---|---|---|
| Viagem do trecho | `01` | origem da viagem | da rota | partida → chegada | — |
| Intervalo (`BlockInterval`) | `07` | `07` | oposto da última viagem | chegada da última → a mesma | sim |
| Troca de turno (escala) | `10` | `10` | da próxima viagem | chegada da última (ou `t`) → a mesma | sim |
| Fim do trecho sem intervalo nem recolhida (segue para outra linha) | `10` | `10` | oposto da última viagem | chegada da última → a mesma | fim |
| Recolhida (`RETURN`) no fim do trecho | `11` | `11` | oposto da última viagem | chegada da última → chegada do `RETURN` | fim |
| Deslocamento (`DISPLACEMENT`) dentro do trecho | `98` | `98` | da próxima viagem | do deadrun | não |

- Sentido da rota: `OUTBOUND → I`, `INBOUND → V`, `CIRCULAR → C`. "Oposto" de `C` é `C`.
- `COD_LINHA` só é preenchido nas **viagens** cuja linha é diferente da linha raiz da
  programação, inclusive filhas e linhas da perdedora numa disputa. Fica em branco no
  deslocamento e nas linhas de encerramento.
- `COD_VIAGENS`: começa em 10 e reinicia a cada tabela. Conta todas as linhas da tabela,
  inclusive o deslocamento e o encerramento.

### 3.5 Cabeçalho da tabela

| Campo | Regra |
|---|---|
| SERVICO_TAB | `pad2(nº carro)` + letra. A 1ª tabela do carro é `A`; depois de TT, a próxima livre de `A B D E F`; depois de intervalo, a próxima livre de `C V X Z`. Se as letras acabarem, é erro |
| TURNO | início da tabela < 09:00 → `1`, senão `2` (minutos do dia operacional, sem módulo) |
| INICIO_SERVICO | partida da 1ª viagem. O preparo **não** é descontado; vai em campo próprio |
| FIM_SERVICO | horário de chegada da linha de encerramento |
| COD_LOCAL_MOT | trecho que começa com `ACCESS`: na 1ª tabela, a garagem (`block.depot`). Nos demais casos, a origem da 1ª viagem da tabela |
| PREPARO_MOT | `signOnMinutes` das configurações efetivas da escala (`CrewPlanService.resolveSettings`) |
| SAIDA_GAR | só na 1ª tabela de um trecho que começa com `ACCESS`: a partida do `ACCESS`. Nos demais casos, vazio |

### 3.6 Códigos externos

- `externalCodes Json?` em `TransitLocality` e `TransitLine`, no formato `{ GLOBUS?: string }`,
  com schema montado a partir do enum `EXTERNAL_SYSTEMS` e widget `object-editor`. Isso dá um
  campo por sistema, sem chave digitada à mão.
- Resolução: `externalCodes[system]`; em branco, usa `code`. O preview marca os casos de
  fallback.
- Hoje `TransitLocality.code` é igual ao código do Globus, então o fallback cobre tudo. O
  mapeamento existe para quando não for.

### 3.7 Erros e avisos

- **Erro (bloqueia o Gerar)**:
  - código maior que o campo: localidade > 6, linha > 4, programação > 8, tabela > 5;
  - seq > 99;
  - letras esgotadas;
  - nome de tabela duplicado (edição);
  - programação sem código.
- **Aviso**:
  - troca no meio da viagem (viagem dividida);
  - troca dentro de deslocamento;
  - escala stale;
  - trecho sem motorista;
  - viagens descartadas numa disputa;
  - blocos sem operador;
  - código por fallback (marca).

---

## 4. Arquitetura

### 4.1 Schemas (`packages/schemas/transit/plan-export/`)

| Arquivo | Conteúdo |
|---|---|
| `external-system.ts` | `EXTERNAL_SYSTEMS = ['GLOBUS'] as const`, `externalCodesSchema` |
| `plan-export.types.ts` | Tipos neutros: `ExportLayoutField { field, size, pad, align, mask?, level: 'program' \| 'table' \| 'row', editable? }`, `ExportPreview { programs: [{ lineId, code, carros: [{ number, tables: [{ fields, rows: [{ fields, warnings? }] }] }] }], warnings, errors }` (os `fields` são `Record<campo, string>`) |
| `plan-export.format.ts` | Funções puras `formatExport(layout, preview)` → string e `validateExport(layout, preview)` → erros. Usadas pela API (testes) e pelo cliente (Gerar a partir do preview editado) |
| `layouts/globus.layout.ts` | `GLOBUS_LAYOUT`, `GLOBUS_AVAILABLE_FIELDS` |
| `layouts/index.ts` | `EXPORT_LAYOUTS: Record<ExternalSystem, { layout, availableFields }>` |

A aba Schema e o Preview são renderizados a partir do layout (`level` e `editable`), e não de
campos fixos no código.

Os schemas de `locality` e `line` ganham o campo `externalCodes`. A migração é no
`transit.prisma` (você roda o `db:migrate`).

### 4.2 API (`apps/api/src/modules/transit/timetabling/vehicle-plan/plan-export/`)

| Arquivo | Responsabilidade |
|---|---|
| `plan-export.assembler.ts` | Carrega os blocos das programações (viagens + rota + localidades, deadruns, intervalos, `DutyPiece`s da escala), aplica trecho e disputa (§3.1), numeração e operador (§3.2). Devolve a estrutura neutra carro → eventos do trecho |
| `plan-export.cuts.ts` | Função pura: eventos + peças → segmentos com o motivo do corte (intervalo / TT / fim por `RETURN` / fim sem recolhida) e viagens divididas (§3.3) |
| `profiles/globus.profile.ts` | Função pura: segmentos → `ExportPreview` (tabelas, letras, turno, mapa de atividades, seq, códigos), §3.4–3.6 |
| `plan-export.service.ts` | Orquestra: assembler → cuts → `switch (system)` → profile → `validateExport` |
| `plan-export.controller.ts` | Endpoints abaixo |

```
GET  /transit/vehicle-plan/:id/plan-export/options?lineIds=...
     → { crewPlans: [{ id, description, status }], operators: [{ branchId, abbr }],
         programs: [{ lineId, lineCode, defaultCode }], blocksWithoutOperator }
POST /transit/vehicle-plan/:id/plan-export/preview
     body { system, crewPlanId, branchId, lineIds, programCodes: { [lineId]: code } }
     → ExportPreview
```

O arquivo é montado no cliente com `formatExport` sobre o preview editado; não existe
endpoint de download.

### 4.3 Web

- `vehicle-plan/[id]/page.tsx`: item no `menu` de **Linhas**, passando `selectedLineIds`.
- `vehicle-plan/[id]/components/PlanExportModal.tsx`: abas e comportamento da §1. Atalhos:
  Esc fecha, `alt+g` gera (com o preview carregado e válido).

---

## 5. Fases

1. **Schemas**: `plan-export/` (tipos, layout Globus, `formatExport`/`validateExport`),
   `externalCodes` em localidade e linha, mudança no Prisma.
2. **Formatação**: teste do `formatExport` reproduzindo byte a byte as linhas da §2.2.
3. **Cortes e perfil**: testes com fixtures para intervalo, TT entre viagens com folga, TT no
   meio da viagem, recolhida, fim de trecho sem recolhida, deslocamento dentro do trecho,
   viagem de outra linha, viagem de linha filha, disputa e letras.
4. **Assembler + service + controller**.
5. **Modal + item de menu**.
6. **Validação**: exportar uma linha que hoje sai da planilha, comparar com o TXT do script
   (`diff`) e importar na homologação do Globus. Depois disso, aposentar o `flow/oso_export`.

## 6. Fora do escopo (v1)

- Envio direto ao Globus: a v1 só gera o arquivo.
- CSV (era só para conferência).
- Configuração editável: o layout, os códigos de atividade e local, o mapa de turno, as
  letras e o seq inicial ficam fixos no perfil.
- Comportamento por tipo de intervalo: todo intervalo corta e vira `07`.
- Persistência das edições do preview.
- Campos do layout não usados (§2.1).
