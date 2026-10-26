import { DAILY_ISSUE_LABEL, VEHICLE_TYPE_LABELS, type DailyIssueCode, type RepairItem, type RepairOption, type RepairStep } from '@nyx/schemas'
import { availableOn, BLOCKED, CAR_COST, carCost, type CarBlock, type CarFacts, type CarVehicle } from '../roster/roster-vehicles'
import { hungarian } from '../roster/hungarian'
import { dayOf } from '../../timetabling/plan-validity'

// "Encaixar veículos" — pure. Per date, the blocks whose car is missing or can't run them get:
//   1. SPARE     — a free car of the empresa (active, available, on no other block), by the same
//                  preference as the generator's vehicle step; a minimum-cost matching per date
//   2. TYPE_SWAP — only a car of another type is free: a block running a car that fits the target
//                  and accepting the free one swaps — the one losing the least preference
// Nothing else moves. On VEHICLE_DOUBLE the car stays on the block it suits best.

export interface VehicleRepairBlock extends CarBlock {
  blockNumber: number
  vehicleId:   string | null
  issues:      DailyIssueCode[]
  published:   boolean
}

export interface VehicleRepairInput {
  facts:  CarFacts
  // the empresa's blocks on the period's editable days
  blocks: VehicleRepairBlock[]
  // per date, cars on blocks outside the list (other empresas, closed days)
  busy:   Map<string, Set<string>>
  // any vehicle's code (the current car may be another empresa's)
  code:   Map<string, string>
}

const TARGET: DailyIssueCode[] = ['BLOCK_NO_VEHICLE', 'VEHICLE_UNAVAILABLE', 'VEHICLE_TYPE_MISMATCH', 'VEHICLE_BRANCH_MISMATCH', 'VEHICLE_DOUBLE']
const NO_CAR = 1e6
const MAX_OPTIONS = 5

const COST_NOTE: Record<number, string> = {
  [CAR_COST.preferred]:      'carro fixo do operador',
  [CAR_COST.otherPreferred]: 'carro fixo de outro operador do bloco',
  [CAR_COST.habitual]:       'carro habitual do operador',
  [CAR_COST.otherHabitual]:  'carro habitual de outro operador do bloco',
}

const crewOf = (b: CarBlock) => [...new Set(b.pieces.flatMap(p => p.duty.rosterEntries.map(e => e.crewMemberId)))]

