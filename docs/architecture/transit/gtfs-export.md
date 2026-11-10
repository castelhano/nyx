# GTFS Export

> Architecture reference for the GTFS feed generated for Goal.
> Source files: `apps/api/src/modules/transit/timetabling/gtfs/`, `packages/schemas/transit/gtfs-export.schema.ts` and `apps/web/src/app/transit/vehicle-plan/components/GtfsExportModal.tsx`

---

## Overview

Goal is the scheduling system that receives the plans. Every change to a line used to mean editing a GTFS file by hand, so nyx generates the feed itself, in one step, for a timetable or a route change.

A load is **one operator and one day type**. Goal expects one day type per load, and each company has its own scenarios and GTFS there. The operator rule is our own convention. All the operator's lines go in every load, including the ones that didn't change.

Nyx is the source of the data. There is no diff against the previous feed and no direct publication: the file is downloaded and imported in Goal by hand. Goal's API has no GTFS import.

---

## Flow

The entry point is the **GTFS** button on the vehicle plan list.

1. `GET /transit/gtfs/options` lists the operators, the day types and the next version of each.
2. The user picks operator, period, one day type (none comes selected), version and `block_id` mode.
3. `POST /transit/gtfs/preview` runs the whole generation and writes nothing. The preview is mandatory, because Goal keeps every load and the download uses up the version.
4. `POST /transit/gtfs/export` zips the feed and records it in `GtfsExport` + `GtfsExportDayType`, which say which plan became which version.

Preview and export share `buildGtfsFeed`, so the report can't diverge from the file.

| File | Role |
|---|---|
| `gtfs-export.service.ts` | Resolves the plan, blocks what can't be generated, zips and records |
| `gtfs-export.loader.ts` | The only file that touches the database |
| `gtfs-feed.builder.ts` | Pure functions: loaded data → tables of each file + report |
| `gtfs-times.ts` | Times of each locality |
| `gtfs-csv.ts` | CSV serialization, every value quoted like Goal's own feeds |

### What gets exported

- **Plan:** the non-`DRAFT` plan in force on the first day of the period (`inForceOn`), not simply the `ACTIVE` one: an active plan may start in the future. A plan that starts inside the period blocks the export, so the period has to start at the new plan.
- **Trips:** those of the blocks whose `VehicleBlock.branchId` is the operator's. `LineOperator` doesn't cover this. A line split between operators gets a warning.
- **Day types:** only those with a `pattern`. `FERIAS` and `ESPECIAL` have none, so they aren't offered.
- **Scope metadata:** `agencyId`, `agencyUrl`, `agencyTimezone` and `routeType` in `Scope.serviceMetadata`. The first three block the export when blank. `agency_name` comes from `organName`, falling back to the scope's name.

`LineCalendarException`, `frequencies`, fares, transfers, `feed_info.txt` and `route_text_color` are left out on purpose. The last two match the feed Goal already accepted.

---

## Generated files

| File | Rule |
|---|---|
| `agency.txt` | One row from the scope's metadata |
| `routes.txt` | `route_id` and `route_short_name` = line's Goal code, falling back to `code`; `route_long_name` = `<code> - <name>`; color cycles through `ROUTE_COLOR_PALETTE` by position |
| `stops.txt` | Localities used by the routes, depots included. `stop_id` is always the nyx `code`, with no mapping to Goal's old ones. Waypoints never enter |
| `shapes.txt` | `RouteLocality.geometry` concatenated without repeating the junction; `shape_id` = `TransitRoute.id` |
| `trips.txt` | See identifiers below; `CIRCULAR` and `OUTBOUND` = `direction_id` 0, `INBOUND` = 1 |
| `stop_times.txt` | One row per locality of the trip |
| `calendar.txt` | `weekdays` patterns, with the period as start and end |
| `calendar_dates.txt` | `month_window` patterns, one row per date |

### Identifiers

| Field | Format | Example |
|---|---|---|
| `service_id` | `<operator>_<day type>_V<version>` | `RAPIDO_UTIL_V012` |
| `trip_id`, `trip_short_name` | `<day code>_<route_id>_<block>_<position in the block by departure>` | `U_A20_12_3` |
| `block_id`, all | `<day code>_<block>` | `U_12` |
| `block_id`, grouped only | `<day code>_<block>_<group in the block>` | `U_12_1` |
| File | `gtfs-<operator>-<day code><version>.zip` | `gtfs-RAPIDO-U012.zip` |

The position comes from `departureMinutes`, not `BlockTrip.sequence`: a trip moved between blocks goes to the end of it. `trip_id` isn't stable between plans, which is fine because a Goal scenario has no link to the service after it's generated.

### Versions

Each operator + day type counts its own loads, because plans change at different paces. The version counts **loads, not plan changes**: sending an unchanged day type again needs a new number, since Goal refuses a repeated name.

