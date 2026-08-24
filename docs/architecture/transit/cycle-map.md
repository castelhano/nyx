# Cycle Map — Architecture Reference

The cycle map is a bulk-import tool that turns raw trip execution data (exported from an operations system) into per-direction cycle-time windows stored on each transit line record, scoped to the day type (`DayType.code`, e.g. `U`/`S`/`D`) selected when importing.

---

## Flow Overview

```
CSV upload
    │
    ▼
parseCsv()          ← apps/web/src/app/transit/transit-line/cycle-map/csv-parser.ts
    │  extracts RawTrip[] per line + direction
    ▼
buildHourClusters() ← cycle-utils.ts
    │  groups trips by departure hour → clusters by cycle duration (±3 min tolerance)
    │  marks outliers via IQR on each hour's cluster set
    ▼
suggestCuts()       ← cycle-utils.ts
    │  detects hour boundaries where avg cycle time shifts ≥15%
    ▼
[user selects day type, reviews canvas, adjusts cuts/clusters/interval]
    ▼
computeWindows()    ← cycle-utils.ts
    │  collapses hour clusters into time windows (from→to) using the cut boundaries
    │  each window: { from, to, minutes (weighted avg), intervalMinutes }
    ▼
POST /transit/transit-line/windows/apply
    └─ body: { dayTypeCode, updates: [{ lineId, windows: { OUTBOUND: [...], INBOUND: [...] } }] }
```

---

## Data Model Output

Windows are stored in the `metrics` JSON field of the `TransitLine` record, keyed by `dayTypeCode` first — same convention as `metrics.demand` (see `LineService.applyDemand`):

```ts
metrics: {
  windows: {
    U: { // dayTypeCode
      OUTBOUND: Array<{ from: number; to: number; minutes: number; intervalMinutes: number }>
      INBOUND:  Array<{ from: number; to: number; minutes: number; intervalMinutes: number }>
      CIRCULAR: Array<{ from: number; to: number; minutes: number; intervalMinutes: number }>
    }
    S: { ... }, D: { ... }
  }
}
```

Consumers that resolve a cycle window (schedule generator, block editor, vehicle-plan materialization) fall back to `windows['U']` (dia útil) when the plan's own day type has no cycle data imported yet.

`from` and `to` are hour integers (e.g. `6`–`11`). `minutes` is the weighted average cycle time across all active clusters in that window. `intervalMinutes` is a uniform headway value set by the user and applied equally to all windows of a direction. Custom intervals per window can be defined by the user in the line settings, but they will be overwritten during the next sync call.

---

## Clustering Algorithm

**Step 1 — Group by departure hour**
Each trip belongs to the hour of its `Actual Departure` timestamp.

**Step 2 — Cluster by cycle duration**
Within each hour, trips are sorted by `cycleMinutes` and merged into clusters whenever consecutive values fall within ±`CLUSTER_TOLERANCE` (3 min). The cluster center is the most frequent value in the group.

**Step 3 — Outlier detection**
IQR is computed over all individual trip values in active (non-disabled) clusters. Clusters whose center falls outside `[Q1 − 1.5×IQR, Q3 + 1.5×IQR]` are flagged as outliers and excluded from window averages. Hours with fewer than 4 trips skip outlier detection.

---

## Window Computation

`suggestCuts()` proposes a cut between hour `h` and `h+1` when:

```
|avg(h+1) - avg(h)| / avg(h) >= 0.15
```

Cuts divide the active hour range into windows. Each window's `minutes` value is the weighted average of all non-outlier, non-disabled cluster centers within that window, weighted by trip count.

---

## Default Intervals

When no previously saved data exists for a direction, the interval defaults are defined at the top of `page.tsx`:

```ts
const DEFAULT_INTERVAL: Record<Direction, number> = {
  OUTBOUND: 10,
  INBOUND:  1,
  CIRCULAR: 10,
}
```

On reload, if the line already has saved windows for the selected day type, the interval from `windows[dayTypeCode][dir][0].intervalMinutes` is restored instead of the default (all windows for a direction always share the same interval value). Switching the day type selector reloads this default for the newly selected day type.

---

## Interactive Canvas

`CycleMapCanvas.tsx` renders an HTML canvas (engine: `cycle-engine.ts`) showing one dot per cluster per hour. The x-axis is the hour of day; the y-axis is the cycle duration in minutes. Dots are coloured by state:

| State | Colour |
|-------|--------|
| Normal | Blue |
| Outlier | Red |
| Disabled | Gray |
| Has edited trips | Orange ring |

Users can click a dot to toggle outlier/disabled state. Vertical cut lines are draggable. Changes feed back into `dirStates` in the page via `onCutsChange` / `onHourClustersChange` callbacks.

---

## Page Mechanics

