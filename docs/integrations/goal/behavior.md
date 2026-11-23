# Goal — observed behavior

> How Goal behaves, as tested. None of this is in nyx's code or in the API specification. Each item has the date it was seen; re-test when Goal updates.

---

## Planning flow

GTFS → **service** (timetable offer) → **scenario** → **logical schedule** → **daily schedules**.

- A scenario is generated from one or more services and has no link to them or to other scenarios afterwards, so a new one lives alongside the existing ones. (2026-11-05)
- A service only feeds a scenario once **published**, and a published service can't be deleted. Imported services stay as "Validado" until then. Publish only reviewed data. (2026-11-05)
- Each company has its own scenarios and GTFS: `MTU_RAPIDO_UTIL`, `MTU_VPAR_SAB`… Scenario day types are named `UTEIS`, `SABADO`, `DOMINGO`. (2026-11-04)

---

## GTFS load

Details of the feed in [gtfs-export.md](../../architecture/transit/gtfs-export.md). Tested on 2026-11-04 and 2026-11-05.

- **Unique name:** a repeated `service_id` is refused, which is why it carries the version.
- **Loads add, they don't replace.** New routes and places stay in the catalog even after the service is deleted, and `placeCode` is immutable.
- **Routes are reused** when the stop sequence and the name match. Renaming a line creates a new route for it. Color isn't part of the identity: 14 lines changed color between two loads without new routes.
- **Km comes from `shapes.txt`, not the stops.** A20: 389.2 km on screen against 389.9 km from the trace and 125.2 km from straight lines. It follows the trace on reload too: a load with 1 km more on the A20 outbound gave 419.1 km against 419.9 km expected.
- **Two or three stops per trip are enough.** New `stop_id`s and `trip_id`s are accepted.
- **Places created by GTFS:** `placeCode` and `shortName` take the `stop_id`, `commercialName` the `stop_name`.
- **Older data:** in the scenarios loaded before nyx (from Globus), a trip's distance is the sum of straight lines between its stops, even where the shape is detailed (313 outbound: 34.9 km shape, 29.5 km of straight lines, 29.45 km in Goal).

---

## Idle matrix

A matrix is created in the web app by hand and the file is imported into it; the file name doesn't matter. Export in [osrm.md](../../architecture/transit/osrm.md#idle-matrix-export). (2026-11-09)

- A row whose place Goal doesn't have is refused (`Parada inicial ausente`, `Parada final ausente`).
- Depots are known by Goal's own codes: `G1` (GAR RAPIDO) and `G2` (GAR VPAR), kept in the locality's `externalCodes.GOAL`. Lines point to them by `parkingCode`.
- Without empty trips between the new places, scenario generation fails: the engine stops with `ErrorData`.

---

## Scenario engine

- The web app lets the engine log of a run be downloaded. It holds `problem_info.json`, the whole problem the engine received: trips with Goal's internal ids (`routeId`, `startPositionId`), empty trips, lines and routes, depots, shifts and costs. The best source to see what Goal understood from a load. (2026-11-09)
- The ids in the log are internal (route `1590` is `380_2_2`), not GTFS ids.
- Its warnings point to data worth checking in nyx, such as trips with a commercial speed under 8 km/h. (2026-11-09)

---

## Absence types

Configured in the web app (Configuração de ausência). The "ID do GoalBus Motorista" column is the code Globus expects. (2026-11-05)

| Name | Short name | Globus code | Category | Unit | Notes |
|---|---|---|---|---|---|
| FOLGA CLT | FOLGA CLT | 1 | Livre | whole day | shown in the driver app |
| COMPENSACAO | COMP | 2 | Livre | whole day | at most 3 days in the driver's request app, no limit through the API; shown in the driver app |
| FERIAS | FERIAS | 0 | Pura | whole day | worth 07:00 of work |

`COMPENSACAO` is the day off nyx would give from the hour bank. Goal is still confirming that its short name for the API is `COMP` (2026-11-23).

---

## Daily operation

Stated by Goal's support on 2026-11-23, not tested yet.

- **Assigning a task** that already exists to a person, such as a reserve, is done only in the Daily Operation module. No API call does it. `POST /ext/v1/task` creates a new task with no driver, listed as available there.
- **An absence over a task:** an absence can be given for a future date where the person already has a task. If the absence type is set to remove the previous assignment, the task is left without a driver and the planner picks a replacement in Daily Operation.
- **Deleting an absence** doesn't give the task back to the original driver.
- **Notifications:** the people involved are told in GoalBus Driver, both of an absence given through the API and of a task reassigned in Daily Operation.
- **`staff/assignment`** returns what was published in Rostering and is available in Daily Operation, not drafts.
- **Reserves (`STAND_BY`):** a person with a working day in the roster and no task, who can cover a vacancy. A presentation place can't be set for a reserve today.
- **`staffCode`** is the "Código" column of Goal's driver registry, which holds the employee number (matrícula) at MTU.
- **The 3-day limit of `COMPENSACAO`** applies only in the driver's request app. The API doesn't enforce it, so nyx has to keep its own limit.
- **Filtering by company:** Goal will adjust the Rostering rules to the two depots of each company, so the roster can be filtered by depot.
- **No test environment:** every write lands in production.

---

## API

- **Network:** the TLS handshake times out now and then, on the token and on the API. Retry with a pause. (2026-11-04 to 2026-11-09)
- **Token:** lasts 5 minutes. (2026-11-05)
- **`/ext/v1/schedulingScenarios`** returns only scenarios with a publication period covering the dates; use `/detail` to list them all. (2026-11-04)
- **`/ext/v2/section`** came back empty, with or without place filters. (2026-11-04)
- **`/ext/v1/solutions`** came back empty for October–December. (2026-11-04)
- **`timetable`** exists only for scenarios: a service's content can't be read through the API, only on screen. (2026-11-04)
- **`/ext/v2/task/event`**, listed in Goal's e-mail, isn't in the specification. (2026-11-05)
