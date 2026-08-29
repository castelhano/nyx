import { z } from 'zod'

// Single transactional diff for the Gantt "Salvar" flow — VehiclePlanService.applyDiff
// applies all of it inside one prisma.$transaction, closing with recalculate() before
// commit. Mirrors PendingAddEntry (apps/web/.../AddTripModal.tsx) for the `adds` shape,
// so the frontend can serialize its pending state as-is. See docs/proposal/
// vehicle-plan-summary-score-consolidation.md §2.4.

const localityRefSchema = z.object({ id: z.string(), name: z.string() })

const pendingAddTripSchema = z.object({
  _kind:               z.literal('trip'),
  _tempId:             z.string(),
  routeId:             z.string(),
  blockId:             z.string(),   // 'new' | 'pending:<tempId>' | real block id
  departureMinutes:    z.number(),
  arrivalMinutes:      z.number(),
  // Set when this trip comes straight from an approved LineDeparture (OSO switch —
  // see SwitchLineScheduleModal/switch-schedule-logic.ts) rather than a
  // free-standing manual add: preserves traceability/requiredVehicleType the same
  // way activateNewLineSchedule's server-side trip creation already does.
  lineDepartureId:     z.string().optional(),
  requiredVehicleType: z.enum(['STANDARD', 'MICRO_BUS', 'MINIBUS', 'VAN']).optional(),
  access: z.object({ localityId: z.string(), travelMinutes: z.number() }).optional(),
  return: z.object({ localityId: z.string(), travelMinutes: z.number() }).optional(),
})

const pendingAddDeadrunSchema = z.object({
  _kind:               z.literal('deadrun'),
  _tempId:             z.string(),
  type:                z.enum(['ACCESS', 'RETURN']).optional(),   // absent = DISPLACEMENT
  blockTripId:         z.string().optional(),                     // required when type is ACCESS/RETURN
  originLocality:      localityRefSchema,
  destinationLocality: localityRefSchema,
  departureMinutes:    z.number(),
  arrivalMinutes:      z.number(),
  blockId:             z.string(),
})

const pendingAddIntervalSchema = z.object({
  _kind:            z.literal('break'),
  _tempId:          z.string(),
  intervalTypeId:   z.string(),
  departureMinutes: z.number(),
  arrivalMinutes:   z.number(),
  blockId:          z.string(),
})

export const pendingAddEntrySchema = z.discriminatedUnion('_kind', [
  pendingAddTripSchema,
  pendingAddDeadrunSchema,
  pendingAddIntervalSchema,
])
export type PendingAddEntryDto = z.infer<typeof pendingAddEntrySchema>

const timeUpdateSchema = z.object({ id: z.string(), departureMinutes: z.number(), arrivalMinutes: z.number() })

export const vehiclePlanDiffSchema = z.object({
  tripUpdates: z.array(z.object({
    id:               z.string(),
    departureMinutes: z.number().optional(),
    arrivalMinutes:   z.number().optional(),
    constraints:      z.object({ locked: z.array(z.string()).optional() }).nullable().optional(),
  })).default([]),
  deadrunUpdates:  z.array(timeUpdateSchema).default([]),
  intervalUpdates: z.array(timeUpdateSchema).default([]),
  tripDeletes:     z.array(z.string()).default([]),
  deadrunDeletes:  z.array(z.string()).default([]),
  intervalDeletes: z.array(z.string()).default([]),
  adds:            z.array(pendingAddEntrySchema).default([]),
  // Pins which approved LineSchedule version governs a line within this plan
  // (VehiclePlanLine.lineScheduleId) — travels with the rest of the diff so an OSO
  // switch (delete old trips + add new ones from the target schedule) only takes
  // effect atomically with the pin, never leaving the line pointed at a schedule
  // whose departures don't match what's actually persisted.
  lineSchedulePins: z.array(z.object({ lineId: z.string(), lineScheduleId: z.string() })).default([]),
  moves: z.array(z.object({
    blockTripIds: z.array(z.string()),
    breakIds:     z.array(z.string()).default([]),
    deadrunIds:   z.array(z.string()).default([]),
    fromBlockId:  z.string(),   // may be 'pending:<tempId>' from an add above
    toBlockId:    z.string(),
  })).default([]),
})
export type VehiclePlanDiff = z.infer<typeof vehiclePlanDiffSchema>
