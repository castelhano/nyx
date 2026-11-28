import { describe, expect, it } from 'vitest'
import { renumberOrder, type RenumberBlock, type RenumberLine } from './block-renumber.utils'

const LINES: RenumberLine[] = [
  { id: 'l309',  code: '309',  parentLineId: null },
  { id: 'l206',  code: '206',  parentLineId: null },
  { id: 'l206B', code: '206B', parentLineId: 'l206' },
  { id: 'l031',  code: '031',  parentLineId: null },
  { id: 'lA06',  code: 'A06B', parentLineId: null },
]

const block = (id: string, blockNumber: number, trips: Array<[string, number]>): RenumberBlock =>
  ({ id, blockNumber, trips: trips.map(([lineId, departureMinutes]) => ({ lineId, departureMinutes })) })

describe('renumberOrder', () => {
  it('orders by line code (natural), then by the first trip', () => {
    const order = renumberOrder([
      block('a', 1, [['l309', 300]]),
      block('b', 2, [['lA06', 200]]),
      block('c', 3, [['l031', 500]]),
      block('d', 4, [['l031', 400]]),
      block('e', 5, [['l206', 100]]),
    ], LINES)
    expect(order).toEqual(['d', 'c', 'e', 'a', 'b'])
  })

  it('places a mixed car under the line with most trips, regardless of its first trip', () => {
    const order = renumberOrder([
      block('mixed', 1, [['l031', 300], ['l309', 400], ['l309', 500]]),
      block('pure',  2, [['l309', 350]]),
    ], LINES)
    expect(order).toEqual(['mixed', 'pure'])
  })

  it('breaks a tie by the line of the first trip', () => {
    const order = renumberOrder([
      block('tie',  1, [['l309', 300], ['l031', 400]]),
      block('o031', 2, [['l031', 100]]),
    ], LINES)
    // tie between 309 and 031 → 309, the first trip's line, so it comes after the 031 car
    expect(order).toEqual(['o031', 'tie'])
  })

  it('counts a child line within its parent family', () => {
    const order = renumberOrder([
      block('child',  1, [['l206B', 300]]),
      block('parent', 2, [['l206', 400]]),
      block('mixed',  3, [['l206B', 200], ['l206', 250], ['l309', 100], ['l309', 150]]),
    ], LINES)
    // mixed: 2 trips of the 206 family vs 2 of 309 → tie, first trip is 309
    expect(order).toEqual(['child', 'parent', 'mixed'])
  })

  it('puts cars with no trip last, in their old order', () => {
    const order = renumberOrder([
      block('empty2', 9, []),
      block('empty1', 2, []),
      block('x',      5, [['l309', 100]]),
    ], LINES)
    expect(order).toEqual(['x', 'empty1', 'empty2'])
  })
})
