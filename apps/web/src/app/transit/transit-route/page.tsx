'use client'

import { useState, useEffect } from 'react'
import { useRouter, useSearchParams }        from 'next/navigation'
import dynamic                               from 'next/dynamic'
import { useQueries, useQuery, useQueryClient } from '@tanstack/react-query'
import { Icons }                             from '@/lib/icons'
import { apiFetch }                          from '@/lib/auth'
import { useToast }                          from '@/lib/toast-context'
import { useConfirm }                        from '@/lib/confirm-context'
import { useShortcut }                       from '@/lib/keywatch'
import type { ShortcutSection }               from '@/lib/keywatch'
import { useTopbarActions }                  from '@/components/layout/topbar-actions-context'
import { Breadcrumb }                        from '@/components/ui/breadcrumb'
import { Button }                            from '@/components/ui/button'
import { RoutePanel }                        from './RoutePanel'
import { RulerCanvas }                       from './RulerCanvas'
import { CreateRouteModal }                  from './CreateRouteModal'
import { AddPointModal }                     from './AddPointModal'
import { SeqModal }                          from './SeqModal'
import { apiPost, apiPatch, apiDelete }      from './api'
import type { TransitRoute, RouteLocality, PendingPoint, SuggestedLocality } from './types'
import { DIR_COLOR }                         from './types'
import { resolveOrder }                      from './order'
import { extractError } from '@/lib/utils'

const MapCanvas = dynamic(() => import('./MapCanvas'), { ssr: false })

type CanvasMode  = 'ruler' | 'map'
type TopbarState = 'idle' | 'pending' | 'suggesting'

// stable references so a still-loading/disabled query doesn't recreate a new
// array identity every render (breaks memoization in useTopbarActions' deps)
const EMPTY_ROUTES: TransitRoute[] = []
const EMPTY_LOCALITIES: RouteLocality[] = []

