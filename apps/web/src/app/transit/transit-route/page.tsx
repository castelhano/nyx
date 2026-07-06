'use client'

import { useState, useEffect } from 'react'
import { useRouter, useSearchParams }        from 'next/navigation'
import dynamic                               from 'next/dynamic'
import { useQuery, useQueryClient }          from '@tanstack/react-query'
import { Icons }                             from '@/lib/icons'
import { apiFetch }                          from '@/lib/auth'
import { useToast }                          from '@/lib/toast-context'
import { useConfirm }                        from '@/lib/confirm-context'
import { useShortcut }                       from '@/lib/keywatch'
import { useTopbarActions }                  from '@/components/layout/topbar-actions-context'
import { Breadcrumb }                        from '@/components/ui/breadcrumb'
import { Button }                            from '@/components/ui/button'
import { RoutePanel }                        from './RoutePanel'
import { RulerCanvas }                       from './RulerCanvas'
import { CreateRouteModal }                  from './CreateRouteModal'
import { AddPointModal }                     from './AddPointModal'
import { SuggestModal }                      from './SuggestModal'
import { SeqModal }                          from './SeqModal'
import { apiPost, apiPatch, apiDelete }      from './api'
import type { TransitRoute, RouteLocality, PendingPoint, SuggestedLocality } from './types'
import { DIR_COLOR }                         from './types'
import { extractError } from '@/lib/utils'

const MapCanvas = dynamic(() => import('./MapCanvas'), { ssr: false })

type CanvasMode  = 'ruler' | 'map'
type TopbarState = 'idle' | 'pending' | 'suggesting'

