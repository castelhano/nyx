'use client'

import { useEffect, useRef, useState } from 'react'
import { CycleEngine }   from './cycle-engine'
import { markOutliers }  from './cycle-utils'
import type { Direction, DotCluster, DotClickInfo, MarqueeSelection } from './types'

const DIR_LABEL: Record<Direction, string> = {
  OUTBOUND: 'IDA',
  INBOUND:  'VOLTA',
  CIRCULAR: 'ÚNICO',
}

interface Props {
  direction:      Direction
  hourClusters:   Map<number, DotCluster[]>
  cuts:           number[]
  onCutsChange:   (cuts: number[]) => void
  onHourClustersChange: (updated: Map<number, DotCluster[]>) => void
}

interface DetailPopup {
  cluster: DotCluster
  hour:    number
  x:       number
  y:       number
}

export function CycleMapCanvas({
  direction,
  hourClusters,
  cuts,
  onCutsChange,
  onHourClustersChange,
}: Props) {
  const canvasRef   = useRef<HTMLCanvasElement>(null)
  const wrapRef     = useRef<HTMLDivElement>(null)
  const engineRef   = useRef<CycleEngine | null>(null)
  const [detail, setDetail]   = useState<DetailPopup | null>(null)
  const [marquee, setMarquee] = useState<MarqueeSelection | null>(null)

  // ── engine lifecycle ──────────────────────────────────────────────────────

  useEffect(() => {
    const canvas = canvasRef.current
    const wrap   = wrapRef.current
    if (!canvas || !wrap) return

    const engine      = new CycleEngine()
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

    engine.onCutsChange     = (c)   => onCutsChange(c)
    engine.onDotClick       = (info) => {
      setDetail({ cluster: info.cluster, hour: info.hour, x: info.canvasX, y: info.canvasY })
    }
    engine.onMarqueeSelect  = (sel) => setMarquee(sel)

    return () => {
      ro.disconnect()
      engine.dispose()
      engineRef.current = null
    }
  }, []) // eslint-disable-line react-hooks/exhaustive-deps

  // keep callbacks fresh without re-running engine lifecycle
  useEffect(() => {
    const e = engineRef.current
    if (!e) return
    e.onCutsChange = onCutsChange
  }, [onCutsChange])

  // sync data to engine when props change
  useEffect(() => {
    engineRef.current?.setData(hourClusters, cuts)
    setMarquee(null)
    engineRef.current?.clearSelection()
  }, [hourClusters, cuts])

  // ── dot toggle ────────────────────────────────────────────────────────────

  function handleToggle(hour: number, clusterIdx: number) {
    const next = new Map(hourClusters)
    const cs   = [...(next.get(hour) ?? [])]
    if (!cs[clusterIdx]) return
    cs[clusterIdx] = { ...cs[clusterIdx], isDisabled: !cs[clusterIdx].isDisabled }
    next.set(hour, markOutliers(cs))
    onHourClustersChange(next)
    setDetail(null)
  }

  // ── marquee bulk toggle ──────────────────────────────────────────────────

  function closeMarquee() {
    engineRef.current?.clearSelection()
    setMarquee(null)
  }

  function handleBulkToggle(items: { hour: number; idx: number }[], disabled: boolean) {
    if (items.length > 0) {
      const next    = new Map(hourClusters)
      const byHour  = new Map<number, number[]>()
      for (const it of items) {
        byHour.set(it.hour, [...(byHour.get(it.hour) ?? []), it.idx])
      }
      for (const [hour, idxs] of byHour) {
        const cs = [...(next.get(hour) ?? [])]
        for (const idx of idxs) {
          if (!cs[idx]) continue
          cs[idx] = { ...cs[idx], isDisabled: disabled }
        }
        next.set(hour, markOutliers(cs))
      }
      onHourClustersChange(next)
    }
    closeMarquee()
  }

  // ── render ────────────────────────────────────────────────────────────────

  const hasData = hourClusters.size > 0

  return (
    <div className="flex flex-col gap-1">
      <p className="text-xs font-semibold uppercase tracking-wide text-muted-foreground px-1">
        {DIR_LABEL[direction]}
      </p>

      <div
        ref={wrapRef}
        className="relative w-full bg-background border border-border rounded-sm"
        style={{ height: 320 }}
      >
        {!hasData && (
          <div className="absolute inset-0 flex items-center justify-center text-sm text-muted-foreground">
            Sem dados para esta direção
          </div>
        )}

        <canvas
          ref={canvasRef}
          className="absolute inset-0 w-full h-full"
        />

        {/* detail popup */}
        {detail && (
          <DotDetail
            cluster={detail.cluster}
            hour={detail.hour}
            canvasX={detail.x}
            canvasY={detail.y}
            containerH={320}
            onToggle={() => handleToggle(detail.hour, hourClusters.get(detail.hour)?.indexOf(detail.cluster) ?? -1)}
            onClose={() => setDetail(null)}
          />
        )}

        {/* marquee selection popup */}
        {marquee && (
          <MarqueeConfirm
            selection={marquee}
            containerH={320}
            onDeactivate={() => handleBulkToggle(
              marquee.items.filter(i => !i.cluster.isDisabled).map(i => ({ hour: i.hour, idx: i.idx })),
              true,
            )}
            onActivate={() => handleBulkToggle(
              marquee.items.filter(i => i.cluster.isDisabled).map(i => ({ hour: i.hour, idx: i.idx })),
              false,
            )}
            onClose={closeMarquee}
          />
        )}
      </div>

      {/* cut zone hint */}
      <p className="text-[10px] text-muted-foreground/60 px-1">
        Clique na régua X para adicionar corte · Clique no corte para remover · Arraste para mover · Arraste sobre os pontos para selecionar vários
      </p>
    </div>
  )
}

