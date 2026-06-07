# Vehicle Plan Import

> Architecture reference for the vehicle plan import pipeline.
> Source files: `apps/api/src/modules/transit/timetabling/vehicle-plan/vehicle-plan-import.parser.ts` and `vehicle-plan-import.service.ts`

---

## Overview

The import ingests a semicolon-delimited scheduling file produced by external planning software and creates a `VehiclePlan` with its `VehicleBlock` and `TransitTrip` records. The process runs asynchronously via `JobService`.

Entry point: `VehiclePlanImportService.import()` → spawns a job → calls `execute()`.

---

## File Format

Each line is a semicolon-separated record. Fields are 0-indexed.

| Col | Field | Notes |
|-----|-------|-------|
| `c[0]` | `lineCode` | Transit line code — must exist in `TransitLine` |
| `c[2]` | `blockCode` | Vehicle block identifier (e.g. `204U01`) — informational, not used for grouping |
| `c[4]` | `tabId` | Schedule tab within the line (e.g. `01A`, `02B`) — driver shift scope |
| `c[7]` | `sequence` | Trip order within the tab — only meaningful within a single tab |
| `c[8]` | `entryType` | See Entry Types below |
| `c[9]` | `isProductive` | `1` = revenue trip, `0` = dead run |
| `c[10]` | `direction` | `I` = OUTBOUND (ida), `V` = INBOUND (volta), `C` = CIRCULAR |
| `c[11]` | `departureHHMM` | Departure time as `HHMM` string |
| `c[12]` | `arrivalHHMM` | Arrival time as `HHMM` string |
| `c[13]` | `depDay` | Day counter for departure — see Day Inference |
| `c[14]` | `arrDay` | Day counter for arrival — see Day Inference |
| `c[17]` | `depotDepartureHHMM` | Depot departure time (saída de garagem); only set on the first trip of the vehicle's day |
| `c[22]` | `vehicleNumber` | Physical vehicle registration number — primary grouping key |
| `c[23]` | `driverCode` | Driver identifier; changes between tabs when drivers rotate |

### Entry Types (`c[8]`)

| Value | Meaning | Handling |
|-------|---------|----------|
| `''` | Regular revenue or dead-run trip | Parsed normally |
| `'2'` | Driver shift change (troca de turno) | Skipped at parse time — reserved for Phase 2 crew scheduling |
| `'3'` | Return to depot (recolhida) | Parsed normally; processed as a regular trip |

---

## Grouping: Physical Vehicle = Block

Rows are grouped by **`vehicleNumber` (c[22])** — the physical bus registration number. Each unique vehicle maps to one `VehicleBlock`.

**Why not `blockCode` (c[2])?**
`blockCode` (e.g. `204U01`) is a line-scheduling unit, not a vehicle identifier. Multiple vehicles can share the same `blockCode` across different timetable entries, making it unsuitable as a grouping key.

**Why not `tabId`?**
`tabId` is scoped to a single line. A bus can serve multiple lines in the same day (different `lineCode` values) and each line assigns its own `tabId` independently.

**Cross-line vehicle days are common.** A bus may run line 390 from 06:31 to 22:44, then pick up a single trip on line 204 at 23:05 — all as one block. The physical vehicle number (c[22]) is the only reliable identifier that spans these assignments.

**Fallback:** when `vehicleNumber` is empty, `lineCode` is used as the grouping key.

---

## Chronological Sort

After grouping, all trips within a block are sorted **purely by departure time**.

```
adjDep = rawDep < 180 ? rawDep + 1440 : rawDep   // 180 = 03:00
```

Trips departing before **03:00** (the operational day boundary) are shifted forward by 1440 minutes in the sort key only, placing them at the end of the block rather than the beginning. The actual minute computation is unaffected — it is handled by sequential inference.

**Why not sort by `tabId` or `sequence`?**
Both fields are scoped to a single `(lineCode, tabId)` pair. When a block spans multiple lines, `tabId` letters are assigned independently by each line's scheduling entry (e.g. both line 308 and line 308B use `tabId = "01C"`), and `sequence` resets to 1 at each tab boundary. Using these fields for cross-line ordering produces incorrect or non-deterministic results.

---

## Day Inference: Sequential Comparison

**`depDay` and `arrDay` (c[13], c[14]) are NOT reliable day indicators** and must not be used to compute absolute minute values. Their absolute values are internal counters of the scheduling software that can:
- Increment per trip (night vehicles)
- Increment per circuit group (day vehicles)
- Reset between driver tabs

The only piece of information that can be reliably extracted from these fields is the **delta**: if `arrDay > depDay` for a given row, the arrival of that specific trip crosses midnight relative to its departure.

### Algorithm

After sorting, iterate trips in order maintaining:
- `dayOffset` — cumulative minutes added to account for midnight crossings (multiple of 1440, starts at 0)
- `prevArrivalMinutes` — absolute arrival of the previous trip (starts at -∞)

For each trip:

```
rawDep = parseHHMM(departureHHMM)
rawArr = parseHHMM(arrivalHHMM)

// Departure wraps before previous arrival → new calendar day
if (rawDep + dayOffset < prevArrivalMinutes) dayOffset += 1440
departureMinutes = rawDep + dayOffset

// arrDay > depDay → this trip's arrival crosses midnight
arrivalDayOffset = arrDay > depDay ? dayOffset + 1440 : dayOffset
arrivalMinutes   = rawArr + arrivalDayOffset
if (arrivalMinutes < departureMinutes) arrivalMinutes += 1440  // safety guard

prevArrivalMinutes = arrivalMinutes
```

### Example: night vehicle crossing midnight

