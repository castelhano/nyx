# Goal — open questions

> Questions taken to Goal's support and what came back. Move an answer to [behavior.md](behavior.md) or [api.md](api.md) once it's settled.

---

## Open

| # | Question | Status |
|---|---|---|
| 8 | Should `absenceConfigShortName` be `COMP`? | Goal is checking MTU's configuration (2026-11-23) |
| 13 | How to filter one company: `depotCodes`, `businessUnitCodes` or `workingGroupCodes`? | Goal will adjust the Rostering rules to the two depots of each company, so filtering by depot works (2026-11-23). Waiting for the adjustment |
| 15 | How are Goal's places tied to Globus's, for the on-board report? The places loaded via GTFS have codes of their own | pending |
| 16 | Do absence types reach Globus through "ID do GoalBus Motorista"? | pending |
| 17 | Cittati needs settings now made in Globus's planning module (route suffix, pull-out and pull-in). How do they come from Goal? | pending |
| 18 | Support mentioned a missing shape for route `1590` (the 380 inbound, `380_2_2`). The feed has its trace and the engine got the route; details asked | pending |
| 19 | Is `COMP` set to remove the previous assignment? Answer 5 depends on it | to ask |
| 21 | Can an absence be given for the current day, or for a day already started? Answer 6 covers only future dates | to ask |

15–17 were asked in the meeting of 2026-11-05.

---

## Answered

Goal's answers of 2026-11-23, by e-mail. The settled facts are in [behavior.md](behavior.md#daily-operation) and [api.md](api.md#2-daily-operation--roster).

| # | Question | Answer |
|---|---|---|
| 1 | Does `external-client` have write access? | Yes: GET, POST, PUT and DELETE on the operations the API offers. Absences go through `POST /ext/v2/absence` |
| 2 | Can a person be put in a task of an already scheduled day, leaving the reserve? | No, not through the API. It's done in the Daily Operation module |
| 3 | Does `POST /ext/v1/task` take the person? | No. It creates a new task with no driver, listed as available in Daily Operation |
| 4 | Is there a test environment? | Not now |
| 5 | What happens to the task when a `COMP` is given? | If the absence type is set to remove the previous assignment, the task is left without a driver and the planner picks a replacement in Daily Operation (see 19) |
| 6 | Can an absence be given over a daily schedule already generated? | Yes, for a future date where the person already has a task (see 21) |
| 7 | Does the 3-day limit apply through the API? | "It can also be managed through the API" (see 20) |
| 20 | Does the API refuse a fourth day? | No: the API has no limit. The 3 days apply only in the driver's request app (2026-11-23) |
| 9 | Does deleting a wrong day off give the task back? | No |
| 10 | Is the driver told in the app? | Yes, both of an absence given through the API and of a task reassigned in Daily Operation |
| 11 | Does the daily schedule show in `staff/assignment` before publication? | No: it returns what was published in Rostering and is available in Daily Operation |
| 12 | Do reserves show as `STAND_BY`, with time and place? | A standby has a working day in the roster and no task, and can cover a vacancy. A presentation place can't be set for it today |
| 14 | Is `staffCode` the employee number (matrícula)? | Yes. It's the "Código" column of Goal's driver registry, and MTU filled it with the matrícula (2026-11-23) |
