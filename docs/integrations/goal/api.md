# Goal API — map by use case

> Curated from `openapi/ext-common.json` (OTTO-Integration 1.0). Every operation is listed in [endpoints.md](endpoints.md); this file says what each relevant one is for.
> "Read" and "write" below follow the HTTP method. Both are granted, and there is no test environment (see [README.md](README.md#access-status)).

---

## Conventions

| Topic | Rule |
|---|---|
| Headers | `Authorization: Bearer`, `X-TENANT-ID: 1045`, `responseMode: SYNC` (`ASYNC` sends the answer to a message queue) |
| Paging, usual | `page` (from 0) + `pageSize` → `{ data, totalRecords, currentPage, totalPages }`. `pageSize` 1000 is accepted |
| Paging, others | `/ext/v1/solutions` and `/ext/empty-trip`: `page` + `size` → `{ total, page, size, items }`. `/ext/v1/absenceConfig`: `limit` + `offset`. `/ext/v1/standBy`: `limit` is required |
| Dates | `yyyy-MM-dd` |
| Times | `HH:mm:ss`, hours may pass 24 (`27:30:00`) for the operational day after midnight |
| Direction | `1` outbound, `2` inbound — GTFS uses 0/1 |
| Distance | Meters in scheduling data (`distance`), meters as a float in sections (`sectionDistance`) |
| Writes | Body is a list; `processingMode` is required: `atomic` (all or none) or `partial` (each item on its own). Answer: `OperationStatusDto { executionCode, summary, details }` |
| Transactions | `POST /ext/v1/new/transaction` opens a batch and returns its `batchId`; writes carry `batchId`; `POST /ext/v1/end/transaction` closes it |

---

## 1. Scheduling scenarios — validation

What Goal generated from a service. Read-only, and the base of the planned validation: compare a scenario with the nyx plan it came from, check vehicles and duties, find imbalances.

| Call | Returns |
|---|---|
| `GET /ext/v1/schedulingScenarios/detail` | Every scenario: `scenarioCode`, `scenarioName`, `shortCode`, `associatedLines`, `dayType`, `depot`, `status`, `publicationPeriods`. The way to list them |
| `GET /ext/v1/schedulingScenarios?startDate&endDate` | Scenarios active per date, by publication period. Empty for a date outside every period |
| `GET /ext/v1/schedulingScenarios/{externalId}` | One scenario |
| `GET …/{scenarioCode}/metrics` | KPIs: `vehicles` (total, by depot, by type), `drivers` (total, by residence, by shift), `commercialKilometers`, `emptyKilometers`, `operationTime` and `workingTime` (hours) |
| `GET …/{scenarioCode}/timetable` | One row per trip stop: `lineCode`, `direction`, `tripCode`, `routeCode`, `order`, `placeCode`, `arrivalTime`, `departureTime`, `distance` (of the leg), `serviceCode`, `logicalVehicleCode`. Filters: `lineCode`, `routeCode`, `tripCode`, `logicalVehicleCode`, `direction`, `fromTime`, `untilTime` |
| `GET …/{scenarioCode}/events` | The solution as events, ordered by start: `eventTypeCode`, times, places, `duration`, `distance`, `tripCode`, `serviceCode`, `logicalVehicleCode`, logical day/week. Includes what isn't a trip (empty trips, breaks) |
| `GET …/{scenarioCode}/logicalVehicles` | Per vehicle: start/end of duty and place, `dutyDuration`, `circulationTime`, `distance`, `vehicleType`, `lines`, `driverChanges`, `depotCode` |
| `GET …/{scenarioCode}/logicalServices` | Per duty (driver): `shiftType`, start/end and place, `dutyDuration`, `distance`, `lines`, `logicalVehicles`, `busChangeCount`, `lineChangeCount`, counters `work`, `brk` (break), `dsp` (travel), `exp` (expedition), `empty` |

- `tripCode` is the GTFS `trip_id`, so every trip ties back to nyx.
- `serviceCode` is the duty (logical service) and `logicalVehicleCode` the vehicle, both prefixed by the scenario (`3990_8`).
- A full weekday timetable (45,181 rows) takes about 4 minutes at 500 rows per page.

**Not covered:** `/ext/v1/schedulingLDScenarios` and its `logicalVehicles`, `logicalPersonnel`, `sequence` carry `commercialPackageCode` and look meant for long-distance service. Not used here.

---

## 2. Daily operation — roster

The daily schedules generated from a logical schedule, per person and per vehicle.

The planned adjustment, as the operation does it:

1. The daily schedules are generated in Goal, which puts everyone left over as a reserve (`STAND_BY`).
2. Nyx compares the reserves of the day with how many the operation needs. The surplus is the number of compensation days off to give.
3. Nyx chooses who gets them by the balance of the hour bank it keeps ([rostering.md](../../architecture/transit/rostering.md)). Goal has no hour bank.
4. Nyx gives each one a `COMPENSACAO` day off through `POST /ext/v2/absence`. Nyx must enforce its own limit on them, since the API doesn't.
5. The planner puts one of the remaining reserves in each duty that opened, in Daily Operation. The API can't do this step.

### Reads

| Call | Returns |
|---|---|
| `GET /ext/v1/staff/assignment?startDate&endDate` | Per staff member and day: `assignmentType` — `TASK`, `DAY_OFF`, `STAND_BY`, `ABSENCE`, `UNASSIGNED`, `INCIDENCE`, `REMOVE_ABSENCE`, `ON_LEAVE` — with times, places, `tripCode`. Only what was published in Rostering. Filters: `depotCodes` (one company once Goal adjusts the Rostering rules), `businessUnitCodes`, `workingGroupCodes`, `staffCodes`, `assignmentTypes` |
| `GET /ext/v1/standBy?startDate&endDate&limit` | Standbys (reserves): `code`, `date`, places, `shiftName`, `hourly` |
| `GET /ext/v1/task?startDate&endDate` | Tasks (duties of the day): places, times, `drivingTime`, `paidTime`, `breakTime`, `overTime`, `nightTime`, `amplitude`, `workingTime`, `lineName`, `serviceName`, `shiftCode` |
| `GET /ext/v1/task/event` | Events of tasks (trips, breaks…), by `taskCodes`, `tripCode` or `eventType` |
| `GET /ext/v1/staff/bookOnBookOff?startDate&endDate` | Sign-on / sign-off per person and day |
| `GET /ext/v1/dailyWorkReport?staffCode&startDate&endDate` | Daily work report: up to three periods, `workTime`, `extraHours`, `duration`, `comment`, custom properties, `status`. One person per call |
| `GET /ext/v2/absence?startDate&endDate` | Absences: `absenceCode`, `absenceConfigShortName`, `date`, `staffCode`, hours |
| `GET /ext/v1/absenceConfig` | Absence types (see [behavior.md](behavior.md#absence-types)) |
| `GET /ext/v1/staff` | Staff members; `/staff/detail`, `/staff/inactivity`, `/staff/documentQualification` for more |
| `GET /ext/v1/vehicle/assignment?startDate&endDate` | Per vehicle and day: `VEHICLE_TASK` / `VEHICLE_ABSENCE`, `logicalVehicle`, trips |

### Writes

| Call | Does |
|---|---|
| `POST /ext/v2/absence` | Creates absences: `{ absenceCode, absenceConfigShortName, date, staffCode, startHour?, endHour? }`. `absenceCode` is ours and not editable |
| `PUT` / `DELETE /ext/v2/absence/{absenceCode}` | Changes or removes one |
| `PUT /ext/v1/dailyWorkReport`, `/statusUpdate`, `/batchValidation` | Changes reports and their status |
| `POST /ext/v1/task`, `PUT /ext/v1/task`, `POST /ext/v1/task/delete` | Creates, versions or deletes tasks. The `PUT` keeps the assignment as is |

**Not in the API:** assigning a person to a task or removing a standby. Goal confirmed it (2026-11-23): that's done only in Daily Operation. `POST /ext/v1/task` creates a new task with no driver, so it can't fill an existing one. Giving the day off goes through the API; putting the reserve in its place stays manual.

---

## 3. Catalog

What a GTFS load creates, and what an integration could write instead of the file.

| Call | Read returns / write takes |
|---|---|
| `GET /ext/v1/line` | Lines: `lineCode` (immutable, the GTFS `route_id`), names, `color`, `parkingCode`, `vehicleTypeCode` |
| `GET /ext/v1/place?startDate` | Places: `placeCode` (immutable), `shortName`, `commercialName`, `type` (`COMMERCIAL` / `OPERATIONAL`), `location` |
| `GET /ext/v2/route?startDate` | Routes: `routeCode` (hash), `routeShortName` (`<line>_<direction>_<n>`), `lineCode`, ordered `places` with `main` (the two ends) |
| `GET /ext/v2/section?startDate` | Sections (place pair, distance, time per slot). Came back empty |
| `GET /ext/v1/depot`, `/ext/v1/parking` | Depots and parkings |
| `GET /ext/v1/dayType`, `/ext/v1/vehicle/vehicleType` | Catalogs |
| `POST /ext/v1/place`, `/ext/v2/route`, `/ext/v2/section`, `/ext/v1/line`, `/ext/v1/depot` | Create or update — an alternative to the GTFS load, never tried |

---

## Manual loads

These steps are done by hand in the web app, by design: nyx generates the file and the user imports it. Their schemas are in the specification, but no operation uses them.

| Step | Schema | How it's done |
|---|---|---|
| Idle matrix | `EmptyTripsMatrixDto` (`matrixName`, `dayTypeCode`, `emptyTrips` with distance, time slots and route points) | CSV from nyx, imported into a matrix created by hand |
| GTFS | `GtfsFileBuildDto` (lines and services in a date range) | Feed from nyx, imported as a service |
| Scenario publication | `IntegrationPublishSchedulingScenarioDto` (`newServiceName`, `dayRanges`) | In the web app |

A service's content (timetable offer) can't be read through the API either; it's only on screen.

---

## Out of scope

Present in the API, not relevant to the operation as it is: long-distance ticketing and trips (`trip`, `scheduledTrip`, `commercialPackage`, `standardSeatMap`, `serviceClass`), VDV 452 export (`vdv452`), payment groups, document qualifications, vehicle registry and unavailability, real-time dispatch (`realTime/dispatchOperationData`), external notifications (`/integration/notifications/external`).
