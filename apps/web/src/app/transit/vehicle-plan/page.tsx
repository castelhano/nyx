'use client'

import { useState, useCallback, useMemo } from 'react'
import { useRouter, useSearchParams } from 'next/navigation'
import { Icons } from '@/lib/icons'
import { useQueryClient } from '@tanstack/react-query'
import { AutoList } from '@/core/AutoList'
import { AutoBreadcrumb } from '@/core/AutoBreadcrumb'
import { SyncModal } from '@/core/SyncModal'
import { usePageGuard } from '@/core/usePageGuard'
import { useTopbarActions } from '@/components/layout/topbar-actions-context'
import { useShortcut } from '@/lib/keywatch'
import { apiFetch } from '@/lib/auth'
import { downloadCsv } from '@/lib/csv'
import { extractError } from '@/lib/utils'
import { useConfirm } from '@/lib/confirm-context'
import { useToast } from '@/lib/toast-context'
import { Button } from '@/components/ui/button'
import { PlanCompareModal } from './components/PlanCompareModal'

type Row = Record<string, unknown>

export default function VehiclePlanListPage() {
  const router       = useRouter()
  const searchParams = useSearchParams()
  const queryClient  = useQueryClient()
  const confirm      = useConfirm()
  const { toast }    = useToast()

  const [importOpen,      setImportOpen]      = useState(false)
  const [importPlanId,    setImportPlanId]    = useState<string | null>(null)
  const [importDayTypeId, setImportDayTypeId] = useState<string | null>(null)
  const [importDayTypeName, setImportDayTypeName] = useState<string | null>(null)
  const [importScopeId,   setImportScopeId]   = useState<string | null>(null)
  const [importScopeName, setImportScopeName] = useState<string | null>(null)

  // plans picked for "Comparar" — same scope + day type, up to 3
  const [selected,    setSelected]    = useState<Row[]>([])
  const [compareOpen, setCompareOpen] = useState(false)
  const selection = useMemo(() => ({
    max:       3,
    selected,
    onChange:  setSelected,
    canSelect: (row: Row, current: Row[]) =>
      !current.length || (row.scopeId === current[0].scopeId && row.dayTypeId === current[0].dayTypeId)
        || 'Somente planejamentos do mesmo escopo e tipo de dia',
  }), [selected])

  const { guardNode, meta } = usePageGuard('transit', 'vehicle-plan')

  const filters: Record<string, string> = {}
  for (const [key, value] of searchParams.entries()) {
    if (!key.startsWith('_')) filters[key] = value
  }

  async function handleDownloadCsv() {
    if (!meta) return
    const params = new URLSearchParams({ page: '1', pageSize: '9999', ...filters })
    const res = await apiFetch(`/transit/vehicle-plan?${params}`)
    if (!res.ok) return
    const { data } = await res.json()
    downloadCsv(data, meta.fields, meta.labelPlural)
  }

  useTopbarActions([
    ...(meta?.permissions?.create !== false
      ? [{ label: 'Novo', icon: Icons.Plus, onClick: () => router.push('/transit/vehicle-plan/new'), primary: true }]
      : []),
    ...(meta?.permissions?.create !== false
      ? [{ label: 'Importar', icon: Icons.Upload, onClick: () => { setImportPlanId(null); setImportOpen(true) }, variant: 'ghost' as const }]
      : []),
    ...(meta?.allowCsv ? [{ label: 'CSV', icon: Icons.Download, onClick: handleDownloadCsv, variant: 'ghost' as const }] : []),
  ], [meta?.permissions?.create, meta?.allowCsv])

  useShortcut('alt+v', () => router.push('/transit'), {
    desc:   'Voltar',
    icon:   Icons.ArrowLeft,
    origin: 'app/transit/vehicle-plan/page',
  })

  useShortcut('alt+n', () => router.push('/transit/vehicle-plan/new'), {
    desc:   'Novo',
    icon:   Icons.Plus,
    origin: 'app/transit/vehicle-plan/page',
  })

  useShortcut('alt+d', handleDownloadCsv, {
    desc:   'Baixar dados em CSV',
    icon:   Icons.Download,
    origin: 'app/transit/vehicle-plan/page',
  })

  useShortcut('alt+c', () => { if (selected.length >= 2) setCompareOpen(true) }, {
    desc:   'Comparar planejamentos selecionados',
    icon:   Icons.GitCompare,
    origin: 'app/transit/vehicle-plan/page',
  })

  // AutoList's alt+l (clear filters) fires too
  useShortcut('alt+l', () => setSelected([]), {
    display: false,
    origin:  'app/transit/vehicle-plan/page',
  })

  const handleAction = useCallback(async (action: string, row: Record<string, unknown>) => {
    if (action === 'import') {
      setImportPlanId(row.id as string)
      setImportDayTypeId(row.dayTypeId as string | null)
      setImportDayTypeName((row as any).dayType?.name ?? null)
      setImportScopeId(row.scopeId as string | null)
      setImportScopeName((row as any).scope?.name ?? null)
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
          throw new Error(extractError(json, 'Erro ao excluir'))
        }
        queryClient.invalidateQueries({ queryKey: ['transit', 'vehicle-plan'] })
        toast.success('Planejamento excluído')
      } catch (err) {
        toast.error(err instanceof Error ? err.message : 'Erro ao excluir')
      }
    }
  }, [confirm, queryClient, toast])

  if (guardNode) return guardNode

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
        selection={selection}
      />
      {selected.length > 0 && (
        <div className="fixed bottom-6 left-1/2 -translate-x-1/2 z-40 flex items-center gap-3 bg-card border border-border rounded-lg shadow-lg px-4 py-2">
          <span className="text-sm text-muted-foreground">
            {selected.length} {selected.length === 1 ? 'selecionado' : 'selecionados'}
            {selected.length < 2 && ' · selecione mais um para comparar'}
          </span>
          <Button size="sm" disabled={selected.length < 2} onClick={() => setCompareOpen(true)}>
            <Icons.GitCompare className="w-3.5 h-3.5" />
            Comparar
          </Button>
          <Button size="sm" variant="ghost" onClick={() => setSelected([])} title="Limpar seleção">
            <Icons.X className="w-3.5 h-3.5" />
          </Button>
        </div>
      )}
      {compareOpen && (
        <PlanCompareModal planIds={selected.map(r => String(r.id))} onClose={() => setCompareOpen(false)} />
      )}
      {importOpen && (
        <SyncModal
          domain="transit"
          resource="vehicle-plan"
          label="Programação de Veículos"
          submitLabel="Importar"
          outputLabels={{ created: 'Blocos', updated: 'Viagens', deactivated: 'Linhas' }}
          extraBody={importPlanId ? { planId: importPlanId } : undefined}
          readonlyFields={importPlanId && importDayTypeId ? {
            dayTypeId: { value: importDayTypeId, displayLabel: importDayTypeName ?? importDayTypeId },
            ...(importScopeId ? { scopeId: { value: importScopeId, displayLabel: importScopeName ?? importScopeId } } : {}),
          } : undefined}
          onClose={() => {
            setImportOpen(false)
            setImportPlanId(null)
            setImportDayTypeId(null)
            setImportDayTypeName(null)
            setImportScopeId(null)
            setImportScopeName(null)
          }}
        />
      )}
    </div>
  )
}
