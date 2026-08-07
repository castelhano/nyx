import { useQuery } from '@tanstack/react-query'
import { apiFetch } from '@/lib/auth'
import type { RouteLocality } from './types'

interface Props {
  rl: RouteLocality
  position: number | null  // 0-indexed among stops (0 = origin); null for waypoints
}

interface LocalityRoute {
  route: { line: { id: string; code: string } }
}

function fmt(n: number | null, unit: string): string {
  return n == null ? '—' : `${n}${unit}`
}

// react-leaflet only mounts a Popup's children once it's actually opened, so this
// query fires on demand per point clicked — never eagerly for every marker on the map
function LinesRow({ localityId }: { localityId: string }) {
  const { data, isLoading } = useQuery({
    queryKey: ['transit', 'transit-locality', localityId, 'routes'],
    queryFn:  () => apiFetch(`/transit/transit-locality/${localityId}/routes`).then((r) => r.json() as Promise<LocalityRoute[]>),
    staleTime: 60_000,
  })

  const codes = data ? [...new Map(data.map((r) => [r.route.line.id, r.route.line.code])).values()] : []

  return (
    <div className="flex justify-between gap-3">
      <dt className="text-muted-foreground">Linhas</dt>
      <dd className="font-medium text-right">{isLoading ? '…' : codes.length > 0 ? codes.join(', ') : '—'}</dd>
    </div>
  )
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
    ...(rl.localityId != null ? [['Troca de motorista', rl.allowsCrewChange ? 'Sim' : 'Não'] as [string, string]] : []),
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
      {rl.localityId != null && <LinesRow localityId={rl.localityId} />}
    </dl>
  )
}