- **Day type selector**: a `MultiSelect` (`components/ui/multi-select.tsx`) fed from `/transit/day-type`, defaults to `[firstDayType]` on mount. `dayTypeCodes[0]` is the "reference" day type — changing the selection reloads the current line's `dirStates` against *that* day type's previously saved windows (if any); the rest of the selected codes are only extra save targets, they don't affect what gets loaded into the canvas. On CSV upload, `suggestDayTypeCode()` (`cycle-utils.ts`) parses the `Data` of the file's first trip into an ISO weekday and matches it against each day type's own `pattern.days`, collapsing the selection back down to that single guess (a new CSV always narrows back to one reference day type; it doesn't inherit whatever N-day selection was active before). Day types with no `pattern` (e.g. "Especial"/"Férias") can never be suggested this way; the selection falls back to whatever was selected before when the date can't be parsed or matched. Save actions are disabled while `dayTypeCodes` is empty.
- **Methodology selector** ("Media" / "Media alta" / "Media baixa" — `Methodology` values `linear`/`longer`/`shorter`): chooses how active cluster centers are averaged into a window's `minutes`. `linear` ("Media") is the plain trip-count-weighted mean; `longer`/`shorter` ("Media alta"/"Media baixa") additionally tilt each cluster's weight by its percentile rank within the window's minutes distribution, by cumulative trip-count share — see `weightedAverage()` in `cycle-utils.ts`. Defaults to `longer`. Behaves like `includeEdited`: a page-level toggle, not part of `DirState`, not persisted per line/day type, and applied uniformly to every line in `handleSaveAll`'s headless recompute branch.
- **Single save** (`handleSave`): computes windows once from current `dirStates`, then POSTs to `windows/apply` once per selected `dayTypeCodes[i]` (same computed windows, applied to every selected day type) before advancing to the next line. Any single request failing aborts the save with a toast naming the offending day type; earlier requests in the loop have already landed.
- **Save all** (`handleSaveAll`): iterates every line in the CSV. The currently displayed line uses `dirStates` directly. All other lines are reprocessed headlessly (cluster → suggest cuts → compute windows) without user interaction, using their previously saved interval (read from `dayTypeCodes[0]`'s saved windows) or `DEFAULT_INTERVAL` as fallback. Per line, one `windows/apply` request fires per selected day type; the line only counts as "saved" in the result modal if every one of those requests succeeded, otherwise its error row lists which day type(s) failed.
- **Include edited toggle**: rebuilds `hourClusters` for the current line with or without trips flagged as edited in the source system.
- **Encoding**: CSV is read as `latin1` to handle accented characters from Brazilian operations exports.

### Partial metrics update

The save payload sends only `{ dayTypeCode, updates: [{ lineId, windows }] }` to the dedicated `windows/apply` endpoint — not a generic PATCH to `metrics`. The backend (`LineService.applyWindows`) reads the current record and merges the incoming windows into `metrics.windows[dayTypeCode]` only, leaving every other key inside `metrics` (`extensionKm`, `demand`, `renewalIndex`, and windows for every other day type) untouched, regardless of how stale the frontend's cached line data is. This mirrors `LineService.applyDemand`.

---

## CSV Layouts

The parser is intentionally kept as a single function in `csv-parser.ts`. Adding support for a new source system means either:

1. **Extending the same file** with a layout-detection heuristic (inspect headers, pick a parser variant), or
2. **Adding a new `parse<System>Csv()` function** in the same file and selecting it at call-site based on user selection or auto-detection.

### Supported Layouts

#### Sonda (m2m-frota)

**File:** `apps/web/src/app/transit/transit-line/cycle-map/csv-parser.ts`

| Column | Field mapped |
|--------|-------------|
| `Data` | `date` |
| `Trajeto` | line code + direction |
| `Veiculo Real` | `vehicle` |
| `Motorista` | `driver` |
| `Partida Real` | `departureTime` / `departureHour` |
| `Tempo Viagem` | `cycleMinutes` (HH:MM[:SS], rounds up at ≥30 s) |
| `Status da Viagem` | filter — only `"1"` (completed) trips are imported |
| `Viagem Editada` | `edited` — `"Sim"` flags the trip as manually adjusted |

**Direction mapping** (from `Trajeto` field):

| Trajeto contains | Direction |
|-----------------|-----------|
| `IDA` | `OUTBOUND` |
| `VOLTA` | `INBOUND` |
| `UNICO` / `ÚNICO` / `CIRCULAR` | `CIRCULAR` |

**Line code** is extracted as the prefix before the first ` - ` in the `Trajeto` value (e.g. `"001 - IDA"` → `"001"`).

**Delimiter** is auto-detected: whichever of `;` or `,` appears more often in the first row wins.
