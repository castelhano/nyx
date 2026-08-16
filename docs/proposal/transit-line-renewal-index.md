# Renewal Index Calculator (Cálculo do Índice de Renovação por Linha)

> Planning document — nothing here is implemented yet.
> Scope: `apps/web/src/app/transit/transit-line/renewal-index/` (new feature), `apps/web/src/app/transit/transit-line/afc-trip-matching.ts` (new **reusable** fragment, see §4), `apps/api/src/modules/transit/network/line/` (new `renewal-index/apply` endpoint), `packages/schemas/transit/line.schema.ts`.
> Feeds `metrics.renewalIndex`, the field defined (but not yet built) in `docs/proposal/vehicle-plan-line-schedule-generator.md` §5 — this doc refines that field's shape (see §5 below) and defines the routine that actually computes it.

---

## 1. Motivation

`TransitLine.metrics.renewalIndex` is meant to capture mid-route boarding/alighting turnover — how much a line's effective carried-passenger count exceeds raw seat count because seats empty and refill along the route. Today it's a manually-typed guess (or left blank). This proposal defines a routine that computes it from real operational data instead: the city's fare/ticketing (bilhetagem) export, cross-referenced with the GPS/AVL system's realized-trips export.

Two source files, both network-wide (not per line), one day at a time:

- **Bilhetagem (AFC)** — one row per card swipe (boarding event): `EMPRESA`, `LINHA`, `VEICULO`, `HORARIO`, `CARTAO`, `TIPO`, `SENTIDO`. ~39k rows for a Sunday sample, expected 400k+ on a weekday.
- **Operação/GPS (VIA export)** — one row per realized trip (`viagem`): `Trajeto` (linha + sentido), `Veiculo Real`, `Partida Real`, `Chegada Real`, `Tempo Viagem`, `Passageiro`, `Status da Viagem`. ~3.3k rows for the same Sunday.

The routine matches each bilhetagem swipe to the specific realized trip it belongs to, then derives the renewal index from boarding counts per trip. **No dependency on internal DB data (`TransitTrip`, `LineSchedule`, `LineDeparture`)** — those aren't populated/reliable today, per project context; this routine is entirely self-contained against the two uploaded files.

**Reuse intent.** The "which passenger rode which viagem" attribution (§4) is the actual reusable asset here — renewal index is only its first consumer. Ridership-from-AFC-data is going to come up again (fuller OD analysis, demand validation, whatever comes next), so §4 is designed and built as its own fragment with no renewal-index-specific knowledge baked in, rather than inlined into this feature's page. Entry point for now stays exactly as agreed — the topbar link on the line list page — only the internal boundary is factored for reuse.

---

## 2. Source data — confirmed characteristics (not assumptions)

Checked directly against the sample files, not just their headers:

| Field | Finding |
|---|---|
| `VEICULO` (bilhetagem) vs `Veiculo Real` (VIA) | Same fleet numbering — 164 of 168 distinct vehicle IDs in the VIA sample also appear in the bilhetagem sample. This is the join key. |
| `SENTIDO` (bilhetagem) | **Not usable today.** 38366 of 39350 rows (97.5%) are marked `IDA` regardless of actual direction — the fare-box/validator field is effectively unpopulated in practice. Confirmed still in development (per conversation) and may become usable later. VIA's own `Trajeto` (e.g. `"007 - IDA"` / `"007 - VOLTA"`) is balanced (1624/1579) and is what direction should be read from instead, once a swipe is matched to a trip. |
| Encoding | Files are Latin-1 (`SERVIÇOS` reads as `SERVI�OS` under UTF-8) — must be decoded explicitly, not assumed UTF-8, wherever the file is read. |
| Coverage | VIA sample has 92 distinct `Trajeto` line codes vs 95 in bilhetagem — network-wide, not a single-line export. |
| `Status da Viagem` | VIA rows should be filtered to realized trips only — same `c[iStatus] !== '1'` check already used in `cycle-map/csv-parser.ts`, reusable as-is. |

---

## 3. Terminology

- **Swipe** (bilhetagem row): one card boarding event — `linha`, `veiculo`, `horario`, `cartao`.
- **Viagem** (VIA row): one realized trip of one vehicle on one line+direction, with a `Partida Real` → `Chegada Real` window.
- **Matched trip**: a viagem with its full set of swipes attributed to it (see §4).
- **Peak-load trip**: for a given line + direction (+ day type), the matched viagem with the highest swipe count — this is what the renewal index is derived from, not an average across the day.
- **Journey**: one or more consecutive swipes by the same card, chained across transfers (baldeação) within a transfer-window threshold — see §6 (Approach B). A journey can involve more than one line.

