'use client'

import { useState, useEffect, useRef } from 'react'
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
import { cn } from '@/lib/utils'
import type { GeneralSettings, PlanningSettings, CrewSettings, RosterSettings, AnchoredCriterion, RangeCriterion } from '@nyx/schemas'

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

const CREW_RANGE_META: Record<keyof CrewSettings['range'], { label: string; unit: string; hint: string }> = {
  workTime:       { label: 'Duração da Jornada',      unit: 'min',    hint: 'Minutos trabalhados na jornada (pegadas + atividades pagas).' },
  spread:         { label: 'Amplitude',               unit: 'min',    hint: 'Da apresentação ao encerramento da jornada, incluindo intervalos.' },
  mealBreak:      { label: 'Intervalo Intrajornada',  unit: 'min',    hint: 'Duração do intervalo de refeição dentro da jornada.' },
  splitInterval:  { label: 'Intervalo Dupla Pegada',  unit: 'min',    hint: 'Intervalo entre as pegadas de uma jornada em dupla pegada.' },
  overtimeRatio:  { label: 'Horas Extras',            unit: '%',      hint: 'Minutos extras sobre o total trabalhado no plano.' },
  splitRatio:     { label: 'Jornadas em Dupla Pegada', unit: '%',     hint: 'Proporção de jornadas em dupla pegada no plano.' },
  vehicleChanges: { label: 'Trocas de Carro',         unit: 'trocas', hint: 'Trocas de carro dentro de uma mesma jornada.' },
}

const CREW_ANCHORED_META: Record<keyof CrewSettings['anchored'], { label: string; unit: string; hint: string }> = {
  dutyCount:  { label: 'Nº de Jornadas', unit: '% sobre mínimo', hint: 'Jornadas do plano sobre o mínimo teórico (minutos de bloco ÷ duração ideal mínima da jornada).' },
  efficiency: { label: 'Eficiência',     unit: '% sobre mínimo', hint: 'Minutos pagos sobre os minutos de bloco cobertos.' },
}

const CREW_PARAMS: { key: 'signOnMinutes' | 'signOffMinutes' | 'handoverMinutes' | 'minPieceMinutes' | 'maxContinuousDrivingMinutes' | 'nightStartHour' | 'nightEndHour'; label: string; hint: string; unit: string; max: number }[] = [
  { key: 'signOnMinutes',               label: 'Apresentação',              unit: 'min', max: 120,  hint: 'Tempo antes da primeira pegada da jornada' },
  { key: 'signOffMinutes',              label: 'Encerramento',              unit: 'min', max: 120,  hint: 'Tempo após a última pegada da jornada' },
  { key: 'handoverMinutes',             label: 'Sobreposição na Rendição',  unit: 'min', max: 60,   hint: 'Sobreposição tolerada entre pegadas do mesmo papel no mesmo carro' },
  { key: 'minPieceMinutes',             label: 'Pegada Mínima',             unit: 'min', max: 1440, hint: 'Pegadas mais curtas são sinalizadas' },
  { key: 'maxContinuousDrivingMinutes', label: 'Direção Contínua Máxima',   unit: 'min', max: 1440, hint: 'Tempo máximo ao volante sem intervalo' },
  { key: 'nightStartHour',              label: 'Início do Período Noturno', unit: 'h',   max: 23,   hint: 'Hora de início da janela noturna (informativo)' },
  { key: 'nightEndHour',                label: 'Fim do Período Noturno',    unit: 'h',   max: 23,   hint: 'Hora de fim da janela noturna (informativo)' },
]

const ROSTER_META: Record<keyof RosterSettings['range'], { label: string; unit: string; hint: string }> = {
  interShiftRest: { label: 'Descanso entre Jornadas', unit: 'min', hint: 'Descanso entre jornadas consecutivas da mesma pessoa.' },
  driverPrefLine: { label: 'Linha Preferencial',      unit: '%',   hint: '% de viagens da jornada nas linhas preferenciais da pessoa.' },
  driverPrefTech: { label: 'Tech Preferencial',       unit: '%',   hint: '% de viagens da jornada com tecnologia de veículo preferencial da pessoa.' },
}

