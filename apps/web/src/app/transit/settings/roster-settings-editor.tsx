'use client'

import { LINE_ACCESS_MODE_LABEL, ROSTER_RULE_LABEL, ROSTER_RULE_MODE_LABEL, type RangeCriterion, type RosterSettings } from '@nyx/schemas'
import { Select } from '@/components/ui/select'
import { SectionHeader, DiffDot, NumberInput, RangeTable, DURATION_UNIT } from './criteria-tables'

const ROSTER_RANGE_META: Record<keyof RosterSettings['range'], { label: string; unit: string; hint: string }> = {
  driverPrefLine: { label: 'Linhas Preferenciais',  unit: '%',          hint: 'Minutos de viagem nas linhas preferenciais do condutor, ponderados pelo peso de cada uma.' },
  shiftFit:       { label: 'Ajuste ao Turno',       unit: DURATION_UNIT, hint: 'Média por jornada de quanto o início/fim fica fora do ideal do turno.' },
  loadDeficit:    { label: 'Déficit de Carga',      unit: '%',          hint: 'Quanto falta para a carga do período (com "Garantir carga").' },
  overtimePref:   { label: 'Horas Extras',          unit: DURATION_UNIT, hint: 'Minutos acima da carga para quem evita extras (sem "Garantir carga").' },
  tableChanges:   { label: 'Trocas de Tabela',      unit: 'trocas',     hint: 'Trocas de linha principal ou turno no período da carga.' },
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
      <SectionHeader label="Condutores" sub="Regras dos cadastros de condutor da empresa" />
      <div className="rounded-lg border border-border divide-y divide-border">
        <Row
          diff={diff('lineAccessMode')}
          label="Linhas do Condutor"
          hint="Como ler o acesso cadastrado nas linhas de cada condutor"
        >
          <Select
            value={value.lineAccessMode}
            onChange={(e) => onChange({ ...value, lineAccessMode: e.target.value as RosterSettings['lineAccessMode'] })}
            size="sm"
            className="w-96"
          >
            {(Object.keys(LINE_ACCESS_MODE_LABEL) as RosterSettings['lineAccessMode'][]).map(m => (
              <option key={m} value={m}>{LINE_ACCESS_MODE_LABEL[m]}</option>
            ))}
          </Select>
        </Row>
        <Row
          diff={diff('maxPreferredLines')}
          label="Linhas Preferenciais por Condutor"
          hint="Primária, secundária... — 0 desliga as preferências"
        >
          <NumberInput value={value.maxPreferredLines} onChange={(v) => onChange({ ...value, maxPreferredLines: Math.round(v) })} min={0} max={10} />
          <span className="text-sm text-muted-foreground w-6"></span>
        </Row>
        <Row
          diff={diff('defaultWeeklyHours')}
          label="Carga Semanal Padrão"
          hint="Quando nem o condutor nem o contrato definem — mensal = semanal × 5"
        >
          <NumberInput value={value.defaultWeeklyHours} onChange={(v) => onChange({ ...value, defaultWeeklyHours: Math.round(v) })} min={1} max={44} />
          <span className="text-sm text-muted-foreground w-6">h</span>
        </Row>
        {grades.length > 0 && (
          <Row
            diff={diff('preferredLineGrades')}
            label="Peso das Linhas Preferenciais"
            hint="Quanto vale cada preferência (primária, secundária...) na pontuação do gerador"
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
          hint="O carro mais dirigido pelo condutor nestes últimos dias"
        >
          <NumberInput value={value.habitualVehicleDays} onChange={(v) => onChange({ ...value, habitualVehicleDays: Math.round(v) })} min={1} max={90} />
          <span className="text-sm text-muted-foreground w-6">dias</span>
        </Row>
      </div>

      <SectionHeader label="Regras do Gerador" sub="Bloqueia: nunca escala. Permite com pendência: só como último recurso, e o dia mostra a pendência." />
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

      <SectionHeader label="Critérios do Gerador" sub="Pontuação de cada condutor no horizonte gerado — a média de todos é a pontuação da proposta." />
      <RangeTable
        data={value.range}
        globalData={reference ? reference.range : value.range}
        meta={ROSTER_RANGE_META}
        onChange={updateRange}
      />
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
