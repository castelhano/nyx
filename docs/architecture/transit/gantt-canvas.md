# Gantt Canvas Architecture

> Architecture reference for the vehicle plan Gantt chart.
> Source: `apps/web/src/app/transit/vehicle-plan/[id]/`

---

## Overview

The Gantt renders a timeline of vehicle blocks (rows) against a time axis (columns). It is built on the HTML5 Canvas API for the drawing surface, with React DOM overlays for labels, the time ruler, and interactive UI elements (tooltips, popovers).

The central design decision is to **keep React out of the hot rendering path**. Canvas drawing and scroll/zoom state live entirely in imperative classes. React receives only a lightweight snapshot after each interaction, which it uses to synchronize the DOM overlay positions.

---

## Module Map

```
engine/
  gantt-engine.ts       — coordinator; owns all engine objects
  viewport.ts           — scroll, zoom, coordinate transforms
  renderer.ts           — canvas drawing
  hit-tester.ts         — mouse→segment mapping
  interaction.ts        — DOM event handlers
  gantt.types.ts        — shared interfaces (GanttView, GanttRow, GanttSegment, ViewportSnapshot)
  layout/
    layout.types.ts     — LayoutStrategy, LayoutRow, LayoutSegment interfaces
    sequential.layout.ts — single-lane layout (current implementation)

components/
  GanttBoard.tsx        — top-level React component; owns the engine lifecycle
  TimeRuler.tsx         — DOM time axis (header)
  RowList.tsx           — DOM row labels (left panel)
  SegmentTooltip.tsx    — hover/click tooltip (absolute-positioned DOM)
  BlockDetailPopover.tsx — click popover for block details
  FrequencyPanel.tsx    — side panel showing line frequencies
  GenerateModal.tsx     — modal to trigger block generation
  LinesPanel.tsx        — side panel listing lines in the plan
  SolverProposalDialog.tsx — dialog to review/accept solver proposals

views/
  vehicles.view.ts      — GanttView implementation for VehiclePlan
```

---

## Engine Architecture

`GanttEngine` is the coordinator. It owns instances of all engine classes and exposes the public API used by React.

```
GanttEngine
  ├── Viewport        — authoritative scroll/zoom state
  ├── Renderer        — draws to canvas ctx
  ├── HitTester       — rect index for mouse→segment
  ├── Interaction     — attaches/detaches DOM event listeners
  └── LayoutStrategy  — converts GanttRows/GanttSegments → LayoutRows/LayoutSegments
```

The engine holds two arrays in memory:
- `layoutRows: LayoutRow[]` — rows with computed y positions
- `segments: LayoutSegment[]` — segments with lane assignments

These are recomputed on every `setView()` call and re-used on every draw frame without re-allocation.

---

## Coordinate Systems

### Content space

The full scrollable content area. `y` values are CSS pixels measured from the top of the content. `x` is not used in content space — horizontal position is always expressed in **minutes**.

### Canvas space

CSS pixels from the top-left of the canvas element. Transforms:

```typescript
minuteToX(minute):  (minute - dayStartMinute) * pixelsPerMinute - scrollX
xToMinute(x):       (x + scrollX) / pixelsPerMinute + dayStartMinute
contentToCanvasY(y): y - scrollY
```

### Device Pixel Ratio (DPR)

Applied once at `init()` and on every `resize()`:

```typescript
canvas.width  = viewport.width  * dpr
canvas.height = viewport.height * dpr
ctx.setTransform(dpr, 0, 0, dpr, 0, 0)
```

All drawing code uses CSS pixel values. The `setTransform` call scales every canvas operation by DPR transparently, producing crisp output on high-density displays without any per-draw awareness of DPR.

---

## Viewport

`Viewport` is the single source of truth for all scroll and zoom state.

| Property | Meaning |
|----------|---------|
| `scrollX` | Horizontal scroll offset in CSS pixels |
| `scrollY` | Vertical scroll offset in CSS pixels |
| `pixelsPerMinute` | Zoom level: CSS pixels per minute of timeline |
| `dayStartMinute` | Leftmost visible minute (usually 0) |
| `dayEndMinute` | Rightmost boundary; set dynamically by `setView` from the max segment `endMinute` |

