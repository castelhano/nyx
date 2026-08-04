// Mock data for the Line Schedule Generator prototype — see
// docs/proposal/vehicle-plan-line-schedule-generator.md. No relation to real
// scope/line data; shapes mirror TransitLine.metrics (windows/demand) so the
// prototype can graduate to real data with minimal changes.

export type Direction = 'OUTBOUND' | 'INBOUND' | 'CIRCULAR'

export interface CycleWindow {
  from:    number // decimal hour, 0–23.5, half-hour resolution — mirrors line.schema.ts
  to:      number
  minutes: number
}

export interface MockRoute {
  direction:       Direction
  originName:      string
  destinationName: string
}

export interface MockLine {
  code:         string
  name:         string
  dayTypeCode:  string
  // A line has one route per direction it actually operates — 1 to 3 of
  // OUTBOUND/INBOUND/CIRCULAR. This is the source of truth for which
  // directions the rest of the form (renewal index rows, etc.) iterates over;
  // never assume OUTBOUND+INBOUND are both present.
  routes:       MockRoute[]
  windows:      Partial<Record<Direction, CycleWindow[]>>
  demand:       Partial<Record<Direction, Record<number, number>>> // hour → avg pax
  renewalIndex: Partial<Record<Direction, number>>                  // % turnover along the route
}

export interface Depot {
  id:   string
  name: string
}

export interface IntervalTypeMock {
  id:         string
  code:       string
  name:       string
  isPaid:     boolean
  minMinutes: number | null
  maxMinutes: number | null
}

export const MOCK_DEPOTS: Depot[] = [
  { id: 'd1', name: 'Garagem Central' },
  { id: 'd2', name: 'Garagem Norte' },
  { id: 'd3', name: 'Garagem Sul' },
]

export const MOCK_INTERVAL_TYPES: IntervalTypeMock[] = [
  { id: 'it1', code: 'REF',  name: 'Refeição', isPaid: true,  minMinutes: 30, maxMinutes: 60 },
  { id: 'it2', code: 'DESC', name: 'Descanso', isPaid: false, minMinutes: 10, maxMinutes: 20 },
]

export const MOCK_LINE: MockLine = {
  code:        '1203',
  name:        'Vila Nova / Centro',
  dayTypeCode: 'U',

  routes: [
    { direction: 'OUTBOUND', originName: 'Vila Nova', destinationName: 'Centro'    },
    { direction: 'INBOUND',  originName: 'Centro',     destinationName: 'Vila Nova' },
  ],

  // Deliberately misaligned between directions — the generator has to unify
  // these into one merged timeline (see generator-logic.ts#buildUnifiedWindows).
  windows: {
    OUTBOUND: [
      { from: 0,    to: 4.5,  minutes: 70  },
      { from: 4.5,  to: 6,    minutes: 85  },
      { from: 6,    to: 9,    minutes: 110 },
      { from: 9,    to: 16,   minutes: 80  },
      { from: 16,   to: 19.5, minutes: 115 },
      { from: 19.5, to: 23.5, minutes: 75  },
    ],
    INBOUND: [
      { from: 0,    to: 5,    minutes: 65  },
      { from: 5,    to: 6,    minutes: 80  },
      { from: 6,    to: 9.5,  minutes: 105 },
      { from: 9.5,  to: 16.5, minutes: 78  },
      { from: 16.5, to: 19,   minutes: 120 },
      { from: 19,   to: 23.5, minutes: 72  },
    ],
  },

  demand: {
    OUTBOUND: { 4: 40, 5: 180, 6: 420, 7: 650, 8: 580, 9: 320, 10: 210, 11: 230, 12: 280, 13: 260, 14: 240, 15: 270, 16: 340, 17: 520, 18: 610, 19: 430, 20: 260, 21: 150, 22: 90, 23: 40 },
    INBOUND:  { 4: 20, 5: 90,  6: 230, 7: 380, 8: 520, 9: 420, 10: 250, 11: 220, 12: 260, 13: 250, 14: 230, 15: 260, 16: 380, 17: 560, 18: 640, 19: 520, 20: 310, 21: 190, 22: 110, 23: 50 },
  },

  renewalIndex: { OUTBOUND: 35, INBOUND: 20 },
}

// Second line — only used by the trips-grid prototype (TripsGridPrototype.tsx)
// to validate multiple lines stacked in one running-schedule table.
export const MOCK_LINE_2: MockLine = {
  code:        '1204',
  name:        'Jardim Sul / Terminal',
  dayTypeCode: 'U',

  routes: [
    { direction: 'OUTBOUND', originName: 'Jardim Sul', destinationName: 'Terminal'   },
    { direction: 'INBOUND',  originName: 'Terminal',   destinationName: 'Jardim Sul' },
  ],

  windows: {
    OUTBOUND: [
      { from: 0,    to: 5,    minutes: 55 },
      { from: 5,    to: 8,    minutes: 90 },
      { from: 8,    to: 17,   minutes: 65 },
      { from: 17,   to: 20,   minutes: 95 },
      { from: 20,   to: 23.5, minutes: 60 },
    ],
    INBOUND: [
      { from: 0,    to: 5.5,  minutes: 50  },
      { from: 5.5,  to: 8.5,  minutes: 85  },
      { from: 8.5,  to: 17.5, minutes: 62  },
      { from: 17.5, to: 20.5, minutes: 100 },
      { from: 20.5, to: 23.5, minutes: 58  },
    ],
  },

  demand: {},

  renewalIndex: { OUTBOUND: 25, INBOUND: 15 },
}
