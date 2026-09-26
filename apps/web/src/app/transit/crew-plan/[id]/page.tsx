'use client'

import { useState, useMemo, useCallback } from 'react'
import { useParams, useRouter } from 'next/navigation'
import { useQuery } from '@tanstack/react-query'
import type { CrewRole, ReliefPoint } from '@nyx/schemas'
import { Icons }            from '@/lib/icons'
import { AutoBreadcrumb }   from '@/core/AutoBreadcrumb'
import { usePageGuard }     from '@/core/usePageGuard'
import { useTopbarActions } from '@/components/layout/topbar-actions-context'
import { useShortcut }      from '@/lib/keywatch'
import { apiFetch }         from '@/lib/auth'
import { useToast }         from '@/lib/toast-context'
import { useConfirm }       from '@/lib/confirm-context'
import { extractError }     from '@/lib/utils'
import type { CrewBoardData, BoardBlock, BoardDuty } from './board.types'
import { CrewBoard, type PieceDraftStart } from './components/CrewBoard'
import { AssignPieceModal, type AssignTarget } from './components/AssignPieceModal'
import { DutyPanel, DUTY_FORM_ID, type DutyPatch, type ActivityInput } from './components/DutyPanel'
import { PlanPanel } from './components/PlanPanel'

// Logical crew schedule of a VehiclePlan (docs/proposal/plan_crew_plan_v1.md). Every edit
// is written immediately (no pending queue) — the server recalculates staleness, issues
// and coverage on each write, and the board is refetched from it.

const ORIGIN = 'apps/web/src/app/transit/crew-plan/[id]/page'
const ZOOMS  = [0.6, 0.9, 1.2, 1.8, 2.6]

async function api(path: string, init?: RequestInit): Promise<unknown> {
  const res = await apiFetch(path, init)
  if (!res.ok) {
    const json = await res.json().catch(() => ({}))
    throw new Error(extractError(json))
  }
  return res.status === 204 ? null : res.json().catch(() => null)
}

