// Protótipo isolado — não importa nada de transit-line/cycle-map para não
// acoplar o playground ao código real. Reimplementa localmente só o
// suficiente (clustering + geração de dados sintéticos) para exercitar o
// canvas com granularidade de 30min.

export interface RawTrip {
  time:         string   // "HH:MM"
  cycleMinutes: number
  vehicle:      string
  edited:       boolean
}

export interface DotCluster {
  minutes:    number
  count:      number
  trips:      RawTrip[]
  isOutlier:  boolean
  isDisabled: boolean
  hasEdited:  boolean
}

const CLUSTER_TOLERANCE = 3

export function clusterTrips(trips: RawTrip[]): DotCluster[] {
  if (trips.length === 0) return []
  const sorted = [...trips].sort((a, b) => a.cycleMinutes - b.cycleMinutes)

  const groups: RawTrip[][] = []
  let current: RawTrip[] = [sorted[0]]
  for (let i = 1; i < sorted.length; i++) {
    if (sorted[i].cycleMinutes - current[0].cycleMinutes <= CLUSTER_TOLERANCE) {
      current.push(sorted[i])
    } else {
      groups.push(current)
      current = [sorted[i]]
    }
  }
  groups.push(current)

  return groups.map(g => {
    const freq = new Map<number, number>()
    for (const t of g) freq.set(t.cycleMinutes, (freq.get(t.cycleMinutes) ?? 0) + 1)
    const center = [...freq.entries()].sort((a, b) => b[1] - a[1])[0][0]
    return {
      minutes:    center,
      count:      g.length,
      trips:      g,
      isOutlier:  false,
      isDisabled: false,
      hasEdited:  g.some(t => t.edited),
    }
  })
}

function quantile(sorted: number[], q: number): number {
  const pos = (sorted.length - 1) * q
  const lo  = Math.floor(pos)
  const hi  = Math.ceil(pos)
  return sorted[lo] + (sorted[hi] - sorted[lo]) * (pos - lo)
}

export function markOutliers(clusters: DotCluster[]): DotCluster[] {
  const active  = clusters.filter(c => !c.isDisabled)
  const allVals = active.flatMap(c => c.trips.map(t => t.cycleMinutes)).sort((a, b) => a - b)

  if (allVals.length < 4) return clusters.map(c => ({ ...c, isOutlier: false }))

  const q1  = quantile(allVals, 0.25)
  const q3  = quantile(allVals, 0.75)
  const iqr = q3 - q1
  const lo  = q1 - 1.5 * iqr
  const hi  = q3 + 1.5 * iqr

  return clusters.map(c => ({
    ...c,
    isOutlier: !c.isDisabled && (c.minutes < lo || c.minutes > hi),
  }))
}

function timeToHour(time: string): number {
  return Number(time.split(':')[0])
}

/** Bucketing sempre por hora cheia — igual à produção. A granularidade de
 *  30min neste protótipo não muda o agrupamento dos pontos, só adiciona um
 *  segundo tipo de corte visual (ver engine.ts) dentro da coluna da hora. */
export function buildHourClusters(
  trips:         RawTrip[],
  includeEdited: boolean,
): Map<number, DotCluster[]> {
  const filtered = includeEdited ? trips : trips.filter(t => !t.edited)

  const byHour = new Map<number, RawTrip[]>()
  for (const t of filtered) {
    const hour = timeToHour(t.time)
    if (!byHour.has(hour)) byHour.set(hour, [])
    byHour.get(hour)!.push(t)
  }

  const result = new Map<number, DotCluster[]>()
  for (const [hour, ts] of byHour) result.set(hour, markOutliers(clusterTrips(ts)))
  return result
}

// Dataset sintético e determinístico: uma linha fictícia com um pico da manhã
// que muda bruscamente de padrão dentro da mesma hora (07:00–07:29 vs
// 07:30–07:59) — exatamente o caso que a faixa horária esconde e a faixa de
// 30min revela — e uma faixa esparsa no fim (11:30/12:00) com poucos pontos,
// para mostrar como a granularidade fina se comporta com pouco dado.
export function generateSyntheticTrips(seed = 1): RawTrip[] {
  let s = seed
  const rand = () => {
    s = (s * 9301 + 49297) % 233280
    return s / 233280
  }
  const jitter = (base: number, spread: number) => Math.round(base + (rand() - 0.5) * spread)

  const patterns: Array<{ hh: number; mm: number; count: number; base: number; spread: number }> = [
    { hh: 5,  mm: 0,  count: 8,  base: 68, spread: 8  },
    { hh: 5,  mm: 30, count: 8,  base: 64, spread: 8  },
    { hh: 6,  mm: 0,  count: 10, base: 66, spread: 10 },
    { hh: 6,  mm: 30, count: 10, base: 70, spread: 8  },
    { hh: 7,  mm: 0,  count: 12, base: 78, spread: 8  }, // pico da manhã
    { hh: 7,  mm: 30, count: 12, base: 54, spread: 8  }, // cai forte na mesma hora
    { hh: 8,  mm: 0,  count: 10, base: 50, spread: 6  },
    { hh: 8,  mm: 30, count: 8,  base: 48, spread: 6  },
    { hh: 9,  mm: 0,  count: 6,  base: 45, spread: 5  },
    { hh: 9,  mm: 30, count: 6,  base: 44, spread: 5  },
    { hh: 10, mm: 0,  count: 5,  base: 43, spread: 5  },
    { hh: 10, mm: 30, count: 5,  base: 43, spread: 5  },
    { hh: 11, mm: 0,  count: 4,  base: 44, spread: 6  },
    { hh: 11, mm: 30, count: 2,  base: 46, spread: 4  }, // faixa esparsa
    { hh: 12, mm: 0,  count: 2,  base: 45, spread: 4  }, // faixa esparsa
  ]

  const trips: RawTrip[] = []
  for (const p of patterns) {
    for (let i = 0; i < p.count; i++) {
      const min = Math.min(p.mm + Math.floor(rand() * 28), 59)
      trips.push({
        time:         `${String(p.hh).padStart(2, '0')}:${String(min).padStart(2, '0')}`,
        cycleMinutes: Math.max(15, jitter(p.base, p.spread)),
        vehicle:      `12${String(10 + (i % 5)).padStart(2, '0')}`,
        edited:       rand() < 0.06,
      })
    }
  }
  // outliers para paridade visual com a ferramenta real
  trips.push({ time: '07:12', cycleMinutes: 120, vehicle: '1299', edited: false })
  trips.push({ time: '09:40', cycleMinutes: 12,  vehicle: '1298', edited: false })

  return trips
}
