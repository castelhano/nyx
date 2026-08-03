# Line Schedule Generator (Gerador de Proposta de Atendimento por Linha)

> Planning document — nothing here is implemented yet.
> Scope: `apps/web/src/app/transit/vehicle-plan/[id]/`, `packages/schemas/transit/line.schema.ts`, `apps/api/src/modules/transit/timetabling/vehicle-plan/`.

---

## 1. Motivation

Today, populating a line's trips inside a `VehiclePlan` (in edit mode) has two paths:

- **Adopt an OSO** (`LineSchedule` + `LineDeparture`s) via `SwitchLineScheduleModal` — materializes trips from an already-approved (or draft) schedule.
- **Add a single trip by hand** via `AddTripModal` — one departure at a time, fully manual.

There is no way to say *"generate a full day of departures for this line, from a target fleet size and operating window, and let me tune it before committing."* This proposal adds that: an interactive modal, triggered from the Gantt in edit mode, that turns a fleet/frequency/interval configuration into a full set of proposed trips — entirely in memory, editable with the existing pending-changes machinery, and persisted only when the user saves.

The output is always a **new draft OSO** — the currently approved OSO for the line is never touched. This is a proposal-drafting tool, not an editor for the official schedule.

---

## 2. Existing building blocks (confirmed reusable)

| Concern | Where | Reuse plan |
|---|---|---|
| Pending in-memory edits, merged into the Gantt before save | `page.tsx` — `pendingAdds`, `pendingChanges`, `mergedPlottedData` | Generator output becomes a batch of `PendingAddTrip` (+ `PendingAddDeadrun` for access/recolhida, `PendingAddInterval` for breaks) |
| Cycle time per direction/time-of-day | `TransitLine.metrics.windows[direction]`, `resolveCycleWindow()` in `vehicles.view.ts` | Seed data for the generator's own window editor (see §4.1) |
| Demand per hour | `TransitLine.metrics.demand[dayTypeCode][direction][hour]`, chart precedent in `DemandChartModal.tsx` | Base series for the oferta×demanda chart, adapted to Bar=oferta / Line=demanda |
| Interval/break model | `PendingAddInterval`, `IntervalType.minMinutes/maxMinutes`, `computeIntervalIrregularity()` | Auto-inserted breaks between round trips per vehicle |
| Access/return deadruns | `AddTripModal`'s depot picker + `getTravelTime()` (`travel-time.ts`), `buildFakeAccessReturn()` in `page.tsx` | Same idea, applied per vehicle's first/last trip instead of a single trip |
| OSO drafting from a set of departures | `VehiclePlanService.createLineSchedule()` | Same pattern (create `LineSchedule` DRAFT + `LineDeparture`s), but sourced from generated departures instead of trips already in the plan |
| Trip replacement for a line+dayType | `VehiclePlanService.clearLinesFromPlan()` / `removeTripsFromPlan()` | Reused to clear the line's current operation in the plan before inserting the generated one |
| "Gerar" modal UX precedent | `GenerateModal.tsx` (solver params) | Visual/interaction reference only — different feature (solver blocks existing trips; this generates new ones) |

---

## 3. Terminology recap

- **Cycle window** (`TransitLine.metrics.windows[direction]`): registered, authoritative cycle time (ida/volta minutes) per time-of-day band. Edited on the Line's own form.
- **Generation window**: a *separate*, ad-hoc set of time bands defined inside the generator modal for this specific run. Seeded from the cycle windows but freely mergeable/splittable — does not write back to `TransitLine.metrics.windows`.
- **OSO** (`LineSchedule`): an approvable schedule version for a line+dayType, made of `LineDeparture` rows. Statuses: `DRAFT → APPROVED → SUPERSEDED/ARCHIVED`.
- **Renewal index** (new): per-direction integer percentage on `TransitLine.metrics`, representing mid-route boarding/alighting turnover that effectively increases carried passengers beyond raw seat count.

---

## 4. Functional design

### 4.0 Entry point

In `page.tsx` edit mode, with exactly one line selected/focused in `LinesPanel` (or a dedicated selection affordance — TBD in implementation), a **Gerar** button opens the new modal, analogous to today's global **Gerar** button but scoped to one line.

### 4.1 Generation windows editor

