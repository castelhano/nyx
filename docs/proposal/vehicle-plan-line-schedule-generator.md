# Line Schedule Generator (Gerador de Proposta de Atendimento por Linha)

> Status: Phase 1 (UX prototype) and the data-wiring half of Phase 2 are done — see §6. Still missing: the actual generation algorithm (§4.7), the `renewalIndex` schema field (§5), and all of Phase 3 (persistence, §4.8).
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
- Originally prototyped against mock data in `apps/web/src/app/playground/` (Phase 1, see §6), confirmed working against deliberately misaligned mock ida/volta windows; the seed/merge logic now lives in `line-generator-logic.ts#buildUnifiedWindows`, wired to real line data.

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
- **Depot assignment algorithm** (resolves §7 open question #2, ex-"open"): vehicles are not assigned to depots in input order. Each vehicle's starting point is the locality of its first departure — the OUTBOUND terminal or the INBOUND terminal, whichever leg the round-robin schedule happens to place first for that vehicle. Assignment greedily minimizes total access-deadrun distance: for each vehicle, `getTravelTime()` is compared across every depot that still has room under its §4.3 count, and the vehicle goes to whichever depot gives the shortest access leg (e.g. of two vehicles starting the day on IDA vs. VOLTA respectively, each is paired with whichever of the two depots is closer to *its own* starting terminal, not both defaulting to the same one). Once a depot's configured count is filled, remaining vehicles simply fill whatever capacity is left elsewhere — there's nothing left to optimize once a vehicle has only one depot with room.

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

**Phase 1 — modal prototype. ✅ Done.**
Repurposed `apps/web/src/app/playground/page.tsx`: cleared out the prior interval-visual-language prototype and replaced it with only this feature's modal, driven by hardcoded/mock data (a fake line with a couple of registered cycle windows, fake demand numbers, fake depots). Validated end-to-end: generation window merge/split behavior and default-minutes rule, inline frequency computation, depot allocation table (single vs. multi-depot), oferta×demanda chart reacting live to window/fleet edits, interval/access toggles. The prototype logic (`generator-logic.ts`) later moved unchanged into `line-generator-logic.ts` (see that file's header comment) once Phase 2 started, and `playground/page.tsx` has since been reverted to an empty stub — it's not where this feature lives anymore.

**Phase 2 — real data + generation algorithm. 🚧 In progress.**
Done: the modal (`LineScheduleGeneratorModal.tsx`) is wired to real `TransitLine` data — windows, demand, depots, interval types — all fetched live via `useQuery` from within the vehicle-plan page, not mocked. The windows editor, oferta×demanda chart, and depot allocation table all operate on real data already.
Not done: `handleGenerate()` currently only calls `estimateGeneration()` — a rough trip-count/peak-fleet estimate for the modal's own preview footer. The actual round-robin scheduling loop that produces real `PendingAddTrip`/`PendingAddDeadrun`/`PendingAddInterval` batches merged into the Gantt via the existing pending-changes state (§4.7) has not been implemented yet. This is the next concrete step.

**Phase 3 — persistence. Not started.**
New atomic `generate-schedule` endpoint (§4.8), OSO draft creation, wiring into `handleSavePending`.

---

## 7. Open questions

**Resolved during Phase 1 prototyping:**

- ~~Fleet vs. direction~~ — settled: fleet is **one number per unified time band**, shared by both directions (a vehicle does ida then volta in sequence). Generation windows merge OUTBOUND/INBOUND into a single timeline instead of two parallel per-direction tables. See §4.1 and `generator-logic.ts#buildUnifiedWindows`. This also resolved the old §5-open-question about where the window editor lives relative to direction — there's one editor, not one per direction tab.

**Resolved (this update):**

- ~~Depot allocation order~~ — settled: greedy, minimizes total access-deadrun distance per vehicle against depots that still have room, then fills whatever capacity is left once no further optimization is possible. See the algorithm note added to §4.5.
- ~~Single line vs. multi-line selection~~ — settled for this phase: exactly one line per run, as already assumed. Multi-line isn't rejected, just deliberately deferred — it raises coordination questions (shared terminals, intercalation between lines, cross-line depot contention) this phase doesn't need to answer. See new §8.

**Still open:**

1. **Renewal index formula** — is it a straight multiplier on capacity (`capacity * (1 + renewalIndex/100)`) as assumed in §4.6 and implemented in `computeOfertaSeries`, or does it interact with frequency/oferta differently? Also tracked in `docs/TODO.md` ("Definir critério para geração de índice de renovação da linha e campo no form") — this is what's blocking adding `metrics.renewalIndex` to the schema (§5): better to lock the formula before persisting a field whose meaning would be expensive to change later.
2. **CIRCULAR-direction lines** — `buildUnifiedWindows` (in `line-generator-logic.ts`) only reads `metrics.windows.OUTBOUND`/`.INBOUND`; a circular line's cycle data lives under `metrics.windows.CIRCULAR` and isn't consumed at all today, so running the generator against a circular line would silently produce an all-unknown/zero timeline instead of a useful one. Needs a decision: extend the unifier to handle the CIRCULAR case, or explicitly exclude circular lines from this feature for now and surface that at the entry point (§4.0).

These should be settled before Phase 2's generation algorithm (§4.7) is implemented — #1 blocks the schema change in §5, #2 blocks generation from working correctly for circular lines at all.

---

## 8. Future: multi-line generation (explicitly out of scope for this phase)

`Gerar` in this feature only ever targets one line at a time (§4.0, §7#3). A multi-line mode is real future scope, not rejected — it's deliberately kept out of this phase because it introduces coordination questions a single-line generator doesn't have to answer:

- **Shared terminals/depots** — lines whose IDA or VOLTA terminal coincides with another selected line's terminal, or that draw from the same depot, may need coordinated arrival/departure spacing at that shared point rather than independently generated schedules that happen to collide there.
- **Intercalation deltas** — where two lines share a corridor or stop, there may be a minimum/target headway *between* lines (not just within one line's own frequency) that a batch generator would need to respect.
- **Cross-line depot contention** — the depot allocation and assignment logic in §4.3/§4.5 is scoped to one line's fleet; multiple lines drawing from the same depot's vehicle pool would need that resolved jointly, not line by line.

None of this is designed yet, and nothing in this document's algorithm (§4.7) or persistence design (§4.8) assumes it. When multi-line generation is picked up, it should get its own proposal building on this one, rather than being bolted onto the single-line round-robin algorithm after the fact.
