'use client'

import type { PlanningSettings, AnchoredCriterion, RangeCriterion } from '@nyx/schemas'
import { Icons } from '@/lib/icons'
import { DurationInput } from '@/components/ui/duration-input'
import { SectionHeader, DiffDot, NumberInput, AnchoredTable, RangeTable, DURATION_UNIT } from './criteria-tables'

// Planning (vehicle plan) settings editor — used by the transit settings page (global / per
// Scope) and by the vehicle plan's optimize modal (per-plan customization).

const RANGE_META: Record<keyof PlanningSettings['range'], { label: string; unit: string; hint: string }> = {
  lineTransfer:         { label: 'Troca de Linha',          unit: 'trocas', hint: 'Nº de trocas de linha no bloco (linhas distintas - 1). Zero = bloco com linha única.' },
  deadrunRatio:         { label: 'Ratio Km em Vazio',       unit: '%',      hint: 'Proporção de km em vazio sobre o total do bloco.' },
  minBlockDuration:     { label: 'Duração Mínima Bloco',    unit: DURATION_UNIT,    hint: 'Duração total do bloco (minutos). Blocos abaixo do idealMin são candidatos a fusão.' },
  distributionVariance: { label: 'Variância de Distribuição', unit: '% CV', hint: 'Coeficiente de variação (desvio padrão / média) da duração dos blocos do plano.' },
  preferredVehicleType: { label: 'Tipo Preferencial',       unit: '% viagens', hint: 'Viagens de linhas com tipo de veículo preferencial rodando em outro tipo.' },
  operatorShareFleet:   { label: 'Participação — Frota',    unit: 'p.p.',   hint: 'Maior desvio entre a participação de cada empresa na frota e a definida no escopo (entre as empresas com participação).' },
  operatorShareKm:      { label: 'Participação — Km',       unit: 'p.p.',   hint: 'Maior desvio entre a participação de cada empresa no km total e a definida no escopo.' },
}

const ANCHORED_META: Record<keyof PlanningSettings['anchored'], { label: string; unit: string; hint: string }> = {
  totalKm:    { label: 'Km Total',   unit: '% sobre mínimo', hint: 'Km total do plano sobre o mínimo teórico (soma do km de cada viagem, deadrun zero).' },
  fleetUsage: { label: 'Uso de Frota', unit: '% sobre mínimo', hint: 'Frota utilizada sobre o mínimo teórico (requisito de pico de veículos simultâneos).' },
}

// every plan-level criterion's label — the optimize modal's per-criterion breakdown
export const PLANNING_CRITERIA_LABEL: Record<string, string> = Object.fromEntries(
  [...Object.entries(RANGE_META), ...Object.entries(ANCHORED_META)].map(([key, m]) => [key, m.label]),
)

type LineRangeKey = Exclude<keyof PlanningSettings['line'], 'fleetUsage'>

const LINE_RANGE_META: Record<LineRangeKey, { label: string; unit: string; hint: string }> = {
  demandMatch:          { label: 'Oferta x Demanda',        unit: '% ocupação', hint: 'Ocupação por hora e sentido (demanda/oferta). Penaliza excesso e falta de oferta.' },
  headwayRegularity:    { label: 'Regularidade de Intervalo', unit: '% CV',     hint: 'Coeficiente de variação dos intervalos entre partidas consecutivas, por sentido.' },
  maxGap:               { label: 'Maior Vão sem Atendimento', unit: DURATION_UNIT,     hint: 'Maior intervalo entre partidas consecutivas de um mesmo sentido.' },
  peakConcentration:    { label: 'Concentração Pico/Vale',  unit: '%',         hint: 'Participação da oferta no horário de pico sobre a participação da demanda no pico (100% = equivalente).' },
  distributionVariance: { label: 'Variância de Distribuição', unit: '% CV',    hint: 'Coeficiente de variação do km que a linha demanda de cada veículo que a atende.' },
}

