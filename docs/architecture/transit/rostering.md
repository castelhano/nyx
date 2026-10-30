# Rostering (Escala real)

> Architecture reference for the real roster: crew records, the operational day and the roster
> generator.
> Source: `apps/api/src/modules/transit/crew/`, `apps/api/src/modules/transit/daily/`, the
> `CrewShift` / `Duty` parts of `timetabling/`, `apps/web/src/app/transit/daily-operation/`;
> types in `packages/schemas/transit/` (`crew-*`, `rest-pattern`, `daily-operation`,
> `roster-generator`, `settings-roster`, `settings-crew`).
> Related: [console.md](console.md) (Painel de Escala — balances the crew records this roster
> reads), [crew-solver.md](crew-solver.md) (logical duties).

---

## Overview

The logical planning (`VehiclePlan` → `CrewPlan` → `Duty`) has no people and no real vehicles.
The real roster turns it into **who works which duty, in which car, on each date**:

```
VehiclePlan + CrewPlan (in force, per line × day type)
        │  materializeDay(scope, date) — a copy, never adjusted
        ▼
DailyOperation (scope × date) ── DailyBlock / DailyBlockEvent / DailyDuty / DailyDutyPiece
        │  RosterEntry (crew member × date): DUTY, STANDBY, DAY_OFF, COMP_OFF
        │  vehicle on DailyBlock.vehicleId
        ▼
PLANNED ──publish──► PUBLISHED (changes logged) ──close──► CLOSED (read-only)
```

