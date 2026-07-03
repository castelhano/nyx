# OSRM Map Integration — Route Trajectories & Map-Based Locality Entry

> Proposal. Records the design discussion so implementation can proceed without re-deriving the reasoning.

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

**Next.js App Router / SSR:** Leaflet accesses `window` on import. The map component must be wrapped with `dynamic(() => import('./MapComponent'), { ssr: false })` — required, or `next build` breaks.

**Trade-off:** public OSM tile servers have a restrictive usage policy for anything beyond light dev traffic — fine to prototype against, but production needs either a tile provider with a free tier (MapTiler, Stadia Maps) or self-hosted tiles. Not a blocker for dev; flagged here so it isn't forgotten before a prod rollout.

**Alternative considered:** MapLibre GL JS (vector tiles, better performance at scale) — more setup cost, only worth it if raster tiles become a real bottleneck (large locality counts, frequent re-renders). Not recommended as the starting point.

**Scale check:** the target dataset is ~60 lines (≈2 routes each) over ~4,000 bus stops citywide (Cuiabá, initial rollout). That's well within Leaflet's comfortable range — the full network is rarely rendered at once, and when it is, two standard techniques apply:
- Render stops as `L.circleMarker` with `renderer: L.canvas()` instead of default DOM `L.marker` — thousands of canvas-drawn points cost far less than the same count of DOM nodes on pan/zoom.
- `Leaflet.markercluster` for network-wide views, so far-zoomed-out views group nearby stops instead of rendering all 4,000 individually.

Most editing screens only need the handful of `RouteLocality` rows for the route being built, with the wider network (if shown at all) as a clustered background layer — reinforces that MapLibre's vector-tile advantage isn't needed at this scale.

---

## Schema changes — one migration

All new fields land in a single migration before any feature ships:

```prisma
model RouteLocality {
  id               String           @id @default(uuid())
  routeId          String
  localityId       String?          // null = routing waypoint (see Waypoints section)
  lat              Float?           // populated when localityId is null
  lng              Float?           // populated when localityId is null
  sequence         Int
  deltaMinutes     Int?             // null → runtime falls back to TravelTimeMatrix for this pair
  deltaKm          Float?
  deltaSource      TravelTimeSource @default(OSRM)  // protects manual overrides from regeneration
  // null for the first stop (no incoming leg); GeoJSON LineString for all others
  geometry         Json?
  allowsCrewChange Boolean          @default(false)
  createdAt        DateTime         @default(now())
  updatedAt        DateTime         @updatedAt

  route    TransitRoute     @relation(fields: [routeId], references: [id], onDelete: Cascade)
  locality TransitLocality? @relation(fields: [localityId], references: [id])

  @@unique([routeId, sequence])
  @@unique([routeId, localityId])   // nulls are treated as distinct in both SQLite and PG,
                                    // so multiple waypoints (null localityId) per route are allowed
  @@map("transit_route_localities")
}
```

`deltaSource` is a **prerequisite for Feature 3** — without it, auto-generation silently overwrites manual edits. The `OSRM | MANUAL` enum already exists as `TravelTimeSource`.

---

## Waypoints — forcing passage through a street

A `RouteLocality` with `localityId = null` is a **routing waypoint**: a coordinate that forces OSRM to route through a specific point (street, intersection) without that point being a bus stop.

- `lat`/`lng` are stored directly on the row (the snapped coordinate from OSRM `/nearest`).
- The OSRM `/route` call includes all `RouteLocality` coords in `sequence` order, regardless of whether `localityId` is null or not — the routing is transparent to the waypoint/stop distinction.
- Waypoints are **invisible in the ruler view** — they are routing implementation details, not operational stops.
- In the map view, waypoints render with a distinct marker style (smaller, different shape) to differentiate them from bus stops.
- Feature 4 (suggest localities): the candidate search runs against `TransitLocality` records not already present in the route — waypoints are not included in suggestion output.

---

## NestJS endpoints

All OSRM and Nominatim calls go through NestJS — never called directly from the browser (CORS, future auth, provider swap without frontend changes).

```
POST /transit/route                              create TransitRoute + auto-generate initial trajectory
POST /transit/route/:id/reprocess               full OSRM recompute for entire route
POST /transit/route/:id/suggest-localities      Feature 4 — returns candidates, does not persist
GET  /transit/route/:id/trajectory              ordered RouteLocality rows including geometry
GET  /transit/locality/nearest?lat=&lng=        proxy → OSRM /nearest (snapping)
GET  /transit/locality/reverse-geocode?lat=&lng= proxy → Nominatim (address lookup)
```

