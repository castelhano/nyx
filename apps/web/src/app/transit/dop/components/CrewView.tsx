'use client'

// DOP — visão Escala. Consumes GET /transit/dop/crew;
// every *ByRole map is filtered/summed here by the role selector (motorista by default).

import { useMemo, useState } from 'react'
import { useQuery } from '@tanstack/react-query'
import {
  CREW_ROLES, type CrewRole,
  type DopCrewPeriodSummary, type DopCrewMetrics, type DopCrewRoleQuality, type DopCrewCost,
} from '@nyx/schemas'
import { Icons } from '@/lib/icons'
import { Select } from '@/components/ui/select'
import { Button } from '@/components/ui/button'
import { apiFetch } from '@/lib/auth'
import { httpError, httpRetry } from '@/lib/query'
import { downloadCsvRows } from '@/lib/csv'
import { cn } from '@/lib/utils'
import { ROLE_LABEL, KIND_LABEL } from '../../crew-plan/[id]/board.types'
import { fmtPct, fmtDateBr, StatTile, HEADER_GROUP_BG, HEADER_SUBGROUP_BG, GROUP_DIVIDER } from './dop-ui'

type RoleFilter = CrewRole | 'ALL'

const KINDS = ['STRAIGHT', 'SPLIT', 'TRIPPER', 'STANDBY'] as const

// ── formatting ───────────────────────────────────────────────────────────────

const fmtHours = (min: number) => `${Math.round(min / 60).toLocaleString('pt-BR')} h`
const fmtNum   = (v: number, digits = 1) => v.toLocaleString('pt-BR', { maximumFractionDigits: digits })
const fmtMoney = (v: number) => v.toLocaleString('pt-BR', { style: 'currency', currency: 'BRL', maximumFractionDigits: 0 })
function fmtHm(min: number): string {
  const m = Math.round(min)
  return `${Math.floor(m / 60)}h${String(m % 60).padStart(2, '0')}`
}

// ── role aggregation ─────────────────────────────────────────────────────────

function rolesOf(f: RoleFilter): readonly CrewRole[] {
  return f === 'ALL' ? CREW_ROLES : [f]
}

function sumMetrics(byRole: Record<string, DopCrewMetrics> | undefined, roles: readonly CrewRole[]): DopCrewMetrics {
  const out: DopCrewMetrics = { dutyShare: 0, workMinutes: 0, paidMinutes: 0, overtimeMinutes: 0, nightMinutes: 0, cost: 0 }
  for (const r of roles) {
    const m = byRole?.[r]
    if (!m) continue
    out.dutyShare += m.dutyShare; out.workMinutes += m.workMinutes; out.paidMinutes += m.paidMinutes
    out.overtimeMinutes += m.overtimeMinutes; out.nightMinutes += m.nightMinutes; out.cost += m.cost
  }
  return out
}

function sumCost(costs: Record<string, DopCrewCost>, roles: readonly CrewRole[]): DopCrewCost {
  const out: DopCrewCost = { fixed: 0, overtime: 0, night: 0, charges: 0, benefits: 0, total: 0 }
  for (const r of roles) {
    const c = costs[r]
    if (!c) continue
    out.fixed += c.fixed; out.overtime += c.overtime; out.night += c.night
    out.charges += c.charges; out.benefits += c.benefits; out.total += c.total
  }
  return out
}

// counts add up; averages are weighted by each role's duty count
function sumQuality(byRole: Record<string, DopCrewRoleQuality>, roles: readonly CrewRole[]): DopCrewRoleQuality {
  const qs = roles.map(r => byRole[r]).filter(Boolean)
  const n  = qs.reduce((s, q) => s + q.dutyCount, 0)
  const avg = (f: (q: DopCrewRoleQuality) => number) => (n ? qs.reduce((s, q) => s + f(q) * q.dutyCount, 0) / n : 0)
  const byKind: Record<string, number> = {}
  for (const q of qs) for (const [k, v] of Object.entries(q.byKind)) byKind[k] = (byKind[k] ?? 0) + v
  return {
    dutyCount:            n,
    byKind,
    issueDutyCount:       qs.reduce((s, q) => s + q.issueDutyCount, 0),
    staleDutyCount:       qs.reduce((s, q) => s + q.staleDutyCount, 0),
    interShiftBelowFloor: qs.reduce((s, q) => s + q.interShiftBelowFloor, 0),
    interShiftBelowIdeal: qs.reduce((s, q) => s + q.interShiftBelowIdeal, 0),
    avgSpreadMinutes:     avg(q => q.avgSpreadMinutes),
    avgWorkMinutes:       avg(q => q.avgWorkMinutes),
    avgBreakMinutes:      avg(q => q.avgBreakMinutes),
    avgVehicleChanges:    avg(q => q.avgVehicleChanges),
    avgLineChanges:       avg(q => q.avgLineChanges),
    multiLineCount:       qs.reduce((s, q) => s + q.multiLineCount, 0),
  }
}

