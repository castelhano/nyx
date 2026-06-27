# Cycle Map — Architecture Reference

The cycle map is a bulk-import tool that turns raw trip execution data (exported from an operations system) into per-direction cycle-time windows stored on each transit line record.

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
[user reviews canvas, adjusts cuts/clusters/interval]
    ▼
computeWindows()    ← cycle-utils.ts
    │  collapses hour clusters into time windows (from→to) using the cut boundaries
    │  each window: { from, to, minutes (weighted avg), intervalMinutes }
    ▼
PATCH /transit/transit-line/:id
    └─ body: { metrics: { windows: { OUTBOUND: [...], INBOUND: [...] } } }
```

---

## Data Model Output

Windows are stored in the `metrics` JSON field of the `TransitLine` record:

```ts
metrics: {
  windows: {
    OUTBOUND: Array<{ from: number; to: number; minutes: number; intervalMinutes: number }>
    INBOUND:  Array<{ from: number; to: number; minutes: number; intervalMinutes: number }>
    CIRCULAR: Array<{ from: number; to: number; minutes: number; intervalMinutes: number }>
  }
}
```

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

On reload, if the line already has saved windows, the interval from `windows[dir][0].intervalMinutes` is restored instead of the default (all windows for a direction always share the same interval value).

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

- **Single save** (`handleSave`): computes windows from current `dirStates`, PATCHes the current line, then advances to the next one.
- **Save all** (`handleSaveAll`): iterates every line in the CSV. The currently displayed line uses `dirStates` directly. All other lines are reprocessed headlessly (cluster → suggest cuts → compute windows) without user interaction, using their previously saved interval or `DEFAULT_INTERVAL` as fallback.
- **Include edited toggle**: rebuilds `hourClusters` for the current line with or without trips flagged as edited in the source system.
- **Encoding**: CSV is read as `latin1` to handle accented characters from Brazilian operations exports.

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
