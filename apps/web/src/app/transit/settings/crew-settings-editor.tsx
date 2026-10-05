'use client'

import type { CrewSettings, AnchoredCriterion, RangeCriterion } from '@nyx/schemas'
import { Select } from '@/components/ui/select'
import { SectionHeader, DiffDot, NumberInput, AnchoredTable, RangeTable } from './criteria-tables'
import { useIntervalTypes } from '../use-interval-types'

// Crew (duty/CCT) settings editor — used by the transit settings page (global / per Scope)
// and by the crew plan's own settings modal (per-plan customization).

const CREW_RANGE_META: Record<keyof CrewSettings['range'], { label: string; unit: string; hint: string }> = {
  workTime:       { label: 'Duração da Jornada',      unit: 'min',    hint: 'Minutos trabalhados na jornada (pegadas + atividades pagas).' },
  spread:         { label: 'Amplitude',               unit: 'min',    hint: 'Da apresentação ao encerramento da jornada, incluindo intervalos.' },
  mealBreak:      { label: 'Intervalo Intrajornada',  unit: 'min',    hint: 'Duração do intervalo de refeição dentro da jornada.' },
  splitInterval:  { label: 'Intervalo Dupla Pegada',  unit: 'min',    hint: 'Intervalo entre as pegadas de uma jornada em dupla pegada.' },
  idleTime:       { label: 'Tempo Ocioso Remunerado', unit: 'min',    hint: 'Tempo parado e pago entre as pegadas (fora refeição e dupla pegada). Acima do teto a jornada fica pendente.' },
  overtimeRatio:  { label: 'Horas Extras',            unit: '%',      hint: 'Minutos extras sobre o total trabalhado no plano.' },
  splitRatio:     { label: 'Jornadas em Dupla Pegada', unit: '%',     hint: 'Proporção de jornadas em dupla pegada no plano.' },
  tripperRatio:   { label: 'Meias Jornadas',          unit: '%',      hint: 'Proporção de meias jornadas no plano. Ideal e teto 0 = não permitidas.' },
  vehicleChanges: { label: 'Trocas de Carro',         unit: 'trocas', hint: 'Trocas de carro dentro de uma mesma jornada.' },
  lineChanges:    { label: 'Trocas de Linha',         unit: 'trocas', hint: 'Trocas de linha dentro de uma mesma jornada — somam às trocas de carro.' },
  walkDistance:   { label: 'Deslocamento a Pé',       unit: 'm',      hint: 'Metros caminhados na jornada entre pegadas em locais diferentes.' },
}

const CREW_ANCHORED_META: Record<keyof CrewSettings['anchored'], { label: string; unit: string; hint: string }> = {
  dutyCount:  { label: 'Nº de Jornadas', unit: '% sobre mínimo', hint: 'Jornadas do plano sobre o mínimo teórico (minutos de bloco ÷ duração ideal máxima da jornada).' },
  efficiency: { label: 'Eficiência',     unit: '% sobre mínimo', hint: 'Minutos pagos sobre os minutos de bloco cobertos.' },
}

