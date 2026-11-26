# Cittati BI

> Reference for reading the Cittati BI: what it is to nyx, how to reach it, how to query its data model and what was observed.
> Cittati is the GPS/AVL vendor; this BI is their Power BI report over the tracked trips. Nothing here is a documented API — see [Risks](#risks).

---

## What it is to nyx

Cittati tracks the fleet by GPS and publishes the result as a Power BI report (`BI_RS_MTU`): trips planned × done, punctuality, trip times and garage departures, per operator, line, vehicle and driver. It is the only source of **what actually ran**, which nyx plans and Goal schedules but neither records.

| Flow | Direction | How | Status |
|---|---|---|---|
| Trip execution (planned × done, punctuality, trip times) | Cittati → nyx | Report query endpoint | Reads work (ad hoc, 2026-11-19) |
| Garage departures | Cittati → nyx | Report query endpoint | Model reachable, not queried yet |

Nyx code doesn't call it yet.

---

## Server

A **Power BI Report Server** (the on-premises Power BI, not powerbi.com) behind nginx. The internal host name is `servidorbi`.

| What | Address |
|---|---|
| Portal | `https://bi.cittati.com.br/Reports` |
| Report (as shared by Cittati) | `https://bi.cittati.com.br/Reports/powerbi/BI/MTU/BI_RS_MTU?rs:embed=true` |
| Report viewer (what the portal embeds) | `https://bi.cittati.com.br/powerbi/?id=<reportId>` |
| Portal REST API | `https://bi.cittati.com.br/Reports/api/v2.0` |
| Viewer API (queries) | `https://bi.cittati.com.br/powerbi/api/explore/reports/<reportId>/...` |

The viewer API sits at the host root, **not** under `/Reports`: under `/Reports` every unknown path answers 200 with the portal's HTML.

| Id | Value |
|---|---|
| Report id | `d3ed7e6d-2360-45df-848e-4d22e9567a92` |
| Model id | `1063846545` |
| Report path | `/BI/MTU/BI_RS_MTU` |

---

## Authentication

HTTP **Basic** on every request (nginx answers `401` with `WWW-Authenticate: Basic` otherwise). The login is one account given by Cittati, which the server resolves to the local user `VMWA2RSBI\MTU`.

Secrets never go in the repository. They live in `apps/api/.env` (git-ignored); `apps/api/.env.example` lists the variables:

| Variable | Value |
|---|---|
| `CITTATI_BI_URL` | `https://bi.cittati.com.br/Reports` |
| `CITTATI_BI_REPORT_PATH` | `/BI/MTU/BI_RS_MTU` |
| `CITTATI_BI_USER` | from Cittati |
| `CITTATI_BI_PASSWORD` | from Cittati |

```bash
set -a; source apps/api/.env; set +a
curl -u "$CITTATI_BI_USER:$CITTATI_BI_PASSWORD" "$CITTATI_BI_URL/api/v2.0/Me"
```

---

## Access status

Tested 2026-11-19 with the MTU account.

| Call | Result |
|---|---|
| `GET /Reports/api/v2.0/Me` | 200 |
| `GET /Reports/api/v2.0/PowerBIReports(Path='/BI/MTU/BI_RS_MTU')` | 200 — report metadata (id, size 2.8 MB, last modified) |
| `GET .../PowerBIReports(<id>)/CacheRefreshPlans` | 200 — refresh schedule and last run |
| `GET .../PowerBIReports(<id>)/DataModelParameters` | 200 — empty |
| `GET .../PowerBIReports(<id>)/DataSources` | error, empty message |
| `GET .../PowerBIReports(<id>)/Policies` | insufficient permissions |
| `GET .../CatalogItems`, `Folders(...)/CatalogItems`, `PowerBIReports` | insufficient permissions — the account can't list anything, only open this report by path |
| `GET .../PowerBIReports(<id>)/Content/$value` (download the `.pbix`) | **403** — the data can't be taken out as a file |
| `GET /powerbi/api/explore/reports/<id>/modelsAndExploration?preferReadOnlySession=true` | 200 — the whole report definition: pages, visuals, the fields each visual uses |
| `POST /powerbi/api/explore/reports/<id>/conceptualschema` | 200 — the data model: tables, columns, measures, types |
| `POST /powerbi/api/explore/reports/<id>/querydata?synchronous=true` | **200 — arbitrary queries over the model** |

So the only way to the data is the viewer's own query endpoint, the one the report's charts call. It accepts any combination of the model's columns, measures and filters, not just what the report pages show.

Rechecked 2026-11-26:

- `conceptualschema` now answers 200 with `schema: null` and `errorCode: OnPremises_Connection_Error_General` (`OnPremises_Connection_Error_Connection_String`), even right after `modelsAndExploration`. `querydata` kept working normally. Don't depend on the schema call at run time: check the expected columns in the query result instead, and fall back to the field list in `modelsAndExploration` (`queryRef` in each visual's `config`) to discover names.
- **No CORS.** A preflight `OPTIONS` answers `405` (`allow: POST`) and no response carries `Access-Control-Allow-*`. A browser page from another origin can't call the BI. The call has to come from a server or a script, or from a page served by `bi.cittati.com.br` itself.

