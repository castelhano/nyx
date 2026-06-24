# Gantt Interaction Layer

> Architecture reference for the contextual selection and action bar system built on top of the Gantt canvas.
> Source: `apps/web/src/app/transit/vehicle-plan/[id]/`

---

## Overview

The interaction layer is a separate concern from canvas rendering. It defines:

- **A selection model** — what can be selected (`trip` or `interval`) and how selection state is represented
- **A per-view action spec** — which actions are available for a given selection, and how clicks resolve into selections
- **A floating action bar** — a React DOM overlay that appears when a selection is active, listing contextual action buttons

The canvas engine and `GanttView` protocol are unchanged. The interaction layer sits entirely above them.

---

## Module Map

New files added to the existing structure:

```
engine/
  gantt.types.ts        — Selection, ActionItem, SelectionContext, GanttActionSpec (added)

components/
  GanttActionBar.tsx    — floating action bar (DOM overlay)

views/
  vehicles.actions.ts   — GanttActionSpec implementation for the vehicles view
```

---

## Selection Model

`Selection` is a discriminated union defined in `engine/gantt.types.ts`:

```typescript
export type Selection =
  | { type: 'trip';     segment: LayoutSegment }
  | { type: 'interval'; rowId: string; segments: LayoutSegment[]; from: LayoutSegment; to: LayoutSegment }
```

| Variant | When | Contents |
|---------|------|----------|
| `'trip'` | A single segment is clicked (trip or deadrun) | The clicked `LayoutSegment` |
| `'interval'` | A second trip is clicked in the same row | `rowId`, anchor `from`, endpoint `to`, and all segments between them (inclusive, including deadruns) |

`from` is the **anchor** — it stays fixed across subsequent clicks. `to` moves as the user clicks other trips in the same row, expanding or shrinking the interval without changing the anchor.

`selection.segments` for an interval contains **all** segments in the span (trips and deadruns alike). The action spec separates them internally with `segments.filter(s => !s.id.endsWith(':dr'))` and `segments.filter(s => s.id.endsWith(':dr'))`.

Selection state is owned by the **page** (`page.tsx`), not by `GanttBoard`. `GanttBoard` is fully controlled.

---

## GanttActionSpec Protocol

`GanttActionSpec<TData>` decouples selection logic and action definitions from both the canvas engine and the `GanttActionBar` component:

```typescript
export interface GanttActionSpec<TData = unknown> {
  resolveSelection(
    clicked: LayoutSegment,
    current: Selection | null,
    ctx:     SelectionContext,
  ): Selection | null

  getActions(
    selection: Selection,
    data:      TData,
    onClose:   () => void,
  ): ActionItem[]
}

export interface SelectionContext {
  allSegments: LayoutSegment[]
  allRows:     LayoutRow[]
}
```

`resolveSelection` is a pure function — it receives the current selection and the clicked segment, and returns the next selection (or `null` to clear). The engine calls it on every segment click and propagates the result upward via `onSelectionChange`.

`getActions` returns the list of buttons to render for a given selection. `onClose` is provided so any action can dismiss the bar after executing.

### ActionItem

```typescript
export interface SplitMenuItem {
  id:       string
  label:    string
  checked:  boolean
  onToggle: () => void
}

export interface ActionItem {
  id:         string
  label?:     string
  icon?:      string       // key in lib/icons.ts Icons map
  variant:    'icon' | 'text' | 'both'
  disabled?:  boolean
  danger?:    boolean
  active?:    boolean      // renders button in amber "locked/active" state
  splitMenu?: SplitMenuItem[]  // if present, renders as split button with dropdown
  onClick:    () => void
}
```

When `splitMenu` is present, `GanttActionBar` renders a split button: the left part is the main `onClick` trigger; the right part (`▾`) opens a checkbox dropdown anchored above the button. `active: true` applies an amber highlight to both halves.

---

## Selection Logic (vehicles view)

`views/vehicles.actions.ts` exports `createVehiclesActionSpec(deps: VehiclesActionDeps)` — a factory that closes over mutation callbacks and returns a `GanttActionSpec`.

### Segment ID conventions

The vehicles view produces two segment ID formats:

| Suffix | Type | Selectable |
|--------|------|-----------|
| none | Block trip (productive) | Yes — trip or interval |
| `:dr` | Deadrun (ACCESS / RETURN / DISPLACEMENT) | Yes — trip only (never anchor/expand an interval) |
| `:dead` | Reserved guard suffix (not currently produced) | No — selection is unchanged |

