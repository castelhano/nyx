export type Direction = 'OUTBOUND' | 'INBOUND' | 'CIRCULAR'

export interface RawTrip {
  date:          string
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
  lines:  string[]
  byLine: Map<string, Map<Direction, RawTrip[]>>
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