---

## Refresh

The model is **Import** mode, refreshed by a schedule owned by Cittati (`Refresh 2h`, daily from 02:00). The last run is in `CacheRefreshPlans` → `LastRunTime` / `LastStatus` (on 2026-11-19: 05:09, on 2026-11-26: 05:01, both `Completed Data Refresh`). Today's trips are not in the model; yesterday's are complete after the morning refresh.

---

## Querying

### Schema

```bash
curl -u "$CITTATI_BI_USER:$CITTATI_BI_PASSWORD" -X POST -H 'Content-Type: application/json' \
  -d '{"modelIds":[1063846545],"userPreferredLocale":"pt-BR"}' \
  https://bi.cittati.com.br/powerbi/api/explore/reports/d3ed7e6d-2360-45df-848e-4d22e9567a92/conceptualschema
```

`schemas[0].schema.Entities[]` → each with `Properties[]`; a property with `Column` is a column, with `Measure` a measure. `DataType`: 1 text, 4 integer, 7 datetime (others exist).

### Query body

A Power BI *semantic query*. Every query names one source entity (`From`), selects columns and measures, optionally filters, and asks for a row window:

```json
{
  "version": "1.0.0",
  "queries": [{
    "Query": { "Commands": [{ "SemanticQueryDataShapeCommand": {
      "Query": {
        "Version": 2,
        "From": [{ "Name": "f", "Entity": "FT_ViagensBI", "Type": 0 }],
        "Select": [
          { "Column":  { "Expression": { "SourceRef": { "Source": "f" } }, "Property": "Data_Sem_Hora" }, "Name": "data" },
          { "Measure": { "Expression": { "SourceRef": { "Source": "f" } }, "Property": "_Previstos" },     "Name": "previstos" },
          { "Measure": { "Expression": { "SourceRef": { "Source": "f" } }, "Property": "_Realizados" },    "Name": "realizados" }
        ],
        "Where": [ ... ]
      },
      "Binding": {
        "Primary": { "Groupings": [{ "Projections": [0, 1, 2] }] },
        "DataReduction": { "DataVolume": 3, "Primary": { "Window": { "Count": 30000 } } },
        "Version": 1
      }
    }}]},
    "QueryId": "",
    "ApplicationContext": { "DatasetId": "1063846545", "Sources": [{ "ReportId": "d3ed7e6d-2360-45df-848e-4d22e9567a92" }] }
  }],
  "cancelQueries": [],
  "modelId": 1063846545
}
```

- Columns group, measures aggregate: selecting `numeroLinha` + `_Realizados` gives trips done per line. Selecting `idResumoViagem` (one per trip) gives one row per trip.
- `Projections` lists the indexes of every `Select` item.
- To see how the report itself queries a visual, read its `config` in `modelsAndExploration` → `exploration.sections[].visualContainers[]` — `singleVisual.prototypeQuery` is the same query shape.

### Filters

`Where` is a list of `{ "Condition": <expr> }`, all of them ANDed. Verified expressions:

```json
{ "Comparison": { "ComparisonKind": 0,
    "Left":  { "Column": { "Expression": { "SourceRef": { "Source": "f" } }, "Property": "Dia" } },
    "Right": { "Literal": { "Value": "17L" } } } }

{ "In": { "Expressions": [ { "Column": { "Expression": { "SourceRef": { "Source": "f" } }, "Property": "Data" } } ],
          "Values": [ [ { "Literal": { "Value": "datetime'2026-11-17T00:00:00'" } } ] ] } }
```

- `ComparisonKind`: 0 `=`, 1 `>`, 2 `>=`, 3 `<`, 4 `<=`.
- Literals are typed strings: integer `17L`, text `'17/11/2026'` (single quotes inside), datetime `datetime'2026-11-17T00:00:00'`.
- `And` / `Or` combine two conditions: `{ "And": { "Left": <expr>, "Right": <expr> } }`.
- A date range is `Data >= d1` and `Data < d2`.

### Response

