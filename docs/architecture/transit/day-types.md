# Day Types and Special Days

> Architecture reference for how a line's day type is resolved on a date, and how special days (Férias, Especial) are planned and run.
> Source files: `apps/api/src/modules/transit/timetabling/day-type/day-type.service.ts`, `apps/api/src/modules/transit/timetabling/vehicle-plan/plan-day-type.utils.ts`, `apps/api/src/modules/transit/timetabling/calendar-exception/` and `apps/api/src/modules/transit/daily/daily-materialize.ts`

---

## Overview

A `DayType` either has a `pattern` (Útil, Sábado, Domingo), which matches dates on its own, or has none (Férias, Especial). A day type without a pattern only applies through a `LineCalendarException` ("Troca tipo dia" in the UI), never by date.

The daily operation, the DOP and the roster all ask the same question per date and line: which day type runs here? The answer picks the vehicle plan in force for that day type and the line's scope.

---

## Resolution

`resolveDayType(date, lineId)` and its batch twin `buildDayTypeResolver(from, to, lineIds)` apply three steps:

1. An exception with no `sourceDayTypeId` (UI: **De** empty) covering the date → its `overrideDayTypeId`.
2. Otherwise, the patterned day type that matches the date (lowest `priority` first).
3. An exception whose `sourceDayTypeId` equals the step 2 result → its `overrideDayTypeId`. Otherwise, the step 2 result.

Within a step, the exception with the latest `validFrom` wins.

An exception targets either a whole scope (`scopeId`, which also covers lines created later) or a list of lines (`LineCalendarExceptionLine`), never both and never neither. The service enforces this rule.

Vacations use a **conditional** exception: De = Útil, Para = Férias. An unconditional one (De empty) would also turn the period's Saturdays and Sundays into Férias.

---

## Special day plans

A special plan is a `VehiclePlan` whose day type has no pattern. It derives from a conventional plan through `baseDayTypeId` (`assertPlanDayTypes`):

| Plan day type | `baseDayTypeId` |
|---|---|
| With pattern (U/S/D) | must be `null` |
| Without pattern (F/E) | required, and the base must have a pattern |

Neither field can change after creation. The usual way to create one is **Duplicar como dia especial** on a conventional plan, which copies the whole plan with `dayTypeId = special` and `baseDayTypeId = source`.

**The special plan is complete.** It holds every line of the scope that runs on that day, with its own vehicles, interlines and duties, so the solvers see the whole day.

**Borrowed OSOs.** A line in a special plan may pin an OSO of the plan's day type or of the base day type (`pinnableDayTypeIds`). Lines that don't change keep the base OSO and are not duplicated. A borrowed OSO is **never written from the special plan**: attribute propagation and sync refuse it, and the Gantt flags the line as `isBorrowed`. If the line diverges, the fix is a new OSO of the special day type (**Nova OSO**).

Activation warns, without blocking, about the scope's active lines missing from the special plan. Service requirements are checked against the day type of each line's pinned OSO.

---

## Lines outside the special plan don't run

When a line resolves to Férias and isn't in the Férias plan in force, it is left out of that day. This is intentional.

**There is no fallback to the patterned day type's plan.** A fallback would bring back, through the Útil plan, a line that was removed from the vacation service.

---

## Mixed days

An exception may send only part of the lines to a special day type, so one day can mix plans (U, F and E). `daily-materialize.ts` merges them as usual. Each plan only brings its own lines' trips, and it records every plan it used in `DailyOperation.sources`.

Interlines and duties that cross two plans come out broken (`BLOCK_REMOVED`). They are repaired in the daily roster.

---

## Out of scope

- **GTFS:** the export refuses day types without a pattern. Exporting special days would need `calendar_dates` built from the exceptions.
- Duplicating from one special day type to another (F → E).
- Re-pinning borrowed lines in bulk when the base OSO gets a new version. Each line shows that its pinned OSO was superseded, as in any plan.
