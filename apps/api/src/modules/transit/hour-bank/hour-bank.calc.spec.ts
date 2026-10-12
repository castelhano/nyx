import { describe, expect, it } from 'vitest'
import { forecastDay, importedDay, runBank } from './hour-bank.calc'
import { parseOpeningCsv } from './hour-bank.service'

const mv = (minutes: number) => ({ minutes, payMinutes: 0, holidayMinutes: 0 })

describe('hour bank day rule', () => {
  it('banks half of the extra and debits the whole shortfall', () => {
    expect(importedDay({ occurrence: 'NOR', extraMinutes: 147, shortMinutes: 0 }, 420)).toMatchObject({ minutes: 73, payMinutes: 74 })
    expect(importedDay({ occurrence: 'NOR', extraMinutes: 0, shortMinutes: 47 }, 420)).toMatchObject({ minutes: -47, payMinutes: 0 })
  })
  it('pays a worked holiday whole, debits a compensation, ignores neutral days', () => {
    expect(importedDay({ occurrence: 'F TRB', extraMinutes: 543, shortMinutes: 0 }, 420)).toMatchObject({ minutes: 0, holidayMinutes: 543 })
    expect(importedDay({ occurrence: 'COMPENSACAO B', extraMinutes: 0, shortMinutes: 0 }, 420)).toMatchObject({ minutes: -420 })
    expect(importedDay({ occurrence: '** FERIAS **', extraMinutes: 0, shortMinutes: 0 }, 420).minutes).toBe(0)
    expect(importedDay({ occurrence: 'JORJ', extraMinutes: 60, shortMinutes: 0 }, 420).minutes).toBe(0)
  })
  it('forecasts from the roster — plantão neutral, holiday paid', () => {
    expect(forecastDay([{ kind: 'DUTY', paid: 500 }], 420, false)).toMatchObject({ minutes: 40, payMinutes: 40 })
    expect(forecastDay([{ kind: 'DUTY', paid: 300 }], 420, false)).toMatchObject({ minutes: -120 })
    expect(forecastDay([{ kind: 'DUTY', paid: 300 }], 420, true)).toMatchObject({ minutes: 0, holidayMinutes: 300 })
    expect(forecastDay([{ kind: 'STANDBY', paid: 600 }], 420, false)).toBeNull()
    expect(forecastDay([{ kind: 'COMP_OFF', paid: 0 }], 420, false)).toMatchObject({ minutes: -420 })
  })
})

describe('hour bank lots', () => {
  it('expires the previous month lot at the closing, oldest consumed first', () => {
    const r = runBank([
      { month: '2026-09', closed: true, moves: [mv(600)] },
      { month: '2026-10', closed: true, moves: [mv(300), mv(-420)] },
      { month: '2026-11', closed: false, moves: [] },
    ])
    // October: the -420 eats September's 600 first → 180 of it expires at October's closing
    expect(r[1]).toMatchObject({ expiring: 180, payout: 180, lot: 300, balance: 300 })
    // November: October's 300 is expiring now
    expect(r[2]).toMatchObject({ expiring: 300, lot: 0, balance: 300 })
  })
  it('carries the negative, pays it off with credit and forgives it on even months', () => {
    const r = runBank([
      { month: '2026-09', closed: true, moves: [mv(-200)] },
      { month: '2026-10', closed: true, moves: [mv(50)] },
      { month: '2026-11', closed: true, moves: [mv(-30)] },
    ])
    expect(r[0]).toMatchObject({ negative: -200, forgiven: 0 })
    // October (even): 50 pays part of it, the remaining -150 is forgiven
    expect(r[1]).toMatchObject({ lot: 0, forgiven: 150, negative: 0 })
    expect(r[2]).toMatchObject({ negative: -30, balance: -30 })
  })
})

describe('opening balance csv', () => {
  it('reads the H:MM column, else the decimal one', () => {
    expect(parseOpeningCsv('matricula,decimal,horas\n10002,"32,95",32:57\n10003,"-6,42",-06:25\n030087;-7,5\n')).toEqual([
      { code: '10002', minutes: 1977 }, { code: '10003', minutes: -385 }, { code: '030087', minutes: -450 },
    ])
  })
})
