'use client'

import { useState, useCallback } from 'react'
import { useRouter, useSearchParams } from 'next/navigation'
import { Plus, Upload, ArrowLeft } from 'lucide-react'
import { useQueryClient } from '@tanstack/react-query'
import { AutoList } from '@/core/AutoList'
import { AutoBreadcrumb } from '@/core/AutoBreadcrumb'
import { SyncModal } from '@/core/SyncModal'
import { usePageGuard } from '@/core/usePageGuard'
import { useTopbarActions } from '@/components/layout/topbar-actions-context'
import { useShortcut } from '@/lib/keywatch'
import { apiFetch } from '@/lib/auth'
import { useConfirm } from '@/lib/confirm-context'
import { useToast } from '@/lib/toast-context'

export default function VehiclePlanListPage() {
  const router       = useRouter()
  const searchParams = useSearchParams()
  const queryClient  = useQueryClient()
  const confirm      = useConfirm()
  const { toast }    = useToast()

  const [importOpen,   setImportOpen]   = useState(false)
  const [importPlanId, setImportPlanId] = useState<string | null>(null)

  const { guardNode, meta } = usePageGuard('transit', 'vehicle-plan')
  if (guardNode) return guardNode

  const filters: Record<string, string> = {}
  for (const [key, value] of searchParams.entries()) {
    if (!key.startsWith('_')) filters[key] = value
  }

  useTopbarActions([
    ...(meta?.permissions?.create !== false
      ? [{ label: 'Novo', icon: Plus, onClick: () => router.push('/transit/vehicle-plan/new'), primary: true }]
      : []),
    ...(meta?.permissions?.create !== false
      ? [{ label: 'Importar', icon: Upload, onClick: () => { setImportPlanId(null); setImportOpen(true) }, variant: 'ghost' as const }]
      : []),
  ], [meta?.permissions?.create])

  useShortcut('alt+v', () => router.push('/transit'), {
    desc:   'Voltar',
    icon:   ArrowLeft,
    origin: 'app/transit/vehicle-plan/page',
  })

  const handleAction = useCallback(async (action: string, row: Record<string, unknown>) => {
    if (action === 'import') {
      setImportPlanId(row.id as string)
      setImportOpen(true)
      return
    }
    if (action === 'delete') {
      const ok = await confirm({
        title:        'Excluir planejamento',
        description:  'Esta ação não pode ser desfeita. Todos os blocos serão removidos.',
        confirmLabel: 'Excluir',
        variant:      'destructive',
      })
      if (!ok) return
      try {
        const res = await apiFetch(`/transit/vehicle-plan/${row.id}`, { method: 'DELETE' })
        if (!res.ok) {
          const json = await res.json().catch(() => ({}))
          throw new Error(json?.message?.message ?? json?.message ?? 'Erro ao excluir')
        }
        queryClient.invalidateQueries({ queryKey: ['transit', 'vehicle-plan'] })
        toast.success('Planejamento excluído')
      } catch (err) {
        toast.error(err instanceof Error ? err.message : 'Erro ao excluir')
      }
    }
  }, [confirm, queryClient, toast])

  return (
    <div className="p-6 space-y-4">
      <AutoBreadcrumb domain="transit" resource="vehicle-plan" contextParams={filters} />
      <h1 className="text-xl font-semibold">{meta?.labelPlural ?? 'Planos de Veículos'}</h1>
      <AutoList
        domain="transit"
        resource="vehicle-plan"
        filters={Object.keys(filters).length ? filters : undefined}
        onEdit={(id) => router.push(`/transit/vehicle-plan/${id}`)}
        onAction={handleAction}
      />
      {importOpen && (
        <SyncModal
          domain="transit"
          resource="vehicle-plan"
          label="Programação de Veículos"
          submitLabel="Importar"
          outputLabels={{ created: 'Blocos', updated: 'Viagens', deactivated: 'Linhas' }}
          extraBody={importPlanId ? { planId: importPlanId } : undefined}
          onClose={() => { setImportOpen(false); setImportPlanId(null) }}
        />
      )}
    </div>
  )
}