// ── Small components ─────────────────────────────────────────────────────────

function SectionHeader({ label, sub }: { label: string; sub?: string }) {
  return (
    <div className="flex items-baseline gap-3 mb-3">
      <p className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">{label}</p>
      {sub && <p className="text-xs text-muted-foreground/60">{sub}</p>}
    </div>
  )
}

function HintPopover({ hint }: { hint: string }) {
  const [open, setOpen] = useState(false)
  const [pos, setPos]   = useState({ top: 0, right: 0 })
  const btnRef          = useRef<HTMLButtonElement>(null)

  function handleOpen() {
    if (btnRef.current) {
      const rect = btnRef.current.getBoundingClientRect()
      setPos({ top: rect.bottom + 4, right: window.innerWidth - rect.right })
    }
    setOpen((o) => !o)
  }

  return (
    <div>
      <button
        ref={btnRef}
        type="button"
        onClick={handleOpen}
        className="text-muted-foreground/50 hover:text-muted-foreground transition-colors"
      >
        <Icons.Info className="w-3.5 h-3.5" />
      </button>
      {open && (
        <>
          <div className="fixed inset-0 z-40" onClick={() => setOpen(false)} />
          <div
            className="fixed z-50 w-56 rounded border bg-popover p-2.5 text-xs text-muted-foreground shadow-md"
            style={{ top: pos.top, right: pos.right }}
          >
            {hint}
          </div>
        </>
      )}
    </div>
  )
}


function DiffDot({ show }: { show: boolean }) {
  if (!show) return <span className="w-1.5" />
  return <span className="w-1.5 h-1.5 rounded-full bg-amber-700 flex-shrink-0" title="Difere do global" />
}

function NumberInput({ value, onChange, min = 0, max, step = 1, disabled }: {
  value:     number
  onChange:  (v: number) => void
  min?:      number
  max?:      number
  step?:     number
  disabled?: boolean
}) {
  return (
    <input
      type="number"
      value={value}
      min={min}
      max={max}
      step={step}
      disabled={disabled}
      onChange={(e) => {
        const v = parseFloat(e.target.value)
        if (!isNaN(v)) onChange(Math.max(min, max !== undefined ? Math.min(max, v) : v))
      }}
      className={cn(
        'h-8 w-20 rounded-sm border border-input bg-input-bg text-center text-sm',
        'focus:outline-none focus:ring-1 focus:ring-ring',
        'disabled:cursor-not-allowed disabled:opacity-60',
        '[appearance:textfield] [&::-webkit-outer-spin-button]:appearance-none [&::-webkit-inner-spin-button]:appearance-none',
      )}
    />
  )
}

// ── AnchoredTable ────────────────────────────────────────────────────────────

type AnchoredMeta = Record<string, { label: string; unit: string; hint: string }>