### Resolution rules

| State | Click target | Result |
|-------|-------------|--------|
| Any | `:dead` segment | No change (guard for future view implementations) |
| Any | `:dr` segment (deadrun) | `{ type: 'trip', segment: clicked }` — always starts a fresh trip selection |
| No selection | Any trip | `{ type: 'trip', segment: clicked }` |
| Any | Different row | `{ type: 'trip', segment: clicked }` |
| `trip` or `interval` | Anchor segment | `null` (deselect) |
| `trip` | Different trip, same row | `{ type: 'interval', from: anchor, to: clicked, ... }` |
| `interval` | Any non-anchor trip, same row | Resize — anchor `from` stays, `to` moves to clicked |

Clicking inside an existing interval shrinks it; clicking outside expands it. Both go through the same `buildInterval(anchor, clicked, allSegments)` call.

`buildInterval` filters `allSegments` to the same row (excluding `:dead` markers), sorts by `startMinute`, and collects all segments between `from.startMinute` and `to.startMinute` (inclusive). Dead-run `:dr` segments within the span are included in `selection.segments`.

---

## Available Actions

### Trip selection — productive trip

| Order | Action | Condition |
|-------|--------|-----------|
| 1 | Lock (split button) | Always |
| 2 | Access (`Acesso`) | Only when a garage-out deadrun can be inserted before this trip |
| 3 | Return (`Recolhida`) | Only when a garage-in deadrun can be inserted after this trip |
| 4 | Move to block (`Mover para bloco`) | Always |
| 5 | Delete (`Excluir`) | Always |

Access and Return are suppressed when the trip is back-to-back (gap ≤ 15 min) with an adjacent trip or an existing deadrun of the same type.

### Trip selection — deadrun (`:dr`)

| Order | Action | Condition |
|-------|--------|-----------|
| 1 | Delete deadrun (`Excluir vazio`) | Always |

### Interval selection

| Order | Action | Condition |
|-------|--------|-----------|
| 1 | Lock (split button) | Always |
| 2 | Move to block (`Mover para bloco`) | Always |
| 3 | Delete interval (`Excluir`) | Always — removes all trips and deadruns in the span |

---

## Wiring GanttBoard

`GanttBoard` accepts these props for the interaction layer:

```typescript
interface Props {
  // ...existing props...
  selection?:         Selection | null
  onSelectionChange?: (sel: Selection | null) => void
  actionSpec?:        GanttActionSpec<VehiclePlanGanttData>
  onBlockUpdate?:     () => void
}
```

When `actionSpec` is not provided, click behavior is unchanged (shows the segment tooltip). This keeps read-only boards fully unaffected.

### Stale closure prevention

`actionSpec`, `onSelectionChange`, and `selection` are all used inside the engine's `onSegmentClickCallback`, which is registered once at mount. They are kept current via refs:

```typescript
const actionSpecRef        = useRef(actionSpec)
const onSelectionChangeRef = useRef(onSelectionChange)
const selectionRef         = useRef<Selection | null>(selection ?? null)

useEffect(() => { actionSpecRef.current        = actionSpec },        [actionSpec])
useEffect(() => { onSelectionChangeRef.current = onSelectionChange }, [onSelectionChange])
useEffect(() => { selectionRef.current         = selection ?? null }, [selection])
```

`allSegments` and `allRows` are read from the engine instance directly at click time (not cached in a ref) — they are always current because the engine owns and recomputes them on every `setView`.

### Selection → engine sync

A `useEffect` on `[selection]` translates React selection state into a `Set<string>` of highlighted segment IDs and pushes it to the engine:

```typescript
useEffect(() => {
  const engine = engineRef.current
  if (!engine) return
  if (!selection) { engine.setSelectedSegIds(new Set()); return }
  if (selection.type === 'trip') {
    engine.setSelectedSegIds(new Set([selection.segment.id]))
    return
  }
  // interval: include all segs in the row within the time span (incl. deadruns)
  const { rowId, from, to } = selection
  const spanStart = Math.min(from.startMinute, to.startMinute)
  const spanEnd   = Math.max(from.endMinute,   to.endMinute)
  const ids = new Set(
    engine.getLayoutSegments()
      .filter(s => s.rowId === rowId && s.endMinute > spanStart && s.startMinute < spanEnd)
      .map(s => s.id)
  )
  engine.setSelectedSegIds(ids)
}, [selection])
```