const CREW_PARAMS: { key: 'signOnMinutes' | 'signOffMinutes' | 'handoverMinutes' | 'minPieceMinutes' | 'maxContinuousDrivingMinutes' | 'maxWalkMeters' | 'nightStartHour' | 'nightEndHour' | 'stopMaxTotalMinutes' | 'stopNoImprovementMinutes'; label: string; hint: string; unit: string; max: number }[] = [
  { key: 'signOnMinutes',               label: 'Apresentação',              unit: 'min', max: 120,  hint: 'Tempo antes da primeira pegada da jornada' },
  { key: 'signOffMinutes',              label: 'Encerramento',              unit: 'min', max: 120,  hint: 'Tempo após a última pegada da jornada' },
  { key: 'handoverMinutes',             label: 'Sobreposição na Rendição',  unit: 'min', max: 60,   hint: 'Sobreposição tolerada entre pegadas do mesmo papel no mesmo carro' },
  { key: 'minPieceMinutes',             label: 'Pegada Mínima',             unit: 'min', max: 1440, hint: 'Pegadas mais curtas são sinalizadas' },
  { key: 'maxContinuousDrivingMinutes', label: 'Direção Contínua Máxima',   unit: 'min', max: 1440, hint: 'Tempo máximo ao volante sem intervalo' },
  { key: 'maxWalkMeters',               label: 'Distância Máxima a Pé',     unit: 'm',   max: 20000, hint: 'Deslocamento a pé permitido entre pegadas em locais diferentes (4 km/h)' },
  { key: 'nightStartHour',              label: 'Início do Período Noturno', unit: 'h',   max: 23,   hint: 'Hora de início da janela noturna (informativo)' },
  { key: 'nightEndHour',                label: 'Fim do Período Noturno',    unit: 'h',   max: 23,   hint: 'Hora de fim da janela noturna (informativo)' },
  { key: 'stopMaxTotalMinutes',         label: 'Tempo Máximo de Geração',   unit: 'min', max: 1440, hint: 'Duração máxima da geração da escala' },
  { key: 'stopNoImprovementMinutes',    label: 'Parar sem Melhora',         unit: 'min', max: 60,   hint: 'Encerra a geração após este tempo sem encontrar escala melhor' },
]

type MealRule = CrewSettings['mealRule']

interface Props {
  value:     CrewSettings
  // values to diff against (DiffDot) — null shows no diff markers
  reference: CrewSettings | null
  onChange:  (next: CrewSettings) => void
  disabled?: boolean
}

