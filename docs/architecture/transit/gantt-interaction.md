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
| `'trip'` | A single non-deadhead segment is clicked | The clicked `LayoutSegment` |
| `'interval'` | A second trip is clicked in the same row | `rowId`, anchor `from`, endpoint `to`, and all non-deadhead `segments` between them (inclusive) |

`from` is the **anchor** — it stays fixed across subsequent clicks. `to` moves as the user clicks other trips in the same row, expanding or shrinking the interval without changing the anchor.

`segments` contains only non-deadhead trips. The canvas highlight (see [Visual Feedback](#visual-feedback)) independently includes dead-run segments within the span.

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
export interface ActionItem {
  id:        string
  label?:    string
  icon?:     string       // key in lib/icons.ts Icons map
  variant:   'icon' | 'text' | 'both'
  disabled?: boolean
  danger?:   boolean
  onClick:   () => void
}
```

---

## Selection Logic (vehicles view)

`views/vehicles.actions.ts` implements `vehiclesActionSpec` with the following rules:

| State | Click target | Result |
|-------|-------------|--------|
| No selection | Any trip | `{ type: 'trip', segment: clicked }` |
| Any | Dead-run | No change |
| `trip` | Same trip (anchor) | `null` (deselect) |
| `trip` or `interval` | Different row | `{ type: 'trip', segment: clicked }` |
| `trip` | Different trip, same row | `{ type: 'interval', from: anchor, to: clicked, ... }` |
| `interval` | Any trip in same row (not anchor) | Resize interval — anchor `from` stays, `to` moves to clicked |
| `interval` | Anchor trip | `null` (deselect) |

Clicking inside an existing interval shrinks it; clicking outside expands it. Both cases go through the same `buildInterval(anchor, clicked, allSegments)` call.

`buildInterval` filters `allSegments` to the same row, excludes dead-runs, sorts by `startMinute`, and collects all trips between `from.startMinute` and `to.startMinute` (inclusive).

---

## Wiring GanttBoard

`GanttBoard` accepts three new optional props:

```typescript
interface Props {
  // ...existing props...
  selection?:         Selection | null
  onSelectionChange?: (sel: Selection | null) => void
  actionSpec?:        GanttActionSpec<VehiclePlanGanttData>
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
  // interval: include dead-runs within the time span for visual continuity
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

Dead-run segments are included in the canvas highlight even though they are excluded from `selection.segments` — this gives a continuous visual span across the interval.

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
- Trip: `{line}  {HH:MM} – {HH:MM}` (departure and arrival)
- Interval: `[ {n} ]  {HH:MM} – {HH:MM}` (count, earliest departure, latest arrival)

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

### Dismiss

- Clicking `×` calls `onDismiss`
- `Escape` keydown (global listener, cleaned up on unmount) calls `onDismiss`
- Any action button's `onClick` can call `onClose` (the same function) after executing

---

## Adding a New View's Actions

To add editing to a new Gantt view (e.g. drivers):

1. Create `views/drivers.actions.ts` exporting `driversActionSpec: GanttActionSpec<DriverPlanGanttData>`
2. Implement `resolveSelection` — return `null` to clear, a `Selection` to set
3. Implement `getActions` — return `ActionItem[]` appropriate for the selection type
4. In `page.tsx`: add `useState<Selection | null>(null)`, pass `actionSpec={driversActionSpec}` to `GanttBoard`, render `GanttActionBar` when selection is non-null

The canvas engine, renderer, and `GanttActionBar` component require no changes.

---

## Key Design Decisions

**`GanttActionSpec` is generic.** Each view controls its own selection rules and actions. Views that need cross-block interactions (e.g. moving an interval from one block to another) can handle the multi-row state entirely within `resolveSelection` by inspecting `ctx.allRows`.

**`selection.segments` excludes dead-runs; canvas highlight includes them.** The action spec operates on trips only — actions like "move interval" apply to trips, not dead-runs. The visual highlight includes dead-runs for continuity. These are computed separately and intentionally kept decoupled.

**The bar receives computed `actions`, not the spec.** `GanttActionBar` is a pure display component. It has no dependency on `GanttActionSpec` or view-specific types. The page assembles actions and passes them down.

**`inset-x-0 mx-auto w-fit` for centering.** Using margin-based centering instead of `transform: translateX(-50%)` decouples horizontal positioning from the animation transform, avoiding the visual jump that occurs when both CSS classes and keyframes compete over the `transform` property.