The data comes in Power BI's compressed *DSR* format, at `results[0].result.data.dsr.DS[0]`:

| Key | Meaning |
|---|---|
| `PH[0].DM0[]` | The rows |
| `S` (first row only) | One entry per selected item; `DN` names the value dictionary of a column |
| `C` | The row's values, **omitting** the ones flagged in `R` and `Ø` |
| `R` | Bitmask: value *i* repeats the previous row's |
| `Ø` | Bitmask: value *i* is null |
| `ValueDicts` | `{ "D0": [...] }` — text columns send an index into their dictionary instead of the text |
| `RT` | Restart token, present when there are more rows than the window |
| `IC` | `true` when the result is complete |

Decoder, as used in the tests (Python):

```python
def decode(ds, names):
    rows, prev, dn = [], [None] * len(names), {}
    for r in ds['PH'][0].get('DM0', []):
        for i, s in enumerate(r.get('S', [])):
            dn[i] = s.get('DN')
        vals, out = iter(r.get('C', [])), []
        for i in range(len(names)):
            if r.get('R', 0) >> i & 1:
                out.append(prev[i])
            elif r.get('Ø', 0) >> i & 1:
                out.append(None)
            else:
                v = next(vals)
                if dn.get(i) and isinstance(v, int):
                    v = ds['ValueDicts'][dn[i]][v]
                out.append(v)
        prev = out
        rows.append(dict(zip(names, out)))
    return rows, ds.get('RT')
```

### Paging

Send the `RT` back as `Window.RestartTokens` to get the next page. **The first row of each page repeats the last row of the previous one** — drop it. In practice the window can be large: one whole day at trip level (7,321 trips, 10 columns) came back in one 30,000-row window in ~1.2 s. Paging is only needed for long periods.

### Value formats

- `Data` (datetime) comes as **epoch milliseconds at UTC midnight** — `1794873600000` = 2026-11-17. Read it as a calendar date, not as an instant in Cuiabá time.
- `Data_Sem_Hora`, `Prev_Inicio_sem_segundos`, `Real_Inicio_sem_segundos` are **text** (`17/11/2026`, `17/11/2026 05:15`).
- Percentage measures sometimes come as a number and sometimes as a numeric string (`"60.427350427350426"`) — parse both. They are 0–100, not 0–1.
- Line numbers (`numeroLinha`) and vehicle numbers (`prefixo`) are text with leading zeros (`007`, `008A`). Expect stray values too (`501.` on Caribus).
- `previstoTP` / `realizadoTP` / `previstoTS` / `realizadoTS` are epoch milliseconds holding **Cuiabá wall-clock time written as UTC**: `1795650253223` = `2026-11-25T23:44:13Z`, shown as `Real_Inicio_sem_segundos = 25/11/2026 23:44`. Read the UTC fields as local time, with no offset.
- A missing real time is an **empty string** in the `*_sem_segundos` text columns and `null` in the epoch columns.
- Flags come in two styles: `viagemRealizada`, `viagemExtra` and `justificaViagem` are text `Sim` / `Não`, while `partidaPerdida` and `problemaHardware` are integers `0` / `1`.
- Some text values come with a broken encoding (`turno = 'Manh�'`). Compare on a prefix or an accent-stripped form, not on the exact text.

### Aggregates

Selecting columns plus one measure returns one row per distinct combination with the measure's value. That's the cheap way to profile a column over the whole period without pulling trips. For example, `motivo` + `viagemRealizada` + `_Previstos` came back as ~60 rows covering 2026-11-03 to 2026-11-25.

```json
"Select": [
  { "Column":  { "Expression": { "SourceRef": { "Source": "f" } }, "Property": "motivo" },          "Name": "motivo" },
  { "Column":  { "Expression": { "SourceRef": { "Source": "f" } }, "Property": "viagemRealizada" }, "Name": "realizada" },
  { "Measure": { "Expression": { "SourceRef": { "Source": "f" } }, "Property": "_Previstos" },      "Name": "n" }
]
```

---

## Data model

17 entities; 10 of them are Power BI's automatic date tables (`LocalDateTable_*`, `DateTableTemplate_*`) and can be ignored. The report's field names still show old table names (`tb_viagensbi`, `tb_all_tables_partition_orc_ano_mes_dia`, `db_benfica ...`); the model has renamed them, so query by the names below.

### `FT_ViagensBI` — one row per trip

137 columns, 36 measures. The ones that matter:

