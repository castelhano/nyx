'use client'

import { useEffect, useRef, useState } from 'react'
import { CycleEngineProto } from './engine'
import { markOutliers }     from './data'
import type { DotCluster }  from './data'
import type { DotClickInfo, MarqueeSelection } from './engine'

interface Props {
  slotClusters:   Map<number, DotCluster[]>
  cuts:           number[]
  subCuts:        number[]
  onCutsChange:   (cuts: number[]) => void
  onSubCutsChange: (subCuts: number[]) => void
  onSlotClustersChange: (updated: Map<number, DotCluster[]>) => void
}

interface DetailPopup {
  cluster: DotCluster
  slot:    number
  x:       number
  y:       number
}

export function CycleCanvasProto({
  slotClusters,
  cuts,
  subCuts,
  onCutsChange,
  onSubCutsChange,
  onSlotClustersChange,
}: Props) {
  const canvasRef = useRef<HTMLCanvasElement>(null)
  const wrapRef   = useRef<HTMLDivElement>(null)
  const engineRef = useRef<CycleEngineProto | null>(null)
  const [detail, setDetail]   = useState<DetailPopup | null>(null)
  const [marquee, setMarquee] = useState<MarqueeSelection | null>(null)

  useEffect(() => {
    const canvas = canvasRef.current
    const wrap   = wrapRef.current
    if (!canvas || !wrap) return

    const engine      = new CycleEngineProto()
    engineRef.current = engine
    let initialized   = false

    const ro = new ResizeObserver((entries) => {
      const { width, height } = entries[0].contentRect
      if (!initialized) {
        engine.resize(width, height)
        engine.init(canvas)
        initialized = true
      } else {
        engine.resize(width, height)
      }
    })
    ro.observe(wrap)

    engine.onCutsChange    = (c) => onCutsChange(c)
    engine.onSubCutsChange = (c) => onSubCutsChange(c)
    engine.onDotClick      = (info) => {
      setDetail({ cluster: info.cluster, slot: info.slot, x: info.canvasX, y: info.canvasY })
    }
    engine.onMarqueeSelect = (sel) => setMarquee(sel)

    return () => {
      ro.disconnect()
      engine.dispose()
      engineRef.current = null
    }
  }, []) // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => {
    const e = engineRef.current
    if (!e) return
    e.onCutsChange    = onCutsChange
    e.onSubCutsChange = onSubCutsChange
  }, [onCutsChange, onSubCutsChange])

  useEffect(() => {
    engineRef.current?.setData(slotClusters, cuts, subCuts)
    setMarquee(null)
    engineRef.current?.clearSelection()
  }, [slotClusters, cuts, subCuts])

  function handleToggle(slot: number, clusterIdx: number) {
    const next = new Map(slotClusters)
    const cs   = [...(next.get(slot) ?? [])]
    if (!cs[clusterIdx]) return
    cs[clusterIdx] = { ...cs[clusterIdx], isDisabled: !cs[clusterIdx].isDisabled }
    next.set(slot, markOutliers(cs))
    onSlotClustersChange(next)
    setDetail(null)
  }

  function closeMarquee() {
    engineRef.current?.clearSelection()
    setMarquee(null)
  }

  function handleBulkToggle(items: { slot: number; idx: number }[], disabled: boolean) {
    if (items.length > 0) {
      const next   = new Map(slotClusters)
      const bySlot = new Map<number, number[]>()
      for (const it of items) {
        bySlot.set(it.slot, [...(bySlot.get(it.slot) ?? []), it.idx])
      }
      for (const [slot, idxs] of bySlot) {
        const cs = [...(next.get(slot) ?? [])]
        for (const idx of idxs) {
          if (!cs[idx]) continue
          cs[idx] = { ...cs[idx], isDisabled: disabled }
        }
        next.set(slot, markOutliers(cs))
      }
      onSlotClustersChange(next)
    }
    closeMarquee()
  }

  const hasData = slotClusters.size > 0

  return (
    <div className="flex flex-col gap-1">
      <div
        ref={wrapRef}
        className="relative w-full bg-background border border-border rounded-sm"
        style={{ height: 320 }}
      >
        {!hasData && (
          <div className="absolute inset-0 flex items-center justify-center text-sm text-muted-foreground">
            Sem dados
          </div>
        )}

        <canvas ref={canvasRef} className="absolute inset-0 w-full h-full" />

        {detail && (
          <DotDetail
            cluster={detail.cluster}
            slot={detail.slot}
            canvasX={detail.x}
            canvasY={detail.y}
            containerH={320}
            onToggle={() => handleToggle(detail.slot, slotClusters.get(detail.slot)?.indexOf(detail.cluster) ?? -1)}
            onClose={() => setDetail(null)}
          />
        )}

        {marquee && (
          <MarqueeConfirm
            selection={marquee}
            containerH={320}
            onDeactivate={() => handleBulkToggle(
              marquee.items.filter(i => !i.cluster.isDisabled).map(i => ({ slot: i.slot, idx: i.idx })),
              true,
            )}
            onActivate={() => handleBulkToggle(
              marquee.items.filter(i => i.cluster.isDisabled).map(i => ({ slot: i.slot, idx: i.idx })),
              false,
            )}
            onClose={closeMarquee}
          />
        )}
      </div>

      <p className="text-[10px] text-muted-foreground/60 px-1">
        Clique perto da borda da coluna para corte cheio (arraste para mover, clique de novo para remover) ·
        Clique no <span className="text-violet-600 font-medium">centro da coluna</span> para alternar o corte de 30min ·
        Arraste sobre os pontos para selecionar vários
      </p>
    </div>
  )
}

