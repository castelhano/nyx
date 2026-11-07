'use client'

import { useEffect, useState } from 'react'
import { useQuery } from '@tanstack/react-query'
import { gtfsFileName, type GtfsBlockIdMode, type GtfsExportRequest, type GtfsOptions, type GtfsPreview } from '@nyx/schemas'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Select } from '@/components/ui/select'
import { apiFetch } from '@/lib/auth'
import { useConfirm } from '@/lib/confirm-context'
import { Icons } from '@/lib/icons'
import { useShortcut, useShortcutContext } from '@/lib/keywatch'
import { useToast } from '@/lib/toast-context'
import { cn, extractError } from '@/lib/utils'

// GTFS feed of an operator and day type for Goal (docs/architecture/transit/gtfs-export.md). The preview is
// mandatory: Goal keeps every load, so the report is read before the version is used up.

const CONTEXT = 'gtfs_export_md'
const DEFAULT_PERIOD_DAYS = 30

const localDay = (date: Date) =>
  `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}-${String(date.getDate()).padStart(2, '0')}`

function daysAhead(days: number): string {
  const date = new Date()
  date.setDate(date.getDate() + days)
  return localDay(date)
}

const hours = (minutes: number) => `${Math.floor(minutes / 60)}:${String(minutes % 60).padStart(2, '0')}`

function ReportList({ items, className }: { items: string[]; className: string }) {
  if (!items.length) return null
  return (
    <ul className={cn('rounded-sm border px-3 py-2 text-xs space-y-1', className)}>
      {items.map(item => <li key={item}>{item}</li>)}
    </ul>
  )
}

