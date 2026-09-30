'use client'

import { useState, useEffect } from 'react'
import { useRouter } from 'next/navigation'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import { Icons } from '@/lib/icons'
import { Breadcrumb } from '@/components/ui/breadcrumb'
import { Select } from '@/components/ui/select'
import { Switch } from '@/components/ui/switch'
import { Stepper } from '@/components/ui/stepper'
import { useTopbarActions } from '@/components/layout/topbar-actions-context'
import { useShortcut } from '@/lib/keywatch'
import { apiFetch } from '@/lib/auth'
import { useToast } from '@/lib/toast-context'
import { msgs } from '@/lib/messages'
import type { GeneralSettings, PlanningSettings, CrewSettings, CrewCostSettings, RosterSettings, AnchoredCriterion, RangeCriterion } from '@nyx/schemas'
import { SectionHeader, NumberInput, AnchoredTable, RangeTable } from './criteria-tables'
import { CrewSettingsEditor } from './crew-settings-editor'
import { CrewCostEditor } from './crew-cost-editor'

// ── UI metadata (not stored in settings) ────────────────────────────────────

const RANGE_META: Record<keyof PlanningSettings['range'], { label: string; unit: string; hint: string }> = {
  lineTransfer:         { label: 'Troca de Linha',          unit: 'trocas', hint: 'Nº de trocas de linha no bloco (linhas distintas - 1). Zero = bloco com linha única.' },
  tripInterval:         { label: 'Intervalo de Viagem',     unit: 'min',    hint: 'Menor intervalo entre viagens consecutivas no bloco (minutos).' },
  deadrunRatio:         { label: 'Ratio Km em Vazio',       unit: '%',      hint: 'Proporção de km em vazio sobre o total do bloco.' },
  minBlockDuration:     { label: 'Duração Mínima Bloco',    unit: 'min',    hint: 'Duração total do bloco (minutos). Blocos abaixo do idealMin são candidatos a fusão.' },
  distributionVariance: { label: 'Variância de Distribuição', unit: '% CV', hint: 'Coeficiente de variação (desvio padrão / média) da duração dos blocos do plano.' },
  specialFleetUsage:    { label: 'Frota Especial',          unit: '% viagens', hint: 'Proporção de viagens do plano cujo tipo de veículo exigido não foi respeitado.' },
}

const ANCHORED_META: Record<keyof PlanningSettings['anchored'], { label: string; unit: string; hint: string }> = {
  totalKm:    { label: 'Km Total',   unit: '% sobre mínimo', hint: 'Km total do plano sobre o mínimo teórico (soma do km de cada viagem, deadrun zero).' },
  fleetUsage: { label: 'Uso de Frota', unit: '% sobre mínimo', hint: 'Frota utilizada sobre o mínimo teórico (requisito de pico de veículos simultâneos).' },
}

const LINE_RANGE_META: Record<Exclude<keyof PlanningSettings['line'], 'fleetUsage'>, { label: string; unit: string; hint: string }> = {
  demandMatch:          { label: 'Oferta x Demanda',        unit: '% ocupação', hint: 'Ocupação por hora e sentido (demanda/oferta). Penaliza excesso e falta de oferta.' },
  headwayRegularity:    { label: 'Regularidade de Intervalo', unit: '% CV',     hint: 'Coeficiente de variação dos intervalos entre partidas consecutivas, por sentido.' },
  maxGap:               { label: 'Maior Vão sem Atendimento', unit: 'min',     hint: 'Maior intervalo entre partidas consecutivas de um mesmo sentido.' },
  peakConcentration:    { label: 'Concentração Pico/Vale',  unit: '%',         hint: 'Participação da oferta no horário de pico sobre a participação da demanda no pico (100% = equivalente).' },
  distributionVariance: { label: 'Variância de Distribuição', unit: '% CV',    hint: 'Coeficiente de variação do km que a linha demanda de cada veículo que a atende.' },
}

const LINE_FLEET_META: Record<'fleetUsage', { label: string; unit: string; hint: string }> = {
  fleetUsage: { label: 'Uso de Frota', unit: '% sobre mínimo', hint: 'Frota da linha sobre o mínimo teórico (requisito de pico de veículos simultâneos, só desta linha).' },
}