// ── data ─────────────────────────────────────────────────────────────────────

function useDopCrew(scopeId: string, branchId: string, from: string, to: string) {
  return useQuery<DopCrewPeriodSummary>({
    queryKey: ['transit', 'dop', 'crew', scopeId, branchId, from, to],
    queryFn: async () => {
      const res = await apiFetch(`/transit/dop/crew?scopeId=${scopeId}&branchId=${branchId}&from=${from}&to=${to}`)
      if (!res.ok) throw httpError(res.status)
      return res.json()
    },
    enabled: !!scopeId && !!from && !!to,
    retry:   httpRetry,
  })
}

type Tab = 'jornadas' | 'horas' | 'custos'
const TABS: { key: Tab; label: string }[] = [
  { key: 'jornadas', label: 'Quadro' },
  { key: 'horas',    label: 'Horas' },
  { key: 'custos',   label: 'Custos' },
]

const th  = 'text-right font-medium px-2 py-1.5 whitespace-nowrap'
const td  = 'px-2 py-1.5 text-right'

// ── view ─────────────────────────────────────────────────────────────────────

export function CrewView({ scopeId, branchId, from, to }: { scopeId: string; branchId: string; from: string; to: string }) {
  const { data, isLoading, isError } = useDopCrew(scopeId, branchId, from, to)
  const [role, setRole] = useState<RoleFilter>('DRIVER')
  const [tab, setTab]   = useState<Tab>('jornadas')
  const roles = useMemo(() => rolesOf(role), [role])

  const dayTypes = useMemo(() => data?.calendar ?? [], [data])

  // per DayType: duties on one day (snapshot) and hours summed over the days of that type
  const byDayType = useMemo(() => {
    if (!data) return []
    return dayTypes.map(dt => {
      const m = data.lines.reduce((acc, l) => {
        const x = sumMetrics(l.byDayType.find(b => b.dayTypeId === dt.dayTypeId)?.byRole, roles)
        acc.dutyShare += x.dutyShare; acc.paidMinutes += x.paidMinutes
        acc.overtimeMinutes += x.overtimeMinutes; acc.nightMinutes += x.nightMinutes
        return acc
      }, { dutyShare: 0, paidMinutes: 0, overtimeMinutes: 0, nightMinutes: 0 })
      return { ...dt, ...m }
    })
  }, [data, dayTypes, roles])

  const total = useMemo(() => {
    const t = { dutyShare: 0, workMinutes: 0, paidMinutes: 0, overtimeMinutes: 0, nightMinutes: 0, cost: 0 }
    for (const l of data?.lines ?? []) {
      const m = sumMetrics(l.byRole, roles)
      t.dutyShare += m.dutyShare; t.paidMinutes += m.paidMinutes; t.overtimeMinutes += m.overtimeMinutes
      t.nightMinutes += m.nightMinutes; t.cost += m.cost
    }
    return t
  }, [data, roles])

  if (isLoading) return <div className="text-sm text-muted-foreground">Carregando…</div>
  if (isError)   return <div className="text-sm text-destructive">Erro ao carregar os dados de escala do período.</div>
  if (!data)     return null

  const refDuties = byDayType.find(dt => dt.dayTypeId === data.referenceDayTypeId)?.dutyShare ?? 0
  const staff     = roles.reduce((acc, r) => {
    const s = data.staffing[r]
    return s ? { estimate: acc.estimate + s.estimate, weekday: acc.weekday + s.weekday, saturday: acc.saturday + s.saturday, sunday: acc.sunday + s.sunday } : acc
  }, { estimate: 0, weekday: 0, saturday: 0, sunday: 0 })
  const driverStaff = data.staffing.DRIVER?.estimate ?? 0
  const driverPaid  = data.lines.reduce((s, l) => s + (l.byRole.DRIVER?.paidMinutes ?? 0), 0)
  const cost        = sumCost(data.costs, roles)
  const dtName      = new Map(dayTypes.map(dt => [dt.dayTypeId, dt.dayTypeName]))
  const noCrewTotal = data.noCrewDays.reduce((s, d) => s + d.days, 0)

  function exportCsv() {
    const headers = [
      'Código', 'Linha',
      ...dayTypes.map(dt => `Jornadas ${dt.dayTypeCode}`), 'Jornadas-dia Mês',
      ...dayTypes.flatMap(dt => [`Horas Oper. ${dt.dayTypeCode}`, `Horas Extra ${dt.dayTypeCode}`, `Horas Not. ${dt.dayTypeCode}`]),
      'Horas Oper. Mês', 'Horas Extra Mês', 'Horas Not. Mês', 'Custo Mês',
    ]
    const h = (min: number) => (min / 60).toFixed(1)
    const rows = data!.lines.map(l => {
      const bd = new Map(l.byDayType.map(b => [b.dayTypeId, sumMetrics(b.byRole, roles)]))
      const m  = sumMetrics(l.byRole, roles)
      return [
        l.lineCode, l.lineName,
        ...dayTypes.map(dt => (bd.get(dt.dayTypeId)?.dutyShare ?? 0).toFixed(2)), m.dutyShare.toFixed(1),
        ...dayTypes.flatMap(dt => {
          const x = bd.get(dt.dayTypeId)
          return [h(x?.paidMinutes ?? 0), h(x?.overtimeMinutes ?? 0), h(x?.nightMinutes ?? 0)]
        }),
        h(m.paidMinutes), h(m.overtimeMinutes), h(m.nightMinutes), m.cost.toFixed(2),
      ]
    })
    const roleTag = role === 'ALL' ? 'todos' : ROLE_LABEL[role].toLowerCase()
    downloadCsvRows(headers, rows, `dop-escala_${roleTag}_${data!.from}_${data!.to}`)
  }

  return (
    <>
      {/* ── composição do período + papel ── */}
      <div className="rounded-md border border-border bg-card px-4 py-2.5 flex flex-wrap items-center gap-5 text-xs">
        <span className="flex items-center gap-1.5 font-medium">
          <Icons.CalendarDays className="w-3.5 h-3.5 text-muted-foreground" />
          {fmtDateBr(data.from)} – {fmtDateBr(data.to)}
        </span>
        <span className="text-muted-foreground">·</span>
        {dayTypes.map(dt => (
          <span key={dt.dayTypeId}><span className="font-medium">{dt.days}</span> <span className="text-muted-foreground">{dt.dayTypeName.toLowerCase()}</span></span>
        ))}
        {noCrewTotal > 0 && (
          <span
            className="flex items-center gap-1.5 rounded-sm px-2 py-0.5 bg-amber-500/15 text-amber-700 dark:text-amber-400"
            title={data.noCrewDays.map(d => `${dtName.get(d.dayTypeId) ?? d.dayTypeId}: ${d.days}`).join(' · ')}
          >
            <Icons.AlertTriangle className="w-3.5 h-3.5" />
            {noCrewTotal} dia(s) com planejamento ativo sem escala ativa
          </span>
        )}
        <span className="ms-auto flex items-center gap-2">
          <span className="text-muted-foreground">Papel</span>
          <Select size="sm" className="h-[26px] w-36 py-0 text-xs" value={role} onChange={e => setRole(e.target.value as RoleFilter)}>
            {CREW_ROLES.map(r => <option key={r} value={r}>{ROLE_LABEL[r]}</option>)}
            <option value="ALL">Todos</option>
          </Select>
        </span>
      </div>

      {/* ── KPIs ── */}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
        <StatTile icon={Icons.Users} label="Jornadas/dia útil" value={fmtNum(refDuties)} sub={`${fmtNum(total.dutyShare, 0)} jornadas-dia no período`} />
        <StatTile
          icon={Icons.UserRound} label="Quadro estimado" value={staff.estimate.toLocaleString('pt-BR')}
          sub={`maior entre útil (${staff.weekday}) e sáb+dom (${staff.saturday}+${staff.sunday}) — estimativa`}
        />
        <StatTile icon={Icons.Clock} label="Horas operacionais" value={fmtHours(total.paidMinutes)} />
        <StatTile
          icon={Icons.Timer} label="Horas extras" value={`${fmtHours(total.overtimeMinutes)} · ${fmtMoney(cost.overtime)}`}
          sub={`${fmtPct(total.paidMinutes > 0 ? total.overtimeMinutes / total.paidMinutes : 0, 1)} das operacionais · custo sem encargos`}
        />
        <StatTile
          icon={Icons.Moon} label="Horas noturnas" value={`${fmtHours(total.nightMinutes)} · ${fmtMoney(cost.night)}`}
          sub="adicional noturno (20%), sem encargos"
        />
        <StatTile
          icon={Icons.Bus} label="Relação condutor/veículo"
          value={data.referenceFleet > 0 ? fmtNum(driverStaff / data.referenceFleet, 2) : '—'}
          sub={`quadro motorista (${driverStaff}) ÷ frota dia útil (${data.referenceFleet})`}
        />
        <StatTile
          icon={Icons.Gauge} label="Aproveitamento"
          value={driverPaid > 0 ? fmtPct(data.coveredMinutes / driverPaid, 1) : '—'}
          sub="horas de veículo em serviço ÷ horas operacionais (motorista)"
        />
        <StatTile
          icon={Icons.Banknote} label="Custo total estimado" value={fmtMoney(cost.total)}
          sub="custos fixos, horas extras, encargos e benefícios"
        />
      </div>

      {/* ── horas por tipo de dia + por empresa ── */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
        <Panel title="Horas por tipo de dia" sub="Jornadas em um dia do tipo; horas somadas nos dias do período">
          <table className="w-full text-xs tabular-nums">
            <thead>
              <tr className="border-b border-border text-[11px] text-muted-foreground">
                <th className="text-left font-medium px-2 py-1.5">Tipo de dia</th>
                <th className={th}>Jornadas</th><th className={th}>Operac.</th><th className={th}>Extra</th><th className={th}>Noturno</th>
              </tr>
            </thead>
            <tbody>
              {byDayType.map(dt => (
                <tr key={dt.dayTypeId} className="border-b border-border">
                  <td className="px-2 py-1.5">{dt.dayTypeName} <span className="text-muted-foreground">({dt.days}x)</span></td>
                  <td className={td}>{fmtNum(dt.dutyShare)}</td>
                  <td className={td}>{fmtHours(dt.paidMinutes)}</td>
                  <td className={td}>{fmtHours(dt.overtimeMinutes)}</td>
                  <td className={td}>{fmtHours(dt.nightMinutes)}</td>
                </tr>
              ))}
              <tr className="bg-accent/40 font-medium">
                <td className="px-2 py-1.5">Mês</td>
                <td className={td}>{fmtNum(total.dutyShare, 0)} <span className="text-muted-foreground font-normal">jorn.-dia</span></td>
                <td className={td}>{fmtHours(total.paidMinutes)}</td>
                <td className={td}>{fmtHours(total.overtimeMinutes)}</td>
                <td className={td}>{fmtHours(total.nightMinutes)}</td>
              </tr>
            </tbody>
          </table>
        </Panel>

        <Panel title="Horas por empresa" sub="Pela empresa da jornada, consolidado do período">
          {data.byBranch.length === 0 && <p className="text-xs text-muted-foreground">Sem dados de empresa para o período.</p>}
          {data.byBranch.length > 0 && (
            <table className="w-full text-xs tabular-nums">
              <thead>
                <tr className="border-b border-border text-[11px] text-muted-foreground">
                  <th className="text-left font-medium px-2 py-1.5">Empresa</th>
                  <th className={th}>Jorn.-dia</th><th className={th}>Operac.</th><th className={th}>Extra</th><th className={th}>Noturno</th><th className={th}>Custo</th>
                </tr>
              </thead>
              <tbody>
                {data.byBranch.map(b => {
                  const m = sumMetrics(b.byRole, roles)
                  return (
                    <tr key={b.branchId ?? 'none'} className="border-b border-border last:border-0">
                      <td className="px-2 py-1.5">{b.branchName}</td>
                      <td className={td}>{fmtNum(m.dutyShare, 0)}</td>
                      <td className={td}>{fmtHours(m.paidMinutes)}</td>
                      <td className={td}>{fmtHours(m.overtimeMinutes)}</td>
                      <td className={td}>{fmtHours(m.nightMinutes)}</td>
                      <td className={td}>{fmtMoney(m.cost)}</td>
                    </tr>
                  )
                })}
              </tbody>
            </table>
          )}
        </Panel>
      </div>

      {/* ── composição + custo ── */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
        <Panel title="Jornadas por tipo" sub="Escala em vigor no último dia de cada tipo de dia">
          <table className="w-full text-xs tabular-nums">
            <thead>
              <tr className="border-b border-border text-[11px] text-muted-foreground">
                <th className="text-left font-medium px-2 py-1.5">Tipo de dia</th>
                {KINDS.map(k => <th key={k} className={th}>{KIND_LABEL[k]}</th>)}
                <th className={th}>Total</th>
              </tr>
            </thead>
            <tbody>
              {data.quality.map(q => {
                const s = sumQuality(q.byRole, roles)
                return (
                  <tr key={q.dayTypeId} className="border-b border-border last:border-0">
                    <td className="px-2 py-1.5">{dtName.get(q.dayTypeId) ?? '—'}</td>
                    {KINDS.map(k => {
                      const n = s.byKind[k] ?? 0
                      return <td key={k} className={td}>{n}<span className="text-muted-foreground ms-1">{s.dutyCount ? fmtPct(n / s.dutyCount) : ''}</span></td>
                    })}
                    <td className={cn(td, 'font-medium')}>{s.dutyCount}</td>
                  </tr>
                )
              })}
            </tbody>
          </table>
        </Panel>

        <Panel title="Custo por componente" sub="Parâmetros atuais do escopo (Configurações › Custos de Pessoal)">
          <div className="space-y-1.5 text-xs tabular-nums">
            {([
              ['Salário (quadro estimado)', cost.fixed],
              ['Horas extras (+50%)',       cost.overtime],
              ['Adicional noturno (20%)',   cost.night],
              ['Encargos',                  cost.charges],
              ['Benefícios',                cost.benefits],
            ] as const).map(([label, v]) => (
              <div key={label} className="flex items-center gap-3">
                <span className="w-44 shrink-0">{label}</span>
                <div className="flex-1 h-2 rounded-sm bg-muted overflow-hidden">
                  <div className="h-full bg-sky-500 dark:bg-sky-600" style={{ width: `${cost.total > 0 ? (v / cost.total) * 100 : 0}%` }} />
                </div>
                <span className="w-28 text-right">{fmtMoney(v)}</span>
              </div>
            ))}
            <div className="flex items-center justify-between border-t border-border pt-1.5 font-medium">
              <span>Total</span><span>{fmtMoney(cost.total)}</span>
            </div>
            {cost.total === 0 && <p className="text-muted-foreground">Sem parâmetros de custo para este escopo.</p>}
          </div>
        </Panel>
      </div>

      {/* ── qualidade ── */}
      <Panel title="Qualidade da escala" sub="Escala em vigor no último dia de cada tipo de dia; interjornada estimada (mesma jornada no dia seguinte)">
        <div className="overflow-auto">
          <table className="w-full text-xs tabular-nums">
            <thead>
              <tr className="border-b border-border text-[11px] text-muted-foreground">
                <th className="text-left font-medium px-2 py-1.5">Tipo de dia</th>
                <th className={th}>Score</th><th className={th}>Pendências</th><th className={th}>Desatualizadas</th>
                <th className={th}>Interj. &lt; mín.</th><th className={th}>Interj. &lt; ideal</th>
                <th className={th}>Amplitude</th><th className={th}>Trabalhado</th><th className={th}>Intervalo</th>
                <th className={th}>Trocas carro · linha · multi-linha</th>
              </tr>
            </thead>
            <tbody>
              {data.quality.map(q => {
                const s = sumQuality(q.byRole, roles)
                return (
                  <tr key={q.dayTypeId} className="border-b border-border last:border-0">
                    <td className="px-2 py-1.5">{dtName.get(q.dayTypeId) ?? '—'}</td>
                    <td className={td}>{q.score?.toLocaleString('pt-BR') ?? '—'}</td>
                    <td className={cn(td, s.issueDutyCount > 0 && 'text-amber-600 dark:text-amber-400')}>{s.issueDutyCount}</td>
                    <td className={cn(td, s.staleDutyCount > 0 && 'text-red-600 dark:text-red-400')}>{s.staleDutyCount}</td>
                    <td className={cn(td, s.interShiftBelowFloor > 0 && 'text-red-600 dark:text-red-400')}>{s.interShiftBelowFloor}</td>
                    <td className={cn(td, s.interShiftBelowIdeal > 0 && 'text-amber-600 dark:text-amber-400')}>{s.interShiftBelowIdeal}</td>
                    <td className={td}>{fmtHm(s.avgSpreadMinutes)}</td>
                    <td className={td}>{fmtHm(s.avgWorkMinutes)}</td>
                    <td className={td}>{fmtHm(s.avgBreakMinutes)}</td>
                    <td className={td}>
                      {fmtNum(s.avgVehicleChanges, 2)} · {fmtNum(s.avgLineChanges, 2)} · {s.dutyCount ? fmtPct(s.multiLineCount / s.dutyCount) : '—'}
                    </td>
                  </tr>
                )
              })}
              {data.quality.length === 0 && (
                <tr><td colSpan={10} className="px-2 py-3 text-muted-foreground">Nenhuma escala ativa no período.</td></tr>
              )}
            </tbody>
          </table>
        </div>
      </Panel>

      {/* ── tabela por linha ── */}
      <div className="rounded-md border border-border bg-card overflow-hidden">
        <div className="flex items-center justify-between px-4 py-2.5 border-b border-border">
          <div className="inline-flex rounded-sm border border-border p-0.5 bg-background/50">
            {TABS.map(t => (
              <button
                key={t.key}
                onClick={() => setTab(t.key)}
                className={cn(
                  'px-3 py-1 text-xs rounded-sm transition-colors',
                  tab === t.key ? 'bg-accent text-accent-foreground font-medium' : 'text-muted-foreground hover:text-foreground',
                )}
              >
                {t.label}
              </button>
            ))}
          </div>
          <Button size="sm" variant="outline" onClick={exportCsv}>
            <Icons.Download className="w-3.5 h-3.5" />CSV
          </Button>
        </div>

        <div className="overflow-auto max-h-[480px]">
          <table className="w-full text-xs tabular-nums border-separate border-spacing-0">
            {/* border-separate: with collapsed borders a sticky header leaves a seam — borders go on the cells */}
            <thead className="sticky top-0 bg-card z-10">
              {tab === 'jornadas' && (
                <tr className="[&>*]:border-b [&>*]:border-border text-[11px] text-muted-foreground">
                  <th className="text-left font-medium px-3 py-1.5">Linha</th>
                  {dayTypes.map(dt => <th key={dt.dayTypeId} className={th}>{dt.dayTypeName}</th>)}
                  <th className={cn(th, GROUP_DIVIDER)}>Quadro-dia (mês)</th>
                </tr>
              )}
              {tab === 'horas' && (
                <>
                  <tr className="text-[11px] text-muted-foreground">
                    <th rowSpan={2} className="text-left font-medium px-3 py-1.5 align-bottom border-b border-border">Linha</th>
                    {dayTypes.map((dt, i) => (
                      <th key={dt.dayTypeId} colSpan={3} className={cn('text-center font-medium px-2 py-1 border-b border-border', HEADER_GROUP_BG, i > 0 && GROUP_DIVIDER)}>{dt.dayTypeName}</th>
                    ))}
                    <th colSpan={3} className={cn('text-center font-medium px-2 py-1 border-b border-border', HEADER_GROUP_BG, GROUP_DIVIDER)}>Mês</th>
                  </tr>
                  <tr className={cn('text-[11px] text-muted-foreground [&>*]:border-b [&>*]:border-border', HEADER_SUBGROUP_BG)}>
                    {[...dayTypes.map(dt => dt.dayTypeId), 'month'].map((k, i) => (
                      <HoursHeader key={k} divider={i > 0} />
                    ))}
                  </tr>
                </>
              )}
              {tab === 'custos' && (
                <tr className="[&>*]:border-b [&>*]:border-border text-[11px] text-muted-foreground">
                  <th className="text-left font-medium px-3 py-1.5">Linha</th>
                  <th className={th}>Horas operacionais</th><th className={th}>Custo</th><th className={th}>R$/h operacional</th><th className={th}>% do custo</th>
                </tr>
              )}
            </thead>
            <tbody>
              {data.lines.map((l, i) => {
                const bd = new Map(l.byDayType.map(b => [b.dayTypeId, sumMetrics(b.byRole, roles)]))
                const m  = sumMetrics(l.byRole, roles)
                return (
                  <tr key={l.lineId ?? 'none'} className={cn('[&>*]:border-b [&>*]:border-border [&:last-child>*]:border-b-0 hover:bg-row-hover', i % 2 === 1 && 'bg-muted/40', l.lineId === null && 'italic')}>
                    <td className="px-3 py-2">
                      <div className="font-medium">{l.lineCode}</div>
                      <div className="text-[11px] text-muted-foreground">{l.lineName}</div>
                    </td>
                    {tab === 'jornadas' && (<>
                      {dayTypes.map(dt => <td key={dt.dayTypeId} className={td}>{bd.get(dt.dayTypeId) ? fmtNum(bd.get(dt.dayTypeId)!.dutyShare, 0) : '—'}</td>)}
                      <td className={cn(td, GROUP_DIVIDER, 'font-medium')}>{fmtNum(m.dutyShare, 0)}</td>
                    </>)}
                    {tab === 'horas' && (<>
                      {dayTypes.map((dt, di) => <HoursCells key={dt.dayTypeId} m={bd.get(dt.dayTypeId)} divider={di > 0} />)}
                      <HoursCells m={m} divider />
                    </>)}
                    {tab === 'custos' && (<>
                      <td className={td}>{fmtHours(m.paidMinutes)}</td>
                      <td className={td}>{fmtMoney(m.cost)}</td>
                      <td className={td}>{m.paidMinutes > 0 ? fmtMoney(m.cost / (m.paidMinutes / 60)) : '—'}</td>
                      <td className={cn(td, 'text-muted-foreground')}>{total.cost > 0 ? fmtPct(m.cost / total.cost, 1) : '—'}</td>
                    </>)}
                  </tr>
                )
              })}
            </tbody>
            <tfoot className="sticky bottom-0 bg-muted z-10">
              <tr className="[&>*]:border-t [&>*]:border-border font-medium">
                <td className="px-3 py-2">Total</td>
                {tab === 'jornadas' && (<>
                  {byDayType.map(dt => <td key={dt.dayTypeId} className={td}>{fmtNum(dt.dutyShare, 0)}</td>)}
                  <td className={cn(td, GROUP_DIVIDER)}>{fmtNum(total.dutyShare, 0)}</td>
                </>)}
                {tab === 'horas' && (<>
                  {byDayType.map((dt, di) => <HoursCells key={dt.dayTypeId} m={dt} divider={di > 0} />)}
                  <HoursCells m={total} divider />
                </>)}
                {tab === 'custos' && (<>
                  <td className={td}>{fmtHours(total.paidMinutes)}</td>
                  <td className={td}>{fmtMoney(total.cost)}</td>
                  <td className={td}>{total.paidMinutes > 0 ? fmtMoney(total.cost / (total.paidMinutes / 60)) : '—'}</td>
                  <td className={td}>{total.cost > 0 ? '100%' : '—'}</td>
                </>)}
              </tr>
            </tfoot>
          </table>
        </div>
      </div>
    </>
  )
}

function Panel({ title, sub, children }: { title: string; sub?: string; children: React.ReactNode }) {
  return (
    <div className="rounded-md border border-border bg-card p-4">
      <div className="mb-3">
        <h2 className="text-sm font-semibold">{title}</h2>
        {sub && <p className="text-[11px] text-muted-foreground">{sub}</p>}
      </div>
      {children}
    </div>
  )
}

function HoursHeader({ divider }: { divider?: boolean }) {
  return (
    <>
      <th className={cn(th, divider && GROUP_DIVIDER)}>Operac.</th>
      <th className={th}>Extra</th>
      <th className={th}>Not.</th>
    </>
  )
}

function HoursCells({ m, divider }: { m: { paidMinutes: number; overtimeMinutes: number; nightMinutes: number } | undefined; divider?: boolean }) {
  return (
    <>
      <td className={cn(td, divider && GROUP_DIVIDER)}>{m ? fmtHours(m.paidMinutes) : '—'}</td>
      <td className={td}>{m ? fmtHours(m.overtimeMinutes) : '—'}</td>
      <td className={td}>{m ? fmtHours(m.nightMinutes) : '—'}</td>
    </>
  )
}
