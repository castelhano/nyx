'use client'

import { useEffect, useMemo, useRef, useState } from 'react'
import { useQuery } from '@tanstack/react-query'
import { Button } from '@/components/ui/button'
import { Switch } from '@/components/ui/switch'
import { Icons } from '@/lib/icons'
import { apiFetch } from '@/lib/auth'
import { useToast } from '@/lib/toast-context'
import { useShortcut, useShortcutContext } from '@/lib/keywatch'
import type { ShortcutSection } from '@/lib/keywatch'
import type { GanttBlock, LineMetrics } from '../views/vehicles.view'
import type { PendingAddEntry } from './AddTripModal'
import { redistributeTrips, type Direction, type RedistributeTripCandidate } from '../line-generator-logic'

const DIR_LABEL: Record<Direction, string> = { OUTBOUND: 'Ida', INBOUND: 'Volta', CIRCULAR: 'Circular' }
const DIR_ORDER: Direction[] = ['OUTBOUND', 'INBOUND', 'CIRCULAR']
const SEC_FORM: ShortcutSection = { label: 'Formulário — Redistribuir' }

interface RouteRecord {
  id:        string
  direction: Direction
  isPrimary: boolean
}

interface Props {
  lineId:             string
  lineCode:           string
  lineName:           string
  lineMetrics:        LineMetrics | null
  dayTypeCode:        string
  blocks:             GanttBlock[]
  hasPendingChanges:  boolean
  onClose:            () => void
  onPendingAdd:       (entry: PendingAddEntry) => void
  onQueueTripDeletes: (tripIds: string[]) => void
}