function AnchoredTable<T extends Record<string, AnchoredCriterion>>({ data, globalData, meta, onChange, disabled }: {
  data:       T
  globalData: T
  meta:       AnchoredMeta
  onChange?:  (key: keyof T, field: keyof AnchoredCriterion, value: unknown) => void
  disabled?:  boolean
}) {
  const keys = Object.keys(meta) as (keyof T)[]

  return (
    <div className="overflow-x-auto rounded-lg border border-border">
      <table className="w-full min-w-max text-sm">
        <thead>
          <tr className="border-b border-border bg-muted/30">
            <th className="w-1.5" />
            <th className="px-3 py-2 text-left text-xs font-medium text-muted-foreground">Critério</th>
            <th className="px-3 py-2 text-center text-xs font-medium text-muted-foreground w-16">Ativo</th>
            <th className="px-3 py-2 text-center text-xs font-medium text-muted-foreground w-28">Ideal até (%)</th>
            <th className="px-3 py-2 text-center text-xs font-medium text-muted-foreground w-28">Ceiling (%)</th>
            <th className="px-3 py-2 text-center text-xs font-medium text-muted-foreground w-24">Peso</th>
            <th className="px-3 py-2 text-center text-xs font-medium text-muted-foreground w-8" />
          </tr>
        </thead>
        <tbody className="divide-y divide-border">
          {keys.map((key) => {
            const m         = meta[key as string]
            const row       = data[key]
            const globalRow = globalData[key]
            const isDiff    = !disabled && (
              row.active              !== globalRow.active ||
              row.idealMaxOverPercent !== globalRow.idealMaxOverPercent ||
              row.ceilingOverPercent  !== globalRow.ceilingOverPercent ||
              row.weight              !== globalRow.weight
            )

            const set = (field: keyof AnchoredCriterion, value: unknown) => onChange?.(key, field, value)

            return (
              <tr key={String(key)} className="group">
                <td className="pl-2 pr-0">
                  <div className="flex items-center justify-center h-full py-3">
                    <DiffDot show={isDiff} />
                  </div>
                </td>
                <td className="px-3 py-2.5">
                  <div className="flex items-center gap-2">
                    <span>{m.label}</span>
                    <span className="text-xs text-muted-foreground/50">{m.unit}</span>
                  </div>
                </td>
                <td className="px-3 py-2.5 text-center">
                  <div className="flex justify-center">
                    <Switch
                      checked={row.active}
                      onToggle={() => set('active', !row.active)}
                      disabled={disabled}
                    />
                  </div>
                </td>
                <td className="px-3 py-2.5 text-center">
                  <div className="flex justify-center">
                    <NumberInput value={row.idealMaxOverPercent} onChange={(v) => set('idealMaxOverPercent', v)} min={0} disabled={disabled} />
                  </div>
                </td>
                <td className="px-3 py-2.5 text-center">
                  <div className="flex justify-center">
                    <NumberInput value={row.ceilingOverPercent} onChange={(v) => set('ceilingOverPercent', v)} min={0} disabled={disabled} />
                  </div>
                </td>
                <td className="px-3 py-2.5 text-center">
                  <div className="flex justify-center">
                    <NumberInput value={row.weight} onChange={(v) => set('weight', v)} min={0} step={5} disabled={disabled} />
                  </div>
                </td>
                <td className="px-3 py-2.5 text-center">
                  <div className="flex justify-center">
                    <HintPopover hint={m.hint} />
                  </div>
                </td>
              </tr>
            )
          })}
        </tbody>
      </table>
    </div>
  )
}

// ── RangeTable ───────────────────────────────────────────────────────────────

type RangeMeta = Record<string, { label: string; unit: string; hint: string }>