export function CrewSettingsEditor({ value, reference, onChange, disabled }: Props) {
  const { data: intervalTypes = [] } = useIntervalTypes()

  function updateRange(key: keyof CrewSettings['range'], field: keyof RangeCriterion, v: unknown) {
    onChange({ ...value, range: { ...value.range, [key]: { ...value.range[key], [field]: v } } })
  }

  const rule = value.mealRule
  function setRule(patch: Partial<MealRule>) {
    onChange({ ...value, mealRule: { ...rule, ...patch } })
  }

  function updateAnchored(key: keyof CrewSettings['anchored'], field: keyof AnchoredCriterion, v: unknown) {
    onChange({ ...value, anchored: { ...value.anchored, [key]: { ...value.anchored[key], [field]: v } } })
  }

  return (
    <div className="flex flex-col gap-6">
      <div className="flex flex-col gap-3">
        <SectionHeader label="Parâmetros da Jornada" sub="Regras da CCT aplicadas à escala lógica" />
        <div className="rounded-lg border border-border divide-y divide-border">
          {CREW_PARAMS.map((p) => (
            <div key={p.key} className="flex items-center justify-between gap-6 px-4 py-3">
              <div className="flex items-center gap-2">
                <DiffDot show={!!reference && value[p.key] !== reference[p.key]} />
                <div>
                  <p className="text-sm font-medium">{p.label}</p>
                  <p className="text-xs text-muted-foreground mt-0.5">{p.hint}</p>
                </div>
              </div>
              <div className="flex items-center gap-2">
                <NumberInput
                  value={value[p.key]}
                  onChange={(v) => onChange({ ...value, [p.key]: Math.round(v) })}
                  min={0}
                  max={p.max}
                  disabled={disabled}
                />
                <span className="text-sm text-muted-foreground w-6">{p.unit}</span>
              </div>
            </div>
          ))}
          {/* intrajornada of a STRAIGHT duty — mode (none / allowed / required) and form */}
          <div className="flex items-center justify-between gap-6 px-4 py-3">
            <div className="flex items-center gap-2">
              <DiffDot show={!!reference && (rule.mode !== reference.mealRule.mode || rule.form !== reference.mealRule.form)} />
              <div>
                <p className="text-sm font-medium">Intervalo de Refeição</p>
                <p className="text-xs text-muted-foreground mt-0.5">
                  Nas corridas — a dupla pegada usa o próprio intervalo. Permitir: o gerador coloca a refeição onde couber, sem exigir
                </p>
              </div>
            </div>
            <div className="flex items-center gap-3 shrink-0">
              <Select
                value={rule.mode}
                onChange={(e) => {
                  const mode = e.target.value as MealRule['mode']
                  // fractioned is paid: only a required one changes anything
                  setRule({ mode, form: mode === 'allowed' ? 'continuous' : rule.form })
                }}
                size="sm"
                wrapperClassName="w-36"
                disabled={disabled}
              >
                <option value="none">Não usar</option>
                <option value="allowed">Permitir</option>
                <option value="required">Obrigatório</option>
              </Select>
              <Select
                value={rule.form}
                onChange={(e) => setRule({ form: e.target.value as MealRule['form'] })}
                size="sm"
                wrapperClassName="w-36"
                disabled={disabled || rule.mode === 'none'}
              >
                <option value="continuous">Contínuo</option>
                <option value="fractioned" disabled={rule.mode === 'allowed'}>Fracionado</option>
              </Select>
            </div>
          </div>
          {rule.mode !== 'none' && rule.form === 'continuous' && (
            <div className="flex items-center justify-between gap-6 px-4 py-3">
              <div className="flex items-center gap-2">
                <DiffDot show={!!reference && value.mealBreakIntervalTypeId !== reference.mealBreakIntervalTypeId} />
                <div>
                  <p className="text-sm font-medium">Tipo de Intervalo da Refeição</p>
                  <p className="text-xs text-muted-foreground mt-0.5">
                    Intervalo não pago, na faixa do cadastro do tipo, em local que permite refeição
                  </p>
                </div>
              </div>
              <Select
                value={value.mealBreakIntervalTypeId ?? ''}
                onChange={(e) => onChange({ ...value, mealBreakIntervalTypeId: e.target.value || null })}
                size="sm"
                wrapperClassName="w-56"
                disabled={disabled}
              >
                <option value="">Não definido</option>
                {intervalTypes.map(t => <option key={t.id} value={t.id}>{t.name}</option>)}
              </Select>
            </div>
          )}
          {rule.mode !== 'none' && rule.form === 'fractioned' && (
            <div className="flex items-center justify-between gap-6 px-4 py-3">
              <div className="flex items-center gap-2">
                <DiffDot show={!!reference && (rule.fractionedMinTotal !== reference.mealRule.fractionedMinTotal || rule.fractionedMinLongest !== reference.mealRule.fractionedMinLongest)} />
                <div>
                  <p className="text-sm font-medium">Refeição Fracionada</p>
                  <p className="text-xs text-muted-foreground mt-0.5">
                    Paradas da jornada (qualquer duração, pagas) somam o mínimo, com uma de pelo menos o tamanho indicado
                  </p>
                </div>
              </div>
              <div className="flex items-center gap-3 shrink-0">
                <span className="text-xs text-muted-foreground">soma</span>
                <NumberInput
                  value={rule.fractionedMinTotal}
                  onChange={(v) => setRule({ fractionedMinTotal: Math.round(v) })}
                  min={0} max={600}
                  disabled={disabled}
                />
                <span className="text-xs text-muted-foreground">maior</span>
                <NumberInput
                  value={rule.fractionedMinLongest}
                  onChange={(v) => setRule({ fractionedMinLongest: Math.round(v) })}
                  min={0} max={600}
                  disabled={disabled}
                />
                <span className="text-sm text-muted-foreground">min</span>
              </div>
            </div>
          )}
        </div>
      </div>

      <div className="flex flex-col gap-3">
        <SectionHeader
          label="Critérios Ancorados na Escala"
          sub="Piso inferido do próprio plano — Ideal/Ceiling em % acima desse piso."
        />
        <AnchoredTable
          data={value.anchored}
          globalData={reference ? reference.anchored : value.anchored}
          meta={CREW_ANCHORED_META}
          onChange={updateAnchored}
          disabled={disabled}
        />
      </div>

      <div className="flex flex-col gap-3">
        <SectionHeader
          label="Critérios por Jornada"
          sub="Fora do ideal → perde pontuação; fora de Floor/Ceiling → pendência. Nenhum bloqueia o save da jornada."
        />
        <RangeTable
          data={value.range}
          globalData={reference ? reference.range : value.range}
          meta={CREW_RANGE_META}
          onChange={updateRange}
          disabled={disabled}
        />
      </div>
    </div>
  )
}
