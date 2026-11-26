import { describe, expect, it } from 'vitest'
import { VehiclePlanService } from './vehicle-plan.service'

// resolveOrCreateBlock — the empresa and depot of a block the Gantt/generator creates
const VP = 'vp', RC = 'rc'
const DEPOTS = [
  { id: 'rapido', depot: { operators: [RC, VP] } },
  { id: 'vpar',   depot: { operators: [VP] } },
]

function fakeTx(opts: { lineOperators?: string[]; blocks?: { id: string; branchId: string | null; depotId: string; blockNumber: number }[]; scopeOperators?: string[] }) {
  const blocks = opts.blocks ?? []
  const created: any[] = []
  const tx = {
    created,
    vehicleBlock: {
      findFirst: async ({ where, orderBy }: any) => orderBy
        ? [...blocks].sort((a, b) => b.blockNumber - a.blockNumber)[0] ?? null
        : blocks.find(b => b.id === where.id) ?? null,
      groupBy: async ({ where }: any) => {
        const counts = new Map<string, number>()
        for (const b of blocks) if (b.branchId === where.branchId && where.depotId.in.includes(b.depotId)) counts.set(b.depotId, (counts.get(b.depotId) ?? 0) + 1)
        return [...counts].sort((a, b) => b[1] - a[1]).map(([depotId, n]) => ({ depotId, _count: { _all: n } }))
      },
      create: async ({ data }: any) => { created.push(data); return { id: 'new', ...data } },
    },
    lineOperator:   { findMany: async () => (opts.lineOperators ?? []).map(branchId => ({ branchId })) },
    scopeOperator:  { findMany: async () => (opts.scopeOperators ?? [VP, RC]).map(branchId => ({ branchId })) },
    transitLocality: { findMany: async () => DEPOTS },
  }
  return tx
}

const service = new VehiclePlanService({} as any, {} as any, {} as any, {} as any, {} as any, {} as any) as any
const create = (tx: any, refBlockId?: string, origin?: { lineId: string; homeDepotId: string | null }) =>
  service.resolveOrCreateBlock(tx, 'plan', undefined, refBlockId, origin).then(() => tx.created[0])

describe('resolveOrCreateBlock — new block', () => {
  it("takes the line's single operator, not the last block's empresa", async () => {
    const tx = fakeTx({
      lineOperators: [VP],
      blocks: [
        { id: 'b33', branchId: VP, depotId: 'rapido', blockNumber: 33 },
        { id: 'b209', branchId: RC, depotId: 'rapido', blockNumber: 209 },
      ],
    })
    const block = await create(tx, undefined, { lineId: '301', homeDepotId: null })
    expect(block).toMatchObject({ branchId: VP, depotId: 'rapido', blockNumber: 210 })
  })

  it('picks the depot the empresa uses the most in the plan when it may use several', async () => {
    const tx = fakeTx({
      lineOperators: [VP],
      blocks: [
        { id: 'a', branchId: VP, depotId: 'vpar', blockNumber: 1 },
        { id: 'b', branchId: VP, depotId: 'vpar', blockNumber: 2 },
        { id: 'c', branchId: VP, depotId: 'rapido', blockNumber: 3 },
      ],
    })
    expect(await create(tx, undefined, { lineId: '301', homeDepotId: null })).toMatchObject({ branchId: VP, depotId: 'vpar' })
  })

  it("prefers the route's home depot when the empresa may use it", async () => {
    const tx = fakeTx({ lineOperators: [RC] })
    expect(await create(tx, undefined, { lineId: 'x', homeDepotId: 'vpar' })).toMatchObject({ branchId: RC, depotId: 'rapido' })
    const tx2 = fakeTx({ lineOperators: [VP] })
    expect(await create(tx2, undefined, { lineId: 'x', homeDepotId: 'vpar' })).toMatchObject({ branchId: VP, depotId: 'vpar' })
  })

  it("keeps a move's source block empresa and depot when the line has several operators", async () => {
    const tx = fakeTx({ lineOperators: [VP, RC], blocks: [{ id: 'src', branchId: RC, depotId: 'rapido', blockNumber: 5 }] })
    expect(await create(tx, 'src')).toMatchObject({ branchId: RC, depotId: 'rapido', blockNumber: 6 })
  })

  it('leaves the empresa empty with several scope operators and nothing else to go by', async () => {
    const tx = fakeTx({ blocks: [{ id: 'b', branchId: RC, depotId: 'rapido', blockNumber: 9 }] })
    expect(await create(tx)).toMatchObject({ branchId: null, depotId: 'rapido' })
  })
})