export default function TransitRoutePage() {
  const router       = useRouter()
  const searchParams = useSearchParams()
  const queryClient  = useQueryClient()
  const { toast }    = useToast()
  const confirm      = useConfirm()

  const lineId    = searchParams.get('lineId') ?? ''
  const routeId   = searchParams.get('routeId') ?? ''

  const [canvasMode,    setCanvasMode]    = useState<CanvasMode>('ruler')
  const [showCreate,    setShowCreate]    = useState(false)
  const [showSeq,       setShowSeq]       = useState(false)
  const [addPointMode,  setAddPointMode]  = useState(false)
  const [mapClickPos,   setMapClickPos]   = useState<{ lat: number; lng: number } | null>(null)
  const [pendingPoints, setPendingPoints] = useState<PendingPoint[]>([])
  const [suggestions,   setSuggestions]  = useState<SuggestedLocality[] | null>(null)
  const [isSaving,      setIsSaving]     = useState(false)
  const [isReprocessing,setIsReprocessing] = useState(false)
  const [isSuggesting,  setIsSuggesting]  = useState(false)
  const [isDeleting,    setIsDeleting]    = useState(false)

  const topbarState: TopbarState = suggestions !== null ? 'suggesting' : pendingPoints.length > 0 ? 'pending' : 'idle'

  // ── queries ────────────────────────────────────────────────────────────────

  const { data: lineData } = useQuery({
    queryKey: ['transit', 'transit-line', lineId],
    queryFn:  () => apiFetch(`/transit/transit-line/${lineId}`).then((r) => r.json()),
    enabled:  !!lineId,
    staleTime: 60_000,
  })

  const { data: routes = [] } = useQuery<TransitRoute[]>({
    queryKey: ['transit', 'transit-route', { lineId }],
    queryFn:  () => apiFetch(`/transit/transit-route?lineId=${lineId}&pageSize=100`).then((r) => r.json().then((j: any) => j.data ?? [])),
    enabled:  !!lineId,
    staleTime: 30_000,
  })

  const { data: selectedLocalities = [] } = useQuery<RouteLocality[]>({
    queryKey: ['transit', 'trajectory', routeId],
    queryFn:  () => apiFetch(`/transit/transit-route/${routeId}/trajectory`).then((r) => r.json()),
    enabled:  !!routeId,
    staleTime: 0,
  })

  // trajectories for all routes (ruler + map background)
  const localitiesMap: Record<string, RouteLocality[]> = {}
  if (routeId) localitiesMap[routeId] = selectedLocalities

  // ── navigation ────────────────────────────────────────────────────────────

  function selectRoute(id: string) {
    const params = new URLSearchParams(searchParams.toString())
    params.set('routeId', id)
    router.replace(`/transit/transit-route?${params}`)
    setPendingPoints([])
    setSuggestions(null)
  }

  function handleCreated(route: { id: string }) {
    setShowCreate(false)
    queryClient.invalidateQueries({ queryKey: ['transit', 'transit-route', { lineId }] })
    selectRoute(route.id)
  }

  // ── pending points ────────────────────────────────────────────────────────

  function addPendingPoint(point: PendingPoint) {
    setPendingPoints((prev) => [...prev, point])
    setAddPointMode(false)
    setMapClickPos(null)
  }

  function discardPending() {
    setPendingPoints([])
    setSuggestions(null)
  }

  // ── save (gravar) ─────────────────────────────────────────────────────────

  async function handleSave() {
    if (!routeId || pendingPoints.length === 0) return
    setIsSaving(true)
    try {
      // build new sequence list: insert pending points after their anchor,
      // matched against the *current* stop list (including the last one —
      // a pending point may extend the route past today's final stop)
      const sorted = [...selectedLocalities].sort((a, b) => a.sequence - b.sequence)

      const allItems: Array<{ type: 'existing'; rl: RouteLocality } | { type: 'pending'; p: PendingPoint }> = []
      for (const p of pendingPoints.filter((p) => p.insertAfterSequence === 0)) allItems.push({ type: 'pending', p })
      for (const rl of sorted) {
        allItems.push({ type: 'existing', rl })
        for (const p of pendingPoints.filter((p) => p.insertAfterSequence === rl.sequence)) allItems.push({ type: 'pending', p })
      }

      const withSeq = allItems.map((item, i) => ({ item, seq: i + 1 }))

      // Wave 1 — move every existing row whose sequence is changing out to a safe
      // offset first. Patching straight to final numbers concurrently can collide
      // mid-flight with the @@unique([routeId, sequence]) constraint (e.g. a new
      // row's INSERT landing on a slot a moving row hasn't vacated yet).
      const OFFSET = 1_000_000
      const moves = withSeq.filter(({ item, seq }) => item.type === 'existing' && item.rl.sequence !== seq)
      await Promise.all(moves.map(({ item, seq }) => apiPatch(`/transit/route-locality/${(item as { rl: RouteLocality }).rl.id}`, { sequence: seq + OFFSET })))

      // Wave 2 — land on the real sequence; new stops (and their TransitLocality, if any) are created here
      const ops: Promise<unknown>[] = []
      for (const { item, seq } of withSeq) {
        if (item.type === 'existing') {
          if (item.rl.sequence !== seq) ops.push(apiPatch(`/transit/route-locality/${item.rl.id}`, { sequence: seq }))
        } else {
          const p = item.p
          ops.push((async () => {
            const body: Record<string, unknown> = { routeId, sequence: seq, allowsCrewChange: false }
            if (p.localityId) {
              body.localityId = p.localityId
            } else if (p.code) {
              const locality = await apiPost('/transit/transit-locality', { code: p.code, abbr: p.abbr ?? undefined, name: p.localityName, lat: p.lat, lng: p.lng })
              body.localityId = (locality as { id: string }).id
            } else {
              body.lat = p.lat
              body.lng = p.lng
            }
            await apiPost('/transit/route-locality', body)
          })())
        }
      }
      await Promise.all(ops)
      setPendingPoints([])

      // reprocess trajectory
      await apiPost(`/transit/transit-route/${routeId}/reprocess`)
      queryClient.invalidateQueries({ queryKey: ['transit', 'trajectory', routeId] })
      toast.success('Trajetória salva e reprocessada')
    } catch (err) {
      toast.error(extractError(err as Record<string, unknown>, 'Erro ao salvar'))
    } finally {
      setIsSaving(false)
    }
  }

  // ── reprocess ─────────────────────────────────────────────────────────────

  async function handleReprocess() {
    if (!routeId) return
    setIsReprocessing(true)
    try {
      await apiPost(`/transit/transit-route/${routeId}/reprocess`)
      queryClient.invalidateQueries({ queryKey: ['transit', 'trajectory', routeId] })
      toast.success('Trajetória reprocessada')
    } catch (err) {
      toast.error(extractError(err as Record<string, unknown>, 'Erro ao reprocessar'))
    } finally {
      setIsReprocessing(false)
    }
  }

  // ── delete route ───────────────────────────────────────────────────────────

  async function handleDeleteRoute() {
    if (!routeId) return
    const route = routes.find((r) => r.id === routeId)
    const ok = await confirm({
      title:       'Excluir sentido?',
      description: `${route?.name ?? 'Este sentido'} e todos os seus pontos serão removidos permanentemente.`,
      variant:      'destructive',
    })
    if (!ok) return
    setIsDeleting(true)
    try {
      await apiDelete(`/transit/transit-route/${routeId}`)
      queryClient.invalidateQueries({ queryKey: ['transit', 'transit-route', { lineId }] })
      const params = new URLSearchParams(searchParams.toString())
      params.delete('routeId')
      router.replace(`/transit/transit-route?${params}`)
      setPendingPoints([])
      setSuggestions(null)
      toast.success('Sentido excluído')
    } catch (err) {
      toast.error(extractError(err as Record<string, unknown>, 'Erro ao excluir sentido'))
    } finally {
      setIsDeleting(false)
    }
  }

  // ── suggest ───────────────────────────────────────────────────────────────

  async function handleSuggest() {
    if (!routeId) return
    setIsSuggesting(true)
    try {
      const data = await apiPost(`/transit/transit-route/${routeId}/suggest-localities`) as SuggestedLocality[]
      setSuggestions(data)
    } catch (err) {
      toast.error(extractError(err as Record<string, unknown>, 'Erro ao sugerir pontos'))
    } finally {
      setIsSuggesting(false)
    }
  }

  async function handleConfirmSuggestions(selected: SuggestedLocality[]) {
    if (!routeId || selected.length === 0) { setSuggestions(null); return }
    // add selected as pending points
    const newPending: PendingPoint[] = selected.map((s) => ({
      _pendingId:          crypto.randomUUID(),
      localityId:          s.id,
      localityName:        s.name,
      code:                null,
      abbr:                null,
      lat:                 s.lat,
      lng:                 s.lng,
      isWaypoint:          false,
      insertAfterSequence: s.insertAfterSequence,
    }))
    setPendingPoints((prev) => [...prev, ...newPending])
    setSuggestions(null)
  }

  // ── topbar ────────────────────────────────────────────────────────────────

  const hasGeometry = selectedLocalities.some((rl) => rl.geometry != null)

  useTopbarActions(
    !routeId ? [] : topbarState === 'pending' ? [
      { label: isSaving ? 'Gravando…' : 'Gravar', icon: Icons.Save, onClick: handleSave, disabled: isSaving, primary: true },
      { label: 'Descartar pendentes', icon: Icons.Undo2, onClick: discardPending, variant: 'ghost' as const },
      { label: 'Adicionar ponto', icon: Icons.MapPinPlus, onClick: () => setAddPointMode(true), variant: 'ghost' as const },
    ] : topbarState === 'suggesting' ? [
      { label: 'Cancelar sugestão', icon: Icons.X, onClick: () => setSuggestions(null), variant: 'ghost' as const },
    ] : [
      { label: isReprocessing ? 'Reprocessando…' : 'Reprocessar', icon: Icons.RefreshCw, onClick: handleReprocess, disabled: isReprocessing || !routeId, overflow: true },
      {
        label:    isSuggesting ? 'Sugerindo…' : 'Sugerir pontos',
        icon:     Icons.Sparkles,
        onClick:  handleSuggest,
        disabled: isSuggesting || !hasGeometry,
        title:    !hasGeometry ? 'Gere a trajetória primeiro' : undefined,
        overflow: true,
      } as any,
      { label: 'Adicionar ponto', icon: Icons.MapPinPlus, onClick: () => setAddPointMode(true), variant: 'ghost' as const },
      { label: isDeleting ? 'Excluindo…' : 'Excluir', icon: Icons.Trash2, variant: 'destructive' as const, onClick: handleDeleteRoute, disabled: isDeleting, overflow: true },
    ],
    [routeId, topbarState, isSaving, isReprocessing, isSuggesting, isDeleting, hasGeometry],
  )

  useShortcut('alt+v', () => router.push(lineId ? `/transit/transit-line/${lineId}` : '/transit'), {
    desc:   'Voltar',
    icon:   Icons.ArrowLeft,
    origin: 'transit/transit-route/page',
    context: 'all' as any,
  })

  // warn on navigate with pending
  useEffect(() => {
    if (pendingPoints.length === 0) return
    const handler = (e: BeforeUnloadEvent) => { e.preventDefault(); e.returnValue = '' }
    window.addEventListener('beforeunload', handler)
    return () => window.removeEventListener('beforeunload', handler)
  }, [pendingPoints.length])

  // ── render ────────────────────────────────────────────────────────────────

  const lineName = lineData?.code ? `${lineData.code} — ${lineData.name ?? ''}` : 'Sentidos'

  return (
    <div className="flex flex-col h-[calc(100vh-3.5rem)]">
      {/* breadcrumb */}
      <div className="px-6 pt-4 pb-2 shrink-0">
        <Breadcrumb
          segments={[
            { label: 'Transit',  href: '/transit' },
            { label: 'Linhas',   href: '/transit/transit-line' },
            { label: lineName,   href: lineId ? `/transit/transit-line/${lineId}` : '#' },
            { label: 'Sentidos' },
          ]}
        />
      </div>

      {/* canvas toggle */}
      <div className="px-6 pb-2 shrink-0 flex items-center gap-3">
        <span className="text-lg font-semibold">Sentidos</span>
        <div className="ml-auto flex items-center gap-1 border border-border rounded-sm p-0.5">
          <button
            type="button"
            onClick={() => setCanvasMode('ruler')}
            className={`flex items-center gap-1.5 px-2.5 h-7 rounded-sm text-xs font-medium transition-colors ${canvasMode === 'ruler' ? 'bg-accent text-accent-foreground' : 'hover:bg-muted'}`}
          >
            <Icons.Route className="w-3.5 h-3.5" />
            Régua
          </button>
          <button
            type="button"
            onClick={() => setCanvasMode('map')}
            className={`flex items-center gap-1.5 px-2.5 h-7 rounded-sm text-xs font-medium transition-colors ${canvasMode === 'map' ? 'bg-accent text-accent-foreground' : 'hover:bg-muted'}`}
          >
            <Icons.Map className="w-3.5 h-3.5" />
            Mapa
          </button>
        </div>

        <Button
          type="button"
          variant="outline"
          size="sm"
          disabled={!routeId}
          onClick={() => setShowSeq(true)}
        >
          <Icons.List className="w-3.5 h-3.5" />
          Seq
        </Button>
      </div>

      {/* stale trajectory badge */}
      {routeId && pendingPoints.length > 0 && (
        <div className="mx-6 mb-2 px-3 py-1.5 bg-amber-50 dark:bg-amber-950/30 border border-amber-200 dark:border-amber-800 rounded-sm text-xs text-amber-700 dark:text-amber-400 shrink-0">
          Trajetória desatualizada — {pendingPoints.length} ponto{pendingPoints.length > 1 ? 's' : ''} pendente{pendingPoints.length > 1 ? 's' : ''}. Clique <strong>Gravar</strong> para persistir e reprocessar.
        </div>
      )}

      {/* main layout */}
      <div className="flex flex-1 min-h-0">
        <RoutePanel
          routes={routes}
          selectedRouteId={routeId || null}
          onSelect={selectRoute}
          onAddRoute={() => setShowCreate(true)}
        />

        <div className="flex-1 flex min-w-0">
          {canvasMode === 'ruler' ? (
            <RulerCanvas
              routes={routes}
              localities={localitiesMap}
              selectedRouteId={routeId || null}
              onSelectRoute={selectRoute}
            />
          ) : (
            <MapCanvas
              routes={routes}
              localities={localitiesMap}
              selectedRouteId={routeId || null}
              pendingPoints={pendingPoints}
              addPointMode={addPointMode}
              onMapClick={(lat, lng) => setMapClickPos({ lat, lng })}
              onSelectRoute={selectRoute}
            />
          )}
        </div>
      </div>

      {/* modals */}
      {showCreate && lineId && (
        <CreateRouteModal lineId={lineId} onClose={() => setShowCreate(false)} onCreated={handleCreated} />
      )}

      {(addPointMode && canvasMode === 'ruler') || (mapClickPos) ? (
        <AddPointModal
          localities={selectedLocalities}
          prefillLat={mapClickPos?.lat}
          prefillLng={mapClickPos?.lng}
          onAdd={addPendingPoint}
          onClose={() => { setAddPointMode(false); setMapClickPos(null) }}
        />
      ) : null}

      {suggestions !== null && (
        <SuggestModal
          suggestions={suggestions}
          onConfirm={handleConfirmSuggestions}
          onClose={() => setSuggestions(null)}
        />
      )}

      {showSeq && routeId && (
        <SeqModal
          routeId={routeId}
          localities={selectedLocalities}
          color={DIR_COLOR[routes.find((r) => r.id === routeId)?.direction ?? 'OUTBOUND']}
          disabled={pendingPoints.length > 0}
          onClose={() => setShowSeq(false)}
          onSaved={() => {
            queryClient.invalidateQueries({ queryKey: ['transit', 'trajectory', routeId] })
            toast.success('Sequência atualizada')
          }}
        />
      )}
    </div>
  )
}