| Group | Columns |
|---|---|
| Identity | `idResumoViagem` (trip), `numeroViagem`, `posicao` |
| When | `Data`, `Data_Sem_Hora`, `Ano`, `Mes`, `Dia`, `diaDaSemana`, `nomeTipoDia`, `Quinzena`, `turno`, `Faixa30m` / `Faixa01h` / `Faixa02h` |
| Operator / line | `nomeEmpresa`, `numeroLinha`, `nomeLinha`, `linha`, `Sentido` (`IDA` / `VOLTA`), `nomeAtendimento`, `nomeGrupoLinha`, `linhaCompartilhada` |
| Vehicle | `prefixo`, `VeicEmpPlaca`, `nomeTipoVeiculo`, chassis and body make/model, year |
| Crew | `matriculaMotorista`, `nomeMotorista`, `matriculaCobrador`, `nomeCobrador`, `idEscala` |
| Start (TP) / end (TS) points | `nomePontoTP`, `nomePontoTS`, `previstoTP`, `realizadoTP`, `diferencaTP`, `previstoTS`, `realizadoTS`, `diferencaTS`, `Prev_Inicio_sem_segundos`, `Real_Inicio_sem_segundos`, `Prev_Fim_sem_segundos`, `Real_Fim_sem_segundos` |
| Outcome flags | `viagemRealizada`, `partidaRegular`, `partidaAdiantado`, `partidaAtrasado`, `partidaPerdida`, `viagemExtra`, `problemaHardware`, `motivo`, `justificaViagem` |
| Trip time | `tempoViagemPrevisto`, `tempoViagemRealizado`, `tempoViagemDiferenca`, per direction |
| Idle / other | `ociosoPrev`, `ociosoReal`, `minutosOciosos`, `distanciaTerminalSaida`, `distanciaTerminalChegada`, `passageiros`, `toleranciaAtraso`, `toleranciaAdiantamento` |

Observed on the trip columns (2026-11-25 and period aggregates as of 2026-11-26):

| Column | What it holds |
|---|---|
| `Data_Sem_Hora` | The **operational day**: the trips of 25/11 run from about 04:30 to 26/11 03:30. Filter by it, not by the date part of the times. |
| `posicao` | Text `'1'`, `'2'`… per line. It looks like the timetable slot (*tabela*); not confirmed. |
| `idEscala` | One per line per day on Rápido (17 lines, 17 values), not one per vehicle or slot. |
| `prefixo` | Filled on trips not done too: the planned vehicle. Empty on ~2% of trips, all of them not done. |
| `viagemRealizada = Não` | Covers trips with **one of the two real times**: on Rápido 25/11, 375 not done = 229 with neither, 86 with only the end, 60 with only the start. Every `Sim` has both. |
| `partidaPerdida` | `1` when there is no real start (most of the `Não`). |
| `motivo` | Free text set by the operator, usually `NNN - DESCRIPTION`. Mostly null. Codes with `#` (`#01 - GPS INOPERANTE`, `#02 - GPS COM FALHA`, `#03 - FEZ 50pp TRAJETO`, `#04 - ERRO SISTEMA`, `#05- OMISSÃO`) are the most frequent; mechanical and operational codes (`200 - CATRACA TRAVADA`, `007 - FALTA CARRO`…) are rare. Spelling varies (`113 - SEM FORCA` / `113 - SEM FORÇA`, `107-Motor Esquentando`). A `motivo` appears on trips with `viagemRealizada = Sim` too. |
| `justificaViagem` | Always `Não` over the whole period, including trips with a `motivo`. Not a usable flag. |
| `passageiros` | Always null. The BI has no ridership. |
| `irregularidadeTP` / `irregularidadeTS` | `Adiantado` / `Atrasado` / `Regular` / null. `irregularidadeTS` is filled on some trips not done. |
| `nomePontoTS` | End point. One per line and direction in 248 of 252 combinations on 25/11. The exceptions are a dominant point plus a rare one (`720 IDA`: `PP3 BISPO` ×21, `PP2` ×1), which is what a trip closed early at another point looks like. `A02 IDA` had three points at similar counts: three routes of the same line. |
| `nomeAtendimento` | The short name of the trip's direction **within its route**. In Cittati a line has one or more routes (each with a code and a suffix), and each route has a name for its outbound and one for its return direction; this column carries that name. The suffix itself isn't in the BI. Example `A02`, three routes: main route (no suffix) outbound `Term Cpa 1` / return `Pq Nacoes`; suffix 22 `Barreiro Branco` / `Terminal do Cpa 1`; suffix 21 `V Formosa` / `Term CPA 1`. Names still under review show as `Ida` / `Volta` / `Unico`. A name can repeat across directions of different routes (`Term Cpa 1` is the main route's outbound and, ignoring case, suffix 21's return), so identify a route by line + `Sentido` + `nomeAtendimento`, not by the name alone. Keyed that way, every combination on 25/11 had a single end point except three trips. `distanciaTerminalSaida` / `distanciaTerminalChegada` match the route's km in Cittati (A02 main route: 6,946 m / 11,932 m = 6.9 / 11.9 km) and work as a second check. |

