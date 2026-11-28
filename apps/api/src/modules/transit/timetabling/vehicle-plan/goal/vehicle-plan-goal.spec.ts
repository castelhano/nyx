import { describe, expect, it } from 'vitest'
import {
  buildGoalContext, suggestGoalLevers, evaluateGoal, splitBandFleet, vehiclePlanGoalSchema,
  type GoalBlockInput, type GoalLineInput, type GoalCriteria, type LineGenMetrics, type Direction,
} from '@nyx/schemas'

const L1 = '00000000-0000-4000-8000-000000000001'
const L2 = '00000000-0000-4000-8000-000000000002'
const A  = '00000000-0000-4000-8000-00000000000a'
const B  = '00000000-0000-4000-8000-00000000000b'

const criteria: GoalCriteria = {
  demandMatch: { active: true, modifier: 25, floor: 0, idealMin: 50, idealMax: 90,  ceiling: 130 },
  maxGap:      { active: true, modifier: 15, floor: 0, idealMin: 0,  idealMax: 60,  ceiling: 180 },
}

// one cycle window all day: 25 + 5 each way = 60 min round trip
const metrics = (demand?: Record<string, number>): LineGenMetrics => ({
  windows: { U: {
    OUTBOUND: [{ from: 4, to: 23.5, minutes: 25, intervalMinutes: 5 }],
    INBOUND:  [{ from: 4, to: 23.5, minutes: 25, intervalMinutes: 5 }],
  } },
  ...(demand ? { demand: { U: { OUTBOUND: demand, INBOUND: demand } } } : {}),
})

const line = (lineId: string, m: LineGenMetrics, extra: Partial<GoalLineInput> = {}): GoalLineInput => ({
  lineId, code: lineId, metrics: m, dayTypeCode: 'U', capacity: 80,
  requirements: [], lockedTrips: 0, bundledTrips: 0, isDrifted: false, ...extra,
})

/** `fleet` vehicles shuttling the line from 04:00 to 24:00 every `cycle` minutes, staggered so
 *  departures are evenly spaced — one block per vehicle. */
function shuttle(lineId: string, fleet: number, branchOf: (i: number) => string | null = () => A): GoalBlockInput[] {
  const cycle = 60
  return Array.from({ length: fleet }, (_, i) => {
    const trips = []
    for (let start = 240 + i * cycle / fleet; start + cycle <= 1440; start += cycle) {
      trips.push({ lineId, direction: 'OUTBOUND' as Direction, departureMinutes: Math.round(start),      arrivalMinutes: Math.round(start + 25) })
      trips.push({ lineId, direction: 'INBOUND'  as Direction, departureMinutes: Math.round(start + 30), arrivalMinutes: Math.round(start + 55) })
    }
    return { id: `${lineId}-${i}`, branchId: branchOf(i), trips }
  })
}

const goal = (amount: number, extra: object = {}) => vehiclePlanGoalSchema.parse({ kind: 'FLEET_REDUCE', amount, ...extra })

describe('goal analysis — fleet by frequency', () => {
  it('measures a line by cycle ÷ headway', () => {
    const ctx = buildGoalContext(shuttle(L1, 5), [line(L1, metrics())], criteria)
    const busy = ctx.lines[0].bands.filter(b => b.departures > 0)
    expect(busy.length).toBeGreaterThan(0)
    for (const b of busy) expect(b.fleet).toBe(5)
    const ev = evaluateGoal(ctx, goal(1), [])
    expect(ev.reference).toBe(5)
  })

  it('cuts where occupancy has slack before where it is tight', () => {
    // same fleet; L1 carries little, L2 is close to its ideal occupancy
    const blocks = [...shuttle(L1, 6), ...shuttle(L2, 6)]
    const ctx = buildGoalContext(blocks, [
      line(L1, metrics(Object.fromEntries(Array.from({ length: 24 }, (_, h) => [String(h), 100])))),
      line(L2, metrics(Object.fromEntries(Array.from({ length: 24 }, (_, h) => [String(h), 400])))),
    ], criteria)
    const levers = suggestGoalLevers(ctx, goal(2))
    const ev = evaluateGoal(ctx, goal(2), levers)
    expect(ev.reached).toBe(true)
    expect(levers.every(l => l.lineId === L1)).toBe(true)
  })

  it('takes lines without demand only after the ones with demand', () => {
    const blocks = [...shuttle(L1, 6), ...shuttle(L2, 6)]
    const ctx = buildGoalContext(blocks, [
      line(L1, metrics(Object.fromEntries(Array.from({ length: 24 }, (_, h) => [String(h), 100])))),
      line(L2, metrics()),
    ], criteria)
    expect(ctx.lines[1].alerts).toContain('NO_DEMAND')
    const levers = suggestGoalLevers(ctx, goal(1))
    expect(levers.map(l => l.lineId)).toEqual([L1])
    const none = suggestGoalLevers(ctx, goal(1, { lockedLineIds: [L1], useLinesWithoutDemand: false }))
    expect(none).toEqual([])
  })

  it('never leaves a band without a vehicle nor past the headway limit', () => {
    const ctx = buildGoalContext(shuttle(L1, 2), [line(L1, metrics())], criteria)
    const levers = suggestGoalLevers(ctx, goal(5, { maxHeadwayMinutes: 45 }))
    // 2 → 1 would leave a 60 min headway
    expect(levers).toEqual([])
    expect(evaluateGoal(ctx, goal(5, { maxHeadwayMinutes: 45 }), levers).reached).toBe(false)
  })

  it('counts a shared line only for the filtered empresa, after rounding the split', () => {
    // 3 vehicles of A, 2 of B on the same line
    const blocks = shuttle(L1, 5, i => (i < 3 ? A : B))
    const ctx = buildGoalContext(blocks, [line(L1, metrics())], criteria)
    const band = ctx.lines[0].bands.find(b => b.fleet === 5)!
    expect(splitBandFleet(band, 5)).toEqual({ [A]: 3, [B]: 2 })
    expect(splitBandFleet(band, 4)).toEqual({ [A]: 2, [B]: 2 })

    const g = goal(1, { branchIds: [A] })
    const ev = evaluateGoal(ctx, g, suggestGoalLevers(ctx, g))
    expect(ev.reference).toBe(3)
    expect(ev.reached).toBe(true)
    expect(ev.levers.every(l => l.gain >= 1)).toBe(true)
  })
  it('completes the goal with other lines when one is dropped, keeping the cuts in place', () => {
    const demand = (v: number) => Object.fromEntries(Array.from({ length: 24 }, (_, h) => [String(h), v]))
    const blocks = [...shuttle(L1, 6), ...shuttle(L2, 6)]
    const ctx = buildGoalContext(blocks, [line(L1, metrics(demand(100))), line(L2, metrics(demand(200)))], criteria)
    const g = goal(2)
    const first = suggestGoalLevers(ctx, g)
    expect(first.every(l => l.lineId === L1)).toBe(true)

    // the user drops L1: what is left of the goal goes to L2
    const kept = first.filter(l => l.lineId !== L1)
    const next = suggestGoalLevers(ctx, { ...g, lockedLineIds: [L1] }, kept)
    expect(next.length).toBeGreaterThan(0)
    expect(next.every(l => l.lineId === L2)).toBe(true)
    expect(evaluateGoal(ctx, g, next).reached).toBe(true)
  })
})
