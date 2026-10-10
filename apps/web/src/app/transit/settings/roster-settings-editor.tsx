'use client'

import { LINE_ACCESS_MODE_LABEL, type RosterSettings } from '@nyx/schemas'
import { Select } from '@/components/ui/select'
import { SectionHeader, DiffDot, NumberInput } from './criteria-tables'

interface Props {
  value:     RosterSettings
  // values to diff against (DiffDot) — null shows no diff markers
  reference: RosterSettings | null
  onChange:  (next: RosterSettings) => void
}

// The real roster's rules of one empresa (transit.roster, scope branch)
export function RosterSettingsEditor({ value, reference, onChange }: Props) {
  const diff = (key: keyof RosterSettings) => !!reference && value[key] !== reference[key]
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
      </div>
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