function formatSlotLabel(slot: number): string {
  const h = Math.floor(slot)
  const m = Math.round((slot - h) * 60)
  return m === 0 ? `${h}h` : `${h}h${String(m).padStart(2, '0')}`
}

interface DotDetailProps {
  cluster:    DotCluster
  slot:       number
  canvasX:    number
  canvasY:    number
  containerH: number
  onToggle:   () => void
  onClose:    () => void
}

function DotDetail({ cluster, slot, canvasX, canvasY, containerH, onToggle, onClose }: DotDetailProps) {
  const H      = 200
  const topRaw = canvasY + H > containerH ? canvasY - H - 8 : canvasY + 12
  const top    = Math.max(4, topRaw)
  const left   = Math.max(8, Math.min(canvasX - 120, 400))

  return (
    <div
      className="absolute z-10 bg-popover border border-border rounded shadow-lg p-3 min-w-[220px] text-sm"
      style={{ top, left }}
    >
      <div className="flex items-center justify-between mb-2">
        <span className="font-medium">
          Faixa {formatSlotLabel(slot)} · {cluster.minutes} min
        </span>
        <button type="button" onClick={onClose} className="text-muted-foreground hover:text-foreground">✕</button>
      </div>

      <div className="flex gap-1.5 mb-3 text-xs flex-wrap">
        <span className={`px-1.5 py-0.5 rounded-full font-medium ${
          cluster.isOutlier  ? 'bg-red-100 text-red-700'  :
          cluster.isDisabled ? 'bg-gray-100 text-gray-500' :
          'bg-blue-100 text-blue-700'
        }`}>
          {cluster.isOutlier ? 'Outlier' : cluster.isDisabled ? 'Desativado' : 'Ativo'}
        </span>
        {cluster.hasEdited && (
          <span className="px-1.5 py-0.5 rounded-full bg-orange-100 text-orange-700 font-medium">Contém editadas</span>
        )}
        <span className="px-1.5 py-0.5 rounded-full bg-muted text-muted-foreground">
          {cluster.count} viagem{cluster.count !== 1 ? 's' : ''}
        </span>
      </div>

      <div className="max-h-[120px] overflow-y-auto space-y-1 mb-3 pr-2">
        {cluster.trips.map((t, i) => (
          <div key={i} className="text-xs text-muted-foreground flex justify-between gap-2">
            <span>{t.time}</span>
            <span className="font-medium text-foreground">{t.cycleMinutes}min</span>
            <span className="truncate max-w-[80px]">{t.vehicle}</span>
          </div>
        ))}
      </div>

      <button
        type="button"
        onClick={onToggle}
        className={`w-full text-xs rounded px-2 py-1.5 font-medium transition-colors ${
          cluster.isDisabled ? 'bg-blue-600 text-white hover:bg-blue-700' : 'bg-muted text-muted-foreground hover:bg-muted/80'
        }`}
      >
        {cluster.isDisabled ? 'Reativar ponto' : 'Desativar ponto'}
      </button>
    </div>
  )
}

interface MarqueeConfirmProps {
  selection:    MarqueeSelection
  containerH:   number
  onActivate:   () => void
  onDeactivate: () => void
  onClose:      () => void
}

function MarqueeConfirm({ selection, containerH, onActivate, onDeactivate, onClose }: MarqueeConfirmProps) {
  const hasActive   = selection.items.some(i => !i.cluster.isDisabled)
  const hasDisabled = selection.items.some(i => i.cluster.isDisabled)

  useEffect(() => {
    function onKey(e: KeyboardEvent) { if (e.key === 'Escape') onClose() }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [onClose])

  useEffect(() => {
    function onPointer(e: PointerEvent) {
      const target = e.target as Element
      if (!target.closest('[data-marquee-popup]')) onClose()
    }
    window.addEventListener('pointerdown', onPointer)
    return () => window.removeEventListener('pointerdown', onPointer)
  }, [onClose])

  const H      = 90
  const topRaw = selection.y + H > containerH ? selection.y - H - 8 : selection.y + 12
  const top    = Math.max(4, topRaw)
  const left   = Math.max(8, Math.min(selection.x - 90, 400))

  return (
    <div
      data-marquee-popup
      className="absolute z-10 bg-popover border border-border rounded shadow-lg p-3 min-w-[200px] text-sm"
      style={{ top, left }}
    >
      <div className="flex items-center justify-between mb-2">
        <span className="font-medium">{selection.items.length} ponto{selection.items.length !== 1 ? 's' : ''}</span>
        <button type="button" onClick={onClose} className="text-muted-foreground hover:text-foreground">✕</button>
      </div>

      <div className="flex gap-2">
        {hasActive && (
          <button
            type="button"
            onClick={onDeactivate}
            className="flex-1 text-xs rounded px-2 py-1.5 font-medium bg-muted text-muted-foreground hover:bg-muted/80 transition-colors"
          >
            Desativar
          </button>
        )}
        {hasDisabled && (
          <button
            type="button"
            onClick={onActivate}
            className="flex-1 text-xs rounded px-2 py-1.5 font-medium bg-blue-600 text-white hover:bg-blue-700 transition-colors"
          >
            Ativar
          </button>
        )}
      </div>
    </div>
  )
}