- Everything is per **empresa (branch) × role** (`DRIVER`, `FARE_COLLECTOR`, `ASSISTANT`); the
  day itself is per **scope**. An empresa should operate one scope (the crew isn't split per scope).
- A duty's empresa: `Duty.branchId`, or null in a scope the empresa operates alone. Null in a
  shared scope is the `BRANCH_NONE` duty error — nobody's duty.
- The generator fills the PLANNED days (optionally the PUBLISHED ones); manual edits go through
  the same day endpoints and are always recalculated and checked, never blocked.

---

## Logical side: shifts and line operators

**`CrewShift`** (turno) — a band in minutes of the operational day for the start and for the end:
`floor ≤ idealMin ≤ idealMax ≤ ceiling` each. Inside `[floor, ceiling]` a duty fits; outside the
ideal it still fits, only scored worse. `allowSplit`: SPLIT duties fit it. Shared by the empresas
listed in `CrewShiftBranch`. `restPatternId`: the default rest pattern of its crew.

- **Duty shift** (`Duty.shiftId`): derived on every crew plan recalculation by `bestShift` — among
  the empresa's shifts the duty fits, the lowest `priority`, then the closest to the ideal. None →
  `SHIFT_NONE`. `shiftPinned`: the user's choice, only checked (`SHIFT_MISMATCH`).
- **`LineOperator`** — the empresas operating a line; none = any operator of the scope. Checked as
  `LINE_NOT_OPERATED` (warning) on blocks and duties. With `restrictToBranchLines` ("Consistir
  linha da empresa") the vehicle solver only gives an empresa blocks of lines it operates (hard
  rule; `ScopeOperator.share` chooses among the allowed ones), and the roster generator only takes
  duties of lines the empresa operates.

---

## Crew records

**`CrewMember`** — 1:1 with the `Employee` (branch, status and contract come from there), one role.
Created by hand, by the import or by the Painel ("Criar perfis"); `CrewRoleJobTitle` maps the job
titles that should have one.

| Field | Meaning |
|---|---|
| `isRosterable` | false: out of the generator, still assignable by hand |
| `notBeforeMinutes` / `notAfterMinutes` | replace the shift's hard bounds (earliest start / latest end) |
| `restPatternId` / `restOffset` | own rest pattern (else the shift's) and group in it |
| `blockedVehicleTypes` | types he may not operate |
| `preferredVehicleId` | fixed car — kept by the vehicle step when it can |
| `weeklyHours` | overrides the contract's; monthly load = weekly × 5 |
| `licenseExpiresAt` / `courseExpiresAt` | CNH and collective transport course — checked per date |
| `overtimePreference` | LIKES / NEUTRAL / AVOIDS — weighs `overtimePref` |
| `standbyRank` / `standbyBlocked` | the plantão in his preferences (as if a line) / never on plantão |

- **`CrewMemberShift`** — his shift over time, no overlap, null `validTo` = open. A shift starting
  later closes the open one the day before (`startShift`, which also replaces a link scheduled
  after the new date).
- **`CrewMemberLine`** — one row per crew member × line:
  - `access` reads by the empresa's `lineAccessMode`: WHITELIST = only his ENABLED lines,
    BLACKLIST = all but his BLOCKED ones;
  - `rank` = his preferred lines (1 = primary, up to `maxPreferredLines`), weighted by
    `preferredLineGrades`;
  - `priority` = the empresa's priority lines for him (no limit, the crew portal can't change them).
  - A preferred or priority line must be one he may operate.
- **`RestPattern`** (regime de folga) — `pattern` one char per day (`T` works, `F` off) from
  `anchorDate`. The day of the cycle on a date = `(date − anchor + restOffset) mod length`, so the
  crew of one pattern with different offsets are its **groups** (A, B…): a week apart
  (`staggered: false`, cycle a multiple of 7 — same weekdays off) or a day apart (`staggered: true`).
  `offOnHolidays`: also off on the empresa's holidays.

### Occurrences

**`CrewOccurrence`** — what changes a crew member's availability; only APPROVED takes effect.

- `ABSENCE` (with a `CrewAbsenceType`): out on `[startDate, endDate]`. The type's `effect`:
  - `ABSENCE`: unavailable and reduces the period load;
  - `DAY_OFF` / `COMP_OFF`: its approval puts the day off on the roster (`RosterEntry` with
    `crewOccurrenceId`) on each day he has nothing else — a day with a duty keeps it and shows the
    absence as a pendência.
- `TIME_WINDOW`: works, but only inside `[startNotBefore, endNotAfter]` ("parar até X horas").
  Windows of one day add up (latest start, earliest end); an absence takes the whole day alone.
- `origin`: `STAFF`, `STAFF_ON_BEHALF` or `PORTAL`. A request keeps what was asked in `requested`
  (requests made × granted). Only the portal limits a request to one day.
- System types (`systemKey`): `WEEKLY_OFF` and `COMP_OFF` — the roster's own days off; `VACATION`
  (férias) — may name a ferista (`coverCrewMemberId`, one férias at a time). Launched in bulk by
  the Férias screen; on days already generated the titular's duties are released, each going to
  the ferista when he's free on the day (`vacation-release.service.ts`).

---

## The operational day

**`DailyOperation`** (scope × date) — copied, never adjusted, by `materializeDay`:

- each active line of the scope runs the plan of the day type it resolves to on the date
  (`resolveDayType`: the day types' patterns + `LineCalendarException`);
- a normal day has one plan. A **mixed day** (lines under different day types) copies from each
  plan the blocks holding trips of its own lines, keeping only those trips; duties touching a
  copied block come along, a piece on a block that didn't come is stale. Secondary plans'
  blocks / duties are renumbered after the primary's;
- `sources` records, per line, the plans the day came from; the plain `source*Id` fields keep the
  link (the plan may change or go away — the day is outdated, not broken).

Its tables: `DailyBlock` (a vehicle's day, `vehicleId`), `DailyBlockEvent` (trips, deadruns and
intervals; a trip with no block is `TRIP_UNCOVERED`, a cancelled one stays for the record),
`DailyDuty` / `DailyDutyPiece` / `DailyDutyActivity`.

**Plantões** — the empresa's `reserveTargets` (per day type, role, window, locality, count) are
STANDBY duties synced into every PLANNED day; plantões extras asked at a generation carry its job
id (`standbyExtra`) and are replaced by the next accepted generation.

**`RosterEntry`** — what a crew member does on a date, **the** roster: `DUTY` / `STANDBY` (one
daily duty, at most one holder), `DAY_OFF` (rest pattern), `COMP_OFF` (folga compensada — reduces
the period load). Absences aren't rows: they come from `CrewOccurrence`. `locked` entries are
kept by the generator; `source` = GENERATED, MANUAL or REQUEST.

**`DailyOperation.crewContext`** — per role, per crew member, the rest cycle the day was generated
with (`{ restPatternId, restOffset }`), written for every day an accepted generation writes. The
day-off checks read it (`daily/crew-context.ts`), so changing someone's group only reaches the days
generated after; without it, the current records.

### Checks

Every edit recalculates the day: duty summaries / issues through the crew calculation (over the
day's blocks — `daily-relief.ts`), block issues through `validateBlock`, then the day's own checks
(`daily-checks.ts`). They never block a save; they become `DailyDuty.issues` / `DailyBlock.issues`
(`DAILY_ISSUE_CODES`):

| Duty / crew | Block / vehicle |
|---|---|
| `DUTY_UNASSIGNED`, `RESERVE_SHORT` (plantão without anyone) | `BLOCK_NO_VEHICLE`, `BLOCK_NO_CREW` |
| `CREW_ABSENT`, `CREW_ON_DAY_OFF`, `CREW_INACTIVE`, `NO_SHIFT` | `VEHICLE_DOUBLE`, `VEHICLE_UNAVAILABLE` |
| `CREW_MULTIPLE_DUTIES`, `CREW_BRANCH_MISMATCH`, `STANDBY_BLOCKED` | `VEHICLE_TYPE_MISMATCH`, `VEHICLE_BRANCH_MISMATCH` |
| `SHIFT_WINDOW`, `CREW_WINDOW`, `LINE_NOT_ALLOWED`, `VEHICLE_TYPE_BLOCKED` | |
| `INTER_SHIFT_REST`, `LICENSE_EXPIRED`, `COURSE_EXPIRED`, `SHIFT_IDEAL` (info) | |

Two windows, two checks: the **shift's** bands (`SHIFT_WINDOW`; only info on a duty he's fixed to)
and **his own limit** on the date (`CREW_WINDOW`; holds even on a fixed duty) — his
`notBeforeMinutes` / `notAfterMinutes` narrowed by approved time windows (`crewLimit`,
`CrewLimit` / `limitFits` in `@nyx/schemas`). The limit only narrows: one wider than the shift has
no effect, a duty outside the shift is `SHIFT_WINDOW`'s call. The rest between days
(`INTER_SHIFT_REST`) is the CCT rule `interShiftRest` of the crew settings (per scope).

Vehicles: `VehicleUnavailability` (fleet) takes a car out on `[startDate, endDate]`.

### Publication

- `PLANNED` → `PUBLISHED`: from then on every change that affects crew is logged in
  `DailyChangeLog` (action, entity, before / after, `crewMemberIds` affected) — the source of the
  crew notifications.
- `CLOSED`: executed, read-only. Admins may step a day back one status (a mistake).

---

## The roster generator

"Gerar escala" (`roster-generator.*`) — one empresa × role over a horizon of up to 31 days
(`RosterGeneratorParams`). Starting it materializes the missing days, reads the data
(`roster-generator.input.ts`) and runs the search in a worker thread, streaming progress (SSE). A
generation lives in memory, one per empresa / role, until accepted, discarded or 30 min after it
ends.

**Input.** The duties of the PLANNED days (and PUBLISHED, with `includePublished`) of the scopes
the empresa operates, not held by a fixed entry; its rosterable, active crew of the role, with what
each day means for each (`free`, `off` = rest pattern day off, `away` = absent / inactive / no
shift / fixed day off, `fixed` = holds a fixed duty). Fixed: locked, on a day no longer PLANNED, a
folga compensada or a day off entered by hand. Férias with a ferista: on those days he takes the
titular's place (preferences, last duties, rest pattern).

**Rules** (`pairRule`): a crew member must be free on the day and the duty's lines operated by the
empresa (`restrictToBranchLines`). Configurable per empresa (`ruleModes`), BLOCK = never, WARN =
only as a last resort (`WARN` cost each, the day shows the issue):

- `lineAccess`: a line he may not operate;
- `vehicleType`: a vehicle type blocked for him;
- `shiftWindow`: outside his shift's window — WARN lets one shift take another's duties (a Tarde
  crew member off on Saturday on a Sunday morning);
- `crewWindow`: outside his own limit (bounds, approved time windows) — kept apart from
  `shiftWindow` so crossing shifts never breaks them;
- `interShiftRest`: rest below the minimum between days;
- `license` / `course`: CNH or course expired on the date.

**Objective** — lexicographic, each level outweighing everything below:

1. coverage — `UNASSIGNED` per duty without a crew member, `UNASSIGNED_STANDBY` per plantão
   (filled with whoever is left over);
2. WARN rule violations;
3. preferred crew members of a duty (`Duty.constraints.crewMemberIds`): `PIN` per step down the
   list, `PIN_OUT` for someone off it;
4. with `compensate`: the hour bank — whoever is left free on a day gets a folga compensada, those
   with the most hours (the previous month's balance first) being the ones left free;
5. the score: the average of each crew member's weighted criteria (`transit.roster.range` + the
   crew `interShiftRest` ideal), on the 0–9999 scale of the other solvers:

| Criterion | What it measures |
|---|---|
| `priorityLine` | % of trip minutes on the empresa's priority lines for him (weight 30) |
| `driverPrefLine` | % of trip minutes on his preferred lines, by rank grade (weight 20) |
| `shiftFit` | average minutes away from the shift's ideal start / end |
| `loadDeficit` | % below the period load, pro rata to the horizon (`ensureMonthlyLoad`) |
| `overtimePref` | minutes above the load, for who avoids overtime (load off) |
| `tableChanges` | duty changes in the load period (`maxChanges`) |
| `publishedChanges` | days whose duty changes on a PUBLISHED day (`includePublished`) |

**Continuity.** A duty's identity across days is its signature `crewPlanId#logical duty`; a change
is a different one than the last worked under the same crew plan (a Saturday plan keeps the weekday
sequence apart). The generator keeps people on their table, changing it only when it pays.

**Load.** The load period starts on `loadPeriodStartDay` of the month; target = weekly hours × 5,
reduced by absences and compensatory days off. Minutes before the horizon come from the imported
frequency (`CrewTimesheetDay`) where it has days, else the roster.

**Search.** Construction day by day — a minimum-cost assignment (Hungarian) of the day's duties to
the crew free that day, carrying the state from the days before (last duty per plan, changes,
worked minutes, last sign-off). Then simulated annealing over the horizon: a duty moves to / swaps
with another crew member on its day, or two crew members swap a range of days. The bound shown is
the most duties the crew can cover per day by the fixed rules (`coverageByDay`, also used by the
Painel).

**Accepting.** Writes the best proposal: a GENERATED `RosterEntry` per duty and per rest pattern day
off, replacing every entry that isn't fixed; records the `crewContext` of each day written; redoes
the vehicles (`vehicles`); recalculates the days. On a PUBLISHED day each duty that changes hands
is logged. The generation itself is kept in `RosterGeneration` (who, when, period, params, figures).

**Vehicles** (`roster-vehicles.ts`) — like the crew, every block's car is released first. The car of
a block goes to: its anchor's (the crew member of its earliest DRIVER piece) preferred vehicle →
another crew member's preferred one → the anchor's habitual car (most driven in the last
`habitualVehicleDays`) → another's habitual car → any eligible one. Eligible: the empresa's, active,
available on the date, of a type every line and trip of the block accepts, not on another block of
the date. One minimum-cost matching per date.

---

## The Escala screen

`/transit/daily-operation` — one screen to generate, edit, review requests and publish, per
empresa + role over a day, week or month (context in the URL, the last one remembered):

- **Operadores** (people × days: duty / F / FC / absence / predicted day off, with load and changes
  columns) and **Escalas** (a day's timeline, or duties × days);
- a context panel for the selected crew member, duty or day (publish / close);
- the period's pendências and pending requests;
- **Gerar** in the screen — the proposal shows over the board until accepted or discarded;
- per duty without anyone, **suggestions**: the free crew the rules allow, ranked by the
  generator's score change, with the reasons.

API: `GET /transit/roster-board` (the whole period in one query), swaps, days off and the day's
own endpoints for duty / vehicle / lock edits — each block of edits recalculates each day once, the
neighbors (rest across days) in the background.

---

## Repair ("Reparar")

`daily/repair/` — from the Escala screen (the period's pendências, a day, or one duty), per
empresa × role: **changes as little as possible** to fix them. Proposal → editable list (per
target: the option found, or the options to pick from) → summary per day (published days flagged
with the crew notified) → apply. Each option is a list of steps with what they expect to find
(`RepairStep`: crew `from → to`, vehicle `from → to`, `compOff` removed); the apply checks them all
against the day as it is (409 when it changed, 400 when one person / car is chosen twice on a day)
and writes through `DailyOperationService` (recalculation, `DailyChangeLog` on PUBLISHED days).
Locked duties and days off entered by hand never move.

**Crew** (`crew-repair.calc.ts`) — targets: duties without anyone, or whose holder can't be there
(absent, day off, inactive, no shift, other empresa, a rule in BLOCK mode); a holder only breaking
WARN rules leaves only for someone without any pendência. Plantões aren't targets. Days in order
(a day's moves count for the next one's rest), over the generator's `RosterModel`:

1. **free** — a minimum-cost matching of the day's targets with who has nothing on it;
2. **swap** — a free one takes someone's duty and that one takes the target (one move); only when
   none does, two levels (three people). Fewest people moved, then score;
3. **short crew** — options for the user: cancel a folga compensada the generator gave (the lowest
   hour bank first), or take someone off a plantão of the duty's shift, from the time with the most
   plantões.

**Vehicles** (`vehicle-repair.calc.ts`) — targets: no car, unavailable, wrong type, other
empresa's, the same car on two blocks (it stays where it suits best). A free car by the vehicle
step's preference (`carCost`); else a **type swap**: a block running a car that fits the target and
accepting the free one swaps, the one losing the least preference.

---

## Crew portal

`portal/` — the crew member's own API (`/api/portal/*`), with its own login and guard (never the
staff JWT):

- **Access** (`CrewAccess`): matrícula + 6-digit PIN (argon2). Created at the first login with the
  first PIN — the CPF's first 6 digits —, which must be changed; staff resets it ("Resetar PIN do
  portal"), which bumps `tokenVersion` (older tokens stop). 5 wrong PINs lock it for 15 min;
  logins limited per IP. Token signed with `PORTAL_JWT_SECRET`.
- **Guard** (`PortalGuard`): the token's version, an active employee; until the PIN is changed only
  the change-PIN route answers, and with unread notifications only the notification routes.
- **Permissions** (`PortalProfile` per empresa, `isDefault` for who has none;
  `CrewMember.portalOverride` replaces the fields it sets): see the roster, request absences
  (requestable types) / time windows, edit preferred lines; quotas per absence type and for time
  windows, per week, month (load period) or year — requests from the portal and those entered by
  staff on his behalf, requested or approved, count; a portal request over the quota is refused, one
  launched on his behalf passes with a warning on the launch form (`transit/crew-member/:id/portal-quotas`).
- **Requests**: one day each, `REQUESTED`, what was asked kept (`createFromPortal`); approval stays
  on the Escala screen.
- **Change requests** (`CrewChangeRequest`, `portal-change-request.service.ts`): a lasting change
  with no date — another shift (of his empresa) or another group of his rest pattern, which he picks
  by its days off over the next 4 weeks (holidays counted when the pattern is `offOnHolidays`). One
  open (`REQUESTED` / `QUEUED`) per kind; he sees the status, his place in the queue, and cancels.
  Reviewed in the Painel de Escala (console.md › Change requests). Permissions `requestShiftChange` /
  `requestRestGroupChange`.
- **Notifications** also come from the change requests' steps (queued, rejected, granted) — written
  directly, without a change log.
- **Roster**: only PUBLISHED / CLOSED days — duty, times, lines, cars, days off, absences, windows.
- **Notifications** (`CrewNotification`): made from the `DailyChangeLog` entries naming him (since
  his access exists) the first time the portal reads them; confirmed with "Li e confirmo".
- **Preferred lines**: his ranks only — access, the empresa's priority lines and his plantão rank
  (which takes one of the slots) stay. `transit.roster.portalPreferredLines` = REQUIRED locks the
  portal (after the PIN and the changes to confirm) until every slot is filled — capped by the
  lines open to him, and only when his profile lets him edit them.
- **Screen** (`apps/web/src/app/portal/`, mobile first, public in `proxy.ts`, no app shell): the
  login's "Operador" access; first access → new PIN; unread changes → a "Li e confirmo" sheet over
  everything; tabs Escala (week by week, 4 back / 4 ahead), Pedidos (quotas, new request, history),
  Linhas, Avisos — shown per the permissions.

---

## Settings

- **`transit.roster`** (per empresa, falling back to global): `lineAccessMode`,
  `maxPreferredLines`, `portalPreferredLines`, `preferredLineGrades`, `defaultWeeklyHours`, `loadPeriodStartDay`,
  `habitualVehicleDays`, `reserveTargets`, `ruleModes`, `range`, the hour bank start, and the
  Painel's `awayMinDays`, `lineMarginPct` and `rebalanceRules`.
- **`transit.crew`** (per scope): the CCT rules, `interShiftRest` among them.
