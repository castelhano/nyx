'use client'

import { useQuery } from '@tanstack/react-query'
import { LINE_ACCESS_MODE_LABEL, ROSTER_RULE_LABEL, ROSTER_RULE_MODE_LABEL, type RangeCriterion, type RosterReserveTarget, type RosterSettings } from '@nyx/schemas'
import { Button } from '@/components/ui/button'
import { ClockInput } from '@/components/ui/clock-input'
import { Select } from '@/components/ui/select'
import { apiFetch } from '@/lib/auth'
import { Icons } from '@/lib/icons'
import { SectionHeader, DiffDot, NumberInput, RangeTable, DURATION_UNIT } from './criteria-tables'

const ROSTER_RANGE_META: Record<keyof RosterSettings['range'], { label: string; unit: string; hint: string }> = {
  driverPrefLine: { label: 'Linhas Preferenciais',  unit: '%',          hint: 'Minutos de viagem nas linhas preferenciais do operador, ponderados pelo peso de cada uma.' },
  shiftFit:       { label: 'Ajuste ao Turno',       unit: DURATION_UNIT, hint: 'Média por jornada de quanto o início/fim fica fora do ideal do turno.' },
  loadDeficit:    { label: 'Déficit de Carga',      unit: '%',          hint: 'Quanto falta para a carga do período (com "Garantir carga").' },
  overtimePref:   { label: 'Horas Extras',          unit: DURATION_UNIT, hint: 'Minutos acima da carga para quem evita extras (sem "Garantir carga").' },
  tableChanges:   { label: 'Trocas de Tabela',      unit: 'trocas',     hint: 'Trocas de tabela no período da carga (comparando com a última tabela da mesma escala). Ideal 0 = mantém a tabela.' },
  publishedChanges: { label: 'Mudanças em Publicados', unit: 'dias',     hint: 'Dias do operador cuja tabela muda ao gerar sobre dias já publicados (por operador).' },
}

interface Props {
  value:     RosterSettings
  // values to diff against (DiffDot) — null shows no diff markers
  reference: RosterSettings | null
  onChange:  (next: RosterSettings) => void
}

