'use client'

import { useEffect } from 'react'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import { Icons } from '@/lib/icons'
import { apiFetch } from '@/lib/auth'
import { useToast } from '@/lib/toast-context'
import { extractError } from '@/lib/utils'
import { CrewPinsEditor, type CrewPin } from '../../../crew-pins-editor'

// A trip group's crew members (VehiclePlan.constraints.bundleCrew), in order: the crew solver
// builds the group's duty within the first one's shift, and the daily roster prefers them on it —
// every crew plan of this vehicle plan inherits it. Saved at each change.
export function BundleCrewModal({ planId, bundleId, branchId, canEdit, onClose }: {
  planId: string; bundleId: string; branchId: string | null; canEdit: boolean; onClose: () => void
}) {
  const queryClient = useQueryClient()
  const { toast } = useToast()
  const key = ['transit', 'vehicle-plan', planId, 'bundle-crew']
  const { data } = useQuery<Record<string, CrewPin[]>>({
    queryKey: key,
    queryFn:  async () => {
      const res = await apiFetch(`/transit/vehicle-plan/${planId}/bundle-crew`)
      const json = await res.json().catch(() => ({}))
      if (!res.ok) throw new Error(extractError(json))
      return json
    },
  })

  async function save(crewMemberIds: string[]) {
    const res = await apiFetch(`/transit/vehicle-plan/${planId}/bundle-crew`, { method: 'PUT', body: JSON.stringify({ bundleId, crewMemberIds }) })
    if (!res.ok) return toast.error(extractError(await res.json().catch(() => ({}))))
    await queryClient.invalidateQueries({ queryKey: key })
  }

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') onClose() }
    document.addEventListener('keydown', onKey)
    return () => document.removeEventListener('keydown', onKey)
  }, [onClose])

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center">
      <div className="absolute inset-0 bg-black/40" onClick={onClose} />
      <div className="relative z-10 w-full max-w-md mx-4 rounded-lg border border-border bg-card p-4 shadow-xl space-y-3">
        <div className="flex items-center">
          <h2 className="text-sm font-semibold">Operadores do grupo de viagens</h2>
          <button type="button" onClick={onClose} className="ml-auto text-muted-foreground hover:text-foreground cursor-pointer" title="Fechar"><Icons.X className="w-4 h-4" /></button>
        </div>
        {!data ? <p className="text-xs text-muted-foreground">Carregando…</p> : (
          <CrewPinsEditor
            pins={data[bundleId] ?? []} branchId={branchId} canEdit={canEdit} onChange={(ids) => void save(ids)}
            hint="O gerador de escala monta a tabela deste grupo dentro do turno do 1º operador; a escala diária dá a tabela ao 1º livre da lista. Vale para todas as escalas deste plano."
          />
        )}
      </div>
    </div>
  )
}