The modal suggests the highest used + 1, and the field is editable for when nyx and Goal drift apart. A number used by that operator and day type is refused, gaps are harmless. The history isn't covered by `db:export-transit`, so a `db:reset` restarts the count while Goal still holds the old names.

### `block_id`

The default is **grouped trips only** (`none`, `bundled`, `all`). A trip group runs on one vehicle and one driver, so it's what must stay together, while 31 of the 83 RAPIDO blocks cross lines and sending them all could tie Goal's scheduling down.

Each group is a block of its own, so two groups on one vehicle don't tie together what runs between them. A group of a single trip has nothing to link and gets none. The column is left out when no trip has one.

### Times

The trip's departure and arrival are authoritative. Each locality gets its share of the duration:

```
time(i) = departure + (deltas up to i / sum of the deltas) × (arrival − departure)
```

Deltas include waypoint legs. They are free-flow OSRM times and rarely add up to the duration, so walking them and forcing the arrival would pile the whole difference on the last leg. Output has seconds, `arrival_time` equals `departure_time`, and hours go past 24 after midnight.

### Report

| Level | Cases | Effect |
|---|---|---|
| Blocker | No plan in force, a plan starting inside the period, missing metadata | Nothing is generated |
| Error | Route without a trace, locality without coordinates, all deltas zero, two lines with one Goal code | The item is left out and the download asks for confirmation |
| Warning | Line split between operators, trip with a non-positive duration | Informative |

A route with a missing trace is left out, never drawn as a straight line. There is no warning for an external code falling back to `code`, since that's the normal case.

---

## How Goal behaves

None of this shows in the code. Tested on 2026-11-04, unless stated otherwise.

- **Flow:** GTFS → service (timetable offer) → scenario → logical schedule → daily schedules. A published service can't be deleted anymore, so publish only reviewed data.
- **Unique name:** a repeated service name is refused, which is why it carries the version.
- **Loads add, they don't replace.** New routes and places stay in the catalog even after the service is deleted, and `placeCode` is immutable.
- **Routes are reused** when the stop sequence and the name match. Renaming a line creates a new route for it. Color isn't part of the identity. Reloading all but two routes of V001 with no changes created none.
- **Km comes from `shapes.txt`, not the stops.** A20: 389.2 km on screen against 389.9 km from the trace and 125.2 km from straight lines. It follows the trace on reload too, so editing a route in nyx and reloading works. Tested on the A20 only.
- **Two or three stops per trip are enough.** Stops only mark the start and end of a schedule, and km doesn't depend on them. Goal accepted new `stop_id`s and `trip_id`s.
- **A scenario is independent:** it has no link to other scenarios or to its service once generated, so a new one lives alongside the existing ones.
- **API:** reads were used. The specification lists write operations, none tried.

---

## Idle matrix

Goal takes the idle matrix as a separate load: a matrix is created in Goal by hand and the file is imported into it, so the file name doesn't matter. The export is generic, see [osrm.md](osrm.md#idle-matrix-export); for Goal, pick **Goal** as the depot codes.

- Goal refuses a row whose place it doesn't have (`Parada inicial ausente`), and knows its depots by its own codes (`G1`, `G2`), kept in the locality's `externalCodes.GOAL`.
- Checked on 2026-11-09 against the matrix built by hand (`AMTU_OC_V001`): the 3,906 pairs that remain are identical. The 254 dropped rows were the ones Goal refused, for Monte Sinai and Barreiro Branco, which have no trips.

---

## Decisions

- **Duration:** nyx's stands. Goal's first load came from Globus, where a trip ends when the next starts, and nyx normalizes that on purpose, leaving at least 5 minutes.
- **032, 033 and 034:** stay at 00:30, on purpose, so Goal generates the complement suggestions on the same day. Only 031 goes past 1440 minutes, since it starts at 23:30.
- **F01:** exports, but its route has only origin and destination, so the trace needs waypoints to be faithful.
- **Draft plans:** not exported. Reconsider if testing a draft in Goal becomes useful.

---

## Open

- **Depot as place and depot:** the matrix has no pair between `G1` and `A0318-001`, the same garage under its two codes, since the matrix has no row from a locality to itself. Check whether Goal asks for it.
- **380 route `1590`:** Goal's support mentioned a missing shape for it. It's Goal's id for `380_2_2`, defined with its trace in the problem the engine received, and every trip of the feed has its shape. Waiting for details.
- **Routes with the same pair of places and different km:** 031 × 309 and 311 × 311B. The A20 test doesn't cover two routes of one pair in the same feed, so check it on the full load. If one inherits the other's km, give one of them its own locality in nyx.
- **`block_id` in Goal:** the effect on schedule composition was never tested.
- **End-to-end test:** change a line's timetable and another's route, generate, import, and check the other lines stay intact.
- **Official validator:** last run with `gtfs-validator` 7.1.0, before per-day versions and grouped `block_id`.
- **`agencyUrl`:** still the test value `https://mtu`, the only error the validator raised.
- **Tests:** the operator filter and the plan choice live outside the pure builder and have no automated test.