// The real roster's rules of one empresa (transit.roster, scope branch)
export function RosterSettingsEditor({ value, reference, onChange }: Props) {
  const diff = (key: keyof RosterSettings) => !!reference && JSON.stringify(value[key]) !== JSON.stringify(reference[key])
  const grades = Array.from({ length: value.maxPreferredLines }, (_, i) => value.preferredLineGrades[i] ?? 0)
  const setGrade = (i: number, v: number) => onChange({ ...value, preferredLineGrades: grades.map((g, k) => (k === i ? Math.round(v) : g)) })
  const updateRange = (key: keyof RosterSettings['range'], field: keyof RangeCriterion, v: unknown) =>
    onChange({ ...value, range: { ...value.range, [key]: { ...value.range[key], [field]: v } } })
  return (
    <div className="flex flex-col gap-3">
      <SectionHeader label="Operadores" sub="Regras dos cadastros de operador da empresa" />
      <div className="rounded-lg border border-border divide-y divide-border">
        <Row
          diff={diff('lineAccessMode')}
          label="Regra de Linhas do Operador"
          hint="Regra de associação de linhas para operador"
        >
          <Select
            value={value.lineAccessMode}
            onChange={(e) => onChange({ ...value, lineAccessMode: e.target.value as RosterSettings['lineAccessMode'] })}
            size="sm"
            className="w-70"
          >
            {(Object.keys(LINE_ACCESS_MODE_LABEL) as RosterSettings['lineAccessMode'][]).map(m => (
              <option key={m} value={m}>{LINE_ACCESS_MODE_LABEL[m]}</option>
            ))}
          </Select>
        </Row>
        <Row
          diff={diff('maxPreferredLines')}
          label="Linhas Preferenciais por Operador"
          hint="Quantidade de linhas aceitas como preferênciais"
        >
          <NumberInput value={value.maxPreferredLines} onChange={(v) => onChange({ ...value, maxPreferredLines: Math.round(v) })} min={0} max={10} />
          <span className="text-sm text-muted-foreground w-6"></span>
        </Row>
        <Row
          diff={diff('defaultWeeklyHours')}
          label="Carga Semanal Padrão"
          hint="Quando nem o operador nem o contrato definem — mensal = semanal × 5"
        >
          <NumberInput value={value.defaultWeeklyHours} onChange={(v) => onChange({ ...value, defaultWeeklyHours: Math.round(v) })} min={1} max={44} />
          <span className="text-sm text-muted-foreground w-6">h</span>
        </Row>
        {grades.length > 0 && (
          <Row
            diff={diff('preferredLineGrades')}
            label="Peso das Linhas Preferenciais"
            hint="Bonificação do gerador no atendimento de linhas preferenciais"
          >
            {grades.map((g, i) => <NumberInput key={i} value={g} onChange={(v) => setGrade(i, v)} min={0} max={100} />)}
            <span className="text-sm text-muted-foreground w-6">%</span>
          </Row>
        )}
        <Row
          diff={diff('loadPeriodStartDay')}
          label="Início do Período da Carga"
          hint="Dia do mês em que começa o período da carga — 1 = mês civil"
        >
          <NumberInput value={value.loadPeriodStartDay} onChange={(v) => onChange({ ...value, loadPeriodStartDay: Math.round(v) })} min={1} max={28} />
          <span className="text-sm text-muted-foreground w-6"></span>
        </Row>
        <Row
          diff={diff('habitualVehicleDays')}
          label="Carro Habitual"
          hint="O carro mais dirigido pelo operador nestes últimos dias"
        >
          <NumberInput value={value.habitualVehicleDays} onChange={(v) => onChange({ ...value, habitualVehicleDays: Math.round(v) })} min={1} max={90} />
          <span className="text-sm text-muted-foreground w-6">dias</span>
        </Row>
      </div>

      <SectionHeader label="Plantões" sub="Reserva da empresa por tipo de dia — os plantões são criados com o dia e o gerador os preenche com quem sobra depois das tabelas." />
      <ReserveTargets value={value.reserveTargets} diff={diff('reserveTargets')} onChange={reserveTargets => onChange({ ...value, reserveTargets })} />

      <SectionHeader label="Regras do Gerador" sub="Bloqueia: nunca escala. Alerta: só como último recurso, e o dia mostra a pendência." />
      <div className="rounded-lg border border-border divide-y divide-border">
        {(Object.keys(ROSTER_RULE_LABEL) as (keyof RosterSettings['ruleModes'])[]).map(k => (
          <Row
            key={k}
            diff={!!reference && value.ruleModes[k] !== reference.ruleModes[k]}
            label={ROSTER_RULE_LABEL[k].label}
            hint={ROSTER_RULE_LABEL[k].hint}
          >
            <Select
              value={value.ruleModes[k]}
              onChange={(e) => onChange({ ...value, ruleModes: { ...value.ruleModes, [k]: e.target.value } })}
              size="sm"
              className="w-56"
            >
              {Object.entries(ROSTER_RULE_MODE_LABEL).map(([m, label]) => <option key={m} value={m}>{label}</option>)}
            </Select>
          </Row>
        ))}
      </div>

      <SectionHeader label="Critérios do Gerador" sub="Pontuação de cada operador no horizonte gerado — a média de todos é a pontuação da proposta." />
      <RangeTable
        data={value.range}
        globalData={reference ? reference.range : value.range}
        meta={ROSTER_RANGE_META}
        onChange={updateRange}
      />
    </div>
  )
}

async function fetchList<T>(path: string): Promise<T[]> {
  const res = await apiFetch(path)
  if (!res.ok) return []
  const json = await res.json()
  return json.data ?? json
}

