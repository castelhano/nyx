import { describe, expect, it } from 'vitest'
import { assignRoundsToBlocks, generateRounds, type GenWindow } from '@nyx/schemas'

// generateRounds — the direction of the day's last trip (Fim) and what departs after it
const window: GenWindow = {
  id: 'w', from: 0, to: 24,
  outboundMinutes: 60, outboundKnown: true, outboundInterval: 5,
  inboundMinutes:  60, inboundKnown:  true, inboundInterval:  5,
  fleetCount: 4, reservedFlow: null, reservedOverrideMinutes: null,
}
const h = (hhmm: string) => Number(hhmm.slice(0, 2)) * 60 + Number(hhmm.slice(3))
const legsOf = (rounds: ReturnType<typeof generateRounds>['rounds']) =>
  rounds.flatMap(r => r.legs).sort((a, b) => a.departureMinutes - b.departureMinutes)

describe('generateRounds — last trip direction', () => {
  const start = h('04:40'), end = h('23:00')

  it('ending in the paired direction keeps full rounds, the last return on the end time', () => {
    const { rounds } = generateRounds([window], start, end, 'INBOUND', 'OUTBOUND')
    expect(rounds.every(r => r.legs.length === 2)).toBe(true)
    const last = legsOf(rounds).at(-1)!
    expect(last.direction).toBe('OUTBOUND')
    expect(Math.round(last.departureMinutes)).toBe(end)
  })

  it('ending in the start direction: the last start-direction trip lands on the end, nothing departs after it', () => {
    const { rounds, warnings } = generateRounds([window], start, end, 'INBOUND', 'INBOUND')
    const legs = legsOf(rounds)
    expect(legs.at(-1)!.direction).toBe('INBOUND')
    expect(Math.round(legs.at(-1)!.departureMinutes)).toBe(end)
    expect(legs.every(l => Math.round(l.departureMinutes) <= end)).toBe(true)
    expect(warnings.some(w => w.includes('A última viagem gerada é de'))).toBe(false)
  })

  it('drops every return past the end — each of those vehicles closes its day at the far terminal', () => {
    const full    = generateRounds([window], start, end, 'INBOUND', 'OUTBOUND').rounds
    const trimmed = generateRounds([window], start, end, 'INBOUND', 'INBOUND').rounds
    const cut = trimmed.filter(r => r.closesBlock)
    // with 4 cars on a 130' cycle, more than one return falls after 23:00
    expect(cut.length).toBeGreaterThan(1)
    expect(cut.every(r => r.legs.length === 1 && r.legs[0].direction === 'INBOUND')).toBe(true)
    // the start-direction trips are the same; only the returns after the end are gone
    const inbound = (rs: typeof full) => legsOf(rs).filter(l => l.direction === 'INBOUND').length
    expect(inbound(trimmed)).toBe(inbound(full))
    expect(legsOf(trimmed).length).toBe(legsOf(trimmed).filter(l => l.direction === 'INBOUND').length
      + trimmed.filter(r => !r.closesBlock).length)
  })

  it('a vehicle that closed its day takes no further round', () => {
    const { rounds } = generateRounds([window], start, end, 'INBOUND', 'INBOUND')
    for (const block of assignRoundsToBlocks(rounds, 3)) {
      const closedAt = block.rounds.findIndex(r => r.closesBlock)
      if (closedAt !== -1) expect(closedAt).toBe(block.rounds.length - 1)
    }
  })
})