export function GtfsExportModal({ onClose }: { onClose: () => void }) {
  useShortcutContext(CONTEXT)
  const { toast } = useToast()
  const confirm   = useConfirm()

  useEffect(() => {
    function onKeyDown(e: KeyboardEvent) {
      if (e.key === 'Escape') onClose()
    }
    document.addEventListener('keydown', onKeyDown)
    return () => document.removeEventListener('keydown', onKeyDown)
  }, [onClose])

  const { data: options } = useQuery<GtfsOptions>({
    queryKey: ['transit', 'gtfs', 'options'],
    staleTime: 0,
    queryFn: async () => {
      const res = await apiFetch('/transit/gtfs/options')
      if (!res.ok) throw new Error('Falha ao carregar as opções')
      return res.json()
    },
  })

  // null = not chosen yet, falls back to the default from the options
  const [operatorChoice, setOperatorId] = useState<string | null>(null)
  // Goal takes one day type per load; none picked at first, each load is a choice
  const [dayTypeIds, setDayTypeIds]     = useState<string[]>([])
  const [versionChoice, setVersions]    = useState<Record<string, number>>({})
  const [periodStart, setPeriodStart]   = useState(() => daysAhead(0))
  const [periodEnd, setPeriodEnd]       = useState(() => daysAhead(DEFAULT_PERIOD_DAYS))
  const [blockIdMode, setBlockIdMode] = useState<GtfsBlockIdMode>('bundled')
  const [preview, setPreview] = useState<GtfsPreview | null>(null)
  const [busy, setBusy]       = useState(false)

  const operatorId = operatorChoice ?? options?.operators[0]?.id ?? ''
  const operator   = options?.operators.find(o => o.id === operatorId)
  const dayTypes   = (options?.dayTypes ?? [])
    .filter(d => dayTypeIds.includes(d.id))
    .map(d => ({ ...d, version: versionChoice[d.id] ?? operator?.nextVersions[d.id] ?? 1 }))

  // any parameter change invalidates what was previewed
  function changeParam(apply: () => void) {
    apply()
    setPreview(null)
  }

  const request: GtfsExportRequest = {
    scopeOperatorId: operatorId, periodStart, periodEnd, blockIdMode,
    dayTypes: dayTypes.map(({ id, version }) => ({ id, version })),
  }

  async function handlePreview() {
    setBusy(true)
    try {
      const res = await apiFetch('/transit/gtfs/preview', { method: 'POST', body: JSON.stringify(request) })
      const json = await res.json().catch(() => ({}))
      if (!res.ok) throw new Error(extractError(json))
      setPreview(json)
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Falha ao gerar a prévia')
    } finally {
      setBusy(false)
    }
  }

  const canExport = !!preview && preview.report.blockers.length === 0 && preview.lines.length > 0

  async function handleExport() {
    if (!preview || !canExport || busy) return
    const { errors } = preview.report
    if (errors.length) {
      const ok = await confirm({
        title:        'Exportar sem esses itens?',
        description:  `${errors.length} ${errors.length === 1 ? 'item ficará' : 'itens ficarão'} de fora do feed, e o Goal recebe o feed como um todo.`,
        confirmLabel: 'Exportar',
        variant:      'destructive',
      })
      if (!ok) return
    }

    setBusy(true)
    try {
      const res = await apiFetch('/transit/gtfs/export', { method: 'POST', body: JSON.stringify({ ...request, confirmErrors: errors.length > 0 }) })
      if (!res.ok) {
        const json = await res.json().catch(() => ({}))
        throw new Error(extractError(json))
      }
      const url = URL.createObjectURL(await res.blob())
      const a   = Object.assign(document.createElement('a'), {
        href: url, download: gtfsFileName(operator?.abbr ?? '', dayTypes),
      })
      document.body.appendChild(a)
      a.click()
      a.remove()
      URL.revokeObjectURL(url)
      onClose()
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Falha ao exportar o GTFS')
    } finally {
      setBusy(false)
    }
  }

  useShortcut('alt+g', handleExport, {
    desc: 'Baixar GTFS', icon: Icons.Download, context: CONTEXT,
    origin: 'apps/web/src/app/transit/vehicle-plan/components/GtfsExportModal.tsx',
  })

  function toggleDayType(id: string) {
    changeParam(() => setDayTypeIds(dayTypeIds.includes(id) ? [] : [id]))
  }

  const totals = preview?.lines.reduce((sum, l) => ({ trips: sum.trips + l.trips, km: sum.km + l.km }), { trips: 0, km: 0 })

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center">
      <div className="absolute inset-0 bg-black/40" onClick={onClose} />
      <div className="relative z-10 bg-card border border-border rounded-lg shadow-xl w-full max-w-2xl mx-4 max-h-[85vh] flex flex-col">
        <div className="flex items-center justify-between px-6 py-4 border-b border-border">
          <h2 className="text-base font-semibold">Exportar GTFS</h2>
          <button onClick={onClose} className="p-1 rounded hover:bg-accent text-muted-foreground hover:text-foreground">
            <Icons.X className="w-4 h-4" />
          </button>
        </div>

        <div className="flex-1 overflow-y-auto px-6 py-4 space-y-4">
          <div className="grid grid-cols-[8rem_1fr] items-center gap-x-3 gap-y-3 text-sm">
            <label className="font-medium">Operador</label>
            <Select size="sm" value={operatorId} onChange={e => changeParam(() => { setOperatorId(e.target.value); setVersions({}) })} wrapperClassName="max-w-xs">
              {options?.operators.map(o => <option key={o.id} value={o.id}>{o.abbr} · {o.scopeName}</option>)}
            </Select>

            <label className="font-medium">Período</label>
            <div className="flex items-center gap-2">
              <Input size="sm" type="date" value={periodStart} onChange={e => changeParam(() => setPeriodStart(e.target.value))} className="max-w-40" />
              <span className="text-muted-foreground">a</span>
              <Input size="sm" type="date" value={periodEnd} onChange={e => changeParam(() => setPeriodEnd(e.target.value))} className="max-w-40" />
            </div>

            <label className="font-medium">Tipo de dia</label>
            <div className="flex flex-wrap gap-2">
              {options?.dayTypes.map(d => (
                <button
                  key={d.id}
                  type="button"
                  onClick={() => toggleDayType(d.id)}
                  className={cn(
                    'px-2 py-1 rounded-sm border text-sm transition-colors',
                    dayTypeIds.includes(d.id) ? 'bg-accent text-accent-foreground border-accent' : 'bg-background text-muted-foreground hover:bg-muted',
                  )}
                >
                  {d.name}
                </button>
              ))}
            </div>

            {dayTypes.length > 0 && (
              <>
                <label className="font-medium">Versão</label>
                <div className="flex flex-wrap gap-4">
                  {dayTypes.map(d => (
                    <label key={d.id} className="flex items-center gap-2 text-muted-foreground">
                      {d.name}
                      <Input
                        size="sm"
                        type="number"
                        min={1}
                        value={d.version}
                        onChange={e => {
                          const version = Math.max(1, Number(e.target.value) || 1)
                          changeParam(() => setVersions(prev => ({ ...prev, [d.id]: version })))
                        }}
                        className="w-20"
                      />
                    </label>
                  ))}
                </div>
              </>
            )}

            <label className="font-medium">Enviar block_id</label>
            <Select size="sm" value={blockIdMode} onChange={e => changeParam(() => setBlockIdMode(e.target.value as GtfsBlockIdMode))} wrapperClassName="max-w-xs">
              <option value="none">Nenhum</option>
              <option value="bundled">Somente agrupados</option>
              <option value="all">Todos</option>
            </Select>
          </div>

          {preview && (
            <div className="space-y-3">
              <ReportList items={preview.report.blockers} className="border-destructive/40 text-destructive" />
              <ReportList items={preview.report.errors} className="border-destructive/40 text-destructive" />
              <ReportList items={preview.report.warnings} className="border-border text-muted-foreground" />

              {preview.lines.length > 0 && (
                <>
                  <p className="text-sm">
                    <span className="font-medium">{preview.serviceIds.join(', ')}</span>
                    <span className="text-muted-foreground"> · {totals?.trips} viagens · {totals?.km.toFixed(1)} km · {preview.blockTrips} com block_id</span>
                  </p>
                  <table className="w-full text-sm">
                    <thead>
                      <tr className="text-xs text-muted-foreground text-left border-b border-border">
                        <th className="py-1 font-medium">Linha</th>
                        <th className="py-1 font-medium">Nome</th>
                        <th className="py-1 font-medium text-right">Viagens</th>
                        <th className="py-1 font-medium text-right">Km</th>
                        <th className="py-1 font-medium text-right">Tempo</th>
                      </tr>
                    </thead>
                    <tbody>
                      {preview.lines.map(l => (
                        <tr key={l.routeId} className="border-b border-border/50">
                          <td className="py-1">{l.routeId}</td>
                          <td className="py-1 text-muted-foreground">{l.name}</td>
                          <td className="py-1 text-right tabular-nums">{l.trips}</td>
                          <td className="py-1 text-right tabular-nums">{l.km.toFixed(1)}</td>
                          <td className="py-1 text-right tabular-nums">{hours(l.minutes)}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </>
              )}
            </div>
          )}
        </div>

        <div className="flex items-center justify-end gap-2 px-6 py-4 border-t border-border">
          <Button size="sm" variant="ghost" onClick={onClose}>Cancelar</Button>
          <Button size="sm" variant="ghost" onClick={handlePreview} disabled={busy || !operatorId || dayTypeIds.length === 0}>Pré-visualizar</Button>
          <Button size="sm" onClick={handleExport} disabled={busy || !canExport}>Baixar GTFS</Button>
        </div>
      </div>
    </div>
  )
}