**Scroll clamping:**
- `scrollY` is clamped to `[0, totalHeight - height + 80]` — the +80 px overscroll gives visual breathing room at the bottom
- `scrollX` is clamped to `[0, (dayEndMinute - dayStartMinute) * pixelsPerMinute - width + 120]` — the +120 px overscroll keeps the last segment from being flush against the right edge

**Zoom** is centered on a screen x position (`zoom(factor, centerX)`): the minute under the cursor is preserved after scaling `pixelsPerMinute`.

**`snapshot()`** returns a plain `ViewportSnapshot` object. This is the only mechanism by which canvas state crosses into React — it carries no class references and is safe to store in React state.

---

## Rendering Pipeline

Each draw call invokes:

```
ctx.clearRect(...)
drawRowBands     — alternating light fill for even rows
drawTimeGrid     — vertical grid lines (interval adapts to zoom level)
drawDayBoundaries — dashed lines at multiples of 1440 min (midnight markers)
drawSegments     — colored rounded rectangles + labels
```

Layers are drawn bottom-to-top so segments appear above grid lines.

### Grid interval adaptation

```typescript
ppm >= 4   → 15 min
ppm >= 1.5 → 30 min
ppm >= 0.8 → 60 min
else       → 120 min
```

The same function exists in both `Renderer` (canvas grid) and `TimeRuler` (DOM ruler) to keep them in sync.

### Segment rendering

Segments outside the visible time range are skipped (`isTimeVisible`). Segments in rows outside the visible vertical range are also skipped (`isRowVisible`). Labels are only drawn when the segment is wider than 30 px to avoid clipping artefacts.

Dead-run segments are rendered at `globalAlpha = 0.4`.

---

## Layout Strategy

`LayoutStrategy` is an interface with a single method:

```typescript
compute(rows: GanttRow[], segments: GanttSegment[]): LayoutResult
```

**`SequentialLayout`** (current implementation) assigns each row a fixed height of 44 px with a 2 px gap. All segments in a row share a single lane (`laneIndex = 0`). This works because a vehicle block's trips are sequential with no overlaps.

The strategy pattern allows future layouts (e.g. parallel-lane for overlapping trips) without modifying the engine.

---

## Hit Testing

`HitTester` maintains a flat list of `{ segId, x, y, w, h }` rects built after each draw. Only visible segments are indexed (same visibility checks as the renderer).

Hit testing iterates in **reverse order** (last-drawn segment wins on overlap), matching the visual z-order.

The index is rebuilt on every draw call because `x` and `y` values change on every scroll or zoom event. The rebuild is O(visible segments) and negligible compared to canvas drawing.

---

## Interaction

`Interaction` attaches event listeners in `init()` and removes them in `dispose()`. All listeners are registered through a private `on()` helper that accumulates them for clean disposal.

| Event | Binding | Action |
|-------|---------|--------|
| `wheel` | canvas | Ctrl/Cmd: zoom centered on cursor; plain: vertical scroll |
| `mousedown` (button 1) | canvas | Begin middle-button vertical drag |
| `mousemove` | canvas | Update drag position or hit-test for hover |
| `mouseup` / `mouseleave` | canvas | End drag; clear hover |
| `click` | canvas | Hit-test and fire segment click callback |
| `keydown` | window | ArrowLeft/Right: horizontal scroll by 80 px (skipped when input focused) |

All handlers call `engine.notify()` + `engine.requestDraw()` after mutating viewport state.

---

## RAF Deduplication

Every mutation path ends with `requestDraw()`, which schedules exactly one `requestAnimationFrame` per visual frame regardless of how many mutations arrive (e.g. repeated key events during key-repeat):

```typescript
requestDraw(): void {
  if (!this.ready || this.rafPending) return
  this.rafPending = true
  requestAnimationFrame(() => {
    this.rafPending = false
    this.draw()
  })
}
```

This prevents frame queuing and ensures consistent 60 fps behavior under rapid input.

---

## React Integration

### GanttBoard

`GanttBoard` owns the engine lifecycle:

1. A `useEffect` with `[]` deps creates the engine and a `ResizeObserver`
2. `ResizeObserver` calls `engine.viewport.resize(width, height)` then `engine.init(canvas)` on first measurement; `engine.resize(width, height)` on subsequent
3. `engine.onStateChangeCallback` drives React state updates (`setVp`, `setLayoutRows`, `setTooltip`)
4. A second `useEffect` on `[data]` calls `engine.setView(vehiclesView, data)` when data changes
5. On unmount: `ro.disconnect()` + `engine.dispose()`

