'use client'

import { useCallback, useMemo, useState } from 'react'
import { useParams, useRouter } from 'next/navigation'
import { useQuery } from '@tanstack/react-query'
import { DAILY_STATUS_LABEL } from '@nyx/schemas'
import { Icons }            from '@/lib/icons'
import { AutoBreadcrumb }   from '@/core/AutoBreadcrumb'
import { usePageGuard }     from '@/core/usePageGuard'
import { useTopbarActions } from '@/components/layout/topbar-actions-context'
import { useShortcut }      from '@/lib/keywatch'
import { apiFetch }         from '@/lib/auth'
import { useToast }         from '@/lib/toast-context'
import { useConfirm }       from '@/lib/confirm-context'
import { cn, extractError } from '@/lib/utils'
import { Badge }            from '@/components/ui/badge'
import type { DailyBoardData } from './daily.types'
import { ISSUE_LABEL, crewSituation, dutyLabel } from './daily.types'
import { BlocksTable, CrewTable, DutiesTable } from './DayTables'
import { NewDailyOperation } from './NewDailyOperation'

// The day's real operation: the plans in force copied for the date, allocated to crew members
// and vehicles. Every edit is written at once and the server recalculates the day's issues.

const ORIGIN = 'apps/web/src/app/transit/daily-operation/[id]/page'

type Tab = 'duties' | 'blocks' | 'crew'

const STATUS_COLOR = { PLANNED: 'warning', PUBLISHED: 'success', CLOSED: 'muted' } as const

async function api(path: string, init?: RequestInit): Promise<unknown> {
  const res = await apiFetch(path, init)
  if (!res.ok) {
    const json = await res.json().catch(() => ({}))
    throw new Error(extractError(json))
  }
  return res.status === 204 ? null : res.json().catch(() => null)
}

export default function DailyOperationPage() {
  const { id } = useParams<{ id: string }>()
  return id === 'new' ? <NewDailyOperation /> : <DailyOperationBoard id={id} />
}