---

## 4. `afc-trip-matching` — the reusable fragment

Lives at `apps/web/src/app/transit/transit-line/afc-trip-matching.ts`: plain TypeScript, no React, no renewal-index-specific concepts (no capacity, no peak-trip selection, no `%` formula). Its only job is "given these swipes and these realized trips, which swipe belongs to which trip." Renewal index (§5, §6) is a consumer of its output, not part of it — so is whatever future feature comes next.

Algorithm:

1. Parse the VIA file, filter to `Status da Viagem == '1'`, index by `(empresa, linha, veiculo)` → sorted list of that vehicle's trip windows for the day. A single vehicle can only be on one trip at a time, so once narrowed to its own trips, resolving a timestamp to *the* trip it falls in is unambiguous.
2. Parse the bilhetagem file. For each swipe, look up the vehicle's trip list and find the trip whose window contains the swipe time, using a small pre-departure tolerance (passengers can board while the vehicle is still parked at the terminal before `Partida Real`) — tolerance value TBD empirically, start around 5 minutes.
3. No match found → **discard**, don't fabricate a trip. Two distinct discard reasons worth tracking separately for any consumer's summary UI:
   - vehicle/line combination not present in the VIA file at all that day (unmonitored line/vehicle),
   - vehicle found, but no trip window contains the swipe time (gap in GPS coverage, or a genuinely bad swipe).
4. Direction (`OUTBOUND`/`INBOUND`) for a matched swipe comes from the matched trip's `Trajeto`, **not** from the bilhetagem `SENTIDO` field (§2). Still parse and keep `SENTIDO` per swipe on the returned record — a consumer decides what to do with it (renewal-index's use of it is the diagnostic in §9, itself just a consumer-side concern, not the fragment's).

Sketch of the boundary (exact field names are implementation detail, the shape is what matters):

```ts
export interface RealizedTrip {
  date: string
  lineCode: string
  direction: 'OUTBOUND' | 'INBOUND' | 'CIRCULAR'
  vehicle: string
  empresa: string
  departureReal: string  // HH:MM:SS
  arrivalReal: string    // HH:MM:SS
}

export interface Swipe {
  cartao: string
  lineCode: string
  vehicle: string
  timestamp: string       // full datetime
  sentidoDeclared: string // kept, not trusted — see §2/§9
}

export interface MatchedSwipe extends Swipe { trip: RealizedTrip }
export interface UnmatchedSwipe extends Swipe { reason: 'VEHICLE_NOT_MONITORED' | 'NO_WINDOW_MATCH' }

export function parseViaCsv(text: string): RealizedTrip[]
export function parseAfcCsv(text: string): Swipe[]
export function matchSwipesToTrips(
  swipes: Swipe[],
  trips:  RealizedTrip[],
  opts?:  { preDepartureToleranceMin?: number },
): { matched: MatchedSwipe[]; unmatched: UnmatchedSwipe[] }
```

**Reuse opportunity worth flagging, not required for Phase 1:** `cycle-map/csv-parser.ts` already parses this exact VIA export format (same columns: `Trajeto`, `Veiculo Real`, `Partida Real`, `Tempo Viagem`, `Status da Viagem`), independently, for a different purpose (cycle-time inference). `parseViaCsv` above is a natural superset of what it extracts. Once this fragment exists, `cycle-map` could switch to it instead of keeping two independent VIA parsers that will drift — but that's a follow-up refactor of working code, not something to bundle into this feature's Phase 1.

This matching step alone (match rate, count of matched trips) is worth surfacing in any consumer's summary regardless of which approach runs on top of it.

---

## 5. Approach A — Embarque simples (build now)

Renewal-index-specific logic, living in the `renewal-index/` feature itself (not the fragment) and consuming `MatchedSwipe[]` from §4. No alighting inference needed.

1. Group `matched` by trip, count distinct swipes → total boardings for that trip.
2. Per line + direction (+ day type), take the **peak-load trip** — the viagem with the highest boarding count that day.
3. `renewalIndex[direction] = round(max(0, boardings(peakTrip) / vehicleCapacity - 1) * 100)`