const LINE_FLEET_META: Record<'fleetUsage', { label: string; unit: string; hint: string }> = {
  fleetUsage: { label: 'Uso de Frota', unit: '% sobre mínimo', hint: 'Frota da linha sobre o mínimo teórico (requisito de pico de veículos simultâneos, só desta linha).' },
}

const STOP_PARAMS: { key: 'stopNoImprovementMinutes' | 'stopMaxTotalMinutes'; label: string; hint: string; unit: string; max: number }[] = [
  { key: 'stopNoImprovementMinutes', label: 'Parar sem Melhora',       unit: 'min',         max: 60,   hint: 'Encerra se nenhuma solução melhor for encontrada neste intervalo' },
  { key: 'stopMaxTotalMinutes',      label: 'Tempo Máximo de Geração', unit: DURATION_UNIT, max: 1440, hint: 'Encerra independentemente do resultado após este tempo' },
]

const lineRanges = (line: PlanningSettings['line']): Record<LineRangeKey, RangeCriterion> => ({
  demandMatch:          line.demandMatch,
  headwayRegularity:    line.headwayRegularity,
  maxGap:               line.maxGap,
  peakConcentration:    line.peakConcentration,
  distributionVariance: line.distributionVariance,
})

interface Props {
  value:     PlanningSettings
  // values to diff against (DiffDot) — null shows no diff markers
  reference: PlanningSettings | null
  onChange:  (next: PlanningSettings) => void
  disabled?: boolean
}