`POST /transit/route` auto-creates two `RouteLocality` rows (origin at `sequence=1`, destination at `sequence=2`) and runs the initial OSRM `/route` call before returning — the page opens with a trajectory already drawn.

The `GET /transit/locality/reverse-geocode` proxy is responsible for rate-limiting Nominatim requests (1 req/s public instance limit). The public Nominatim instance is dev-only; a self-hosted instance or paid provider is required before production.

---

## Feature 1 — Route trajectory generation (OSRM call)

For a `TransitRoute` with an ordered list of `RouteLocality` (by `sequence`), generate the real road-snapped path.

Call OSRM's **`/route`** service:

```
GET {OSRM_URL}/route/v1/driving/{coords}?geometries=geojson&overview=full&steps=true
```

`coords` = ordered `lng,lat` pairs from the full `RouteLocality` sequence (stops and waypoints alike).

Using `steps=true` (not `steps=false`) gives both:
- `route.geometry` — merged polyline for the whole route, used for immediate full-route rendering.
- `legs[i].steps[j].geometry` — step-level geometries within each leg, concatenated to reconstruct per-leg `LineString` for `RouteLocality.geometry` storage:

```ts
const legCoords = legs[i].steps.flatMap((step, j) =>
  j === 0 ? step.geometry.coordinates : step.geometry.coordinates.slice(1)
);
// → store as RouteLocality[i+1].geometry (GeoJSON LineString)
```

The first `RouteLocality` in the sequence (`sequence = 1`) has no incoming leg → `geometry = null` by definition.

`legs[i].duration` (seconds) and `legs[i].distance` (metres) populate `deltaMinutes` and `deltaKm`:

```ts
deltaMinutes = Math.ceil(legs[i].duration / 60)
deltaKm      = Math.round(legs[i].distance / 10) / 100
```

Same unit conversions already used by `OsrmService.generateMatrix()`.

---

## Feature 2 — Register a `RouteLocality` by clicking the map

- `TransitLocality` creation/selection stays manual — OSRM automates the *calculation*, not the *selection* of stops.
- Map click handler yields `lat`/`lng`.
- Snap the clicked point to the nearest road via `GET /transit/locality/nearest?lat=&lng=` (OSRM `/nearest` proxy). The **snapped coordinate** — not the raw click — is what gets persisted in `TransitLocality.lat`/`lng` and `TransitLocality.snapInfo`. This ensures the stored position is exactly on the road network, preventing geometry mismatches when the locality is used in other routes.
- Reverse-geocode via `GET /transit/locality/reverse-geocode?lat=&lng=` to pre-fill the name field in the creation modal.
- A `RouteLocality` with `localityId = null` (waypoint) follows the same click flow but skips `TransitLocality` creation — only `lat`/`lng` are stored on the `RouteLocality` row directly.

---

## Feature 3 — Segment time/distance with incremental recompute

On "Reprocessar", the `/route` call covers the full ordered sequence and updates all `RouteLocality` rows in one pass.

**Incremental recompute** (for single-stop edits — add/remove/move):

| Operation | Legs invalidated | OSRM call |
|---|---|---|
| Add stop between A and B | A→new, new→B (replaces A→B) | `/route` with 3 coords |
| Remove stop B between A and C | A→C (replaces A→B + B→C) | `/route` with 2 coords |
| Move stop B (new lat/lng) | A→B and B→C | `/route` with 3 coords |
| Reorder drag from position i to j, `|i−j| > 3` | Too many legs — full recompute | full `/reprocess` |

The threshold `|i−j| > 3` is a heuristic; if a reorder is large, a single full-route `/reprocess` is simpler than computing and patching N individual legs.

**Override protection:** if `deltaSource = MANUAL` on a row, auto-generation skips updating `deltaMinutes`/`deltaKm` for that row. The field is reset to `OSRM` if the planner explicitly triggers "Reprocessar" on the full route (opt-in clobber).

---

## Feature 4 — Suggest existing localities along a generated trajectory

**Prerequisite:** `RouteLocality.geometry` must exist for the route (i.e., a trajectory has been generated at least once). The "Sugerir" button is disabled with a tooltip until this condition is met.

Turf.js runs on NestJS (not in the browser) — keeps `TransitLocality` data server-side and avoids loading ~4,000 coordinates into the client.

Flow:

1. **Prefilter** — `turf.bbox(routeGeometry)` + buffer → `lat`/`lng` range query in Prisma, narrowing ~4,000 localities to a small candidate set. Exclude localities already present in `RouteLocality` for this route (stops and waypoints).
2. **Distance + position** — `turf.nearestPointOnLine(routeGeometry, localityPoint)` → distance from point to line (acceptance filter) + `location` (ordering key).
3. **Threshold** — discard candidates farther than ~30–50 m from the route line. Starting value; may need tuning once tested against Cuiabá's actual stop placement accuracy (or made configurable).
4. **Result** — sort accepted candidates by `location`, return ordered list to the client. No persistence at this stage.

Client flow: user reviews the list, unchecks unwanted candidates → confirms → batch insert as `RouteLocality` rows at the correct `sequence` positions → full `/reprocess` to update `deltaMinutes`/`deltaKm`/`geometry`.

---

## `TravelTimeMatrix` vs `RouteLocality.deltaMinutes/deltaKm` — why both stay

| | `TravelTimeMatrix` | `RouteLocality.deltaMinutes` / `deltaKm` |
|---|---|---|
| Scope | Fastest driving path between **any** two relevant localities | One specific segment of **one specific route's** predefined path |
| Source call | `/table` (batched N×N) | `/route` (ordered, respects actual direction/sequence) |
| Consumers | Dead-run scoring, vehicle-plan solver, generic fallback | The route's own trip-time computation |
| Existing fallback | — | `null` → falls back to `TravelTimeMatrix` for this pair |

The two values can legitimately diverge: `/table`'s fastest point-to-point path is not guaranteed to match the line's real, direction-specific path (one-way boarding lanes, operational detours). That divergence is exactly why `RouteLocality.deltaMinutes`/`deltaKm` exists — not redundancy.

**Conclusion: keep both.**

---

## Geometry storage conventions

- `RouteLocality.geometry` stores the GeoJSON `LineString` for the leg **from the previous stop to this one**.
- The first stop in a route (`sequence = 1`) has `geometry = null` — no incoming leg.
- Rendering the full route = concatenate `geometry` in `sequence` order at read time.
- **Prisma select rule:** queries that list `RouteLocality` for table/form views must exclude `geometry` explicitly (`select: { ..., geometry: false }`). Geometry is large (detailed urban polylines) and only needed when rendering the map. Loading it on every list query adds unnecessary payload.

---

## Page architecture — `/transit/transit-route?lineId=foo`

This URL becomes a **custom page** (replaces the generic resource page). It serves as both list and editor for all `TransitRoute` records belonging to a line — keeping all routes visible on the same canvas simultaneously is essential for spatial context.

Entry point: from `transit/transit-line/[id]`, the existing "Sentidos" action redirects to `/transit/transit-route?lineId=foo`.

**URL params:**
- `lineId` — always present, scopes the page to one `TransitLine`.
- `routeId` — set when a route is selected for editing; cleared when deselected. Enables bookmarking and survives page refresh.

### Layout

```
┌─────────────────────────────────────────────────────────┐
│ Topbar (context-sensitive actions)                      │
├──────────────┬──────────────────────────────────────────┤
│ Side panel   │ Canvas (ruler or map — toggled by switch)│
│              │                                          │
│ [+ Nova]     │                                          │
│ ─────────    │                                          │
│ OUTBOUND     │                                          │
│ INBOUND      │                                          │
│              │                                          │
└──────────────┴──────────────────────────────────────────┘
```

**Side panel:** lists all `TransitRoute` records for the line (direction label + name). Click selects a route — URL updates to `?lineId=foo&routeId=bar`, canvas highlights the selected route (others dimmed). "+" button always visible at the top of the panel, opens the creation modal.

**Canvas switch:** toggles between ruler view and map view. State is local (not in URL).

### Topbar state machine

| State | Controls |
|---|---|
| No route selected | _(breadcrumb only)_ |
| Route selected, no pending points | Adicionar ponto · Reprocessar · Sugerir _(disabled if no geometry)_ |
| Route selected, pending points exist | **Gravar** · Descartar pendentes · Adicionar ponto |
| Suggestion mode active | **Confirmar seleção** · Cancelar |

All controls live in the topbar — no floating buttons on the canvas.

### Creation flow

1. Click "+" in the side panel → modal opens (direction, name, origin, destination).
2. "Gravar" in modal → `POST /transit/route` → backend creates `TransitRoute`, two `RouteLocality` rows (origin seq=1, destination seq=2), and runs the initial OSRM call.
3. Modal closes; new route is auto-selected (`?routeId=bar-novo`); canvas shows the initial trajectory.
4. User is now in the editing state for that route.

### Pending-point flow

Adding or reordering stops before committing avoids unnecessary OSRM calls during an editing session:

