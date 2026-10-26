'use client'

// Painel de Escala — "is my roster balanced?": the effective logical plans against the planned
// crew of one scope + empresa + role (GET /transit/console), and the crew adjustments that answer
// it. Context in the URL (empresa, funcao, escopo, secao); without one, the last one used.

import { useEffect, useRef, useState } from 'react'
import { useRouter, useSearchParams } from 'next/navigation'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import { CONSOLE_ACTION_LABEL, CREW_ROLE_LABEL, CREW_ROLES, CONSOLE_SECTIONS, type ConsoleSection, type ConsoleSnapshot, type CrewRole, type RebalanceRules } from '@nyx/schemas'
import { AutoBreadcrumb } from '@/core/AutoBreadcrumb'
import { usePageGuard } from '@/core/usePageGuard'
import { useTopbarActions } from '@/components/layout/topbar-actions-context'
import { useShortcut } from '@/lib/keywatch'
import { Icons } from '@/lib/icons'
import { apiFetch } from '@/lib/auth'
import { extractError } from '@/lib/utils'
import { useToast } from '@/lib/toast-context'
import {
  AlertsCard, CrewSection, DailySection, GroupsSection, KpiStrip, PlansSection, SectionNav, ShiftsSection, StaffingSection,
  type ConsoleCtx,
} from './sections'
import { AdjustModal, type ConsoleAction } from './AdjustModal'
import { AdjustmentsSection } from './adjustments'
import { RuleModal } from './RuleModal'

const ORIGIN   = 'apps/web/src/app/transit/console/page.tsx'
const LAST_KEY = 'nyx.console.context'