export default function CrewPlanPage() {
  const { id }    = useParams<{ id: string }>()
  const router    = useRouter()
  const { toast } = useToast()
  const confirm   = useConfirm()

  const { data, error, refetch } = useQuery<CrewBoardData>({
    queryKey: ['transit', 'crew-plan', id, 'board'],
    queryFn:  async () => {
      const res = await apiFetch(`/transit/crew-plan/${id}/board`)
      if (!res.ok) throw Object.assign(new Error('Falha ao carregar a escala'), { status: res.status })
      return res.json() as Promise<CrewBoardData>
    },
  })

  const { guardNode, canUpdate, canDelete } = usePageGuard('transit', 'crew-plan', false, error ?? undefined)
  const canEdit = canUpdate

  const [selectedDutyId, setSelectedDutyId] = useState<string | null>(null)
  const [draftStart, setDraftStart]         = useState<PieceDraftStart | null>(null)
  const [assignDraft, setAssignDraft]       = useState<{ block: BoardBlock; start: ReliefPoint; end: ReliefPoint } | null>(null)
  const [saving, setSaving]                 = useState(false)
  const [zoomIdx, setZoomIdx]               = useState(2)
  const [resetSignal, setResetSignal]       = useState(0)

  const selectedDuty = data?.duties.find(d => d.id === selectedDutyId) ?? null

  const localityName = useMemo(() => {
    const map = new Map((data?.localities ?? []).map(l => [l.id, l.abbr || l.name]))
    return (localityId: string) => map.get(localityId) ?? '?'
  }, [data?.localities])

  // runs a mutation, surfaces its error as a toast and refreshes the board either way
  const run = useCallback(async <T,>(fn: () => Promise<T>, success?: string): Promise<T | null> => {
    setSaving(true)
    try {
      const result = await fn()
      if (success) toast.success(success)
      return result
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Erro ao salvar')
      return null
    } finally {
      setSaving(false)
      await refetch()
    }
  }, [refetch, toast])

  // ── piece creation: two clicks on relief points of the same block ─────────

  function handlePointClick(block: BoardBlock, point: ReliefPoint) {
    if (!draftStart || draftStart.blockId !== block.id) { setDraftStart({ blockId: block.id, point }); return }
    const a = draftStart.point
    if (a.minutes === point.minutes) { setDraftStart(null); return }
    const [start, end] = a.minutes < point.minutes ? [a, point] : [point, a]
    setAssignDraft({ block, start, end })
  }

  async function handleAssign(target: AssignTarget) {
    if (!assignDraft) return
    const { block, start, end } = assignDraft
    const dutyId = await run(async () => {
      let targetId: string
      let created = false
      if (target.kind === 'new') {
        const duty = await api('/transit/duty', {
          method: 'POST',
          body:   JSON.stringify({ crewPlanId: id, role: target.role, kind: target.dutyKind }),
        }) as { id: string }
        targetId = duty.id
        created  = true
      } else {
        targetId = target.dutyId
      }
      try {
        await api('/transit/duty-piece', {
          method: 'POST',
          body:   JSON.stringify({
            dutyId: targetId, vehicleBlockId: block.id,
            startMinutes: start.minutes, endMinutes: end.minutes,
            startLocalityId: start.localityId, endLocalityId: end.localityId,
          }),
        })
      } catch (err) {
        // don't leave an empty duty behind when its first piece was rejected
        if (created) await api(`/transit/duty/${targetId}`, { method: 'DELETE' }).catch(() => null)
        throw err
      }
      return targetId
    })
    if (dutyId) {
      setSelectedDutyId(dutyId)
      setAssignDraft(null)
      setDraftStart(null)
    }
  }

  // ── duty / piece / activity ────────────────────────────────────────────────

  async function handleSaveDuty(patch: DutyPatch) {
    if (!selectedDuty) return
    await run(() => api(`/transit/duty/${selectedDuty.id}`, { method: 'PATCH', body: JSON.stringify(patch) }), 'Jornada salva')
  }

  async function handleDeleteDuty() {
    if (!selectedDuty) return
    const ok = await confirm({ title: 'Excluir jornada', description: 'A jornada, suas pegadas e atividades serão removidas.', confirmLabel: 'Excluir', variant: 'destructive' })
    if (!ok) return
    const done = await run(() => api(`/transit/duty/${selectedDuty.id}`, { method: 'DELETE' }).then(() => true))
    if (done) setSelectedDutyId(null)
  }

  async function handleCreateDuty(role: CrewRole) {
    const duty = await run(() => api('/transit/duty', { method: 'POST', body: JSON.stringify({ crewPlanId: id, role }) }) as Promise<{ id: string }>)
    if (duty) setSelectedDutyId(duty.id)
  }

  async function handleDeletePiece(pieceId: string) {
    await run(() => api(`/transit/duty-piece/${pieceId}`, { method: 'DELETE' }))
  }

  async function handleAddActivity(input: ActivityInput): Promise<boolean> {
    if (!selectedDuty) return false
    const res = await run(() => api('/transit/duty-activity', { method: 'POST', body: JSON.stringify({ dutyId: selectedDuty.id, ...input }) }).then(() => true))
    return !!res
  }

  async function handleDeleteActivity(activityId: string) {
    await run(() => api(`/transit/duty-activity/${activityId}`, { method: 'DELETE' }))
  }

  // ── plan-level actions ─────────────────────────────────────────────────────

  async function handleActivate() {
    const s = data?.plan.summary
    if (s && s.issueDutyCount > 0) {
      const ok = await confirm({
        title:        'Ativar escala com pendências',
        description:  `${s.issueDutyCount} jornada(s) não atendem a todos os critérios de jornada. Ativar mesmo assim?`,
        confirmLabel: 'Ativar',
      })
      if (!ok) return
    }
    await run(() => api(`/transit/crew-plan/${id}/activate`, { method: 'POST' }), 'Escala ativada')
  }

  async function handleDeletePlan() {
    const ok = await confirm({ title: 'Excluir escala', description: 'A escala e todas as suas jornadas serão removidas.', confirmLabel: 'Excluir', variant: 'destructive' })
    if (!ok || !data) return
    const done = await run(() => api(`/transit/crew-plan/${id}`, { method: 'DELETE' }).then(() => true))
    if (done) router.push(`/transit/vehicle-plan/${data.vehiclePlan.id}`)
  }

  async function handleNewVersion() {
    if (!data) return
    const plan = await run(() => api('/transit/crew-plan', {
      method: 'POST',
      body:   JSON.stringify({ vehiclePlanId: data.vehiclePlan.id, description: 'Nova escala' }),
    }) as Promise<{ id: string }>)
    if (plan) router.push(`/transit/crew-plan/${plan.id}`)
  }

  async function handleDuplicate() {
    const plan = await run(() => api(`/transit/crew-plan/${id}/duplicate`, { method: 'POST' }) as Promise<{ id: string }>, 'Escala duplicada')
    if (plan) router.push(`/transit/crew-plan/${plan.id}`)
  }

  // ── topbar & shortcuts ─────────────────────────────────────────────────────

  const isActive = data?.plan.status === 'ACTIVE'
  const versions = data?.versions ?? []

  useTopbarActions([
    ...(data ? [{
      label:    'Veículos',
      icon:     Icons.ArrowRightLeft,
      size:     'sm' as const,
      variant:  'ghost' as const,
      onClick:  () => router.push(`/transit/vehicle-plan/${data.vehiclePlan.id}`),
      position: 'start' as const,
    }] : []),
    ...(data ? [{
      label:   `Versão (${versions.length})`,
      icon:    Icons.GitBranch,
      size:    'sm' as const,
      variant: 'ghost' as const,
      menu: [
        ...versions.map(v => ({
          label:    `${v.id === id ? '• ' : ''}${v.description || 'Sem descrição'}${v.status === 'ACTIVE' ? ' (ativa)' : ''}`,
          onClick:  () => { if (v.id !== id) router.push(`/transit/crew-plan/${v.id}`) },
        })),
        ...(canEdit ? [
          { label: 'Nova escala', icon: Icons.Plus, onClick: () => void handleNewVersion() },
          { label: 'Duplicar',    icon: Icons.Copy, onClick: () => void handleDuplicate() },
        ] : []),
      ],
    }] : []),
    { label: '', separator: true },
    ...(zoomIdx > 0 ? [{ label: 'Menos zoom', icon: Icons.ZoomOut, size: 'icon' as const, variant: 'ghost' as const, onClick: () => setZoomIdx(i => Math.max(0, i - 1)) }] : []),
    ...(zoomIdx < ZOOMS.length - 1 ? [{ label: 'Mais zoom', icon: Icons.ZoomIn, size: 'icon' as const, variant: 'ghost' as const, onClick: () => setZoomIdx(i => Math.min(ZOOMS.length - 1, i + 1)) }] : []),
    ...(selectedDuty && canEdit ? [{
      label:    saving ? 'Salvando…' : 'Salvar',
      icon:     Icons.Save,
      type:     'submit' as const,
      form:     DUTY_FORM_ID,
      primary:  true,
      disabled: saving,
      keybind:  'Alt+G',
    }] : []),
    ...(canEdit ? [{
      label:    'Recalcular',
      icon:     Icons.RefreshCw,
      onClick:  () => void run(() => api(`/transit/crew-plan/${id}/recalculate`, { method: 'POST' })),
      disabled: saving,
      overflow: true,
    }] : []),
    ...(canEdit && data ? [{
      label:    data.plan.isCustomSettings ? 'Restaurar configuração padrão' : 'Personalizar configuração',
      icon:     Icons.Settings2,
      onClick:  () => void run(
        () => api(`/transit/crew-plan/${id}/settings${data.plan.isCustomSettings ? '' : '/customize'}`, { method: data.plan.isCustomSettings ? 'DELETE' : 'POST' }),
        data.plan.isCustomSettings ? 'Configuração padrão restaurada' : 'Configuração copiada para esta escala',
      ),
      disabled: saving,
      overflow: true,
    }] : []),
    ...(canEdit && data && !isActive ? [{
      label:    'Ativar',
      icon:     Icons.CheckCircle,
      onClick:  () => void handleActivate(),
      disabled: saving || data.vehiclePlan.status !== 'ACTIVE',
      overflow: true,
    }] : []),
    ...(canDelete && data && !isActive ? [{
      label:    'Excluir',
      icon:     Icons.Trash2,
      onClick:  () => void handleDeletePlan(),
      disabled: saving,
      variant:  'destructive' as const,
      overflow: true,
    }] : []),
  ], [data, id, saving, canEdit, canDelete, selectedDuty?.id, zoomIdx])

  useShortcut('alt+g', () => {
    (document.getElementById(DUTY_FORM_ID) as HTMLFormElement | null)?.requestSubmit()
  }, { desc: 'Salvar jornada', icon: Icons.Save, origin: ORIGIN, enabled: !!selectedDuty && canEdit })
  useShortcut('alt+v', () => router.push('/transit/vehicle-plan'), { desc: 'Voltar', icon: Icons.ArrowLeft, origin: ORIGIN })
  useShortcut('alt+l', () => setResetSignal(s => s + 1), { display: false, origin: ORIGIN })
  useShortcut('esc', () => {
    if (draftStart) setDraftStart(null)
    else if (selectedDutyId) setSelectedDutyId(null)
  }, { display: false, origin: ORIGIN, enabled: !assignDraft })

  // ── render ─────────────────────────────────────────────────────────────────

  if (guardNode) return guardNode

  const summary = data?.plan.summary

  return (
    <div className="flex flex-col h-full overflow-hidden">
      {assignDraft && data && (
        <AssignPieceModal
          block={assignDraft.block}
          start={assignDraft.start}
          end={assignDraft.end}
          duties={data.duties}
          defaultDutyId={selectedDutyId}
          localityName={localityName}
          saving={saving}
          onConfirm={(t) => void handleAssign(t)}
          onClose={() => setAssignDraft(null)}
        />
      )}

      <div className="px-6 pt-4 pb-2 shrink-0 space-y-1">
        <AutoBreadcrumb
          domain="transit" resource="crew-plan" id={id}
          recordName={data?.plan.description ?? undefined}
          contextParams={data ? { vehiclePlanId: data.vehiclePlan.id } : {}}
        />
        {data && (
          <div className="flex flex-wrap items-center gap-x-4 gap-y-1 text-sm text-muted-foreground">
            <span className="font-medium text-foreground">{data.plan.description || 'Escala'}</span>
            <span>{isActive ? 'Ativa' : 'Rascunho'}</span>
            <span>Planejamento: {data.vehiclePlan.description || data.vehiclePlan.dayTypeName}{data.vehiclePlan.status === 'ACTIVE' ? ' (ativo)' : ''}</span>
            {summary && summary.uncoveredMinutes > 0 && (
              <span className="text-red-600">{summary.uncovered.length} trecho(s) sem motorista</span>
            )}
            {summary && summary.staleDutyCount > 0 && (
              <span className="text-red-600">{summary.staleDutyCount} jornada(s) desatualizada(s)</span>
            )}
            {draftStart && <span className="text-amber-600">Selecione o ponto de fim da pegada (Esc cancela)</span>}
          </div>
        )}
      </div>

      <div className="flex flex-1 min-h-0 border-t overflow-hidden">
        <div className="flex-1 min-w-0">
          {data ? (
            data.blocks.length > 0 ? (
              <CrewBoard
                blocks={data.blocks}
                duties={data.duties}
                uncovered={summary?.uncovered ?? []}
                localityName={localityName}
                pxPerMinute={ZOOMS[zoomIdx]}
                selectedDutyId={selectedDutyId}
                draftStart={draftStart}
                canEdit={canEdit && !saving}
                onPointClick={handlePointClick}
                onPieceClick={(duty) => setSelectedDutyId(duty.id)}
              />
            ) : (
              <div className="flex items-center justify-center h-full text-muted-foreground text-sm">O planejamento não tem blocos</div>
            )
          ) : (
            <div className="flex items-center justify-center h-full text-muted-foreground text-sm">Carregando…</div>
          )}
        </div>

        {data && (selectedDuty ? (
          <DutyPanel
            duty={selectedDuty}
            blocks={data.blocks}
            operators={data.operators}
            localityName={localityName}
            canEdit={canEdit}
            resetSignal={resetSignal}
            onSave={(p) => void handleSaveDuty(p)}
            onDelete={() => void handleDeleteDuty()}
            onDeletePiece={(pid) => void handleDeletePiece(pid)}
            onAddActivity={handleAddActivity}
            onDeleteActivity={(aid) => void handleDeleteActivity(aid)}
            onClose={() => setSelectedDutyId(null)}
          />
        ) : (
          <PlanPanel
            data={data}
            canEdit={canEdit}
            onSelect={(d: BoardDuty) => setSelectedDutyId(d.id)}
            onCreate={(role) => void handleCreateDuty(role)}
          />
        ))}
      </div>
    </div>
  )
}