// ── detail popup ─────────────────────────────────────────────────────────────

interface DotDetailProps {
  cluster:    DotCluster
  hour:       number
  canvasX:    number
  canvasY:    number
  containerH: number
  onToggle:   () => void
  onClose:    () => void
}

function DotDetail({ cluster, hour, canvasX, canvasY, containerH, onToggle, onClose }: DotDetailProps) {
  const H      = 200  // popup height estimate
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
          Faixa {hour}h · {cluster.minutes} min
        </span>
        <button
          type="button"
          onClick={onClose}
          className="text-muted-foreground hover:text-foreground"
        >
          ✕
        </button>
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
          <span className="px-1.5 py-0.5 rounded-full bg-orange-100 text-orange-700 font-medium">
            Contém editadas
          </span>
        )}
        <span className="px-1.5 py-0.5 rounded-full bg-muted text-muted-foreground">
          {cluster.count} viagem{cluster.count !== 1 ? 's' : ''}
        </span>
      </div>

      <div className="max-h-[120px] overflow-y-auto space-y-1 mb-3 pr-2">
        {cluster.trips.map((t, i) => (
          <div key={i} className="text-xs text-muted-foreground flex justify-between gap-2">
            <span>{t.date} {t.departureTime}</span>
            <span className="font-medium text-foreground">{t.cycleMinutes}min</span>
            <span className="truncate max-w-[80px]">{t.vehicle}</span>
          </div>
        ))}
      </div>

      <button
        type="button"
        onClick={onToggle}
        className={`w-full text-xs rounded px-2 py-1.5 font-medium transition-colors ${
          cluster.isDisabled
            ? 'bg-blue-600 text-white hover:bg-blue-700'
            : 'bg-muted text-muted-foreground hover:bg-muted/80'
        }`}
      >
        {cluster.isDisabled ? 'Reativar ponto' : 'Desativar ponto'}
      </button>
    </div>
  )
}

// ── marquee confirm popup ──────────────────────────────────────────────────────

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

  const H      = 90  // popup height estimate
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
        <span className="font-medium">
          {selection.items.length} ponto{selection.items.length !== 1 ? 's' : ''}
        </span>
        <button
          type="button"
          onClick={onClose}
          className="text-muted-foreground hover:text-foreground"
        >
          ✕
        </button>
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