const SEC_MAPA: ShortcutSection = { label: 'Visão de Mapa' }

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
  const [showAddPointModal, setShowAddPointModal] = useState(false)
  const [pendingPoints, setPendingPoints] = useState<PendingPoint[]>([])
  // RouteLocality.id or a pending point's _pendingId, selected via a double
  // click, awaiting the next map click to receive its new position
  const [repositionKey, setRepositionKey] = useState<string | null>(null)
  const [suggestions,   setSuggestions]  = useState<SuggestedLocality[] | null>(null)
  // suggested point clicked on the map, awaiting position confirmation via SeqModal
  const [suggestTarget, setSuggestTarget] = useState<SuggestedLocality | null>(null)
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

  const { data: routes = EMPTY_ROUTES } = useQuery<TransitRoute[]>({
    queryKey: ['transit', 'transit-route', { lineId }],
    queryFn:  () => apiFetch(`/transit/transit-route?lineId=${lineId}&pageSize=100&sortField=direction&sortOrder=desc`).then((r) => r.json().then((j: any) => j.data ?? [])),
    enabled:  !!lineId,
    staleTime: 30_000,
  })

  const { data: selectedLocalities = EMPTY_LOCALITIES } = useQuery<RouteLocality[]>({
    queryKey: ['transit', 'trajectory', routeId],
    queryFn:  () => apiFetch(`/transit/transit-route/${routeId}/trajectory`).then((r) => r.json()),
    enabled:  !!routeId,
    staleTime: 0,
  })

  // background trajectories for every other *active* sentido, so Régua/Mapa can
  // show them as context — inactive sentidos only load if directly selected
  // (covered by selectedLocalities above, regardless of their isActive status)
  const backgroundRouteIds = routes.filter((r) => r.isActive && r.id !== routeId).map((r) => r.id)

  const backgroundTrajectoryQueries = useQueries({
    queries: backgroundRouteIds.map((id) => ({
      queryKey:  ['transit', 'trajectory', id],
      queryFn:   () => apiFetch(`/transit/transit-route/${id}/trajectory`).then((r) => r.json()) as Promise<RouteLocality[]>,
      staleTime: 30_000,
    })),
  })

  // trajectories for all visible routes (ruler + map)
  const localitiesMap: Record<string, RouteLocality[]> = {}
  if (routeId) localitiesMap[routeId] = selectedLocalities
  backgroundRouteIds.forEach((id, i) => {
    const data = backgroundTrajectoryQueries[i]?.data
    if (data) localitiesMap[id] = data
  })

  // sentidos plotados na Régua/Mapa: ativos, mais o selecionado mesmo se inativo
  const visibleRoutes = routes.filter((r) => r.isActive || r.id === routeId)

  // ── navigation ────────────────────────────────────────────────────────────

  function selectRoute(id: string) {
    const params = new URLSearchParams(searchParams.toString())
    params.set('routeId', id)
    router.replace(`/transit/transit-route?${params}`)
    setPendingPoints([])
    setSuggestions(null)
    setSuggestTarget(null)
    setRepositionKey(null)
  }

  function handleCreated(route: { id: string }) {
    setShowCreate(false)
    queryClient.invalidateQueries({ queryKey: ['transit', 'transit-route', { lineId }] })
    selectRoute(route.id)
  }

  // ── pending points ────────────────────────────────────────────────────────

  function activateAddPoint() {
    setRepositionKey(null)
    setAddPointMode(true)
  }

  // opens AddPointModal directly, skipping the "click the map to position" step
  function openAddPointModal() {
    setRepositionKey(null)
    setShowAddPointModal(true)
  }

  function addPendingPoint(point: PendingPoint) {
    setPendingPoints((prev) => [...prev, point])
    setAddPointMode(false)
    setMapClickPos(null)
    setShowAddPointModal(false)
  }

  function discardPending() {
    setPendingPoints([])
    setSuggestions(null)
    setRepositionKey(null)
  }

  // ── reposition (double click to select, then click map for new position) ──

  function selectForReposition(key: string) {
    const isPending = pendingPoints.some((p) => p._pendingId === key)
    if (!isPending && pendingPoints.length > 0) {
      toast.error('Grave os pontos pendentes antes de reposicionar pontos existentes')
      return
    }
    setAddPointMode(false)
    setMapClickPos(null)
    setRepositionKey((prev) => (prev === key ? null : key))
  }

  async function applyReposition(lat: number, lng: number) {
    const key = repositionKey
    setRepositionKey(null)
    if (!key) return

    const pending = pendingPoints.find((p) => p._pendingId === key)
    if (pending) {
      if (pending.localityId) {
        toast.error('Este ponto usa uma localidade existente — a posição vem do cadastro de Localidade')
        return
      }
      setPendingPoints((prev) => prev.map((p) => (p._pendingId === key ? { ...p, lat, lng } : p)))
      return
    }

    const rl = selectedLocalities.find((r) => r.id === key)
    if (!rl) return

    if (rl.localityId) {
      const ok = await confirm({
        title:       'Mover parada compartilhada?',
        description: `"${rl.locality?.name ?? 'Este ponto'}" é uma localidade usada por outras rotas/linhas, que também serão reposicionadas. Deseja continuar?`,
        variant:      'destructive',
      })
      if (!ok) return
      try {
        await apiPatch(`/transit/transit-locality/${rl.localityId}`, { lat, lng })
        await apiPost(`/transit/transit-route/${routeId}/reprocess`)
        queryClient.invalidateQueries({ queryKey: ['transit', 'trajectory', routeId] })
        toast.success('Parada reposicionada e trajetória reprocessada')
      } catch (err) {
        toast.error(extractError(err as Record<string, unknown>, 'Erro ao reposicionar parada'))
      }
      return
    }

    try {
      await apiPatch(`/transit/route-locality/${rl.id}`, { lat, lng })
      await apiPost(`/transit/transit-route/${routeId}/reprocess`)
      queryClient.invalidateQueries({ queryKey: ['transit', 'trajectory', routeId] })
      toast.success('Waypoint reposicionado e trajetória reprocessada')
    } catch (err) {
      toast.error(extractError(err as Record<string, unknown>, 'Erro ao reposicionar waypoint'))
    }
  }

  function handleCanvasClick(lat: number, lng: number) {
    if (repositionKey) { applyReposition(lat, lng); return }
    setMapClickPos({ lat, lng })
  }

  // ── save (gravar) ─────────────────────────────────────────────────────────

  async function handleSave() {
    if (!routeId || pendingPoints.length === 0) return
    setIsSaving(true)
    try {
      // build new sequence list: merge persisted stops with pending points,
      // resolving anchor chains (a pending point may anchor onto another
      // pending point added earlier in the same session)
      const allItems = resolveOrder(selectedLocalities, pendingPoints)
      const withSeq = allItems.map((item, i) => ({ item, seq: i + 1 }))

      // Wave 1 — move every existing row whose sequence is changing out to a safe
      // offset first. Patching straight to final numbers concurrently can collide
      // mid-flight with the @@unique([routeId, sequence]) constraint (e.g. a new
      // row's INSERT landing on a slot a moving row hasn't vacated yet).
      const OFFSET = 1_000_000
      const moves = withSeq.filter(({ item, seq }) => item.type === 'existing' && item.rl.sequence !== seq)
      await Promise.all(moves.map(({ item, seq }) => apiPatch(`/transit/route-locality/${(item as { type: 'existing'; rl: RouteLocality }).rl.id}`, { sequence: seq + OFFSET })))

      // Wave 2 — land on the real sequence; new stops (and their TransitLocality, if any) are created here
      const ops: Promise<unknown>[] = []
      for (const { item, seq } of withSeq) {
        if (item.type === 'existing') {
          if (item.rl.sequence !== seq) ops.push(apiPatch(`/transit/route-locality/${item.rl.id}`, { sequence: seq }))
        } else {
          const p = item.p
          ops.push((async () => {
            const body: Record<string, unknown> = { routeId, sequence: seq, allowsCrewChange: p.allowsCrewChange }
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

  // ── primary route ─────────────────────────────────────────────────────────

  async function handleTogglePrimary(route: TransitRoute) {
    try {
      await apiPatch(`/transit/transit-route/${route.id}`, { isPrimary: !route.isPrimary })
      queryClient.invalidateQueries({ queryKey: ['transit', 'transit-route', { lineId }] })
    } catch (err) {
      toast.error(extractError(err as Record<string, unknown>, 'Erro ao definir sentido principal'))
    }
  }

  async function handleToggleActive(route: TransitRoute) {
    try {
      await apiPatch(`/transit/transit-route/${route.id}`, { isActive: !route.isActive })
      queryClient.invalidateQueries({ queryKey: ['transit', 'transit-route', { lineId }] })
    } catch (err) {
      toast.error(extractError(err as Record<string, unknown>, 'Erro ao alterar situação do sentido'))
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

  // plots candidates on the map instead of a checkbox list — clicking one opens
  // SeqModal to position and persist it, one at a time (see handleSuggestionSaved)
  async function handleSuggest() {
    if (!routeId) return
    setCanvasMode('map')
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

  function cancelSuggesting() {
    setSuggestions(null)
    setSuggestTarget(null)
  }

  // after persisting a suggested point, sequences shifted — re-fetch so the
  // remaining candidates' insertAfterSequence stays accurate
  function handleSuggestionSaved() {
    setSuggestTarget(null)
    queryClient.invalidateQueries({ queryKey: ['transit', 'trajectory', routeId] })
    toast.success('Ponto inserido na sequência')
    handleSuggest()
  }

  // ── topbar ────────────────────────────────────────────────────────────────

  const hasGeometry = selectedLocalities.some((rl) => rl.geometry != null)

  useTopbarActions(
    !routeId ? [] : topbarState === 'pending' ? [
      { label: isSaving ? 'Gravando…' : 'Gravar', icon: Icons.Save, onClick: handleSave, disabled: isSaving, primary: true },
      { label: 'Descartar pendentes', icon: Icons.Undo2, onClick: discardPending, variant: 'ghost' as const },
      { label: 'Ponto', icon: Icons.Plus, onClick: openAddPointModal, variant: 'ghost' as const },
    ] : topbarState === 'suggesting' ? [
      { label: 'Cancelar sugestão', icon: Icons.X, onClick: cancelSuggesting, variant: 'ghost' as const },
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
      { label: 'Ponto', icon: Icons.Plus, onClick: openAddPointModal, variant: 'ghost' as const },
      { label: isDeleting ? 'Excluindo…' : 'Excluir', icon: Icons.Trash2, variant: 'destructive' as const, onClick: handleDeleteRoute, disabled: isDeleting, overflow: true },
    ],
    [routeId, topbarState, isSaving, isReprocessing, isSuggesting, isDeleting, hasGeometry, pendingPoints, selectedLocalities],
  )

  useShortcut('alt+v', () => router.push(lineId ? `/transit/transit-line/${lineId}` : '/transit'), {
    desc:   'Voltar',
    icon:   Icons.ArrowLeft,
    origin: 'transit/transit-route/page',
    context: 'all' as any,
  })

  useShortcut('alt+n', openAddPointModal, {
    desc:    'Adicionar ponto',
    icon:    Icons.Plus,
    origin:  'transit/transit-route/page',
    enabled: !!routeId,
  })

  useShortcut('q+[space]', () => setCanvasMode((prev) => (prev === 'ruler' ? 'map' : 'ruler')), {
    desc:    'Alternar Régua/Mapa',
    icon:    Icons.Map,
    origin:  'transit/transit-route/page',
  })

  useShortcut('alt+u', handleSuggest, {
    desc:    'Sugerir pontos',
    icon:    Icons.Sparkles,
    origin:  'transit/transit-route/page',
    enabled: !!routeId && hasGeometry && !isSuggesting,
    section: SEC_MAPA,
  })

  useShortcut('q+m', activateAddPoint, {
    desc:    'Apontar ponto no mapa',
    icon:    Icons.MapPinPlus,
    origin:  'transit/transit-route/page',
    enabled: !!routeId && canvasMode === 'map',
    section: SEC_MAPA,
  })

  // 'dblclick' isn't a real keyboard shortcut — no KeyboardEvent ever carries
  // key:'dblclick', so this handler never fires. The actual selection is a
  // double click on the point, handled in MapCanvas (eventHandlers.dblclick).
  // Registered only so the interaction shows up in the shortcuts modal.
  useShortcut('dblclick', () => {}, {
    desc:    'Reposicionar ponto',
    icon:    Icons.MousePointerClick,
    origin:  'transit/transit-route/page',
    enabled: !!routeId && canvasMode === 'map',
    section: SEC_MAPA,
  })

  // warn on navigate with pending
  useEffect(() => {
    if (pendingPoints.length === 0) return
    const handler = (e: BeforeUnloadEvent) => { e.preventDefault(); e.returnValue = '' }
    window.addEventListener('beforeunload', handler)
    return () => window.removeEventListener('beforeunload', handler)
  }, [pendingPoints.length])

  // Esc cancels "adicionar ponto" (covers both waiting for the map click and the
  // modal already open) and "reposicionar ponto" (point selected, awaiting destination click).
  // Capture phase: Leaflet's own Map.Keyboard handler binds keydown on `document`
  // (bubble phase) and calls stopPropagation() when Esc closes a marker popup —
  // that would otherwise swallow the key before it reaches a bubble-phase listener here.
  useEffect(() => {
    if (!addPointMode && !repositionKey && !showAddPointModal) return
    function onKey(e: KeyboardEvent) {
      if (e.key === 'Escape') { setAddPointMode(false); setMapClickPos(null); setRepositionKey(null); setShowAddPointModal(false) }
    }
    window.addEventListener('keydown', onKey, true)
    return () => window.removeEventListener('keydown', onKey, true)
  }, [addPointMode, repositionKey, showAddPointModal])

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
          onTogglePrimary={handleTogglePrimary}
          onToggleActive={handleToggleActive}
        />

        <div className="flex-1 flex min-w-0">
          {canvasMode === 'ruler' ? (
            <RulerCanvas
              routes={visibleRoutes}
              localities={localitiesMap}
              selectedRouteId={routeId || null}
              onSelectRoute={selectRoute}
            />
          ) : (
            <MapCanvas
              routes={visibleRoutes}
              localities={localitiesMap}
              selectedRouteId={routeId || null}
              pendingPoints={pendingPoints}
              suggestions={suggestions}
              addPointMode={addPointMode}
              repositionKey={repositionKey}
              onMapClick={handleCanvasClick}
              onSelectRoute={selectRoute}
              onSelectForReposition={selectForReposition}
              onAddPointClick={routeId ? activateAddPoint : undefined}
              onSuggestionClick={setSuggestTarget}
            />
          )}
        </div>
      </div>

      {/* modals */}
      {showCreate && lineId && (
        <CreateRouteModal lineId={lineId} onClose={() => setShowCreate(false)} onCreated={handleCreated} />
      )}

      {mapClickPos || showAddPointModal ? (
        <AddPointModal
          existing={selectedLocalities}
          pending={pendingPoints}
          prefillLat={mapClickPos?.lat}
          prefillLng={mapClickPos?.lng}
          onAdd={addPendingPoint}
          onClose={() => { setAddPointMode(false); setMapClickPos(null); setShowAddPointModal(false) }}
        />
      ) : null}

      {(showSeq || suggestTarget) && routeId && (
        <SeqModal
          routeId={routeId}
          localities={selectedLocalities}
          color={DIR_COLOR[routes.find((r) => r.id === routeId)?.direction ?? 'OUTBOUND']}
          disabled={pendingPoints.length > 0}
          insertTarget={suggestTarget}
          onClose={() => { setShowSeq(false); setSuggestTarget(null) }}
          onSaved={suggestTarget ? handleSuggestionSaved : () => {
            queryClient.invalidateQueries({ queryKey: ['transit', 'trajectory', routeId] })
            toast.success('Sequência atualizada')
          }}
        />
      )}
    </div>
  )
}