Dead-run segments are included in the canvas highlight even for interval selections, giving a continuous visual span across the interval.

---

## Visual Feedback

When `selectedSegIds` is non-empty, the renderer applies two passes in `drawSegments`:

**Pass 1 — dim non-selected:**
- Non-selected regular segments: `globalAlpha = 0.25`
- Non-selected dead-runs: `globalAlpha = 0.25 × 0.6` (already partially transparent)
- Selected segments: `globalAlpha = 1`
- Hover ring is suppressed while a selection is active

**Pass 2 — ring overlay:**
After all segments are drawn, selected segment rects are collected and a single white stroke pass is made on top:

```typescript
const SELECTION_RING_COLOR = 'rgba(255, 255, 255, 0.9)'
const SELECTION_RING_WIDTH = 2.5
```

Drawing rings in a second pass ensures they appear above all fill content regardless of segment overlap.

---

## GanttActionBar Component

`components/GanttActionBar.tsx` renders the floating bar as a DOM overlay.

### Props

```typescript
interface Props {
  selection: Selection
  actions:   ActionItem[]
  onDismiss: () => void
}
```

`actions` is computed by the page calling `actionSpec.getActions(selection, data, () => setSelection(null))` and passed down — the bar has no knowledge of the spec.

### Layout

```
[ summary label ] | [ action buttons ] | [ × ]
```

Summary format:
- Trip: `{segment.label}  {HH:MM} – {HH:MM}` (segment label is the line code; empty string for deadruns)
- Interval: `[ {n} ]  {HH:MM} – {HH:MM}` (count of all segments in the span, earliest start, latest end)

### Positioning

The bar is centered horizontally using `absolute inset-x-0 mx-auto w-fit` rather than `left-1/2 -translate-x-1/2`. This avoids any coupling between `transform` and the animation keyframes, which only affect `translateY` and `opacity`.

### Animation

Defined in `globals.css` inside `@theme`:

```css
--animate-action-bar-in: action-bar-in 0.18s ease-out backwards;
@keyframes action-bar-in {
  from { opacity: 0; transform: translateY(10px); }
  to   { opacity: 1; transform: translateY(0);    }
}
```

`backwards` fill-mode ensures the `from` state (opacity 0) is applied before the first browser paint, preventing a flash of the fully-visible element.

### Split button

When an `ActionItem` has `splitMenu`, the bar renders a split button:

```
[ icon/label | ▾ ]
```

- Left half — main `onClick`; styled with amber when `active: true`
- Right half — opens/closes the checkbox dropdown above the bar
- The dropdown is closed on outside click (`pointerdown` listener) or `Escape`
- `Escape` priority: closes the open dropdown first; a second `Escape` dismisses the bar

### Dismiss

- Clicking `×` calls `onDismiss`
- `Escape` keydown (global listener, cleaned up on unmount) — closes open dropdown first, then `onDismiss`
- Any action button's `onClick` can call `onClose` (the same function) after executing

---

## Trip Constraints

`TripConstraints` is a JSON column on `TransitTrip` that controls solver behavior for individual trips:

```typescript
export interface TripConstraints {
  locked?:      string[]   // field names the solver cannot modify
  pinnedBlock?: string     // block UUID — trip cannot leave this block in future runs
}
```

Recognised `locked` field names: `'departureMinutes'`, `'arrivalMinutes'`, `'cycleTime'`.

### Lock action in the vehicles view

The first button in the trip and interval action bars is a split lock button:

| State | Icon | `active` | Main click |
|-------|------|---------|-----------|
| No constraints on any selected trip | `LockOpen` | false | Set `locked: ['departureMinutes', 'arrivalMinutes', 'cycleTime']` for all selected trips |
| Any constraint present on any trip | `Lock` | true (amber) | Clear constraints (`null`) for all selected trips |

The dropdown (`▾`) shows four independent checkboxes:

| Checkbox | Constraint |
|----------|-----------|
| Horário inicial | `locked` includes `'departureMinutes'` |
| Horário final | `locked` includes `'arrivalMinutes'` |
| Tempo de ciclo | `locked` includes `'cycleTime'` |
| Fixar ao Bloco | `pinnedBlock` set to the current block UUID |

For interval selections, a checkbox is checked only if **all** trips in the interval have that constraint. Toggling applies the change to every trip in the selection individually (per-trip patch array).

### Mutations

