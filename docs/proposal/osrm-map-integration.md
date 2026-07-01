# OSRM Map Integration — Route Trajectories & Map-Based Locality Entry

> Proposal. Nothing in this document is implemented yet — it records the design discussion so implementation can proceed without re-deriving the reasoning.

---

## Motivation

The transit module already uses OSRM to fill `TravelTimeMatrix` (see `docs/architecture/transit/osrm.md`), but that only produces scalar duration/distance between arbitrary locality pairs — it has no notion of a bus line's actual predefined path, no map UI, and no way to create a `TransitLocality` from a point clicked on a map.

Goal: let a planner draw/register the real trajectory of a `TransitRoute` (`TransitLine > TransitRoute > RouteLocality`), see it on a map, and get accurate segment-level time/distance without hand-typing it.

---

## Dev environment — local OSRM server

Already implemented (see `docker-compose.osrm.yml`, `osrm/prepare.sh`, `osrm/route.sh`, and the "OSRM — travel time matrix" section in `README.md`). Two-service compose stack:

- `osrm-prepare` — one-shot container: `osrm-extract` → `osrm-partition` → `osrm-customize` against the first `.osm.pbf` found in `osrm/data/` (gitignored). Skips itself on subsequent runs if the processed `.osrm.mldgr` already exists.
- `osrm-routed` — starts after `osrm-prepare` completes successfully (`condition: service_completed_successfully`), serves on `:5000`.

Nothing further needed here; included for completeness since it's the foundation the rest of this proposal builds on.

---

## Map library choice

**Recommendation: `react-leaflet`** (Leaflet) with OpenStreetMap raster tiles for dev.

- Matches the project's "hand-rolled, no heavy primitive libs" convention (`CLAUDE.md`) better than a GL-based stack — simple imperative API, small footprint, easy to wrap in a plain component.
- GeoJSON layers (`<GeoJSON>`) map directly onto what OSRM's `/route` returns.

**Trade-off:** public OSM tile servers have a restrictive usage policy for anything beyond light dev traffic — fine to prototype against, but production needs either a tile provider with a free tier (MapTiler, Stadia Maps) or self-hosted tiles. Not a blocker for dev; flagged here so it isn't forgotten before a prod rollout.

**Alternative considered:** MapLibre GL JS (vector tiles, better performance at scale) — more setup cost, only worth it if raster tiles become a real bottleneck (large locality counts, frequent re-renders). Not recommended as the starting point.

**Scale check:** the target dataset is ~60 lines (≈2 routes each) over ~4,000 bus stops citywide (Cuiabá, initial rollout). That's well within Leaflet's comfortable range — the full network is rarely rendered at once, and when it is, two standard techniques apply:
- Render stops as `L.circleMarker` with `renderer: L.canvas()` instead of default DOM `L.marker` — thousands of canvas-drawn points cost far less than the same count of DOM nodes on pan/zoom.
- `Leaflet.markercluster` for network-wide views, so far-zoomed-out views group nearby stops instead of rendering all 4,000 individually.

Most editing screens only need the handful of `RouteLocality` rows for the route being built, with the wider network (if shown at all) as a clustered background layer — reinforces that MapLibre's vector-tile advantage isn't needed at this scale.

---

## Feature 1 — Route trajectory generation

For a `TransitRoute` with an ordered list of `RouteLocality` (by `sequence`), generate the real road-snapped path.

- Call OSRM's **`/route`** service (not `/table`, which only returns a scalar matrix):
  ```
  GET {OSRM_URL}/route/v1/driving/{coords}?geometries=geojson&overview=full&steps=false
  ```
  `coords` = ordered `lng,lat` pairs from the route's `RouteLocality` sequence.
- The response's `legs[]` array corresponds 1:1 to consecutive `RouteLocality` pairs and gives per-leg `duration` (seconds) and `distance` (metres) — this is the source for Feature 3.
- The response's `geometry` (or per-leg geometry, if requested per-leg) is the polyline to draw on the map.

## Feature 2 — Register a `RouteLocality` by clicking the map

