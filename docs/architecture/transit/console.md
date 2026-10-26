# Painel de Escala (Console)

> Architecture reference for the Painel de Escala.
> Source: `apps/api/src/modules/transit/console/`, `apps/web/src/app/transit/console/`,
> types in `packages/schemas/transit/console.schema.ts` and `console-actions.schema.ts`.
> Plan and decisions: `docs/proposal/brainchild/plan_roster_console_impl_v1.md`.

---

## Overview

The Painel answers one question — **is my roster balanced?** Do I have crew for every shift and
line, and is what's left over (vacations aside) well spread over the shifts?

- It works on the **planned** side: the **effective** logical plans (per scope × day type, the
  non-draft `VehiclePlan` with no `validTo`, even when it starts later) against the **planned
  crew** (each crew member's open shift link — an adjustment scheduled for later already counts).
- It **never rosters anyone**. Allocation stays with the generator and the Escala screen; the
  Painel adjusts crew records (shift, rest group, pattern, line access / priority, new profiles)
  so the generator works on balanced ground.
- Generated days only show up as a warning (planned days up to 30 days ahead with error issues
  or outdated), linking to the Escala.
- Context: **scope + empresa + role** (an empresa operating more than one scope is a
  configuration alert — the crew isn't split per scope).

---

## Files

```
console/
  console.input.ts     Prisma → ConsoleInput (plans, duties, crew, window, records, generated days)
  console.calc.ts      ConsoleInput → ConsoleSnapshot (pure): staffing, coverage, shifts, groups,
                       lines, crew records, alerts, menu status
  console.actions.ts   the adjustments (pure): suggestions per kind, crew after the moves, impact
  console.service.ts   snapshot, suggest / preview / apply, adjustments log, selection rule
  console.controller.ts GET /transit/console, actions, adjustments, rule — CASL subject `Console`
  *.spec.ts            the calculation and the actions on synthetic crews
```

---

## The calculation

**Reference window.** 35 days from today (5 weeks: cycles of 7, 14 and 28 days and a month's
start/end inside). Each date gets its day type from the day types' patterns
(`DayTypeService.patternResolver`) — line calendar exceptions and holidays are left out, they're
one-off. The window is technical, never shown as a horizon.

**Demand.** The empresa's duties of the role in each effective crew plan (`Duty.branchId` = the
empresa, or null in a scope it operates alone — null in a shared scope is the `BRANCH_NONE` duty
issue and `DUTY_NO_BRANCH` alert, out of the demand), plus the reserve targets of the day type
as plantões, in the shift their hours fit (`bestShift`). Each duty keeps its shift (`Duty.shiftId`),
lines (trip minutes) and vehicle types.

**Supply.** Crew members of the role, active employee, `isRosterable`, with a shift link, not away.
**Vacations never take anyone out** — the balance is the crew's, vacations aside. Only an approved
absence that isn't vacation and runs at least `transit.roster.awayMinDays` (default 15) from today
does. A crew member works on a date by his rest pattern (his own, else his shift's) and group.

**Per shift × day type.** `worst` = crew of the shift working on the worst date of the type,
`balance = worst − demand` (the average shows as detail). `required` = the busiest day type's
demand × cycle ÷ days worked of the shift's regime (6x1 → 7/6).

**Coverable.** Shift labels are approximate — the generator's eligibility is by fitting the window.
So each day type also gets the most duties the crew can cover on its worst date: the roster
generator's own model (`RosterModel` over the window, `pairRule` for the fixed rules,
`coverageByDay` for the matching) — the Painel never says "ok" to a crew the generator can't roster.

**Shifts.** Sign-on histogram per day type over the shifts' windows, duties fitting no shift,
duties fitting two shifts (decided by priority only), shifts idle on a day type, shifts with duties
and no crew. Changing a shift window is a suggestion with a link — it changes the shift of duties in
every plan.

**Rest groups.** Per shift and pattern: the crew per group and the spread the demand asks for
(`idealGroupCounts` — one at a time to the group that leaves the worst day best; ties: the group
whose days off have the most to spare, then the one he's already in, then the emptier). Weekday
chart of supply × demand, longest run of days worked in the cycle.

**Lines per shift** (never the whole day — spare crew in the morning don't cover the afternoon):
each duty counts for its dominant line; `need` = duties of the busiest day type × cycle factor;
`enabled` = crew of the shift who may operate it (line access mode + vehicle types); `ideal` = need
+ `transit.roster.lineMarginPct` (default 20%, room for vacations and absences). Enabled below the
need is an error (`LINE_SHORT`), below the margin a warning (`LINE_MARGIN`); "Habilitar" suggests up
to the margin. `bonded` = those with it as a priority (empresa) or preferred (crew member) line —
informative only, listed collapsed: the generator spreads the lines without preferences.

**Alerts** (`CONSOLE_ALERT_CODES`) are pure functions over the blocks, each with severity and the
menu section it opens; the menu status is the worst severity per section.

---

## Adjustments

Every action: **suggestion** (server, by the selection rule) → **editable list** (swap, group,
pattern) → **impact** (recalculated on the server: balance and coverable before → after, warnings)
→ **apply** (one transaction, revalidated: anyone changed since the suggestion → 409) →
**RosterAdjustment** record (who, when, kind, effective date, rule, each crew member before →
after), listed in "Ajustes". No undo — reverting is a new adjustment the other way.

| Kind | Changes | Date |
|---|---|---|
| `shifts` | `CrewMemberShift` from the date (`startShift`, replacing a link scheduled later) + group | yes |
| `groups` | `CrewMember.restOffset` (and `restPatternId` when the row switches pattern) | no — next generation |
| `lines` | `CrewMemberLine.access` by the empresa's mode | no |
| `priority` | `CrewMemberLine.priority` | no |
| `profiles` | new `CrewMember` + its first `CrewMemberShift` | yes |

**Selection rule** (`transit.roster.rebalanceRules`, edited only in the Painel): fixed filters —
his bounds fit the destination window, he operates most of its duties (lines, vehicle types) —
then tie-breaks in order: **most recent in the shift** (`CrewMemberShift.validFrom`), **most recent
hire** (`Employee.hireDate`), matrícula last. A third criterion, **distribute lines across the
groups** (`lineSpread`, default first), weighs only in the rest groups suggestion: who leaves an
overfull group is first who has his lines (priority or preferred, with duties in the shift)
concentrated there above their fair share (∝ the group's ideal size), and he goes to the open group
where they are least represented. Rules saved before a criterion existed get it active, at its
default place (`withAllCriteria`).

**Day types balanced.** Only those with an effective crew plan (`planned`) — on the others the only
demand left is the plantões. None at all: every suggestion is refused (`CONSOLE_NO_PLAN`), except new
profiles, whose shift is then picked by hand ("Aplicar aos selecionados" sets shift, pattern and
group for every selected row). Some only: the suggestion notes the day types left out.

**Profiles.** One employee at a time: where he lowers the shortage the most (ties: the worst day);
with no shortage left, the shift with the thinnest crew for its duties (crew ÷ duties over the
window) — a shift without duties gets no one. His group: the one lowering the shortage, then the
best worst day, then the emptiest (no stacking when the groups tie). Shift, pattern ("do turno" =
none of his own) and group are editable per row.

**Shifts.** Short shifts by worst balance; donors are the shifts with spare crew, never left short.
A move is kept when it lowers the destination's shortage (Σ duties missing crew over the window —
one person rarely lifts the worst day, as he's off on one of them); his group in the destination is
the one that lowers it most. Moves are dropped from the end while the crew would cover fewer duties
than before.

---

## Generated days keep what they were generated with

Rest groups and patterns have no history: changing them changes every date. So each generated day
stores the rest cycle each crew member was generated with — `DailyOperation.crewContext`
(`{ [role]: { [crewMemberId]: { restPatternId, restOffset } } }`), written for every day an
accepted generation writes. The day-off checks (the `CREW_ON_DAY_OFF` issue, the Escala grid's
"folga do regime" mark and the day panel) read it (`daily/crew-context.ts`); without it, the current
settings. Applying an adjustment to a generated day = generating it again.

---

## Priority lines

`CrewMemberLine.priority`: lines the empresa sets for a crew member, beyond his own preferences, with
no limit; the crew portal shows them but can't change them. The roster generator weighs them through
the `priorityLine` criterion (`transit.roster.range`, default weight 30, above `driverPrefLine`'s 20)
— the same share calculation as the preferences, over the priority lines.
