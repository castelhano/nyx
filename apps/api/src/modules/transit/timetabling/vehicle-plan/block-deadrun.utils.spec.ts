import { describe, expect, it } from 'vitest'
import { findDeadrunIdsAnchoredToTrips } from './block-deadrun.utils'

// findDeadrunIdsAnchoredToTrips — which deadruns go away with the trips being removed
type Trip    = { id: string; dep: number; arr: number; sequence: number }
type Deadrun = { id: string; type: 'ACCESS' | 'RETURN' | 'DISPLACEMENT'; dep: number }

function fakeDb(trips: Trip[], deadruns: Deadrun[]) {
  return {
    blockTrip: {
      // sequence order, as the rows come out of the table — not necessarily chronological
      findMany: async () => [...trips].sort((a, b) => a.sequence - b.sequence)
        .map(t => ({ tripId: t.id, trip: { departureMinutes: t.dep, arrivalMinutes: t.arr } })),
    },
    blockDeadrun: { findMany: async () => deadruns.map(d => ({ id: d.id, type: d.type, departureMinutes: d.dep })) },
  } as any
}

const h = (hhmm: string) => Number(hhmm.slice(0, 2)) * 60 + Number(hhmm.slice(3))

// a 340 morning, recolhida, then a 309 afternoon (plan "Ferias Dez 26", block 124)
const trips: Trip[] = [
  { id: '340a', dep: h('05:09'), arr: h('05:58'), sequence: 1 },
  { id: '340b', dep: h('08:01'), arr: h('09:05'), sequence: 2 },
  { id: '309a', dep: h('13:18'), arr: h('14:21'), sequence: 3 },
  { id: '309b', dep: h('16:48'), arr: h('17:51'), sequence: 4 },
]
const deadruns: Deadrun[] = [
  { id: 'acc-am', type: 'ACCESS', dep: h('04:51') },
  { id: 'ret-am', type: 'RETURN', dep: h('09:06') },
  { id: 'acc-pm', type: 'ACCESS', dep: h('13:07') },
  { id: 'ret-pm', type: 'RETURN', dep: h('17:52') },
]

describe('findDeadrunIdsAnchoredToTrips', () => {
  it('takes only the access and return around the removed trips, not the other line\'s', async () => {
    const ids = await findDeadrunIdsAnchoredToTrips(fakeDb(trips, deadruns), 'b', ['309a', '309b'])
    expect(ids.sort()).toEqual(['acc-pm', 'ret-pm'])
  })

  it('removing the block\'s last trip leaves the mid-day return of an earlier trip', async () => {
    const ids = await findDeadrunIdsAnchoredToTrips(fakeDb(trips, deadruns), 'b', ['309b'])
    expect(ids).toEqual(['ret-pm'])
  })

  it('removing the block\'s first trip leaves the afternoon access', async () => {
    const ids = await findDeadrunIdsAnchoredToTrips(fakeDb(trips, deadruns), 'b', ['340a'])
    expect(ids).toEqual(['acc-am'])
  })

  it('goes by time, not by the order trips were added to the block', async () => {
    // an early trip moved in last (highest sequence) is still the one the morning access serves
    const moved = trips.map(t => t.id === '340a' ? { ...t, sequence: 9 } : t)
    expect(await findDeadrunIdsAnchoredToTrips(fakeDb(moved, deadruns), 'b', ['340a'])).toEqual(['acc-am'])
    expect(await findDeadrunIdsAnchoredToTrips(fakeDb(moved, deadruns), 'b', ['309b'])).toEqual(['ret-pm'])
  })

  it('anchors a displacement to the trip before it', async () => {
    const withDisp: Deadrun[] = [...deadruns, { id: 'disp', type: 'DISPLACEMENT', dep: h('14:22') }]
    expect(await findDeadrunIdsAnchoredToTrips(fakeDb(trips, withDisp), 'b', ['309a'])).toEqual(['acc-pm', 'disp'])
  })
})