- `TransitLocality` creation/selection stays manual — OSRM cannot infer which real-world points a line stops at, only compute distances/paths given points a human already chose. (Clarified mid-discussion: OSRM automates the *calculation*, not the *selection* of stops.)
- Map click handler (`map.on('click', ...)`) yields `lat`/`lng` directly.
- For a human-readable address, reverse-geocode via **Nominatim** (OSM's free reverse geocoding):
  ```
  GET https://nominatim.openstreetmap.org/reverse?lat={lat}&lon={lng}&format=json
  ```
  Public instance is rate-limited to 1 req/s and disallows heavy/production use per its usage policy — self-hostable later via the same Docker pattern as OSRM if volume grows.
- Optional: snap the clicked point to the nearest road via OSRM's `/nearest/v1/driving/{lng},{lat}` before persisting, reusing the same snapping concept already implemented as `TransitLocality.snapInfo`.

## Feature 3 — Segment time/distance in insertion order

This is where the existing `RouteLocality.deltaMinutes` / `deltaKm` fields and `TravelTimeMatrix` interact — see next section for the full reasoning.

- On save/reorder of a route's `RouteLocality` list, call OSRM `/route` (once, for the whole ordered sequence) and read `legs[i].duration` / `legs[i].distance` to populate `deltaMinutes` (`Math.ceil(seconds / 60)`) and `deltaKm` (`Math.round(metres / 10) / 100`) for each consecutive pair — same unit conversions already used by `OsrmService.generateMatrix()`.
- Fields stay user-editable afterward (mirrors the `MANUAL` vs `OSRM` `source` pattern already used on `TravelTimeMatrix`), so a planner can override a computed value without it being silently clobbered — this needs an explicit "was this touched manually" signal on `RouteLocality` if we don't want the next regeneration to stomp a manual edit (see Open Questions).

## Feature 4 — Suggest existing localities along a generated trajectory

Motivating case: a planner registers only the handful of points needed to define a route unambiguously (e.g. 6 out of a real ~20 stops — origin, destination, and the turns/detours that disambiguate the path) and wants the system to suggest which of the ~4,000 existing `TransitLocality` records actually lie along the resulting trajectory, instead of hunting for and clicking each one manually.

Approach: once Feature 1 produces the route's GeoJSON geometry, use **Turf.js** (open source, MIT, works natively on GeoJSON — pairs directly with what OSRM already returns) for the linear-referencing math:

1. **Prefilter** — narrow ~4,000 localities down to a small candidate set cheaply, via a bounding box of the route geometry plus a margin (`turf.bbox` + buffer), ideally applied as a `lat`/`lng` range filter at the query level before any per-point geometry math runs.
2. **Distance + position** — for each candidate, `turf.nearestPointOnLine(routeGeometry, localityPoint)` returns both the distance from the point to the line and its `location` (distance along the line from the start). The former is the acceptance filter; the latter is the ordering key.
3. **Threshold** — discard candidates farther than some tolerance (~30–50 m, in the same spirit as the existing `snapInfo.distanceM` tolerance) from the route line; a locality merely "nearby" isn't necessarily served by that path.
4. **Ordering / insertion** — sort accepted candidates by `location` and interleave them into the existing `RouteLocality` sequence between whichever two original points bound that position, renumbering `sequence` accordingly.

Proposed flow: generate trajectory (Feature 1, sparse point set) → run the suggestion pass → planner reviews and approves/discards each suggested stop → `sequence` (and, per Feature 3, `deltaMinutes`/`deltaKm`/`geometry`) recomputed for the final list.

**Dependency note:** this is the one piece of the proposal that needs a library beyond OSRM + the map itself — Turf.js is a small, tree-shakeable, well-maintained geospatial toolkit (no server component, runs fine in the API or in the browser).

---

## `TravelTimeMatrix` vs `RouteLocality.deltaMinutes/deltaKm` — why both stay

These look redundant at first glance but represent different things:

| | `TravelTimeMatrix` | `RouteLocality.deltaMinutes` / `deltaKm` |
|---|---|---|
| Scope | Fastest driving path between **any** two relevant localities (depots, route endpoints, waypoints) | One specific segment of **one specific route's** predefined path |
| Source call | `/table` (batched N×N) | `/route` (ordered, respects actual direction/sequence) |
| Consumers | Dead-run scoring, vehicle-plan solver, generic fallback | The route's own trip-time computation |
| Existing fallback | — | `null` → falls back to the `TravelTimeMatrix` entry for that pair (already in schema comment, `transit.prisma:111`) |

Because `RouteLocality` waypoints are already part of the "relevant locality" set used when generating the Matrix (per `docs/architecture/transit/osrm.md`, Step 1 — "Is a route waypoint"), a Matrix entry for most consecutive stop pairs already exists by the time a route is built. The fallback is what makes that useful without extra work. But the two values can legitimately diverge: `/table`'s fastest point-to-point path is not guaranteed to match the line's real, direction-specific path (one-way boarding lanes, operational detours, etc.) — that divergence is exactly why the override field exists, not a sign it's redundant.

**Conclusion: keep both.** Auto-populate `deltaMinutes`/`deltaKm` from `/route` instead of requiring manual entry, but don't try to collapse them into the Matrix.

---

## Geometry storage — where does the polyline live?

Recommendation: **`RouteLocality.geometry Json?`** (GeoJSON `LineString` for the leg from the previous point to this one), not a field on `TravelTimeMatrix` and not a single blob on `TransitRoute`.

Reasoning:
- `TravelTimeMatrix` is queried heavily by the solver for scalar scoring/dead-run math — adding coordinate arrays to every row is unnecessary weight on a hot table with no rendering use case.
- Per-segment storage on `RouteLocality` matches the existing per-segment grain of `deltaMinutes`/`deltaKm` — same row, same lifecycle.
- Editing one stop (add/move/remove) only requires recomputing the leg(s) touching that stop, not the whole route's geometry. A single `TransitRoute.geometry` blob would need full regeneration on every edit and risks silently going stale if a step is missed.
- Rendering the full route is a concatenation of `RouteLocality.geometry` in `sequence` order at read time — cheap, and always consistent with the segment data it's derived from.

---

## Open questions / follow-ups (not resolved in discussion, flagging for implementation time)

- **Manual-override protection on `RouteLocality`**: `TravelTimeMatrix` has an explicit `source: OSRM | MANUAL` enum to protect manual entries from being overwritten on regeneration. `RouteLocality.deltaMinutes`/`deltaKm` has no equivalent today — if auto-generation runs again after a planner hand-edits a segment, it will silently overwrite it. Needs the same `source` treatment (or a `deltaSource` field) before Feature 3 ships.
- **Nominatim production usage**: fine for dev against the public instance; needs a decision (self-host vs. paid provider) before this ships to production, given the rate limit and usage policy.
- **Regeneration trigger**: should trajectory/segment regeneration run automatically whenever `RouteLocality` rows change (mirroring how matrix generation already triggers on locality create/update, per `README.md`), or be an explicit action in the topbar like the existing "Gerar Matriz" button? Leaning toward explicit action, consistent with the matrix's current UX, but worth confirming.
- **Suggestion threshold (Feature 4)**: the ~30–50 m acceptance distance for "is this locality on the route" is a starting guess, not derived from real data yet — may need to be tuned (or made configurable) once tested against Cuiabá's actual stop placement accuracy.
