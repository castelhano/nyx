'use client'

import { useEffect, useMemo } from 'react'
import { useQuery } from '@tanstack/react-query'
import { Icons } from '@/lib/icons'
import { apiFetch } from '@/lib/auth'
import { extractError } from '@/lib/utils'
import { Button } from '@/components/ui/button'
import { useShortcutContext } from '@/lib/keywatch'
import type { GanttBlock } from '../views/vehicles.view'
import { computeOsoAttributeSync, type OsoAttributePatch, type OsoLineDepartures } from '../oso-attribute-sync-logic'

// "Atualizar da OSO" (OSO → plano) preview — per selected line, how many trips would
// take the pinned OSO's vehicle type / stop pattern / markings. Applying stages them as
// pending edits (docs/proposal/plan_oso_attribute_sync_v1.md).

interface Props {
  planId:      string
  lineIds:     string[]
  lineCodeById: Map<string, string>
  // the Gantt as rendered, pending edits included
  blocks:      GanttBlock[]
  skipTripIds: Set<string>
  onApply:     (patches: Map<string, OsoAttributePatch>) => void
  onClose:     () => void
}

const STATUS_LABELS: Record<string, string> = {
  DRAFT: 'Rascunho', APPROVED: 'Aprovado', SUPERSEDED: 'Substituído', ARCHIVED: 'Arquivado',
}

export function SyncFromOsoModal({ planId, lineIds, lineCodeById, blocks, skipTripIds, onApply, onClose }: Props) {
  useShortcutContext('sync_from_oso_md')

  useEffect(() => {
    function handleKey(e: KeyboardEvent) {
      if (e.key === 'Escape') onClose()
    }
    document.addEventListener('keydown', handleKey)
    return () => document.removeEventListener('keydown', handleKey)
  }, [onClose])

  const { data, isLoading, error } = useQuery<OsoLineDepartures[]>({
    queryKey: ['transit', 'vehicle-plan', planId, 'oso-departures', lineIds],
    queryFn:  async () => {
      const res = await apiFetch(`/transit/vehicle-plan/${planId}/oso-departures?lineIds=${lineIds.join(',')}`)
      const json = await res.json().catch(() => ({}))
      if (!res.ok) throw new Error(extractError(json, 'Erro ao carregar OSOs'))
      return json
    },
    staleTime: 0,
  })

  const sync = useMemo(() => data ? computeOsoAttributeSync(data, blocks, skipTripIds) : null, [data, blocks, skipTripIds])
  const withoutOso = lineIds.filter(id => !data?.some(l => l.lineId === id))

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center">
      <div className="absolute inset-0 bg-black/40" onClick={onClose} />
      <div className="relative z-10 bg-card border border-border rounded-lg shadow-xl w-full max-w-lg mx-4 max-h-[80vh] flex flex-col">
        <div className="flex items-center justify-between px-5 py-3.5 border-b border-border shrink-0">
          <div>
            <h2 className="text-base font-semibold">Atualizar da OSO</h2>
            <p className="text-xs text-muted-foreground mt-0.5">Veículo, embarque e marcações das viagens, a partir da OSO de cada linha</p>
          </div>
          <button onClick={onClose} className="p-1 rounded hover:bg-accent text-muted-foreground hover:text-foreground">
            <Icons.X className="w-4 h-4" />
          </button>
        </div>

        <div className="overflow-y-auto px-5 py-4 space-y-3">
          {isLoading ? (
            <p className="text-sm text-muted-foreground py-6 text-center">Carregando…</p>
          ) : error ? (
            <p className="text-sm text-destructive py-6 text-center">{(error as Error).message}</p>
          ) : (
            <>
              <table className="w-full text-xs">
                <thead>
                  <tr className="text-muted-foreground text-left">
                    <th className="font-medium pb-1.5">Linha</th>
                    <th className="font-medium pb-1.5">OSO</th>
                    <th className="font-medium pb-1.5 text-right">Veículo</th>
                    <th className="font-medium pb-1.5 text-right">Embarque</th>
                    <th className="font-medium pb-1.5 text-right">Marcações</th>
                    <th className="font-medium pb-1.5 text-right" title="Viagens sem partida correspondente na OSO — não são alteradas">Sem par</th>
                  </tr>
                </thead>
                <tbody>
                  {sync?.lines.map(l => (
                    <tr key={l.lineId} className="border-t border-border/60">
                      <td className="py-1.5 font-mono font-medium">{lineCodeById.get(l.lineId) ?? '—'}</td>
                      <td className="py-1.5 text-muted-foreground">{l.approvalRef} · {STATUS_LABELS[l.status] ?? l.status}</td>
                      <td className="py-1.5 text-right tabular-nums">{l.byField.requiredVehicleType || '—'}</td>
                      <td className="py-1.5 text-right tabular-nums">{l.byField.stopPattern || '—'}</td>
                      <td className="py-1.5 text-right tabular-nums">{l.byField.markings || '—'}</td>
                      <td className="py-1.5 text-right tabular-nums text-muted-foreground">{l.unmatched || '—'}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
              {withoutOso.length > 0 && (
                <p className="text-xs text-muted-foreground">
                  Sem OSO vinculada (ignoradas): {withoutOso.map(id => lineCodeById.get(id) ?? id).join(', ')}
                </p>
              )}
              {sync && sync.patches.size === 0 && (
                <p className="text-xs text-muted-foreground">As viagens já estão iguais à OSO.</p>
              )}
            </>
          )}
        </div>

        <div className="flex justify-end gap-2 px-5 py-3 border-t border-border shrink-0">
          <Button variant="outline" onClick={onClose}>Cancelar</Button>
          <Button
            variant="safeConfirm"
            disabled={!sync || sync.patches.size === 0}
            onClick={() => { onApply(sync!.patches); onClose() }}
          >
            Aplicar{sync && sync.patches.size > 0 ? ` (${sync.patches.size})` : ''}
          </Button>
        </div>
      </div>
    </div>
  )
}