Measures: `_Previstos`, `_Realizados`, `_Perdidos`, `_total_regular`, `_total_adiantado`, `_total_atrasado`, `_percentual_partidas`, `_percentual_cumprimento_viagem`, `_percentual_pontualidade`, `_percentual_adiantamento`, `_percentual_atrasos`, `_tempo_medio_viagem_previsto`, `_tempo_medio_viagem_realizado`, `_tempomedio_diferenca`, plus `_ida` / `_volta` variants. Their DAX isn't exposed; what each one counts is inferred from the name (see [open questions](#open-questions)).

### Others

| Entity | Content |
|---|---|
| `FT_SaidaGaragem` | Garage departures. Few columns of its own (`Tem_SaidaRealizada`, `Prev.HoraMin`, `Real.HoraMin`, `_Status`); 16 measures: `_total_saida_prevista` / `_realizada` / `_regular` / `_adiantada` / `_atrasada` / `_perdida`, their `_%_` versions, `_total_horas_adiantadas` / `_atrasadas` |
| `Metas` | Targets and tolerances: `metaCumpPartida`, `metaCumpViagem`, `metaPontualidade`, `metaAdiantamento`, `metaAtraso`, each with a `tolerancia...` |
| `GrupoLinha`, `LinhaEmpresa`, `GrupoLinhaEmpresa` | Line grouping per operator |

### Report pages

The report has two pages, *Operacional* (trips: cumprimento, pontualidade, tempo de viagem, by line, hour band, vehicle, driver, reason) and *Saída Garagem* (garage departures by garage, line, vehicle, driver, reason). The list of visuals and their fields is in `modelsAndExploration`.

---

## Observed data

As of 2026-11-19:

- **Period:** from 2026-11-03 to the day before the last refresh.
- **Scope:** all six operators of the system, not only ours — Caribus, Consórcio Metropolitano, Integração, Rápido Cuiabá, União and VPAR. Filter by `nomeEmpresa` when only RAPIDO / VPAR matter.
- **Volume:** ~7,300–7,800 planned trips on a weekday, ~4,500 on Saturday, ~2,500–2,700 on Sunday.
- **Ramp-up:** trips done / planned was ~19% on 2026-11-03 and climbed to ~70–75% by 2026-11-16. That reads as tracking still being rolled out, not as the real operation. Confirm with Cittati before using early days.
- Punctuality differs a lot by operator (≈7% to ≈71% over the period), which may also come from tracking or timetable setup rather than operation.
- The data has **personal data** (driver and conductor names and IDs). Anything nyx stores from it falls under LGPD like the rest of the crew data.

---

## Risks

- **The query endpoint is internal and undocumented.** It is what the Power BI viewer uses, not a supported API. A server upgrade can change it, and Cittati editing the report can rename or remove a measure or column. Code reading it should check the schema and fail loudly when a field is missing.
- **Measure definitions are invisible.** The DAX behind `_percentual_pontualidade` and the like isn't exposed; results can't be audited, only compared with the report.
- **One shared account.** The login is the operation's, not a service account. Rate and concurrency limits are unknown; keep reads small and spread out.
- **Use agreement.** Automated reads weren't explicitly agreed with Cittati. Worth confirming before nyx reads on a schedule.

---

## Open questions

To ask Cittati:

1. Is automated reading through the viewer endpoint acceptable, or is there a supported export (API, database view, scheduled file)?
2. Can the account get `.pbix` download or read access to the data source, so the data can be taken in bulk?
3. Is the 2026-11-03 to ~2026-11-15 ramp-up a tracking roll-out? From what date is the data reliable?
4. How are cumprimento, pontualidade, adiantamento and atraso computed — which tolerances, against which planned time (Goal's schedule, the timetable sent to them)?
5. Where does the planned side come from, and how often is it updated?
6. Can the refresh run more often than once a day?
7. Is `idResumoViagem` stable across refreshes, so a trip can be found again the next day? Does a correction made in Cittati (a `motivo`, a changed end point) keep the same id?
8. When the operator moves a trip's end point, is that recorded anywhere in the model (the original planned end point, a flag), or only as a different `nomePontoTS`?
9. Is `posicao` the timetable slot?