export default function ConsolePage() {
  const router       = useRouter()
  const searchParams = useSearchParams()
  const queryClient  = useQueryClient()
  const { toast }    = useToast()
  // update: Console update + CrewMember update (the metadata combines them) — apply adjustments, edit the rule
  const { guardNode, canUpdate } = usePageGuard('transit', 'console')
  const branchRef = useRef<HTMLSelectElement>(null)
  const [action, setAction]         = useState<ConsoleAction | null>(null)
  const [ruleOpen, setRuleOpen]     = useState(false)

  const branchId = searchParams.get('empresa') ?? ''
  const role     = (searchParams.get('funcao') ?? 'DRIVER') as CrewRole
  const scopeId  = searchParams.get('escopo') ?? ''
  const section  = (CONSOLE_SECTIONS as readonly string[]).includes(searchParams.get('secao') ?? '') ? searchParams.get('secao') as ConsoleSection : 'staffing'
  const setCtx = (patch: Record<string, string>) => {
    const next = Object.fromEntries(Object.entries({ empresa: branchId, funcao: role, escopo: scopeId, secao: section, ...patch }).filter(([, v]) => v))
    try { localStorage.setItem(LAST_KEY, JSON.stringify({ empresa: next.empresa, funcao: next.funcao })) } catch { /* private mode */ }
    router.replace(`/transit/console?${new URLSearchParams(next)}`)
  }

  const { data: branches = [] } = useQuery<{ id: string; name: string }[]>({
    queryKey: ['core', 'branch', 'all'],
    queryFn:  async () => {
      const res = await apiFetch('/core/branch?pageSize=999')
      if (!res.ok) throw new Error()
      const json = await res.json()
      return json.data ?? json
    },
  })
  // no empresa in the URL: the last context used, else the first empresa
  useEffect(() => {
    if (branchId || !branches.length) return
    let last: Record<string, string> = {}
    try { last = JSON.parse(localStorage.getItem(LAST_KEY) ?? '{}') } catch { /* private mode */ }
    setCtx({ empresa: branches.some(b => b.id === last.empresa) ? last.empresa : branches[0].id, ...(last.funcao ? { funcao: last.funcao } : {}) })
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [branchId, branches])

  const { data: snapshot, isFetching, error, refetch } = useQuery<ConsoleSnapshot>({
    queryKey: ['transit', 'console', branchId, role, scopeId],
    queryFn:  async () => {
      const res = await apiFetch(`/transit/console?${new URLSearchParams({ branchId, role, ...(scopeId ? { scopeId } : {}) })}`)
      const json = await res.json().catch(() => ({}))
      if (!res.ok) throw new Error(extractError(json))
      return json
    },
    enabled: !!branchId,
  })

  const { data: rule = null } = useQuery<RebalanceRules>({
    queryKey: ['transit', 'console', 'rule', branchId],
    queryFn:  async () => {
      const res = await apiFetch(`/transit/console/rule?branchId=${branchId}`)
      const json = await res.json().catch(() => ({}))
      if (!res.ok) throw new Error(extractError(json))
      return json
    },
    enabled: !!branchId,
  })

  const ctx: ConsoleCtx = { branchId, role, onSection: s => setCtx({ secao: s }) }
  const back = () => router.push('/transit')
  useTopbarActions([
    { label: isFetching ? 'Atualizando…' : 'Atualizar', icon: Icons.RefreshCw, onClick: () => void refetch(), disabled: isFetching || !branchId, variant: 'ghost' as const },
    { label: 'Regra de seleção', icon: Icons.SlidersHorizontal, onClick: () => setRuleOpen(true), disabled: !rule, variant: 'ghost' as const },
  ], [isFetching, branchId, rule])
  useShortcut('alt+v', back, { desc: 'Voltar', icon: Icons.ArrowLeft, origin: ORIGIN, context: 'all' })
  useShortcut('ctrl+shift+g', () => branchRef.current?.focus(), { desc: 'Empresa', icon: Icons.Building2, origin: ORIGIN })

  if (guardNode) return guardNode
  const ctl = 'h-8 border border-input rounded-sm text-sm bg-input-bg px-2'

  return (
    <div className="p-6 space-y-4">
      <AutoBreadcrumb domain="transit" resource="console" />

      <div className="flex flex-wrap items-center gap-2">
        <select ref={branchRef} value={branchId} onChange={e => setCtx({ empresa: e.target.value, escopo: '' })} className={ctl} aria-label="Empresa">
          {branches.map(b => <option key={b.id} value={b.id}>{b.name}</option>)}
        </select>
        {snapshot && snapshot.scopes.length > 1 && (
          <select value={snapshot.scopeId} onChange={e => setCtx({ escopo: e.target.value })} className={ctl} aria-label="Escopo">
            {snapshot.scopes.map(s => <option key={s.id} value={s.id}>{s.name}</option>)}
          </select>
        )}
        <select value={role} onChange={e => setCtx({ funcao: e.target.value })} className={ctl} aria-label="Função">
          {CREW_ROLES.map(r => <option key={r} value={r}>{CREW_ROLE_LABEL[r]}</option>)}
        </select>
      </div>

      {error && <p className="flex gap-2 text-sm text-destructive"><Icons.AlertCircle className="w-4 h-4 shrink-0 mt-0.5" />{error instanceof Error ? error.message : 'Erro ao carregar'}</p>}
      {!snapshot && !error && <p className="text-sm text-muted-foreground">{branchId ? 'Calculando…' : 'Carregando…'}</p>}

      {snapshot && (
        <>
          <KpiStrip snapshot={snapshot} />
          <AlertsCard alerts={snapshot.alerts} ctx={ctx} />

          <div className="grid md:grid-cols-[15rem_minmax(0,1fr)] gap-4 items-start">
            <SectionNav value={section} status={snapshot.status} onChange={s => setCtx({ secao: s })} />
            <div>
              {section === 'plans'    && <PlansSection snapshot={snapshot} />}
              {section === 'staffing' && <StaffingSection snapshot={snapshot} onSuggest={() => setAction({ kind: 'shifts' })} />}
              {section === 'shifts'   && <ShiftsSection key={snapshot.scopeId} snapshot={snapshot} />}
              {section === 'groups'   && <GroupsSection key={snapshot.scopeId} snapshot={snapshot} onSuggest={shiftId => setAction({ kind: 'groups', shiftId })} />}
              {section === 'crew'     && <CrewSection snapshot={snapshot} ctx={ctx} onAction={setAction} />}
              {section === 'daily'    && <DailySection snapshot={snapshot} ctx={ctx} />}
              {section === 'adjust'   && <AdjustmentsSection snapshot={snapshot} />}
            </div>
          </div>
        </>
      )}

      {/* the rule modal replaces the adjust one while open — it comes back with the new rule's suggestion */}
      {snapshot && action && !ruleOpen && (
        <AdjustModal
          action={action}
          snapshot={snapshot}
          rule={rule}
          canApply={canUpdate}
          onEditRule={() => setRuleOpen(true)}
          onClose={() => setAction(null)}
          onApplied={a => {
            setAction(null)
            toast.success(`${CONSOLE_ACTION_LABEL[action.kind]}: ${a.items.length} operador(es) ajustado(s) — veja em Ajustes`)
            void queryClient.invalidateQueries({ queryKey: ['transit', 'console'] })
          }}
        />
      )}
      {ruleOpen && rule && (
        <RuleModal
          branchId={branchId}
          rule={rule}
          groups={action ? action.kind === 'groups' : section === 'groups'}
          canEdit={canUpdate}
          onClose={() => setRuleOpen(false)}
          onSaved={r => {
            queryClient.setQueryData(['transit', 'console', 'rule', branchId], r)
            setRuleOpen(false)
            toast.success('Regra de seleção gravada')
          }}
        />
      )}
    </div>
  )
}
