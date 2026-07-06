import type { RouteLocality } from './types'

interface Props {
  rl: RouteLocality
  position: number | null  // 0-indexed among stops (0 = origin); null for waypoints
}

function fmt(n: number | null, unit: string): string {
  return n == null ? '—' : `${n}${unit}`
}

export function PointDetails({ rl, position }: Props) {
  const lat = rl.locality?.lat ?? rl.lat
  const lng = rl.locality?.lng ?? rl.lng

  const rows: [string, string][] = [
    ['Sequência',          position == null ? '—' : String(position)],
    ['Nome',               rl.locality?.name ?? '—'],
    ['Abreviação',         rl.locality?.abbr ?? '—'],
    ['Código',             rl.locality?.code ?? '—'],
    ['Distância',          fmt(rl.deltaKm, ' km')],
    ['Tempo',              fmt(rl.deltaMinutes, ' min')],
    ['Origem do dado',     rl.deltaSource === 'MANUAL' ? 'Manual' : 'OSRM'],
    ['Troca de motorista', rl.allowsCrewChange ? 'Sim' : 'Não'],
    ['Coordenadas',        lat != null && lng != null ? `${lat.toFixed(6)}, ${lng.toFixed(6)}` : '—'],
  ]

  return (
    <dl className="text-xs space-y-1 min-w-40">
      {rows.map(([k, v]) => (
        <div key={k} className="flex justify-between gap-3">
          <dt className="text-muted-foreground">{k}</dt>
          <dd className="font-medium text-right">{v}</dd>
        </div>
      ))}
    </dl>
  )
}