- Seeded from `TransitLine.metrics.windows[direction]` (per direction: OUTBOUND/INBOUND/CIRCULAR, whichever the line uses).
- User can **merge** adjacent windows (e.g. registered `4–5` and `5–7` become one `4–7` row) or **split** a registered window into narrower ranges that reuse its value.
  - **Merge**: default cycle minutes = `max()` of the underlying registered windows' `minutes`; always user-editable after.
  - **Split**: default cycle minutes = the same value as the original window being split; independently editable per new sub-range afterward.
- Each generation window row is **unified across directions**, not per-direction: `from`, `to`, `outboundMinutes` (ida cycle), `inboundMinutes` (volta cycle), a single `fleetCount`, and a **read-only inline computed frequency**: `avgFrequencyMinutes = (outboundMinutes + inboundMinutes) / fleetCount`. A vehicle runs ida then volta in sequence, so fleet is one number per time band, not one per direction — registered cycle windows for OUTBOUND/INBOUND (which can have different boundaries) are unified into one merged timeline at seed time (§Resolved, was open question #2).
- Prototyped in `apps/web/src/app/playground/` (Phase 1, see §6) — `generator-logic.ts#buildUnifiedWindows` does the seed/merge, confirmed working against deliberately misaligned mock ida/volta windows.

### 4.2 Operation window

Two fields, global to the whole generation (not per generation-window): operation **start** and **end** time. Generation windows must fall inside this range; trips are only generated within it.

### 4.3 Fleet & depots

- Fleet size can be **single-depot** or **split across depots** ("multi-empresa"): a small table of `{ depotId, vehicleCount }` rows, summing to the total fleet used across generation windows.
- **Mandatory only when "Incluir acesso e recolhida" is checked** — the depot is what the travel-time matrix (`getTravelTime`) needs to compute access (garage → first departure locality) and recolhida (last arrival locality → garage) legs.
- Default vehicle capacity: hardcoded `80` (seats), editable per generation run. Will move to a global settings field later — not in this phase.

### 4.4 Interval / break configuration

- Toggle: insert a rest interval between round trips, yes/no.
- If yes: which `IntervalType` (code) to use, applied uniformly across all generated vehicles/cycles.
- Duration/placement follows the same min/max irregularity model already in place (`computeIntervalIrregularity`) — no new rules, just reuse.

### 4.5 Access / recolhida

- Checkbox **"Incluir acesso e recolhida"**, default `false`.
- When enabled: appends one access deadrun before each vehicle's first trip of the day and one recolhida deadrun after its last trip, from/to whatever depot that vehicle was allocated to in §4.3.

### 4.6 Oferta × demanda preview

- Chart shown **before** generating anything, so the fleet/window configuration can be validated against demand first.
- **Bar = oferta** (supply), **Line = demanda** (demand) — inverted from `DemandChartModal`'s current bar-only demand chart, but keeping its established palette/series identity.
- Demand series: straight from `TransitLine.metrics.demand[dayTypeCode][direction][hour]`.
- Supply series (per hour, per direction): derived from the generation windows' frequency and the renewal index —

  ```
  tripsPerHour   = 60 / avgFrequencyMinutes   (for the window covering that hour)
  capacityPerTrip = vehicleCapacity * (1 + renewalIndex[direction] / 100)
  oferta(hour)    = tripsPerHour * capacityPerTrip
  ```

  (Formula assumed from the discussion — to be confirmed once §7's open questions are closed.)

### 4.7 Generate (client-side only)

- Clicking **Gerar** inside the modal runs the whole distribution client-side (no server round-trip), producing:
  - `PendingAddTrip[]` — one round-robin scheduling loop per vehicle across the generation windows, switching cycle time as it crosses window boundaries (same walk-forward approach already used by `handleAdjustCycle` in `page.tsx`, which resolves cycle window per actual departure time as it goes).
  - `PendingAddInterval[]` — if breaks are enabled, one per vehicle per gap between rounds.
  - `PendingAddDeadrun[]` — if access/recolhida is enabled, two per vehicle (first + last).
- Result is merged into the Gantt through the **existing** pending-changes pipeline — fully editable (grow/shrink/push/pull, move between blocks, delete) before saving, exactly like a manual `AddTripModal` entry.
- The modal closes after generating; review/edit happens directly on the Gantt.

### 4.8 Persistence (on Salvar)

This is the part that needs a **new atomic backend endpoint** rather than reusing per-item `add-trip`/`add-deadrun`/`add-interval` calls in a loop (too many round-trips, and it must be all-or-nothing):

1. Remove the line's current operation from the plan for this `dayTypeId` (same semantics as `clearLinesFromPlan`/`removeTripsFromPlan`).
2. Create the generated `TransitTrip`s (+ deadruns, + intervals) as blocks/trips in the plan.
3. Create a new `LineSchedule` with `status: DRAFT`, `approvalRef: DRAFT-<random code>`, seeded with `LineDeparture`s matching what was generated — same idea as `createLineSchedule()`, sourced from the generated set instead of pre-existing trips.
4. **Do not** touch `VehiclePlanLine.lineScheduleId` — leave it exactly as it was.

Consequence worth calling out: this is why the line's dot in `LinesPanel` naturally stays **orange** afterward, with zero special-casing needed — `isDrifted` already means "trips in the plan don't match what's pinned," which becomes true the moment the generated trips replace the old ones. The already-approved OSO is never edited, superseded, or repinned; the new DRAFT is purely a documentation trail for the future approval workflow, exactly as requested.

---

## 5. Data model changes

- `packages/schemas/transit/line.schema.ts` — add `metrics.renewalIndex`, mirroring the shape of `metrics.extensionKm` (object keyed by `OUTBOUND`/`INBOUND`/`CIRCULAR`, each an integer percentage). No Prisma migration needed (`metrics` is `Json?`).
- New backend endpoint, tentatively `POST /transit/vehicle-plan/:id/lines/:lineId/generate-schedule`, wrapping steps 1–3 of §4.8 in a single `$transaction`.

---

## 6. Phased plan

**Phase 1 — modal prototype (next step, this request's actual ask).**
Repurpose `apps/web/src/app/playground/page.tsx`: clear out the current interval-visual-language prototype (it's already served its purpose and isn't referenced anywhere else) and replace it with only this feature's modal, driven by hardcoded/mock data (a fake line with a couple of registered cycle windows, fake demand numbers, fake depots). Goal: validate the interaction design end-to-end —
- generation window merge/split behavior and default-minutes rule,
- inline frequency computation,
- depot allocation table (single vs. multi-depot),
- oferta×demanda chart reacting live to window/fleet edits,
- interval/access toggles.

No wiring to real line data, no generation algorithm, no persistence — just the modal's UX, validated in isolation before touching `page.tsx` or the backend.

**Phase 2 — real data + generation algorithm.**
Wire the modal to real `TransitLine` data (windows, demand, metrics) from within the vehicle-plan page; implement the round-robin scheduling loop and produce real `PendingAddTrip`/`PendingAddDeadrun`/`PendingAddInterval` batches merged into the Gantt via the existing pending-changes state.

**Phase 3 — persistence.**
New atomic `generate-schedule` endpoint (§4.8), OSO draft creation, wiring into `handleSavePending`.

---

## 7. Open questions

**Resolved during Phase 1 prototyping:**

- ~~Fleet vs. direction~~ — settled: fleet is **one number per unified time band**, shared by both directions (a vehicle does ida then volta in sequence). Generation windows merge OUTBOUND/INBOUND into a single timeline instead of two parallel per-direction tables. See §4.1 and `generator-logic.ts#buildUnifiedWindows`. This also resolved the old §5-open-question about where the window editor lives relative to direction — there's one editor, not one per direction tab.

**Still open:**

1. **Renewal index formula** — is it a straight multiplier on capacity (`capacity * (1 + renewalIndex/100)`) as assumed in §4.6 and implemented in the prototype's `computeOfertaSeries`, or does it interact with frequency/oferta differently?
2. **Depot allocation order** — when fleet is split across multiple depots, how are vehicles assigned to depots deterministically (first N vehicles to depot A, remainder to depot B? proportional? user-ordered?). The prototype just lets the user type counts freely per depot row with no auto-distribution algorithm.
3. **Single line vs. multi-line selection** — is "Gerar" restricted to exactly one selected line at a time, or should the modal ever handle a batch of lines? Current assumption: one line per run.

These should be settled during Phase 2; they don't block Phase 1's UX prototype since it uses arbitrary mock assumptions where needed.