### State flow

```
User interaction / data change
  → Viewport mutation
  → engine.notify()        — pushes EngineState to React
  → engine.requestDraw()   — schedules canvas frame
  → React re-renders overlays (TimeRuler, RowList, SegmentTooltip)
     using the snapshot (pure data, no engine reference)
```

`engine.notify()` emits an `EngineState` object:

```typescript
interface EngineState {
  viewport:       ViewportSnapshot
  layoutRows:     LayoutRow[]
  hoveredSegId:   string | null
  hoveredSegment: LayoutSegment | null
}
```

`GanttBoard` uses `hoveredSegment` to call `engine.getSegmentRect()` and update the tooltip position in the same callback, keeping hover response synchronous with the canvas frame.

React never reads from the engine during render. The snapshot is the only bridge.

---

## DOM Overlays

The canvas sits inside a flex layout. Overlays are positioned to visually align with canvas content:

```
┌────────────────────────────────────────────┐
│  [corner 160px] │  TimeRuler (flex-1)      │  ← 40px header row
├─────────────────┼──────────────────────────┤
│  RowList        │  <canvas>                │  ← flex-1 content
│  (160px)        │    SegmentTooltip (abs)  │
└─────────────────┴──────────────────────────┘
```

**`TimeRuler`** renders tick marks as absolutely positioned `<div>` elements, computing `x` from the same `minuteToX` formula as the canvas. It receives `ViewportSnapshot` as a prop and re-renders on every scroll/zoom.

**`RowList`** renders row labels as a scrollable list. Its scroll position is driven by `vp.scrollY` — it does not scroll independently. Row `y` values from `LayoutRow` are used to position each label.

**`SegmentTooltip`** is positioned using `engine.getSegmentRect(segId)`, which converts segment minutes and row y back to canvas pixel coordinates. It appears on hover and on click.

**`BlockDetailPopover`** is triggered by clicking the info icon on a `RowList` entry. Its screen position is computed as `screenY = RULER_HEIGHT + row.y - vp.scrollY` and `screenX = LABEL_WIDTH + 8`, placing it just to the right of the row label panel.

---

## GanttView Protocol

Any dataset can be rendered by implementing `GanttView<TData>`:

```typescript
interface GanttView<TData> {
  getRows(data: TData):                     GanttRow[]
  getSegments(row: GanttRow, data: TData):  GanttSegment[]
  getRowLabel(row: GanttRow):               string
  segmentColor(seg: GanttSegment):          string
  onSegmentClick?(seg, pos):                void
  editable?:                                boolean
}
```

`getSegments` is called per-row. Segments carry `startMinute` and `endMinute` as absolute clock minutes. The view is responsible for all color logic and label text; the engine is display-agnostic.

The current implementation is `vehiclesView` in `views/vehicles.view.ts`, which maps `VehicleBlock → GanttRow` and `BlockTrip → GanttSegment`, with line-based color palette and lighter shade for INBOUND direction.

---

## Key Design Decisions

**No Radix UI or component library.** All components are hand-rolled TypeScript + Tailwind per project convention.

**No `resolveIcon` needed.** The canvas module has no icon imports; icons only appear in `BlockDetailPopover` if needed, and must be imported via `lib/icons.ts`.

**`clockOffsetMinutes` is not yet implemented.** A future `clockOffsetMinutes` property on `Viewport` is planned for wiring to `transit.general.operationalDayStartHour`. When added, times before the operational day start would shift forward by the offset for extended-hour notation (e.g. 25:30 for 01:30 of the next calendar day). Currently the ruler displays absolute clock minutes with no offset.

**`dayEndMinute` is dynamic.** `setView` scans all segment `endMinute` values and sets `dayEndMinute = max(1440, maxEnd)`. This extends the horizontal scroll boundary automatically for blocks that cross midnight, without requiring any configuration.

**Layout is decoupled from rendering.** `LayoutStrategy.compute` is pure — no side effects, no DOM access. It can be replaced without touching the renderer, hit tester, or viewport.