This is exactly the inverse of the formula already assumed in `vehicle-plan-line-schedule-generator.md` §4.6 (`capacityPerTrip = vehicleCapacity * (1 + renewalIndex/100)`), so the two documents stay consistent without needing to touch the other one.

Why total boardings on the peak trip is a sound proxy, not a hack: a vehicle physically cannot exceed its capacity at any instant, so if total boardings on a trip *exceed* capacity, turnover must have happened somewhere along the route — that's true regardless of exactly where or how it was distributed. It's a **conservative, aggregate** measure: correct as a single per-direction percentage, but blind to *where* along the route turnover happens. That's what Approach B is for.

Vehicle capacity: reuse the same manually-set default already used in the generator proposal (hardcoded `80`, editable per run) until a global settings field exists — don't invent a second source of truth for this number.

---

## 6. Approach B — Retorno / baldeação-aware (spec now, build later)

Also renewal-index-specific (not part of the §4 fragment) — consumes the same `MatchedSwipe[]`, grouped by `cartao` instead of by trip. Goal: infer each swipe's **alighting** point (not just boarding), by chaining a card's swipes across the whole day into journeys, so turnover can eventually be localized instead of only totaled. Not implemented this phase — the approach selector in the UI (§8) is built now so the entry point exists, but selecting it should be disabled/labeled "em desenvolvimento" until this ships.

Key correction from the initial framing: **baldeação (transfer) chaining must apply across the whole day, not only when pairing morning vs. afternoon.** A commute leg itself can involve two lines (a transfer on the way *out*, not just on the way back). The chaining rule, applied uniformly:

1. Sort each card's swipes for the day by time.
2. Walk through them; start a new **journey** whenever the gap since the previous swipe exceeds a transfer-window threshold (tunable, literature-typical range ~30–60 min) — otherwise the swipe extends the current journey (it's a transfer leg of the same journey, possibly on a different line).
3. A journey's inferred alighting point is the boarding point of the swipe that starts the *next* journey (a real gap between journeys implies the rider actually got off and stayed somewhere — home, work — not just transferred).
4. The day's last journey pairs with the first journey to close the loop (standard trip-chaining assumption: most riders end their day back near where they started).
5. Cards with only one journey that day (no pair to close the loop) are excluded from alighting inference — fall back to their swipes still counting toward Approach A's aggregate, just without a resolved alighting point.

With alighting points inferred, the refinement over Approach A is a genuine **instantaneous peak occupancy** (boardings-in-progress minus alightings-so-far, at each point along the peak trip) instead of total boardings across the whole trip — a tighter, more accurate number, at the cost of depending on this inference chain. Still: neither file has stop-level location data (only line/vehicle/time), so "alighting point" here resolves to *which journey/line segment*, not a physical stop — a genuine stop-level OD matrix isn't achievable from these two files alone. Don't oversell this in the UI once it ships.

---

## 7. Architecture: fully client-side, no new upload endpoint

Following the existing precedent in this same directory — `DemandImportModal.tsx` and `cycle-map/` both parse CSV/JSON entirely in the browser (`file.text()` + a hand-rolled parser) and only hit the backend once, to persist the computed result. No reason to deviate here:

- Both files are parsed and joined in-browser. Scale check: a weekday bilhetagem file (~400k rows) joined against an indexed-by-vehicle VIA file (a few thousand trips) is a hash-lookup-then-small-linear-scan per row, not a nested loop — this is cheap even at 400k rows, same category of work `cycle-map/csv-parser.ts` already does client-side.
- No new file-upload backend endpoint. The only new backend surface is the persistence call in §8.

---

## 8. UI/UX flow

Mirrors the existing `Revisar Demanda` / `Revisar Ciclos` precedent on the line list page topbar (`apps/web/src/app/transit/transit-line/page.tsx`):

- New topbar action **"Calcular Renovação"** (icon TBD — `RefreshCw` is already taken by `Revisar Ciclos`; `Recycle` reads well for "turnover" and is available in `lucide-react`), `overflow: true`, routing to a new page `apps/web/src/app/transit/transit-line/renewal-index/page.tsx` — same pattern as `Revisar Ciclos` routing to `cycle-map/`.
- New page:
  1. Day type selector (same `DayType` fetch/dropdown pattern as `DemandImportModal`).
  2. Approach selector: **Simples** (default) / **Completa (com baldeação)** — the latter disabled until §6 ships.
  3. Two file pickers: Bilhetagem CSV, Operação/GPS CSV.
  4. **Processar** — runs the client-side matching + calculation (§4–5), produces a per-line, per-direction summary: peak-load trip (código/horário/veículo/ocupação), boarding count, computed renewal %, unmatched-swipe count and reason breakdown, and the `SENTIDO`-mismatch diagnostic (§9).
  5. Review screen, same spirit as `cycle-map`'s per-line review before commit — not a blind auto-save.
  6. **Salvar** / **Salvar todos**, same pattern as `cycle-map` (`handleSave` / `handleSaveAll`), POSTing to the new endpoint in §5 of the data-model section below.

---

## 9. `SENTIDO` diagnostic (why keep a field we said isn't usable)

Even though `SENTIDO` isn't trustworthy enough to match on today, the routine should still compute and surface **match rate between the declared `SENTIDO` and the direction of the trip it actually got matched to** (§4 step 4) in the summary. This costs nothing extra to compute (both values are already on hand) and turns this tool into the natural place to notice when the ticketing system's `SENTIDO` field becomes reliable enough to use later — instead of guessing, re-run the tool periodically and watch the mismatch percentage.

---

## 10. Data model changes (refines §5 of `vehicle-plan-line-schedule-generator.md`)

The other proposal assumed `metrics.renewalIndex` as a flat `{ OUTBOUND, INBOUND, CIRCULAR }` object, mirroring `metrics.extensionKm`. Having now designed the actual computation, that shape doesn't fit: renewal index is computed **per day type** (a Sunday's turnover pattern is not a weekday's), the same way `metrics.demand` already is. Recommend mirroring `demand` instead:

```
metrics.renewalIndex: Record<dayTypeCode, Record<'OUTBOUND'|'INBOUND'|'CIRCULAR', number>>
```

Same consequence as `demand`: a dynamic-key record doesn't fit `line.schema.ts`'s declarative `z.object()` shape for `metrics`, so it can't go through the generic `PATCH /transit/transit-line/:id`. Follow the exact precedent already in the codebase (`LineService.applyDemand` / `POST /transit/transit-line/demand/apply`, `line.service.ts:99-129`): a new `applyRenewalIndex(dayTypeCode, updates)` method doing a raw `metrics` merge per line via `this.model.update(...)`, bypassing schema validation the same way, and a matching `POST /transit/transit-line/renewal-index/apply` controller route. No Prisma migration needed (`metrics` stays `Json?`).

This does **not** touch the older proposal's file — noted here only so whoever implements §5 of that doc later knows the shape changed.

---

## 11. Known limitations

- `SENTIDO` unreliable today (§2, §9) — worked around, not solved; revisit once/if the field improves.
- No stop-level location in either source file — Approach B infers *which line segment/journey*, not a physical stop. Don't promise a real OD matrix from this data alone.
- Card sharing: gratuidade/idoso/escolar categories are known to sometimes be shared among family members in practice — adds noise to Approach B's "same card = same person" assumption. Doesn't affect Approach A (which only needs total boardings, not identity across swipes).
- Vehicle capacity is a single manually-set number per run, not per-vehicle-model — same simplification as the generator proposal, same reason (no reliable per-vehicle capacity data yet).
- Two networks' worth of files must be uploaded per run (bilhetagem + VIA) for the same date — no cross-date reconciliation; each day processed is independent, later re-processing a day simply overwrites that day type's stored value.

---

## 12. Phased plan

**Phase 1 — plumbing + Approach A.**
- 1a: `afc-trip-matching.ts` fragment (§4) — parsing for both file formats, the matching engine, and its own tests/fixtures, built and reviewable independently of the renewal-index UI.
- 1b: topbar entry, new `renewal-index/` page, day-type selector, dual file upload wired to the fragment from 1a, Approach A calculation (§5), summary/review screen (§8), `applyRenewalIndex` backend endpoint (§10), save flow.

**Phase 2 — Approach B.**
Journey-chaining engine (§6), enable the "Completa" selector, extend the summary screen with per-journey/localization detail once there's something meaningful to show beyond the aggregate percentage.

**Phase 3 (later, cross-referenced only) — wire into the generator.**
Once both this routine and `vehicle-plan-line-schedule-generator.md`'s modal exist, `metrics.renewalIndex[dayTypeCode][direction]` becomes a real seed value for that modal's §4.6 oferta×demanda chart instead of a manually typed number. No new design needed here — just a consumer of what this doc produces.