const ROSTER_META: Record<keyof RosterSettings['range'], { label: string; unit: string; hint: string }> = {
  interShiftRest: { label: 'Descanso entre Jornadas', unit: 'min', hint: 'Descanso entre jornadas consecutivas da mesma pessoa.' },
  driverPrefLine: { label: 'Linha Preferencial',      unit: '%',   hint: '% de viagens da jornada nas linhas preferenciais da pessoa.' },
  driverPrefTech: { label: 'Tech Preferencial',       unit: '%',   hint: '% de viagens da jornada com tecnologia de veículo preferencial da pessoa.' },
}

// ── Branch type ──────────────────────────────────────────────────────────────

interface Branch { id: string; name: string }
interface TransitScope { id: string; name: string }
interface IntervalTypeOption { id: string; name: string }

// ── Page ─────────────────────────────────────────────────────────────────────

export default function TransitSettingsPage() {
  const router      = useRouter()
  const queryClient = useQueryClient()
  const { toast }   = useToast()

  const [scope, setScope]       = useState<string>('global')
  const [saving, setSaving]     = useState(false)
  const [resetSignal, setResetSignal] = useState(0)

  // form state
  const [general,  setGeneral]  = useState<GeneralSettings  | null>(null)
  const [planning, setPlanning] = useState<PlanningSettings | null>(null)
  const [crew,     setCrew]     = useState<CrewSettings     | null>(null)
  const [roster,   setRoster]   = useState<RosterSettings   | null>(null)
  const [crewCost, setCrewCost] = useState<CrewCostSettings | null>(null)
  // crew rules are keyed by transit Scope (CCT), independent from the branch selector above
  const [crewScope, setCrewScope] = useState<string>('global')

  // ── remote data ────────────────────────────────────────────────────────────

  const { data: branches } = useQuery<Branch[]>({
    queryKey: ['core', 'branch', 'all'],
    queryFn:  async () => {
      const res = await apiFetch('/core/branch?pageSize=999')
      if (!res.ok) throw new Error()
      const json = await res.json()
      return json.data ?? json
    },
  })

  const { data: serverGeneral } = useQuery<GeneralSettings>({
    queryKey: ['transit', 'settings', 'general'],
    queryFn:  async () => {
      const res = await apiFetch('/transit/settings/general')
      if (!res.ok) throw new Error()
      return res.json()
    },
  })

  const { data: intervalTypes = [] } = useQuery<IntervalTypeOption[]>({
    queryKey: ['transit', 'interval-type', 'all'],
    queryFn:  async () => {
      const res = await apiFetch('/transit/interval-type?pageSize=999')
      if (!res.ok) return []
      const json = await res.json()
      return json.data ?? []
    },
  })

  const { data: globalPlanning } = useQuery<PlanningSettings>({
    queryKey: ['transit', 'settings', 'planning', 'global'],
    queryFn:  async () => {
      const res = await apiFetch('/transit/settings/planning?scope=global')
      if (!res.ok) throw new Error()
      return res.json()
    },
  })

  const { data: serverPlanning } = useQuery<PlanningSettings>({
    queryKey: ['transit', 'settings', 'planning', scope],
    queryFn:  async () => {
      const res = await apiFetch(`/transit/settings/planning?scope=${scope}`)
      if (!res.ok) throw new Error()
      return res.json()
    },
  })

  const { data: transitScopes } = useQuery<TransitScope[]>({
    queryKey: ['transit', 'scope', 'all'],
    queryFn:  async () => {
      const res = await apiFetch('/transit/scope?pageSize=999')
      if (!res.ok) throw new Error()
      const json = await res.json()
      return json.data ?? json
    },
  })

  const { data: globalCrew } = useQuery<CrewSettings>({
    queryKey: ['transit', 'settings', 'crew', 'global'],
    queryFn:  async () => {
      const res = await apiFetch('/transit/settings/crew?scope=global')
      if (!res.ok) throw new Error()
      return res.json()
    },
  })

  const { data: serverCrew } = useQuery<CrewSettings>({
    queryKey: ['transit', 'settings', 'crew', crewScope],
    queryFn:  async () => {
      const res = await apiFetch(`/transit/settings/crew?scope=${crewScope}`)
      if (!res.ok) throw new Error()
      return res.json()
    },
  })

  const { data: globalCrewCost } = useQuery<CrewCostSettings>({
    queryKey: ['transit', 'settings', 'crew-cost', 'global'],
    queryFn:  async () => {
      const res = await apiFetch('/transit/settings/crew-cost?scope=global')
      if (!res.ok) throw new Error()
      return res.json()
    },
  })

  const { data: serverCrewCost } = useQuery<CrewCostSettings>({
    queryKey: ['transit', 'settings', 'crew-cost', crewScope],
    queryFn:  async () => {
      const res = await apiFetch(`/transit/settings/crew-cost?scope=${crewScope}`)
      if (!res.ok) throw new Error()
      return res.json()
    },
  })

  const { data: serverRoster } = useQuery<RosterSettings>({
    queryKey: ['transit', 'settings', 'roster'],
    queryFn:  async () => {
      const res = await apiFetch('/transit/settings/roster')
      if (!res.ok) throw new Error()
      return res.json()
    },
  })

  // ── sync server → form ─────────────────────────────────────────────────────
  // resetSignal is bumped by the "reset" action to force a re-sync even when the
  // server value's identity hasn't changed — needs an effect, not just a query load.

  /* eslint-disable react-hooks/set-state-in-effect */
  useEffect(() => { if (serverGeneral)  setGeneral(serverGeneral)   }, [serverGeneral,  resetSignal])
  useEffect(() => { if (serverPlanning) setPlanning(serverPlanning) }, [serverPlanning, resetSignal])
  useEffect(() => { if (serverCrew)     setCrew(serverCrew)         }, [serverCrew,     resetSignal])
  useEffect(() => { if (serverRoster)   setRoster(serverRoster)     }, [serverRoster,   resetSignal])
  useEffect(() => { if (serverCrewCost) setCrewCost(serverCrewCost) }, [serverCrewCost, resetSignal])
  /* eslint-enable react-hooks/set-state-in-effect */

  // ── save ───────────────────────────────────────────────────────────────────

  async function handleSave() {
    if (!general || !planning || !crew || !roster || !crewCost) return
    setSaving(true)
    try {
      const responses = await Promise.all([
        apiFetch('/transit/settings/general', { method: 'PUT', body: JSON.stringify(general) }),
        apiFetch(`/transit/settings/planning?scope=${scope}`, { method: 'PUT', body: JSON.stringify(planning) }),
        apiFetch(`/transit/settings/crew?scope=${crewScope}`, { method: 'PUT', body: JSON.stringify(crew) }),
        apiFetch('/transit/settings/roster', { method: 'PUT', body: JSON.stringify(roster) }),
        apiFetch(`/transit/settings/crew-cost?scope=${crewScope}`, { method: 'PUT', body: JSON.stringify(crewCost) }),
      ])
      if (responses.some((r) => !r.ok)) throw new Error()
      queryClient.invalidateQueries({ queryKey: ['transit', 'settings'] })
      toast.success(msgs.saved())
    } catch {
      toast.error(msgs.error.save())
    } finally {
      setSaving(false)
    }
  }

  // ── shortcuts & topbar ─────────────────────────────────────────────────────

  useTopbarActions([
    { label: 'Salvar', icon: Icons.Save, onClick: handleSave, primary: true, disabled: saving, keybind: 'ALT+G' },
  ], [general, planning, crew, roster, crewCost, saving, scope, crewScope])

  useShortcut('alt+g', handleSave, { desc: 'Salvar configurações', icon: Icons.Save, origin: 'TransitSettingsPage' })
  useShortcut('alt+v', () => router.push('/transit'), { desc: 'Voltar', icon: Icons.ArrowLeft, origin: 'TransitSettingsPage' })
  useShortcut('alt+l', () => setResetSignal((s) => s + 1), { display: false, origin: 'TransitSettingsPage' })

  // ── update helpers ─────────────────────────────────────────────────────────

  function updatePlanningRange(key: keyof PlanningSettings['range'], field: keyof RangeCriterion, value: unknown) {
    setPlanning((prev) => prev ? {
      ...prev,
      range: { ...prev.range, [key]: { ...prev.range[key], [field]: value } },
    } : null)
  }

  function updatePlanningAnchored(key: keyof PlanningSettings['anchored'], field: keyof AnchoredCriterion, value: unknown) {
    setPlanning((prev) => prev ? {
      ...prev,
      anchored: { ...prev.anchored, [key]: { ...prev.anchored[key], [field]: value } },
    } : null)
  }

  function updateLineRange(key: keyof PlanningSettings['line'], field: keyof RangeCriterion, value: unknown) {
    setPlanning((prev) => prev ? {
      ...prev,
      line: { ...prev.line, [key]: { ...(prev.line[key] as RangeCriterion), [field]: value } },
    } : null)
  }

  function updateLineFleetUsage(field: keyof AnchoredCriterion, value: unknown) {
    setPlanning((prev) => prev ? {
      ...prev,
      line: { ...prev.line, fleetUsage: { ...prev.line.fleetUsage, [field]: value } },
    } : null)
  }

  function updateRosterRange(key: keyof RosterSettings['range'], field: keyof RangeCriterion, value: unknown) {
    setRoster((prev) => prev ? {
      ...prev,
      range: { ...prev.range, [key]: { ...prev.range[key], [field]: value } },
    } : null)
  }

  const isBranch   = scope !== 'global'
  const gPlanning  = globalPlanning ?? planning
  const isCrewScoped = crewScope !== 'global'
  const gCrew        = globalCrew ?? crew

  // ── render ─────────────────────────────────────────────────────────────────

  return (
    <div className="p-6 max-w-6xl flex flex-col gap-8">
      <Breadcrumb segments={[
        { label: 'Operação', href: '/transit' },
        { label: 'Configurações' },
      ]} />

      {/* Branch selector */}
      <div className="flex items-center gap-3">
        <span className="text-sm text-muted-foreground">Escopo</span>
        <Select
          value={scope}
          onChange={(e) => setScope(e.target.value)}
          size="sm"
          className="w-56"
        >
          <option value="global">Global</option>
          {branches?.map((b) => (
            <option key={b.id} value={b.id}>{b.name}</option>
          ))}
        </Select>
        {isBranch && (
          <span className="flex items-center gap-x-2 text-xs text-muted-foreground">
            <span className="w-1.5 h-1.5 rounded-full bg-amber-600 flex-shrink-0"></span>
            <span>Diferentes do Global</span>
          </span>
        )}
      </div>
      <hr />

      {/* ── Geral ── */}
      <section className="flex flex-col gap-3">
        <SectionHeader label="Geral" />
        <div className="rounded-lg border border-border divide-y divide-border">
          <div className="flex items-center justify-between gap-6 px-4 py-3">
            <div>
              <p className="text-sm font-medium">Início do Dia Operacional</p>
              <p className="text-xs text-muted-foreground mt-0.5">
                Viagens entre 00:00 e este horário pertencem ao dia operacional anterior
              </p>
            </div>
            <div className="flex items-center gap-2">
              <Stepper
                value={general?.operationalDayStartHour ?? 3}
                onChange={(v) => setGeneral((prev) => prev ? { ...prev, operationalDayStartHour: v } : null)}
                min={0}
                max={6}
                disabled={!general}
              />
              <span className="text-sm text-muted-foreground w-6">h</span>
            </div>
          </div>
          <div className="flex items-center justify-between gap-6 px-4 py-3">
            <div>
              <p className="text-sm font-medium">Modificador de Demanda</p>
              <p className="text-xs text-muted-foreground mt-0.5">
                Fator aplicado em viagens <b>produtivas</b> com tempos da matriz. Tempos cadastrados manualmente não são afetados.
              </p>
            </div>
            <div className="flex items-center gap-2">
              <NumberInput
                value={general?.demandModifier ?? 1.0}
                onChange={(v) => setGeneral((prev) => prev ? { ...prev, demandModifier: v } : null)}
                min={0.5}
                max={3.0}
                step={0.1}
                disabled={!general}
              />
              <span className="text-sm text-muted-foreground w-6"></span>
            </div>
          </div>
          <div className="flex items-center justify-between gap-6 px-4 py-3">
            <div>
              <p className="text-sm font-medium">Fator de Velocidade Base</p>
              <p className="text-xs text-muted-foreground mt-0.5">
                Multiplicador aplicado ao gerar a matriz de tempos. Não afeta pares já gerados.
              </p>
            </div>
            <div className="flex items-center gap-2">
              <NumberInput
                value={general?.baseSpeedRatio ?? 1.1}
                onChange={(v) => setGeneral((prev) => prev ? { ...prev, baseSpeedRatio: v } : null)}
                min={0.5}
                max={3.0}
                step={0.1}
                disabled={!general}
              />
              <span className="text-sm text-muted-foreground w-6"></span>
            </div>
          </div>
          <div className="flex items-center justify-between gap-6 px-4 py-3">
            <div>
              <p className="text-sm font-medium">Distância de Sugestão de Pontos</p>
              <p className="text-xs text-muted-foreground mt-0.5">
                Raio de busca por localidades próximas à trajetória ao sugerir pontos de parada
              </p>
            </div>
            <div className="flex items-center gap-2">
              <NumberInput
                value={general?.suggestThresholdM ?? 50}
                onChange={(v) => setGeneral((prev) => prev ? { ...prev, suggestThresholdM: v } : null)}
                min={1}
                max={1000}
                step={1}
                disabled={!general}
              />
              <span className="text-sm text-muted-foreground w-6">m</span>
            </div>
          </div>
          <div className="flex items-center justify-between gap-6 px-4 py-3">
            <div>
              <p className="text-sm font-medium">Propagar Extensão para o Sentido Principal</p>
              <p className="text-xs text-muted-foreground mt-0.5">
                Ao editar rota a principal, atualiza automaticamente a extensão oficial da linha
              </p>
            </div>
            <div className="flex items-center gap-2">
              <Switch
              checked={general?.propagateExtensionToOfficialKm ?? true}
              onToggle={() => setGeneral((prev) => prev ? { ...prev, propagateExtensionToOfficialKm: !prev.propagateExtensionToOfficialKm } : null)}
              disabled={!general}
            />
              <span className="text-sm text-muted-foreground w-6"></span>
            </div>
          </div>
          <div className="flex items-center justify-between gap-6 px-4 py-3">
            <div>
              <p className="text-sm font-medium">Comportamento do gerador em intervalos longos</p>
              <p className="text-xs text-muted-foreground mt-0.5">
                Comportamento padrão em paradas intermediárias (intervalos longos): aguardar no ponto ou recolher ao depósito
              </p>
            </div>
            <div className="flex items-center gap-2">
              <Select
              value={general?.defaultLayoverPolicy ?? 'HOLD'}
              onChange={(e) => setGeneral((prev) => prev ? { ...prev, defaultLayoverPolicy: e.target.value as GeneralSettings['defaultLayoverPolicy'] } : null)}
              size="sm"
              className="w-30"
              disabled={!general}
            >
              <option value="HOLD">Aguardar</option>
              <option value="DEPOT">Recolher</option>
            </Select>
              <span className="text-sm text-muted-foreground w-6"></span>
            </div>
          </div>
          <div className="flex items-center justify-between gap-6 px-4 py-3">
            <div>
              <p className="text-sm font-medium">Tipo de Intervalo Padrão</p>
              <p className="text-xs text-muted-foreground mt-0.5">
                Parada planejada de veículo (intervalo)
              </p>
            </div>
            <div className="flex items-center gap-2">
              <Select
                value={general?.defaultIntervalTypeId ?? ''}
                onChange={(e) => setGeneral((prev) => prev ? { ...prev, defaultIntervalTypeId: e.target.value || null } : null)}
                size="sm"
                className="w-56"
                disabled={!general}
              >
                <option value="">Nenhum (desativado)</option>
                {intervalTypes.map((it) => (
                  <option key={it.id} value={it.id}>{it.name}</option>
                ))}
              </Select>
              <span className="text-sm text-muted-foreground w-6"></span>
            </div>
          </div>
        </div>
      </section>

      {/* ── Planejamento ── */}
      <section className="flex flex-col gap-6">
        <h1 className='text-2xl text-cyan-900 dark:text-cyan-700'>Etapa 01 - Planejamento</h1>

        {/* Stop criteria */}
        <div className="flex flex-col gap-3">
          <SectionHeader label="Critério de Parada" sub="Controla quando o solver encerra a geração" />
          <div className="rounded-lg border border-border divide-y divide-border">
            <div className="flex items-center justify-between gap-6 px-4 py-3">
              <div>
                <p className="text-sm font-medium">Parar sem Melhora</p>
                <p className="text-xs text-muted-foreground mt-0.5">Encerra se nenhuma solução melhor for encontrada neste intervalo</p>
              </div>
              <div className="flex items-center gap-2">
                <Stepper
                  value={planning?.stopNoImprovementMinutes ?? 10}
                  onChange={(v) => setPlanning((prev) => prev ? { ...prev, stopNoImprovementMinutes: v } : null)}
                  min={1}
                  max={60}
                  disabled={!planning}
                />
                <span className="text-sm text-muted-foreground w-6">min</span>
              </div>
            </div>
            <div className="flex items-center justify-between gap-6 px-4 py-3">
              <div>
                <p className="text-sm font-medium">Tempo Máximo de Geração</p>
                <p className="text-xs text-muted-foreground mt-0.5">Encerra independentemente do resultado após este tempo</p>
              </div>
              <div className="flex items-center gap-2">
                <Stepper
                  value={planning?.stopMaxTotalMinutes ?? 240}
                  onChange={(v) => setPlanning((prev) => prev ? { ...prev, stopMaxTotalMinutes: v } : null)}
                  min={1}
                  max={1440}
                  disabled={!planning}
                />
                <span className="text-sm text-muted-foreground w-6">min</span>
              </div>
            </div>
          </div>
        </div>

        {/* Anchored criteria (plan) */}
        {planning && gPlanning && (
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
              data={planning.anchored}
              globalData={isBranch ? gPlanning.anchored : planning.anchored}
              meta={ANCHORED_META}
              onChange={updatePlanningAnchored}
            />
          </div>
        )}

        {/* Range criteria */}
        {planning && gPlanning && (
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
              data={planning.range}
              globalData={isBranch ? gPlanning.range : planning.range}
              meta={RANGE_META}
              onChange={updatePlanningRange}
            />
          </div>
        )}

        {/* Line-scoped criteria */}
        {planning && gPlanning && (
          <div className="flex flex-col gap-3 mt-4">
            <SectionHeader
              label="Critérios de Linha"
              sub="Score de VehiclePlanLine — só a operação da própria linha, nunca decisões de reaproveitamento entre linhas."
            />
            <RangeTable
              data={{
                demandMatch:          planning.line.demandMatch,
                headwayRegularity:    planning.line.headwayRegularity,
                maxGap:               planning.line.maxGap,
                peakConcentration:    planning.line.peakConcentration,
                distributionVariance: planning.line.distributionVariance,
              }}
              globalData={isBranch ? {
                demandMatch:          gPlanning.line.demandMatch,
                headwayRegularity:    gPlanning.line.headwayRegularity,
                maxGap:               gPlanning.line.maxGap,
                peakConcentration:    gPlanning.line.peakConcentration,
                distributionVariance: gPlanning.line.distributionVariance,
              } : {
                demandMatch:          planning.line.demandMatch,
                headwayRegularity:    planning.line.headwayRegularity,
                maxGap:               planning.line.maxGap,
                peakConcentration:    planning.line.peakConcentration,
                distributionVariance: planning.line.distributionVariance,
              }}
              meta={LINE_RANGE_META}
              onChange={updateLineRange}
            />
            <AnchoredTable
              data={{ fleetUsage: planning.line.fleetUsage }}
              globalData={{ fleetUsage: isBranch ? gPlanning.line.fleetUsage : planning.line.fleetUsage }}
              meta={LINE_FLEET_META}
              onChange={(_key, field, value) => updateLineFleetUsage(field, value)}
            />
          </div>
        )}
      </section>
      <hr className='mt-2' />

      {/* ── Escala ── */}
      <section className="flex flex-col gap-6 mb-20">
        <h1 className='text-2xl text-cyan-900 dark:text-cyan-700'>Etapa 02 - Escala de operadores</h1>

        {/* Transit Scope selector — CCT rules are shared by every operator of the Scope */}
        <div className="flex items-center gap-3">
          <span className="text-sm text-muted-foreground">Scope</span>
          <Select
            value={crewScope}
            onChange={(e) => setCrewScope(e.target.value)}
            size="sm"
            className="w-56"
          >
            <option value="global">Global</option>
            {transitScopes?.map((s) => (
              <option key={s.id} value={s.id}>{s.name}</option>
            ))}
          </Select>
          {isCrewScoped && (
            <span className="flex items-center gap-x-2 text-xs text-muted-foreground">
              <span className="w-1.5 h-1.5 rounded-full bg-amber-600 flex-shrink-0"></span>
              <span>Diferentes do Global</span>
            </span>
          )}
        </div>

        {crew && gCrew && (
          <CrewSettingsEditor
            value={crew}
            reference={isCrewScoped ? gCrew : null}
            onChange={setCrew}
          />
        )}

        {crewCost && (
          <div className="mt-4">
            <CrewCostEditor
              value={crewCost}
              reference={isCrewScoped ? (globalCrewCost ?? null) : null}
              onChange={setCrewCost}
            />
          </div>
        )}

        {roster && (
          <div className="flex flex-col gap-3 mt-4">
            <SectionHeader label="Escala Nominal" sub="Global — ainda sem uso, reservado para a atribuição de pessoas às jornadas" />
            <RangeTable
              data={roster.range}
              globalData={roster.range}
              meta={ROSTER_META}
              onChange={updateRosterRange}
            />
          </div>
        )}
      </section>
    </div>
  )
}