export function repairVehicles(input: VehicleRepairInput): RepairItem[] {
  const { facts } = input
  const items: RepairItem[] = []
  const dates = [...new Set(input.blocks.map(b => dayOf(b.operation.date)))].sort()
  const byId = new Map(facts.vehicles.map(v => [v.id, v]))
  const carText = (v: CarVehicle) => `${v.code} · ${VEHICLE_TYPE_LABELS[v.vehicleType] ?? v.vehicleType}`

  for (const date of dates) {
    const blocks = input.blocks.filter(b => dayOf(b.operation.date) === date)
    // VEHICLE_DOUBLE: the car stays on the block it suits best (then the lowest number)
    const keeper = new Map<string, string>()
    for (const b of blocks.filter(x => x.vehicleId && x.issues.includes('VEHICLE_DOUBLE'))) {
      const v = byId.get(b.vehicleId!)
      const cur = keeper.get(b.vehicleId!)
      const other = cur ? blocks.find(x => x.id === cur)! : null
      const cost = (x: VehicleRepairBlock) => (v ? carCost(facts, x, v) : BLOCKED)
      if (!other || cost(b) < cost(other) || (cost(b) === cost(other) && b.blockNumber < other.blockNumber)) keeper.set(b.vehicleId!, b.id)
    }
    const targets = blocks.filter(b => b.issues.some(c => TARGET.includes(c) && (c !== 'VEHICLE_DOUBLE' || keeper.get(b.vehicleId!) !== b.id)))
    if (!targets.length) continue
    const targetIds = new Set(targets.map(b => b.id))
    const busy = new Set([...(input.busy.get(date) ?? []), ...blocks.filter(b => b.vehicleId && !targetIds.has(b.id)).map(b => b.vehicleId!)])
    const pool = facts.vehicles.filter(v => !busy.has(v.id) && availableOn(v, date))
    const step = (b: VehicleRepairBlock, to: string | null): RepairStep => ({ type: 'vehicle', blockId: b.id, from: b.vehicleId, to })
    const item = (b: VehicleRepairBlock): RepairItem => ({
      id: b.id, date, label: `Bloco ${b.blockNumber}`,
      reason: b.issues.filter(c => TARGET.includes(c)).map(c => DAILY_ISSUE_LABEL[c]).join(' · '),
      current: b.vehicleId ? input.code.get(b.vehicleId) ?? '?' : null, published: b.published, options: [], proposed: null, unsolved: null,
    })
    const spare = (b: VehicleRepairBlock, v: CarVehicle, cost: number): RepairOption => ({
      kind: 'SPARE', text: carText(v), notes: COST_NOTE[cost] ? [COST_NOTE[cost]] : [], steps: [step(b, v.id)], affected: crewOf(b),
    })

    // ── 1. free cars: a minimum-cost matching ──
    const taken = new Set<string>()
    const costs = targets.map(b => pool.map(v => carCost(facts, b, v)))
    const chosen = pool.length ? hungarian(costs.map((line, r) => {
      const out = line.concat(new Array<number>(targets.length).fill(BLOCKED))
      out[pool.length + r] = NO_CAR
      return out
    }), pool.length + targets.length) : targets.map(() => -1)
    chosen.forEach(c => { if (c >= 0 && c < pool.length) taken.add(pool[c].id) })
    const left: VehicleRepairBlock[] = []
    targets.forEach((b, r) => {
      const c = chosen[r]
      if (c < 0 || c >= pool.length || costs[r][c] >= BLOCKED) { left.push(b); return }
      const it = item(b)
      const alternatives = pool.flatMap((v, k) => (k === c || taken.has(v.id) || costs[r][k] >= BLOCKED ? [] : [{ v, cost: costs[r][k] }]))
        .sort((a, x) => a.cost - x.cost).slice(0, MAX_OPTIONS - 1)
      for (const o of [{ v: pool[c], cost: costs[r][c] }, ...alternatives]) it.options.push(spare(b, o.v, o.cost))
      it.proposed = 0
      items.push(it)
    })

    // ── 2. a free car of another type: swap with a block it fits ──
    for (const b of left) {
      const it = item(b)
      let best: { extra: number; option: RepairOption } | null = null
      for (const s of pool) {
        if (taken.has(s.id)) continue
        for (const x of blocks) {
          if (targetIds.has(x.id) || !x.vehicleId) continue
          const c = byId.get(x.vehicleId)
          if (!c) continue
          const onTarget = carCost(facts, b, c), swapped = carCost(facts, x, s)
          if (onTarget >= BLOCKED || swapped >= BLOCKED) continue
          // what the block giving its car loses in preference
          const extra = swapped - carCost(facts, x, c) + onTarget
          if (best && extra >= best.extra) continue
          best = {
            extra,
            option: {
              kind: 'TYPE_SWAP', text: `${carText(c)} sai do Bloco ${x.blockNumber}, que fica com ${carText(s)}`,
              notes: COST_NOTE[carCost(facts, x, c)] ? [`o Bloco ${x.blockNumber} perde o ${COST_NOTE[carCost(facts, x, c)]}`] : [],
              steps: [{ type: 'vehicle', blockId: x.id, from: c.id, to: s.id }, step(b, c.id)],
              affected: [...new Set([...crewOf(b), ...crewOf(x)])],
            },
          }
        }
      }
      if (best) {
        it.options.push(best.option)
        it.proposed = 0
        const swap = best.option.steps[0] as { blockId: string; to: string }
        taken.add(swap.to)
        // the block that gave its car now runs the free one — out of later swaps
        targetIds.add(swap.blockId)
      } else {
        it.unsolved = pool.some(v => !taken.has(v.id)) ? 'nenhum carro livre roda o bloco, nem por giro de tipo' : 'nenhum carro livre da empresa no dia'
      }
      items.push(it)
    }
  }
  return items.sort((a, b) => a.date.localeCompare(b.date) || a.label.localeCompare(b.label, 'pt-BR', { numeric: true }))
}
