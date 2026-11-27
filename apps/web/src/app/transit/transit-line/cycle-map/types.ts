export type Direction = 'OUTBOUND' | 'INBOUND' | 'CIRCULAR'

export interface RawTrip {
  date:          string
  // `date` normalized to YYYY-MM-DD ('' when unparseable) — what the day filter matches
  day:           string
  lineCode:      string
  direction:     Direction
  departureHour: number
  departureTime: string
  cycleMinutes:  number
  vehicle:       string
  driver:        string
  edited:        boolean
}

export interface DotCluster {
  minutes:    number
  count:      number
  trips:      RawTrip[]
  isOutlier:  boolean
  isDisabled: boolean
  hasEdited:  boolean
}

export interface CsvData {
  lines:      string[]
  byLine:     Map<string, Map<Direction, RawTrip[]>>
  // distinct trip days (YYYY-MM-DD), ascending
  days:       string[]
  // "Data" of the first row with a usable trip — used to suggest a dayType
  sampleDate: string | null
}

export interface DotClickInfo {
  cluster:    DotCluster
  hour:       number
  clusterIdx: number
  canvasX:    number
  canvasY:    number
}

export interface MarqueeItem {
  hour:    number
  idx:     number
  cluster: DotCluster
}

export interface MarqueeSelection {
  items: MarqueeItem[]
  x:     number
  y:     number
}

export interface CycleEngineState {
  width:  number
  height: number
}