function DailyOperationBoard({ id }: { id: string }) {
  const router  = useRouter()
  const { toast } = useToast()
  const confirm = useConfirm()
  const [tab, setTab]       = useState<Tab>('duties')
  const [onlyIssues, setOnlyIssues] = useState(false)
  const [search, setSearch] = useState('')
  const [saving, setSaving] = useState(false)

  const { data, error, refetch, isFetching } = useQuery<DailyBoardData>({
    queryKey: ['transit', 'daily-operation', id, 'board'],
    queryFn:  async () => (await api(`/transit/daily-operation/${id}/board`)) as DailyBoardData,
  })
  const { guardNode, canUpdate } = usePageGuard('transit', 'daily-operation', false, error ?? undefined)
  const status  = data?.operation.status
  const canEdit = canUpdate && status !== 'CLOSED'
  const base    = `/transit/daily-operation/${id}`

  const run = useCallback(async (fn: () => Promise<unknown>, success?: string) => {
    setSaving(true)
    try {
      await fn()
      if (success) toast.success(success)
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Erro ao salvar')
    } finally {
      setSaving(false)
      await refetch()
    }
  }, [refetch, toast])

  const put = (path: string, body: unknown) => run(() => api(`${base}${path}`, { method: 'PUT', body: JSON.stringify(body) }))

  async function handlePublish() {
    const ok = await confirm({ title: 'Publicar dia', description: 'Depois de publicado, cada mudança de condutor, carro ou viagem fica registrada no histórico do dia.', confirmLabel: 'Publicar' })
    if (ok) await run(() => api(`${base}/publish`, { method: 'POST' }), 'Dia publicado')
  }
  async function handleClose() {
    const ok = await confirm({ title: 'Encerrar dia', description: 'O dia fica somente leitura.', confirmLabel: 'Encerrar' })
    if (ok) await run(() => api(`${base}/close`, { method: 'POST' }), 'Dia encerrado')
  }
  async function handleRematerialize() {
    const ok = await confirm({
      title: 'Refazer o dia', description: 'O dia é descartado e copiado de novo dos planejamentos em vigor — condutores e veículos alocados são perdidos (folgas lançadas ficam).',
      confirmLabel: 'Refazer', variant: 'destructive',
    })
    if (!ok) return
    setSaving(true)
    try {
      const res = await api(`${base}/rematerialize`, { method: 'POST' }) as { id: string }
      toast.success('Dia refeito')
      router.replace(`/transit/daily-operation/${res.id}`)
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Erro ao refazer')
    } finally {
      setSaving(false)
    }
  }
  const handleRecalculate = () => run(() => api(`${base}/recalculate`, { method: 'POST' }), 'Dia recalculado')

  useTopbarActions([
    ...(status === 'PLANNED' ? [{ label: 'Publicar', icon: Icons.Send, onClick: () => void handlePublish(), primary: true, disabled: saving || !canUpdate }] : []),
    ...(status === 'PUBLISHED' ? [{ label: 'Encerrar', icon: Icons.Lock, onClick: () => void handleClose(), primary: true, disabled: saving || !canUpdate }] : []),
    ...(canEdit ? [{ label: 'Recalcular', icon: Icons.RefreshCw, onClick: () => void handleRecalculate(), disabled: saving, keybind: 'ALT+G' }] : []),
    ...(status === 'PLANNED' && canUpdate ? [{ label: 'Refazer o dia', icon: Icons.RotateCcw, onClick: () => void handleRematerialize(), disabled: saving, overflow: true }] : []),
  ], [status, saving, canEdit, canUpdate])

  useShortcut('alt+g', () => { if (canEdit && !saving) void handleRecalculate() }, { desc: 'Recalcular o dia', icon: Icons.RefreshCw, origin: ORIGIN })
  useShortcut('alt+v', () => router.push('/transit/daily-operation'), { desc: 'Voltar', icon: Icons.ArrowLeft, origin: ORIGIN })
  useShortcut('alt+l', () => void refetch(), { display: false, origin: ORIGIN })

  const dutyById = useMemo(() => new Map((data?.duties ?? []).map(d => [d.id, d])), [data?.duties])
  const crewById = useMemo(() => new Map((data?.crew ?? []).map(c => [c.id, c])), [data?.crew])
  const q = search.trim().toLowerCase()

  const duties = useMemo(() => (data?.duties ?? []).filter(d =>
    (!onlyIssues || d.hasIssues)
    && (!q || dutyLabel(d).toLowerCase().includes(q) || (d.crewMemberId && `${crewById.get(d.crewMemberId)?.code} ${crewById.get(d.crewMemberId)?.name}`.toLowerCase().includes(q)))),
  [data?.duties, onlyIssues, q, crewById])
  const blocks = useMemo(() => (data?.blocks ?? []).filter(b =>
    (!onlyIssues || b.hasIssues) && (!q || String(b.blockNumber).includes(q) || b.events.some(e => e.lineCode?.toLowerCase().includes(q)))),
  [data?.blocks, onlyIssues, q])
  const crew = useMemo(() => (data?.crew ?? []).filter(c => {
    if (q && !`${c.code} ${c.name}`.toLowerCase().includes(q)) return false
    // "issues" on the crew tab: available people (nothing to do on the day)
    return !onlyIssues || crewSituation(c, dutyById).tone === 'free'
  }), [data?.crew, onlyIssues, q, dutyById])

  if (guardNode) return guardNode

  const op = data?.operation
  const s  = op?.summary
  const issueTotal = s ? Object.values(s.issues).reduce((a, b) => a + b, 0) : 0
  const topIssues  = s ? Object.entries(s.issues).sort((a, b) => b[1] - a[1]).slice(0, 4) : []

  return (
    <div className="flex flex-col h-full min-h-0">
      <div className="px-6 pt-4 pb-2 shrink-0 space-y-2">
        <AutoBreadcrumb domain="transit" resource="daily-operation" id={id} recordName={op?.date} />
        {op && (
          <div className="flex flex-wrap items-center gap-x-4 gap-y-1 text-sm text-muted-foreground">
            <span className="font-medium text-foreground">{op.date.split('-').reverse().join('/')}</span>
            <span>{op.scopeName} · {op.dayTypeName}</span>
            <Badge label={DAILY_STATUS_LABEL[op.status]} color={STATUS_COLOR[op.status]} />
            {op.sources.length > 1 && (
              <span className="text-amber-600 dark:text-amber-400" title={op.sources.map(src => `${src.dayTypeName ?? ''} (${src.vehiclePlanLabel ?? 'planejamento'}): ${src.lineCodes.join(', ')}`).join('\n')}>
                Dia misto — {op.sources.length} planejamentos
              </span>
            )}
            {s && <span>Tabelas: {s.assignedCount}/{s.dutyCount}</span>}
            {s && <span>Veículos: {s.vehicleCount}/{s.blockCount}</span>}
            {s && s.uncoveredTrips > 0 && <span className="text-red-600 dark:text-red-400">{s.uncoveredTrips} viagem(ns) sem carro</span>}
            {issueTotal > 0 && (
              <span className="text-amber-600 dark:text-amber-400" title={Object.entries(s!.issues).map(([k, n]) => `${ISSUE_LABEL[k] ?? k}: ${n}`).join('\n')}>
                Pendências: {topIssues.map(([k, n]) => `${ISSUE_LABEL[k] ?? k} (${n})`).join(' · ')}{Object.keys(s!.issues).length > 4 && ' …'}
              </span>
            )}
          </div>
        )}
        <div className="flex flex-wrap items-center gap-2 pt-1">
          {([['duties', 'Tabelas'], ['blocks', 'Carros'], ['crew', 'Pessoal']] as const).map(([key, label]) => (
            <button
              key={key} type="button" onClick={() => setTab(key)}
              className={cn('h-7 px-3 rounded-sm text-sm', tab === key ? 'bg-accent text-accent-foreground font-medium' : 'text-muted-foreground hover:bg-muted')}
            >
              {label}
            </button>
          ))}
          <div className="w-px h-4 bg-border mx-1" />
          <label className="flex items-center gap-1.5 text-xs text-muted-foreground cursor-pointer select-none">
            <input type="checkbox" checked={onlyIssues} onChange={e => setOnlyIssues(e.target.checked)} />
            {tab === 'crew' ? 'Só disponíveis' : 'Só com pendências'}
          </label>
          <div className="relative">
            <Icons.Search className="pointer-events-none absolute left-2 top-1/2 -translate-y-1/2 w-3.5 h-3.5 text-muted-foreground" />
            <input
              value={search} onChange={e => setSearch(e.target.value)} placeholder="Buscar…"
              className="h-7 w-52 border border-input rounded-sm text-xs bg-input-bg pl-7 pr-2 focus:outline-none focus:ring-1 focus:ring-ring"
            />
          </div>
          {isFetching && <span className="text-xs text-muted-foreground">Atualizando…</span>}
        </div>
      </div>

      <div className="flex-1 min-h-0 overflow-auto px-6 pb-6 border-t border-border">
        {!data ? (
          <p className="py-6 text-sm text-muted-foreground">Carregando…</p>
        ) : tab === 'duties' ? (
          <DutiesTable data={data} duties={duties} canEdit={canEdit} onAssign={(dutyId, crewMemberId) => void put(`/duty/${dutyId}/crew`, { crewMemberId })} />
        ) : tab === 'blocks' ? (
          <>
            {data.uncoveredTrips.length > 0 && (
              <p className="py-2 text-xs text-red-600 dark:text-red-400">
                Viagens sem carro: {data.uncoveredTrips.map(t => `${t.lineCode} ${String(Math.floor(t.startMinutes / 60)).padStart(2, '0')}:${String(t.startMinutes % 60).padStart(2, '0')}`).join(', ')}
              </p>
            )}
            <BlocksTable
              data={data} blocks={blocks} canEdit={canEdit}
              onVehicle={(blockId, vehicleId) => void put(`/block/${blockId}/vehicle`, { vehicleId })}
              onCancelTrip={(eventId, cancelled) => void put(`/trip/${eventId}/cancelled`, { cancelled })}
            />
          </>
        ) : (
          <CrewTable data={data} crew={crew} canEdit={canEdit} onDayOff={(crewMemberId, kind) => void put(`/crew/${crewMemberId}/day-off`, { kind })} />
        )}
      </div>
    </div>
  )
}
