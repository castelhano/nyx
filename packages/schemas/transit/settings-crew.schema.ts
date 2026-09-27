import { z } from 'zod'
import { withMeta } from '../with-meta'
import { rangeCriterionSchema, anchoredCriterionSchema } from './settings-planning.schema'

// Duty rules (CCT) for the logical crew schedule — per transit Scope: every operator of
// the Scope follows the same CCT. For now they only validate/flag hand-built duties
// (Duty.issues) and feed the CrewPlan score.
// Ranges: outside [idealMin, idealMax] only costs score; outside [floor, ceiling] → `error` issue.
const rangeDefault = {
  // duty length (minutes worked)
  workTime:       { active: true, modifier: 25, floor: 360, idealMin: 440, idealMax: 550, ceiling: 560 },
  // spread — from sign-on to sign-off (minutes)
  spread:         { active: true, modifier: 15, floor: 0,   idealMin: 0,   idealMax: 720, ceiling: 780 },
  // in-duty break (meal, minutes)
  mealBreak:      { active: true, modifier: 20, floor: 60,  idealMin: 70,  idealMax: 110, ceiling: 120 },
  // gap between the pieces of a split duty (minutes)
  splitInterval:  { active: true, modifier: 10, floor: 60,  idealMin: 60,  idealMax: 240, ceiling: 250 },
  // overtime minutes as % of total minutes worked in the plan
  overtimeRatio:  { active: true, modifier: 15, floor: 0,   idealMin: 0,   idealMax: 5,   ceiling: 20  },
  // % of SPLIT duties in the plan
  splitRatio:     { active: true, modifier: 10, floor: 0,   idealMin: 0,   idealMax: 20,  ceiling: 40  },
  // % of TRIPPER duties (meia jornada) in the plan
  tripperRatio:   { active: true, modifier: 10, floor: 0,   idealMin: 0,   idealMax: 10,  ceiling: 30  },
  // vehicle changes per duty
  vehicleChanges: { active: true, modifier: 5,  floor: 0,   idealMin: 0,   idealMax: 1,   ceiling: 3   },
  // line changes per duty — counted apart from vehicle changes (a change of both scores twice)
  lineChanges:    { active: true, modifier: 15, floor: 0,   idealMin: 0,   idealMax: 0,   ceiling: 2   },
  // meters a duty walks between pieces at different places — only worth it when it pays off
  walkDistance:   { active: true, modifier: 10, floor: 0,   idealMin: 0,   idealMax: 0,   ceiling: 3500 },
  // % of the blocks' service minutes with a DRIVER
  coverage:       { active: true, modifier: 30, floor: 90,  idealMin: 100, idealMax: 100, ceiling: 100 },
}

const anchoredDefault = {
  // realized duties / theoretical minimum (block minutes ÷ workTime.idealMin)
  dutyCount:  { active: true, idealMaxOverPercent: 5,  ceilingOverPercent: 25, weight: 30 },
  // paid minutes / covered block minutes
  efficiency: { active: true, idealMaxOverPercent: 10, ceilingOverPercent: 30, weight: 20 },
}

export const crewSettingsSchema = withMeta(z.object({
  // sign-on before the first piece / sign-off after the last one
  signOnMinutes:               z.number().int().min(0).max(120).default(10),
  signOffMinutes:              z.number().int().min(0).max(120).default(5),
  // tolerated overlap between same-role pieces on the same block (handover)
  handoverMinutes:             z.number().int().min(0).max(60).default(0),
  minPieceMinutes:             z.number().int().min(0).max(1440).default(60),
  maxContinuousDrivingMinutes: z.number().int().min(0).max(1440).default(300),
  // farthest a driver walks between pieces at different places (meters) — beyond it the pieces
  // can't follow each other (WALK_DISTANCE)
  maxWalkMeters:               z.number().int().min(0).max(20000).default(3500),
  // night window (clock hours) — for now only yields informative nightMinutes
  nightStartHour:              z.number().int().min(0).max(23).default(22),
  nightEndHour:                z.number().int().min(0).max(23).default(5),
  // IntervalType placed as the meal (in-duty) break — its min/max decide when an idle gap
  // becomes a meal; BREAKs of this type are checked against TransitLocality.allowsMealBreak.
  // range.mealBreak below only scores/flags the duty
  mealBreakIntervalTypeId:     z.uuid().nullable().default(null),
  // How a STRAIGHT duty meets the in-duty rest (intrajornada) — any accepted form will do; none
  // accepted = no requirement. A SPLIT's own split interval is its rest.
  //  continuous: a BREAK of mealBreakIntervalTypeId (the type's range, at a meal stop) — unpaid
  //  fractioned: the duty's stops (vehicle idle within pieces + gaps between them, any length)
  //              add up to minTotal with one of at least minLongest — paid
  mealRule: z.object({
    continuous:           z.boolean(),
    fractioned:           z.boolean(),
    fractionedMinTotal:   z.number().int().min(0).max(600),
    fractionedMinLongest: z.number().int().min(0).max(600),
  }).default({ continuous: true, fractioned: false, fractionedMinTotal: 30, fractionedMinLongest: 15 }),
  // crew solver's continuous improvement: stops after this long, or this long without a better
  // proposal (same fields as the planning settings)
  stopMaxTotalMinutes:         z.number().int().min(1).max(1440).default(5),
  stopNoImprovementMinutes:    z.number().int().min(1).max(60).default(1),

  range: z.object({
    workTime:       rangeCriterionSchema,
    spread:         rangeCriterionSchema,
    mealBreak:      rangeCriterionSchema,
    splitInterval:  rangeCriterionSchema,
    overtimeRatio:  rangeCriterionSchema,
    splitRatio:     rangeCriterionSchema,
    // own defaults: settings stored before these criteria existed still parse
    tripperRatio:   rangeCriterionSchema.default(rangeDefault.tripperRatio),
    vehicleChanges: rangeCriterionSchema,
    lineChanges:    rangeCriterionSchema.default(rangeDefault.lineChanges),
    coverage:       rangeCriterionSchema.default(rangeDefault.coverage),
    walkDistance:   rangeCriterionSchema.default(rangeDefault.walkDistance),
  }).default(rangeDefault),

  anchored: z.object({
    dutyCount:  anchoredCriterionSchema,
    efficiency: anchoredCriterionSchema,
  }).default(anchoredDefault),
}), {
  // Served alongside General/Planning by the custom `transit/settings` page — must not
  // show up as its own resource in the sidebar/discovery.
  label:  'Configurações de Escala',
  hidden: true,
})

export type CrewSettings = z.infer<typeof crewSettingsSchema>