```
Sorted trips (rawDep):
  23:30 → 23:50   depDay=2  arrDay=2   rawDep=1410  rawArr=1430
  23:50 → 00:00   depDay=3  arrDay=4   rawDep=1430  rawArr=0
  00:00 → 00:30   depDay=4  arrDay=4   rawDep=0     rawArr=30

Processing:
  Trip 1: 1410+0=1410 >= -∞ → dep=1410, arrDay==depDay → arr=1430
  Trip 2: 1430+0=1430 >= 1430 → dep=1430, arrDay>depDay → arr=0+0+1440=1440
  Trip 3: 0+0=0 < 1440 → dayOffset=1440, dep=1440, arrDay==depDay → arr=30+1440=1470
```

---

## Synthetic Depot Deadhead

`c[17]` (`depotDepartureHHMM`) carries the time the vehicle leaves the depot. It is only present on the first trip of the vehicle's operational day (the file places it on the row where the vehicle starts service, which may not be the earliest trip if multiple lines are involved).

After sorting:
1. Find the first row in the sorted block where `depotDepartureHHMM != ''` → `depotRow`
2. `firstTripRow = tabRows[0]` (earliest trip after sort)
3. `depotDepMinutes = parseHHMM(depotRow.depotDepartureHHMM)`
4. `startMinutes = depotDepMinutes - setupMinutes`

If `startMinutes < firstTripDep`, a synthetic deadhead `BlockTrip` is created spanning `[startMinutes, firstTripDep]`. Its route is taken from the first trip with a resolvable route in the block.

**`setupMinutes`** is a per-import parameter representing vehicle preparation time at the depot (fueling, pre-trip inspection). It pushes the block start earlier.

---

## Create vs Update Mode

| Mode | Trigger | Behavior |
|------|---------|----------|
| Create | No `planId` provided | Creates a new `VehiclePlan` in `DRAFT` status with all imported lines linked |
| Update | `planId` provided | Replaces data for the imported lines within the existing plan; other lines are preserved |

**Typical workflow:** a plan starts empty (or is created by the first import) and receives successive imports — one per operator/file — each adding or replacing its lines. Because plans can coexist with the same lines and `dayTypeId`, multiple DRAFTs are valid (e.g. to compare scheduling alternatives).

In Update mode:
- `dayTypeId` is taken from the existing plan (the posted value is ignored)
- `blockNumber` continues from the highest existing block number in the plan

---

## Clearing Existing Data (Update mode only)

Before inserting, `clearLinesFromPlan(planId, lineIds, dayTypeId)` removes the imported lines' data **scoped to this plan only**. Other plans with the same lines are never touched.

1. Find all `BlockTrip` records in this plan whose trips belong to the imported lines
2. Delete those `BlockTrip` records
3. For each affected `VehicleBlock`:
   - Empty (no remaining trips) → **delete**
   - Has trips from other lines → mark `isStale = true`
4. Delete `TripDayType` entries for those trips + this dayType
5. Delete `TransitTrip` records that are now fully orphaned (`dayTypes: none`)
6. Upsert `VehiclePlanLine` for each imported line into this plan

Step 3 is an N+1 pattern (one `count` + one `delete`/`update` per block). It scales with the number of affected blocks and is the dominant cost on a re-import.

---

## Bulk Insert

All inserts are collected in memory during the block loop — no DB calls inside the loop — then committed in four `createMany` calls:

```
transitTrip.createMany
tripDayType.createMany
vehicleBlock.createMany
blockTrip.createMany
```

---

## Post-Import Scoring

After the four `createMany` calls complete, `execute()` calls `VehiclePlanService.scorePlan(planId)`. This computes the plan's initial score and populates `vehiclePlan.summary` and `generatedAt` without running the SA solver:

```
scorePlan(planId):
  load blocks + trips (with route.direction + line.metrics) + matrix from DB
  compute tripKm per trip: line.metrics.extensionKm[direction] ?? matrix[o:d].km ?? 0
  call scoreBlocks() → write summary + generatedAt to vehiclePlan
```

The resulting `summary` includes `fleetCount`, `score`, `deadrunKm`, `productiveKm`, `totalKm`, and duration totals — all km values rounded to 2 decimal places. This gives the plan an immediately visible baseline score without requiring a full solver run.

See [solver.md](./solver.md) for scoring internals.

---

## Known Format Quirks

### `depDay` / `arrDay` dual semantics
The scheduling software uses `depDay > 1` for two unrelated purposes:
1. **Genuine midnight crossing** — a post-midnight trip where the raw time is small (e.g. `00:30`)
2. **Second circuit marker** — the same vehicle completes a second group of trips on the same calendar day; the software increments the day counter even though no midnight boundary was crossed

Because of this dual use, the absolute value of `depDay` is meaningless for day computation. Only the delta `arrDay - depDay == 1` carries reliable information (intra-trip midnight crossing).

### `tabId` reuse across lines
When a vehicle serves multiple lines in a day, each line assigns `tabId` values independently starting from `01A`. Two different lines on the same vehicle can and do produce identical `tabId` values. Sorting by `tabId` or `sequence` across lines is therefore non-deterministic.

### `depotDepartureHHMM` placement
The depot departure time appears on the row that the scheduling software considers the vehicle's "first assignment" — which may not be chronologically first after grouping by physical vehicle. The field is always located by searching the sorted `tabRows` for any row where it is non-empty.

### Zero-duration entries
Rows with `departureHHMM == arrivalHHMM` (zero-duration) appear at tab boundaries and as recolhida endpoints. They are parsed and processed normally; zero-duration trips produce `tripMinutes = 0` and contribute nothing to summary metrics.