export function RedistributeModal({
  lineId, lineCode, lineName, lineMetrics, dayTypeCode, blocks, hasPendingChanges,
  onClose, onPendingAdd, onQueueTripDeletes,
}: Props) {
  useShortcutContext('redistribute_md')
  const { toast } = useToast()

  useEffect(() => {
    function handleKey(e: KeyboardEvent) {
      if (e.key === 'Escape') onClose()
    }
    document.addEventListener('keydown', handleKey)
    return () => document.removeEventListener('keydown', handleKey)
  }, [onClose])

  const { data: routes = [] } = useQuery<RouteRecord[]>({
    queryKey: ['transit', 'transit-route', 'by-line', lineId],
    queryFn:  async () => {
      const res = await apiFetch(`/transit/transit-route?f_lineId=${lineId}&pageSize=999`)
      if (!res.ok) return []
      const json = await res.json()
      return json.data ?? []
    },
  })

  // One route per direction (prefers isPrimary) — same convention as
  // LineScheduleGeneratorModal's lineRoutes.
  const routeByDirection = useMemo(() => {
    const map = new Map<Direction, RouteRecord>()
    for (const r of routes) {
      const existing = map.get(r.direction)
      if (!existing || (r.isPrimary && !existing.isPrimary)) map.set(r.direction, r)
    }
    return map
  }, [routes])

  const directions = useMemo(() => DIR_ORDER.filter(d => routeByDirection.has(d)), [routeByDirection])

  const [marginByDirection, setMarginByDirection] = useState<Partial<Record<Direction, number>>>({})
  const [keepOnlyProductive, setKeepOnlyProductive] = useState(true)
  const [keepInterval,       setKeepInterval]       = useState(true)

  const formRef = useRef<HTMLFormElement>(null)
  useShortcut('alt+g', () => formRef.current?.requestSubmit(), {
    desc:    'Redistribuir',
    context: 'redistribute_md',
    icon:    Icons.Shuffle,
    origin:  'apps/web/src/app/transit/vehicle-plan/[id]/components/RedistributeModal.tsx',
    section: SEC_FORM,
  })

  function setMargin(direction: Direction, value: number) {
    setMarginByDirection(prev => ({ ...prev, [direction]: Math.max(0, Math.min(10, value)) }))
  }

  function handleSubmit(e: React.FormEvent) {
    e.preventDefault()
    if (hasPendingChanges) return

    const localityNameById = new Map<string, string>()
    const candidates: RedistributeTripCandidate[] = []
    // Signature (ordered "tripId:arrivalMinutes") of each original block's
    // candidate trips — used below to recognize a packed group that's byte-for-
    // byte identical to a block that already exists, so it can be skipped
    // instead of deleted and recreated for no reason.
    const originalSignatures = new Set<string>()
    let skippedNoRoute = 0

    for (const block of blocks) {
      const lineTrips = block.blockTrips.filter(bt => bt.trip.route.line.id === lineId)
      if (lineTrips.length === 0) continue

      // "Manter somente viagens produtivas" unchecked: a block that already has
      // a deadrun/interval is left untouched — its trips stay exactly as they are.
      const blockHasNonTrip = block.blockDeadruns.length > 0 || block.blockIntervals.length > 0
      if (!keepOnlyProductive && blockHasNonTrip) continue

      const sortedLineTrips = [...lineTrips].sort((a, b) => a.trip.departureMinutes - b.trip.departureMinutes)
      const signatureParts: string[] = []

      for (const bt of sortedLineTrips) {
        localityNameById.set(bt.trip.route.originLocality.id,      bt.trip.route.originLocality.name)
        localityNameById.set(bt.trip.route.destinationLocality.id, bt.trip.route.destinationLocality.name)

        const direction = bt.trip.route.direction as Direction
        const route      = routeByDirection.get(direction)
        if (!route) { skippedNoRoute++; continue }

        candidates.push({
          _tempId:                 crypto.randomUUID(),
          tripId:                  bt.trip.id,
          routeId:                 route.id,
          direction,
          vehicleType:             block.vehicleType,
          originLocalityId:        bt.trip.route.originLocality.id,
          destinationLocalityId:   bt.trip.route.destinationLocality.id,
          departureMinutes:        bt.trip.departureMinutes,
          originalDurationMinutes: bt.trip.arrivalMinutes - bt.trip.departureMinutes,
        })
        signatureParts.push(`${bt.trip.id}:${bt.trip.arrivalMinutes}`)
      }

      if (signatureParts.length > 0) originalSignatures.add(signatureParts.join('|'))
    }

    if (candidates.length === 0) {
      toast.error('Nenhuma viagem elegível para redistribuir')
      return
    }

    const margin: Partial<Record<Direction, number>> = {}
    for (const d of directions) margin[d] = marginByDirection[d] ?? 0

    const { blocks: packed, warnings } = redistributeTrips(candidates, lineMetrics, dayTypeCode, margin, keepInterval)

    // Groups whose composition, order and timing exactly match an already-
    // persisted block are left alone entirely — same trip ids can only produce
    // the same signature once, so a match here really is that same block,
    // nothing left to stage for it.
    let touchedTripCount   = 0
    let touchedGroupCount  = 0
    let unchangedGroupCount = 0
    const touchedTripIds: string[] = []

    for (const group of packed) {
      const signature = group.map(rt => `${rt.candidate.tripId}:${rt.arrivalMinutes}`).join('|')
      if (originalSignatures.has(signature)) { unchangedGroupCount++; continue }

      touchedGroupCount++
      let anchorTempId: string | null = null
      for (const rt of group) {
        touchedTripCount++
        touchedTripIds.push(rt.candidate.tripId)
        const originLocality      = { id: rt.candidate.originLocalityId,      name: localityNameById.get(rt.candidate.originLocalityId)      ?? '' }
        const destinationLocality = { id: rt.candidate.destinationLocalityId, name: localityNameById.get(rt.candidate.destinationLocalityId) ?? '' }
        onPendingAdd({
          _kind:               'trip',
          _tempId:             rt.candidate._tempId,
          routeId:             rt.candidate.routeId,
          direction:           rt.candidate.direction,
          lineId, lineCode, lineName, lineMetrics,
          originLocality, destinationLocality,
          departureMinutes:    rt.candidate.departureMinutes,
          arrivalMinutes:      rt.arrivalMinutes,
          blockId:             anchorTempId ? `pending:${anchorTempId}` : 'new',
        })
        if (!anchorTempId) anchorTempId = rt.candidate._tempId
      }
    }

    if (touchedTripCount === 0) {
      toast.success('Nenhuma alteração necessária — distribuição atual já é a mais eficiente dentro da margem informada'
        + (skippedNoRoute > 0 ? ` (${skippedNoRoute} ignorada(s) por falta de sentido cadastrado)` : ''))
      onClose()
      return
    }

    onQueueTripDeletes(touchedTripIds)

    const parts = [
      `${touchedTripCount} viagem(ns) redistribuída(s) em ${touchedGroupCount} bloco(s)`,
      unchangedGroupCount > 0 ? `${unchangedGroupCount} bloco(s) mantido(s) sem alteração` : null,
      skippedNoRoute > 0 ? `${skippedNoRoute} ignorada(s) por falta de sentido cadastrado` : null,
      ...warnings,
    ].filter(Boolean)
    toast.success(`${parts.join(' — ')} — use Salvar para persistir`)
    onClose()
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center">
      <div className="absolute inset-0 bg-black/40" onClick={onClose} />
      <form
        ref={formRef}
        onSubmit={handleSubmit}
        className="relative z-10 bg-card border border-border rounded-lg shadow-xl w-full max-w-md mx-4 p-6 space-y-5"
      >
        <h2 className="text-base font-semibold">Redistribuir viagens — {lineCode}</h2>

        {hasPendingChanges && (
          <div className="flex items-center gap-2 rounded-md bg-amber-50 dark:bg-amber-950/30 border border-amber-200 dark:border-amber-800 px-3 py-2 text-xs text-amber-700 dark:text-amber-400">
            <Icons.AlertCircle className="w-4 h-4 shrink-0" />
            Salve ou descarte as alterações pendentes antes de redistribuir.
          </div>
        )}

        <div className="space-y-2">
          <p className="text-xs font-medium text-muted-foreground uppercase tracking-wider">Margem de manobra (min)</p>
          {directions.length === 0 ? (
            <p className="text-xs text-muted-foreground">Nenhum sentido cadastrado para esta linha</p>
          ) : (
            <div className="grid grid-cols-2 gap-3">
              {directions.map((d, i) => (
                <div key={d}>
                  <label className="text-xs text-muted-foreground">{DIR_LABEL[d]}</label>
                  <input
                    type="number" min={0} max={10}
                    autoFocus={i === 0}
                    value={marginByDirection[d] ?? 0}
                    onChange={e => setMargin(d, Number(e.target.value) || 0)}
                    className="w-full mt-1 rounded-sm border border-input bg-input-bg px-2 py-1.5 text-sm focus:outline-none focus:ring-1 focus:ring-ring"
                  />
                </div>
              ))}
            </div>
          )}
        </div>

        <div className="space-y-3">
          <div className="flex items-start gap-2.5">
            <Switch checked={keepOnlyProductive} onToggle={() => setKeepOnlyProductive(v => !v)} className="mt-0.5" />
            <div>
              <span className="text-sm cursor-pointer select-none" onClick={() => setKeepOnlyProductive(v => !v)}>
                Manter somente viagens produtivas
              </span>
              <p className="text-xs text-muted-foreground">
                Desconsidera vazios e intervalos existentes, forçando a redistribuição de todas as partidas
              </p>
            </div>
          </div>

          <div className="flex items-start gap-2.5">
            <Switch checked={keepInterval} onToggle={() => setKeepInterval(v => !v)} className="mt-0.5" />
            <div>
              <span className="text-sm cursor-pointer select-none" onClick={() => setKeepInterval(v => !v)}>
                Manter intervalo entre viagens inalterado
              </span>
              <p className="text-xs text-muted-foreground">
                Desmarcado, usa o mínimo de 1min entre viagens ao invés do intervalo cadastrado
              </p>
            </div>
          </div>
        </div>

        <div className="flex justify-end gap-2 pt-1">
          <Button type="button" variant="cancel" size="sm" tabIndex={-1} onClick={onClose}>
            Cancelar
          </Button>
          <Button type="submit" size="sm" disabled={hasPendingChanges || directions.length === 0}>
            Redistribuir
          </Button>
        </div>
      </form>
    </div>
  )
}