// one row per target: day type, start–end, garage, how many
function ReserveTargets({ value, diff, onChange }: { value: RosterReserveTarget[]; diff: boolean; onChange: (next: RosterReserveTarget[]) => void }) {
  const { data: dayTypes = [] } = useQuery({
    queryKey: ['transit', 'day-type', 'list'],
    queryFn:  () => fetchList<{ id: string; code: string; name: string }>('/transit/day-type'),
    staleTime: 60_000,
  })
  const { data: depots = [] } = useQuery({
    queryKey: ['transit', 'transit-locality', 'depots'],
    queryFn:  () => fetchList<{ id: string; name: string }>('/transit/transit-locality?f_isDepot=true&pageSize=100'),
    staleTime: 60_000,
  })
  const set = (i: number, patch: Partial<RosterReserveTarget>) => onChange(value.map((t, k) => (k === i ? { ...t, ...patch } : t)))
  const add = () => dayTypes[0] && onChange([...value, { role: 'DRIVER', dayTypeId: dayTypes[0].id, startMinutes: 300, endMinutes: 780, localityId: depots[0]?.id ?? null, count: 1 }])
  const clock = 'h-8 w-16 border border-input rounded-sm text-sm bg-input-bg px-2 text-center'
  return (
    <div className="rounded-lg border border-border">
      <div className="flex items-center gap-2 px-4 py-3">
        <DiffDot show={diff} />
        <p className="text-sm text-muted-foreground">{value.length ? `${value.reduce((n, t) => n + t.count, 0)} plantão(ões) em ${value.length} meta(s)` : 'Nenhuma meta de plantão'}</p>
        <Button type="button" size="sm" variant="outline" className="ml-auto" disabled={!dayTypes.length} onClick={add}>
          <Icons.Plus className="w-3.5 h-3.5" />Adicionar
        </Button>
      </div>
      {value.map((t, i) => (
        <div key={i} className="flex flex-wrap items-center gap-2 px-4 py-2 border-t border-border">
          <Select value={t.dayTypeId} onChange={e => set(i, { dayTypeId: e.target.value })} size="sm" className="w-40">
            {dayTypes.map(d => <option key={d.id} value={d.id}>{d.code} · {d.name}</option>)}
          </Select>
          <ClockInput value={t.startMinutes} onChange={v => set(i, { startMinutes: v })} max={1439} className={clock} />
          <span className="text-muted-foreground">–</span>
          <ClockInput value={t.endMinutes} onChange={v => set(i, { endMinutes: v })} max={2879} className={clock} />
          <Select value={t.localityId ?? ''} onChange={e => set(i, { localityId: e.target.value || null })} size="sm" className="w-48">
            <option value="">— sem local</option>
            {depots.map(d => <option key={d.id} value={d.id}>{d.name}</option>)}
          </Select>
          <NumberInput value={t.count} onChange={v => set(i, { count: Math.max(1, Math.round(v)) })} min={1} max={99} />
          <span className="text-sm text-muted-foreground">plantão(ões)</span>
          {t.endMinutes <= t.startMinutes && <span className="text-xs text-red-600 dark:text-red-400">fim antes do início</span>}
          <button type="button" title="Remover" onClick={() => onChange(value.filter((_, k) => k !== i))} className="ml-auto text-muted-foreground hover:text-foreground cursor-pointer">
            <Icons.Trash2 className="w-4 h-4" />
          </button>
        </div>
      ))}
    </div>
  )
}

function Row({ diff, label, hint, children }: { diff: boolean; label: string; hint: string; children: React.ReactNode }) {
  return (
    <div className="flex items-center justify-between gap-6 px-4 py-3">
      <div className="flex items-center gap-2">
        <DiffDot show={diff} />
        <div>
          <p className="text-sm font-medium">{label}</p>
          <p className="text-xs text-muted-foreground mt-0.5">{hint}</p>
        </div>
      </div>
      <div className="flex items-center gap-2">{children}</div>
    </div>
  )
}
