# Goal — open questions

> Questions taken to Goal's support and what came back. Move an answer to [behavior.md](behavior.md) or [api.md](api.md) once it's settled.

---

## API access

Asked in the meeting of 2026-11-05. Goal's development team is deciding whether to grant write access or build the routine themselves; no answer yet.

| # | Question | Answer |
|---|---|---|
| 1 | Does `external-client` have write access? On which endpoints — absences, task assignment? | pending |
| 2 | Can a person be put in a task of an already scheduled day, leaving the reserve? Which endpoint? | pending |
| 3 | If not, is it planned, or is there another way — does `POST /ext/v1/task` take the person? | pending |
| 4 | Is there a test environment with its own API and credentials? | pending |

## Compensation day off

| # | Question | Answer |
|---|---|---|
| 5 | When a `COMP` is given to someone with a task that day, what happens to the task — left without a driver, refused, or a replacement suggested? | pending |
| 6 | Can an absence be given over a daily schedule already generated? Any lock by status or publication? | pending |
| 7 | Does the 3-day limit of `COMPENSACAO` apply through the API? | pending |
| 8 | Should `absenceConfigShortName` be `COMP`? | pending |
| 9 | Does deleting a wrong day off through the API give the task back? | pending |
| 10 | Is the driver told in the app when the day off comes from the API? And of the reserve swap? | pending |

## Reading

| # | Question | Answer |
|---|---|---|
| 11 | Does the daily schedule show in `staff/assignment` as soon as it's generated, or only once published? | pending |
| 12 | Do reserves show as `STAND_BY`, with time and place? Is that the way to find them? | pending |
| 13 | How to filter one company: `depotCodes`, `businessUnitCodes` or `workingGroupCodes`? | pending |
| 14 | Is `staffCode` the employee number (matrícula)? | pending |

## Integration with Globus and Cittati

Asked in the meeting of 2026-11-05.

| # | Question | Answer |
|---|---|---|
| 15 | How are Goal's places tied to Globus's, for the on-board report? The places loaded via GTFS have codes of their own | pending |
| 16 | Do absence types reach Globus through "ID do GoalBus Motorista"? | pending |
| 17 | Cittati needs settings now made in Globus's planning module (route suffix, pull-out and pull-in). How do they come from Goal? | pending |

## Data

| # | Question | Answer |
|---|---|---|
| 18 | Support mentioned a missing shape for route `1590` (the 380 inbound, `380_2_2`). The feed has its trace and the engine got the route; details asked | pending |