export function PlanningSettingsEditor({ value, reference, onChange, disabled }: Props) {
  // the tables mark a difference against globalData — without a reference, against themselves
  const ref = reference ?? value

  function updateRange(key: keyof PlanningSettings['range'], field: keyof RangeCriterion, v: unknown) {
    onChange({ ...value, range: { ...value.range, [key]: { ...value.range[key], [field]: v } } })
  }

  function updateAnchored(key: keyof PlanningSettings['anchored'], field: keyof AnchoredCriterion, v: unknown) {
    onChange({ ...value, anchored: { ...value.anchored, [key]: { ...value.anchored[key], [field]: v } } })
  }

  function updateLineRange(key: LineRangeKey, field: keyof RangeCriterion, v: unknown) {
    onChange({ ...value, line: { ...value.line, [key]: { ...value.line[key], [field]: v } } })
  }

  function updateLineFleetUsage(field: keyof AnchoredCriterion, v: unknown) {
    onChange({ ...value, line: { ...value.line, fleetUsage: { ...value.line.fleetUsage, [field]: v } } })
  }

  return (
    <div className="flex flex-col gap-6">
      {/* Hard rules */}
      <div className="flex flex-col gap-3">
        <SectionHeader label="Regras" sub="Respeitadas sempre pelo solver" />
        <div className="rounded-lg border border-border divide-y divide-border">
          <div className="flex items-center justify-between gap-6 px-4 py-3">
            <div className="flex items-center gap-2">
              <DiffDot show={!!reference && value.minLayoverMinutes !== reference.minLayoverMinutes} />
              <div>
                <p className="text-sm font-medium">Intervalo Mínimo entre Viagens</p>
                <p className="text-xs text-muted-foreground mt-0.5">Menor tempo parado no terminal entre duas viagens seguidas do carro (também usado ao normalizar a importação)</p>
              </div>
            </div>
            <div className="flex items-center gap-2">
              <NumberInput
                value={value.minLayoverMinutes}
                onChange={(v) => onChange({ ...value, minLayoverMinutes: Math.round(v) })}
                min={0}
                max={60}
                disabled={disabled}
              />
              <span className="text-sm text-muted-foreground w-6">min</span>
            </div>
          </div>
        </div>
      </div>

      {/* Stop criteria */}
      <div className="flex flex-col gap-3">
        <SectionHeader label="Critério de Parada" sub="Controla quando o solver encerra a geração" />
        <div className="rounded-lg border border-border divide-y divide-border">
          {STOP_PARAMS.map((p) => (
            <div key={p.key} className="flex items-center justify-between gap-6 px-4 py-3">
              <div className="flex items-center gap-2">
                <DiffDot show={!!reference && value[p.key] !== reference[p.key]} />
                <div>
                  <p className="text-sm font-medium">{p.label}</p>
                  <p className="text-xs text-muted-foreground mt-0.5">{p.hint}</p>
                </div>
              </div>
              <div className="flex items-center gap-2">
                {p.unit === DURATION_UNIT
                  ? <DurationInput value={value[p.key]} onChange={(v) => onChange({ ...value, [p.key]: v })} min={1} max={p.max} disabled={disabled} />
                  : <NumberInput
                      value={value[p.key]}
                      onChange={(v) => onChange({ ...value, [p.key]: Math.round(v) })}
                      min={1}
                      max={p.max}
                      disabled={disabled}
                    />}
                <span className="text-sm text-muted-foreground w-6">{p.unit === DURATION_UNIT ? 'h' : p.unit}</span>
              </div>
            </div>
          ))}
        </div>
      </div>

      {/* Anchored criteria (plan) */}
      <div className="flex flex-col gap-3">
        <SectionHeader
          label="Critérios Ancorados no Plano"
          sub="Piso inferido do próprio plano (km mínimo, frota mínima) — Ideal/Ceiling em % acima desse piso."
        />
        <div className='flex items-center gap-x-2 rounded-sm p-3 text-sm text-slate-50 bg-slate-500 dark:text-slate-300 dark:bg-slate-800/50'>
          <Icons.Info className="w-4 h-4 shrink-0" />
          <span className='tracking-wide'>O piso destes critérios não é configurável — é calculado a partir do próprio plano (km mínimo teórico, requisito de pico de veículos). O peso define a prioridade relativa entre critérios no score final.</span>
        </div>
        <AnchoredTable
          data={value.anchored}
          globalData={ref.anchored}
          meta={ANCHORED_META}
          onChange={updateAnchored}
          disabled={disabled}
        />
      </div>

      {/* Range criteria */}
      <div className="flex flex-col gap-3 mt-4">
        <SectionHeader
          label="Critérios por Bloco"
          sub="Calculados em isolamento por bloco e combinados por média ponderada ao score. Modifier = peso do critério no score final."
        />
        <div className='flex items-center gap-x-2 rounded-sm py-3 px-4 text-sm text-slate-50 bg-slate-500 dark:text-slate-300 dark:bg-slate-800/50'>
          <Icons.Info className="w-4 h-4 shrink-0" />
          <span className='tracking-wide'>
            Modifier define o peso relativo do item na média ponderada do score. Como o modifier altera a pontuação em escala exponencial, pequenas variações causam forte impacto no direcionamento do <dfn className='text-amber-200 cursor-help' title='Motor de otimização do sistema'>solver</dfn>. Altere com cuidado.
          </span>
        </div>
        <RangeTable
          data={value.range}
          globalData={ref.range}
          meta={RANGE_META}
          onChange={updateRange}
          disabled={disabled}
        />
      </div>

      {/* Line-scoped criteria */}
      <div className="flex flex-col gap-3 mt-4">
        <SectionHeader
          label="Critérios de Linha"
          sub="Score de VehiclePlanLine — só a operação da própria linha, nunca decisões de reaproveitamento entre linhas."
        />
        <RangeTable
          data={lineRanges(value.line)}
          globalData={lineRanges(ref.line)}
          meta={LINE_RANGE_META}
          onChange={updateLineRange}
          disabled={disabled}
        />
        <AnchoredTable
          data={{ fleetUsage: value.line.fleetUsage }}
          globalData={{ fleetUsage: ref.line.fleetUsage }}
          meta={LINE_FLEET_META}
          onChange={(_key, field, v) => updateLineFleetUsage(field, v)}
          disabled={disabled}
        />
      </div>
    </div>
  )
}