The page (`page.tsx`) wires all mutation callbacks into the spec factory. The full set of operations:

| Dep | API call | Trigger |
|-----|----------|---------|
| `onUpdateConstraints` | `PATCH /transit/transit-trip/:id` per trip via `Promise.all` | Lock/unlock, per-field toggle |
| `onDeleteTrips` | `DELETE /transit/transit-trip/:id` per trip | Delete single trip |
| `onDeleteDeadruns` | `DELETE /transit/vehicle-block/:blockId/deadrun/:id` per deadrun | Delete single deadrun |
| `onDeleteInterval` | Batch delete of trips + deadruns in the span | Delete interval |
| `onAddAccess` | `POST /transit/vehicle-block/:blockId/access` | Add garage-out deadrun before trip |
| `onAddReturn` | `POST /transit/vehicle-block/:blockId/return` | Add garage-in deadrun after trip |
| `onMoveTrip` | `POST /transit/vehicle-block/:blockId/move` | Move block trips to a different block |

After any mutation resolves, the page calls `refetchGantt()` to update the canvas data. The mutation functions are bound into the spec factory via `useMemo`:

```typescript
const vehiclesActionSpec = useMemo(
  () => createVehiclesActionSpec({
    onUpdateConstraints: (tripIds, patches) => handleUpdateConstraints(tripIds, patches),
    onDeleteTrips:       (tripIds)          => handleDeleteTrips(tripIds),
    onDeleteDeadruns:    (ids, blockId)     => handleDeleteDeadruns(ids, blockId),
    onDeleteInterval:    (tIds, dIds, bId)  => handleDeleteInterval(tIds, dIds, bId),
    onAddAccess:         (btId, blockId)    => handleAddAccess(btId, blockId),
    onAddReturn:         (btId, blockId)    => handleAddReturn(btId, blockId),
    onMoveTrip:          (btIds, blockId)   => handleMoveTrip(btIds, blockId),
  }),
  [],
)
```

`patches` for `onUpdateConstraints` is either a single `TripConstraints | null` (applied uniformly to all trips) or a `TripConstraints[]` (one patch per trip, for per-field toggles where each trip may have different existing state).

---

## Adding a New View's Actions

To add editing to a new Gantt view (e.g. drivers):

1. Create `views/drivers.actions.ts` exporting `createDriversActionSpec(deps): GanttActionSpec<DriverPlanGanttData>` — a factory that closes over mutation callbacks
2. Implement `resolveSelection` — return `null` to clear, a `Selection` to set
3. Implement `getActions` — return `ActionItem[]`; use `splitMenu` for toggle/dropdown actions
4. In `page.tsx`: define mutation functions, call `createDriversActionSpec({ ... })` inside `useMemo`, wire `GanttBoard` and `GanttActionBar`

The canvas engine, renderer, and `GanttActionBar` component require no changes.

### Why a factory instead of a const

Action handlers need to call `apiFetch` / React Query mutations, which only exist inside the component tree. A factory bound via `useMemo` gives the spec access to those functions through closure without passing callbacks through `GanttBoard` or polluting `GanttActionSpec` with app-layer types.

---

## Key Design Decisions

**`GanttActionSpec` is generic.** Each view controls its own selection rules and actions. Views that need cross-block interactions (e.g. moving an interval from one block to another) can handle the multi-row state entirely within `resolveSelection` by inspecting `ctx.allRows`.

**`selection.segments` includes deadruns; action spec separates them.** `buildInterval` collects all segments in the time span (including `:dr` deadruns). The action spec then splits them into `tripSegs` and `drSegs` as needed — for example, the delete-interval action deletes both. This avoids re-querying allSegments inside action callbacks.

**The bar receives computed `actions`, not the spec.** `GanttActionBar` is a pure display component. It has no dependency on `GanttActionSpec` or view-specific types. The page assembles actions and passes them down.

**`inset-x-0 mx-auto w-fit` for centering.** Using margin-based centering instead of `transform: translateX(-50%)` decouples horizontal positioning from the animation transform, avoiding the visual jump that occurs when both CSS classes and keyframes compete over the `transform` property.

**Dead-run trip-type selection enables delete.** Clicking a `:dr` segment starts a `{ type: 'trip' }` selection just like a productive trip. This allows the action spec to render a delete button for standalone deadruns without needing a separate selection variant. Deadruns cannot be interval anchors — clicking them always resets to a fresh trip selection.
