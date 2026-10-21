import { describe, expect, it } from 'vitest'
import { selectLineCopy, type LineCopySourceBlock } from './line-copy.utils'

const trip = (id: string, sequence: number, lineId: string, dep: number, arr: number, bundleId: string | null = null) =>
  ({ id, sequence, lineId, departureMinutes: dep, arrivalMinutes: arr, bundleId })
const deadrun = (id: string, type: string, dep: number, arr: number, bundleId: string | null = null) =>
  ({ id, type, departureMinutes: dep, arrivalMinutes: arr, bundleId })
const interval = (id: string, dep: number, arr: number, bundleId: string | null = null) =>
  ({ id, departureMinutes: dep, arrivalMinutes: arr, bundleId })

describe('selectLineCopy', () => {
  it('copies a single-line block whole, its group included', () => {
    const block: LineCopySourceBlock = {
      trips:     [trip('t1', 1, 'F01', 300, 360, 'g'), trip('t2', 2, 'F01', 370, 430, 'g')],
      deadruns:  [deadrun('a', 'ACCESS', 280, 299, 'g'), deadrun('r', 'RETURN', 431, 450)],
      intervals: [interval('i', 360, 370, 'g')],
    }
    const sel = selectLineCopy(block, 'F01')
    expect([...sel.tripIds]).toEqual(['t1', 't2'])
    expect([...sel.deadrunIds]).toEqual(['a', 'r'])
    expect([...sel.intervalIds]).toEqual(['i'])
    expect([...sel.keptBundleIds]).toEqual(['g'])
    expect(sel.dissolved).toEqual([])
  })

  it('leaves behind what touches another line', () => {
    const block: LineCopySourceBlock = {
      trips:     [trip('x', 1, 'X', 300, 360), trip('t1', 2, 'F01', 380, 440), trip('t2', 3, 'F01', 450, 500), trip('y', 4, 'X', 520, 580)],
      deadruns:  [deadrun('a', 'ACCESS', 280, 299), deadrun('d1', 'DISPLACEMENT', 362, 378), deadrun('r', 'RETURN', 581, 600)],
      intervals: [interval('i1', 440, 450), interval('i2', 500, 520)],
    }
    const sel = selectLineCopy(block, 'F01')
    expect([...sel.tripIds]).toEqual(['t1', 't2'])
    expect([...sel.deadrunIds]).toEqual([])
    expect([...sel.intervalIds]).toEqual(['i1'])
  })

  // block 111 of the weekday plan: the line's trips sequenced after the others', and the
  // vehicle back at the depot between pull-outs
  it('takes each pull-out by time, not by sequence', () => {
    const block: LineCopySourceBlock = {
      trips: [
        trip('o1', 1, 'X', 404, 460), trip('o2', 2, 'X', 1036, 1338),
        trip('t3', 3, 'F01', 870, 930), trip('t1', 4, 'F01', 195, 230), trip('t2', 5, 'F01', 270, 290),
      ],
      deadruns: [
        deadrun('a1', 'ACCESS', 159, 194), deadrun('d1', 'DISPLACEMENT', 236, 261), deadrun('r1', 'RETURN', 296, 321),
        deadrun('a2', 'ACCESS', 396, 404), deadrun('r2', 'RETURN', 655, 663),
        deadrun('a3', 'ACCESS', 852, 869), deadrun('d2', 'DISPLACEMENT', 956, 970), deadrun('r3', 'RETURN', 1389, 1402),
      ],
      intervals: [],
    }
    const sel = selectLineCopy(block, 'F01')
    expect([...sel.deadrunIds].sort()).toEqual(['a1', 'a3', 'd1', 'r1'])
  })

  it('keeps the line part of a mixed group while unbroken', () => {
    const block: LineCopySourceBlock = {
      trips:     [trip('t1', 1, 'F01', 300, 360, 'g'), trip('t2', 2, 'F01', 370, 430, 'g'), trip('x', 3, 'X', 440, 500, 'g')],
      deadruns:  [],
      intervals: [interval('i', 360, 370, 'g')],
    }
    const sel = selectLineCopy(block, 'F01')
    expect([...sel.keptBundleIds]).toEqual(['g'])
    expect(sel.dissolved).toEqual([])
  })

  it('dissolves a group the other line splits', () => {
    const block: LineCopySourceBlock = {
      trips:     [trip('t1', 1, 'F01', 300, 360, 'g'), trip('x', 2, 'X', 370, 430, 'g'), trip('t2', 3, 'F01', 440, 500, 'g')],
      deadruns:  [],
      intervals: [],
    }
    const sel = selectLineCopy(block, 'F01')
    expect([...sel.keptBundleIds]).toEqual([])
    expect(sel.dissolved).toEqual([{ bundleId: 'g', start: 300 }])
  })

  it('ignores groups entirely of another line', () => {
    const block: LineCopySourceBlock = {
      trips:     [trip('t1', 1, 'F01', 300, 360), trip('x', 2, 'X', 370, 430, 'g'), trip('y', 3, 'X', 440, 500, 'g')],
      deadruns:  [],
      intervals: [],
    }
    const sel = selectLineCopy(block, 'F01')
    expect(sel.keptBundleIds.size).toBe(0)
    expect(sel.dissolved).toEqual([])
  })
})
