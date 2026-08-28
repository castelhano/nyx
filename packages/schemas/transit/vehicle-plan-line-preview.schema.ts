import { z } from 'zod'

// Request payload for the stateless line-score preview endpoint — lets the client see
// VehiclePlanLineSummary.score for a line's current in-progress editing state (persisted
// trips + pending changes/deletes/moves/adds already merged) before deciding whether to
// persist it. Mirrors GanttBlock/GanttBlockTrip.trip.route (vehicles.view.ts) — the
// shape useGanttEditor's mergedPlottedData already exposes for BOTH persisted and
// pending trips — so the frontend sends the merged view as-is, no extra reshaping and
// no dependency on a specific route variant (direction + localities are enough; the
// backend never needs to resolve a routeId). No DB writes happen on this path —
// computeLineSummary() is a pure function, shared verbatim with the recalculate() write
// path (single source of truth for the formula).

const previewTripSchema = z.object({
  direction:             z.string(),
  originLocalityId:      z.string(),
  destinationLocalityId: z.string(),
  departureMinutes:      z.number(),
  arrivalMinutes:        z.number(),
})

const previewBlockSchema = z.object({
  id:          z.string(),
  vehicleType: z.string().optional(),   // defaults to STANDARD when not resolved yet
  trips:       z.array(previewTripSchema),
})

export const previewLineScoreSchema = z.object({
  blocks: z.array(previewBlockSchema).default([]),
})
export type PreviewLineScoreDto = z.infer<typeof previewLineScoreSchema>