1. User clicks "Adicionar ponto" → enters click-on-map or lat/lng mode.
2. Each added point enters a **pending array** in React state — not persisted yet.
3. Canvas renders pending points with a distinct marker style (e.g. dashed outline) positioned outside the current trajectory line.
4. Topbar switches to "Gravar / Descartar" state.
5. User adds as many points as needed, then clicks **Gravar** → batch `POST` of all pending `RouteLocality` rows → full `/reprocess` → canvas redraws with the new trajectory.
6. Navigating away with unsaved pending points triggers a standard `beforeunload` warning.

Reordering in the list also stays pending until Gravar — the canvas reflects the last committed trajectory, with a visual badge ("Trajetória desatualizada") when the list and the drawn path have diverged.

**Destination constraint:** the `RouteLocality` with the highest `sequence` must match `TransitRoute.destinationLocalityId`. Enforced in the UI (drag handle disabled for the last row) and validated in the API on Gravar.

---

## Canvas — ruler view (E.1)

Displays all routes for the line as horizontal lines, one per `TransitRoute`. No map tiles loaded.

- Stop distribution: proportional to cumulative `deltaKm` along the route — gives an accurate spatial mental model. Fallback to equal spacing when `deltaKm` is not yet populated (new routes before first reprocess), with a visual indicator ("Gere a trajetória para ver distribuição real").
- Origin: marker at the left end. Destination: marker at the right end.
- `CIRCULAR` routes (`RouteDirection.CIRCULAR`): rendered as a loop with origin at the left and stops distributed along the arc.
- Waypoints (`localityId = null`) are **not rendered** in the ruler — they are routing implementation details.
- No color coding in ruler view — direction is conveyed by label and position in the panel list.

---

## Canvas — map view (E.2)

Displays all routes for the line on an interactive Leaflet map with OSM tiles.

**Visual differentiation by direction:**
- `OUTBOUND` → blue
- `INBOUND` → red
- `CIRCULAR` → green

Selected route: full opacity, full color. Other routes: reduced opacity (background context).

**Bus stop markers:** `L.circleMarker` with `renderer: L.canvas()` for performance. Waypoint markers: smaller, distinct shape.

**Pending points:** rendered immediately on the canvas with a dashed marker style, positioned at their raw (or snapped) coordinates. They float visually outside the current polyline until Gravar triggers a reprocess.

---

## Locations map — second moment

A separate view (not part of the TransitRoute page) that plots all registered `TransitLocality` records on a map. Intended for network-wide inspection; rarely used in daily workflows.

- **Viewport-based loading:** `GET /transit/locality?bbox=lat1,lng1,lat2,lng2` — the frontend calls this endpoint on `map.on('moveend')`. Never loads all ~4,000 points at once.
- **Cluster rendering:** `Leaflet.markercluster` for zoomed-out views.
- **Click on a point:** shows a panel with locality data + all `TransitRoute` records that include this locality (`GET /transit/locality/:id/routes`).
- Entry: accessible from the TransitLocality list template (redirect to a dedicated map endpoint), not from the TransitRoute page.

---

## Open questions

- **Nominatim production:** self-host (same Docker pattern as OSRM) vs. paid provider (MapTiler Geocoding, Geoapify, etc.). Decision needed before prod rollout.

---

## Suggestion threshold (Feature 4) — rationale

The acceptance criterion is the **perpendicular distance** from a `TransitLocality` to the route polyline — what `turf.nearestPointOnLine` returns. This is geometrically equivalent to a buffer radius around the trace, but returns a numeric value that can be filtered and ranked directly without creating a polygon.

Typical distances in Cuiabá's context:

| Scenario | Distance to road center line |
|---|---|
| Stop on the sidewalk of a single-lane road | 5–15 m |
| Stop on the sidewalk of a wide avenue | 15–25 m |
| GPS accuracy of existing stop cadastre | ±5–10 m |
| Stop on the next parallel street | 50–150 m |

The gap between "stop that belongs to this route" and "stop on the adjacent block" sits around 40–60 m. **Default threshold: 50 meters** — covers wide avenues and GPS imprecision without pulling in the next block.

**Configuration:** not exposed per-route in the UI. Stored as an env var (`OSRM_SUGGEST_THRESHOLD_M=50`) or a system settings entry, adjustable without redeploy if real data demands it. The planner's review step (unchecking unwanted candidates) is the safety net for edge cases.

**Future refinement:** stops on the opposite side of the road fall within the threshold but aren't served by the route's direction of travel (OUTBOUND serves one side, INBOUND the other). Filtering this correctly requires knowing which side of the road each stop is on relative to the direction of travel — non-trivial geometry. Not worth implementing now; flag for future tuning if suggestion noise is high in practice.