function RangeTable<T extends Record<string, RangeCriterion>>({ data, globalData, meta, onChange, disabled }: {
  data:       T
  globalData: T
  meta:       RangeMeta
  onChange?:  (key: keyof T, field: keyof RangeCriterion, value: unknown) => void
  disabled?:  boolean
}) {
  const keys = Object.keys(meta) as (keyof T)[]

  return (
    <div className="overflow-x-auto rounded-lg border border-border">
      <table className="w-full min-w-max text-sm">
        <thead>
          <tr className="border-b border-border bg-muted/30">
            <th className="w-1.5" />
            <th className="px-3 py-2 text-left text-xs font-medium text-muted-foreground">Critério</th>
            <th className="px-3 py-2 text-center text-xs font-medium text-muted-foreground w-16">Ativo</th>
            <th className="px-3 py-2 text-center text-xs font-medium text-muted-foreground w-20">Modifier</th>
            <th className="px-3 py-2 text-center text-xs font-medium text-muted-foreground w-20">Floor</th>
            <th className="px-3 py-2 text-center text-xs font-medium text-muted-foreground w-20">Ideal Min</th>
            <th className="px-3 py-2 text-center text-xs font-medium text-muted-foreground w-20">Ideal Max</th>
            <th className="px-3 py-2 text-center text-xs font-medium text-muted-foreground w-20">Ceiling</th>
            <th className="px-3 py-2 text-center text-xs font-medium text-muted-foreground w-8" />
          </tr>
        </thead>
        <tbody className="divide-y divide-border">
          {keys.map((key) => {
            const m         = meta[key as string]
            const row       = data[key]
            const globalRow = globalData[key]
            const isDiff    = !disabled && (
              row.active   !== globalRow.active   ||
              row.modifier !== globalRow.modifier ||
              row.floor    !== globalRow.floor    ||
              row.idealMin !== globalRow.idealMin ||
              row.idealMax !== globalRow.idealMax ||
              row.ceiling  !== globalRow.ceiling
            )

            const set = (field: keyof RangeCriterion, value: unknown) =>
              onChange?.(key, field, value)

            return (
              <tr key={String(key)} className="group">
                <td className="pl-2 pr-0">
                  <div className="flex items-center justify-center h-full py-3">
                    <DiffDot show={isDiff} />
                  </div>
                </td>
                <td className="px-3 py-2.5">
                  <div className="flex items-center gap-2">
                    <span>{m.label}</span>
                    <span className="text-xs text-muted-foreground/50">{m.unit}</span>
                  </div>
                </td>
                <td className="px-3 py-2.5 text-center">
                  <div className="flex justify-center">
                    <Switch
                      checked={row.active}
                      onToggle={() => set('active', !row.active)}
                      disabled={disabled}
                    />
                  </div>
                </td>
                <td className="px-3 py-2.5 text-center">
                  <div className="flex justify-center">
                    <NumberInput value={row.modifier} onChange={(v) => set('modifier', v)} min={0} max={100} step={0.1} disabled={disabled} />
                  </div>
                </td>
                <td className="px-3 py-2.5 text-center">
                  <div className="flex justify-center">
                    <NumberInput value={row.floor} onChange={(v) => set('floor', v)} min={0} disabled={disabled} />
                  </div>
                </td>
                <td className="px-3 py-2.5 text-center">
                  <div className="flex justify-center">
                    <NumberInput value={row.idealMin} onChange={(v) => set('idealMin', v)} min={0} disabled={disabled} />
                  </div>
                </td>
                <td className="px-3 py-2.5 text-center">
                  <div className="flex justify-center">
                    <NumberInput value={row.idealMax} onChange={(v) => set('idealMax', v)} min={0} disabled={disabled} />
                  </div>
                </td>
                <td className="px-3 py-2.5 text-center">
                  <div className="flex justify-center">
                    <NumberInput value={row.ceiling} onChange={(v) => set('ceiling', v)} min={0} disabled={disabled} />
                  </div>
                </td>
                <td className="px-3 py-2.5 text-center">
                  <div className="flex justify-center">
                    <HintPopover hint={m.hint} />
                  </div>
                </td>
              </tr>
            )
          })}
        </tbody>
      </table>
    </div>
  )
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
  /* eslint-enable react-hooks/set-state-in-effect */

  // ── save ───────────────────────────────────────────────────────────────────

  async function handleSave() {
    if (!general || !planning || !crew || !roster) return
    setSaving(true)
    try {
      const responses = await Promise.all([
        apiFetch('/transit/settings/general', { method: 'PUT', body: JSON.stringify(general) }),
        apiFetch(`/transit/settings/planning?scope=${scope}`, { method: 'PUT', body: JSON.stringify(planning) }),
        apiFetch(`/transit/settings/crew?scope=${crewScope}`, { method: 'PUT', body: JSON.stringify(crew) }),
        apiFetch('/transit/settings/roster', { method: 'PUT', body: JSON.stringify(roster) }),
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
  ], [general, planning, crew, roster, saving, scope, crewScope])

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

  function updateCrewRange(key: keyof CrewSettings['range'], field: keyof RangeCriterion, value: unknown) {
    setCrew((prev) => prev ? {
      ...prev,
      range: { ...prev.range, [key]: { ...prev.range[key], [field]: value } },
    } : null)
  }

  function updateCrewAnchored(key: keyof CrewSettings['anchored'], field: keyof AnchoredCriterion, value: unknown) {
    setCrew((prev) => prev ? {
      ...prev,
      anchored: { ...prev.anchored, [key]: { ...prev.anchored[key], [field]: value } },
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
                Fator aplicado pelo solver em viagens produtivas com tempos provenientes do OSRM. Tempos cadastrados manualmente na linha não são afetados.
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
                Multiplicador aplicado aos tempos retornados pelo OSRM ao gerar a matriz de tempos. Não afeta pares já gerados.
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
                Ao reprocessar ou promover uma rota a principal, atualiza automaticamente a extensão oficial da linha (metrics.extensionKm) no sentido correspondente
              </p>
            </div>
            <Switch
              checked={general?.propagateExtensionToOfficialKm ?? true}
              onToggle={() => setGeneral((prev) => prev ? { ...prev, propagateExtensionToOfficialKm: !prev.propagateExtensionToOfficialKm } : null)}
              disabled={!general}
            />
          </div>
          <div className="flex items-center justify-between gap-6 px-4 py-3">
            <div>
              <p className="text-sm font-medium">Comportamento do gerador em intervalos longos</p>
              <p className="text-xs text-muted-foreground mt-0.5">
                Comportamento do gerador de planejamento em paradas intermediárias (intervalos longos), quando não especificado na rota: aguardar no ponto ou recolher à garagem
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
                Usado para inserir automaticamente um BlockInterval em paradas longas entre viagens de um bloco (na importação e ao Finalizar Plano)
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
          <div className="flex flex-col gap-3">
            <SectionHeader label="Parâmetros da Jornada" sub="Regras da CCT aplicadas à escala lógica" />
            <div className="rounded-lg border border-border divide-y divide-border">
              {CREW_PARAMS.map((p) => (
                <div key={p.key} className="flex items-center justify-between gap-6 px-4 py-3">
                  <div className="flex items-center gap-2">
                    <DiffDot show={isCrewScoped && crew[p.key] !== gCrew[p.key]} />
                    <div>
                      <p className="text-sm font-medium">{p.label}</p>
                      <p className="text-xs text-muted-foreground mt-0.5">{p.hint}</p>
                    </div>
                  </div>
                  <div className="flex items-center gap-2">
                    <NumberInput
                      value={crew[p.key]}
                      onChange={(v) => setCrew((prev) => prev ? { ...prev, [p.key]: Math.round(v) } : null)}
                      min={0}
                      max={p.max}
                    />
                    <span className="text-sm text-muted-foreground w-6">{p.unit}</span>
                  </div>
                </div>
              ))}
            </div>
          </div>
        )}

        {crew && gCrew && (
          <div className="flex flex-col gap-3">
            <SectionHeader
              label="Critérios Ancorados na Escala"
              sub="Piso inferido do próprio plano — Ideal/Ceiling em % acima desse piso."
            />
            <AnchoredTable
              data={crew.anchored}
              globalData={isCrewScoped ? gCrew.anchored : crew.anchored}
              meta={CREW_ANCHORED_META}
              onChange={updateCrewAnchored}
            />
          </div>
        )}

        {crew && gCrew && (
          <div className="flex flex-col gap-3">
            <SectionHeader
              label="Critérios por Jornada"
              sub="Fora do ideal → alerta; fora de Floor/Ceiling → erro. Nenhum bloqueia o save da jornada."
            />
            <RangeTable
              data={crew.range}
              globalData={isCrewScoped ? gCrew.range : crew.range}
              meta={CREW_RANGE_META}
              onChange={updateCrewRange}
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
