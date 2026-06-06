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
import { cn } from '@/lib/utils'
import type { GeneralSettings, PlanningSettings, ScheduleSettings, FlatCriterion, RangeCriterion } from '@nyx/schemas'

// ── UI metadata (not stored in settings) ────────────────────────────────────

const FLAT_META: Record<keyof PlanningSettings['flat'], { label: string; unit: string; hint: string; phase: 1 | 2 }> = {
  fleetUsage:           { label: 'Uso de Frota',              unit: 'por veículo',   hint: 'Peso por veículo utilizado no plano.',                                          phase: 1 },
  deadrunKm:            { label: 'Km em Vazio',               unit: 'por km',        hint: 'Peso por km de deslocamento em vazio no plano.',                                phase: 1 },
  totalKm:              { label: 'Km Total',                  unit: 'por km',        hint: 'Peso por km total percorrido no plano.',                                        phase: 1 },
  distributionVariance: { label: 'Variância de Distribuição', unit: 'por coef.',     hint: 'Penaliza planos desbalanceados. Quantity = desvio padrão / média de km por bloco.', phase: 1 },
  specialFleetUsage:    { label: 'Frota Especial',            unit: 'por bloco',     hint: 'Custo por bloco que requer tipo de veículo especial (requiredVehicleType).',     phase: 1 },
  driverUsage:          { label: 'Uso de Condutores',         unit: 'por condutor',  hint: '[Fase 2] Custo por condutor utilizado no plano.',                                phase: 2 },
  overtime:             { label: 'Hora Extra',                unit: 'por minuto',    hint: '[Fase 2] Custo por minuto de hora extra no plano.',                              phase: 2 },
}

const RANGE_META: Record<keyof PlanningSettings['range'], { label: string; unit: string; hint: string }> = {
  lineTransfer: { label: 'Troca de Linha',      unit: 'trocas', hint: 'Nº de trocas de linha no bloco (linhas distintas - 1). Zero = bloco com linha única.' },
  tripInterval: { label: 'Intervalo de Viagem', unit: 'min',    hint: 'Menor intervalo entre viagens consecutivas no bloco (minutos).' },
  deadrunRatio: { label: 'Ratio Km em Vazio',   unit: '%',      hint: 'Proporção de km em vazio sobre o total do bloco.' },
}

const SCHEDULE_META: Record<keyof ScheduleSettings['range'], { label: string; unit: string; hint: string }> = {
  layover:            { label: 'Duração do Turno',        unit: 'min', hint: 'Duração total do turno (minutos).' },
  shiftBreak:         { label: 'Pausa no Turno',          unit: 'min', hint: 'Duração da pausa dentro do turno (minutos).' },
  interShiftRest:     { label: 'Descanso entre Turnos',   unit: 'min', hint: 'Descanso entre turnos consecutivos do mesmo condutor (minutos).' },
  splitShiftInterval: { label: 'Intervalo Turno Partido', unit: 'min', hint: 'Intervalo entre as partes de um turno partido (minutos).' },
  driverPrefLine:     { label: 'Linha Preferencial',      unit: '%',   hint: '% de viagens do turno nas linhas preferenciais do condutor.' },
  driverPrefTech:     { label: 'Tech Preferencial',       unit: '%',   hint: '% de viagens do turno com tecnologia de veículo preferencial do condutor.' },
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
  return (
    <div className="relative">
      <button
        type="button"
        onClick={() => setOpen((o) => !o)}
        className="text-muted-foreground/50 hover:text-muted-foreground transition-colors"
      >
        <Icons.Info className="w-3.5 h-3.5" />
      </button>
      {open && (
        <>
          <div className="fixed inset-0 z-40" onClick={() => setOpen(false)} />
          <div className="absolute right-0 top-5 z-50 w-56 rounded border bg-popover p-2.5 text-xs text-muted-foreground shadow-md">
            {hint}
          </div>
        </>
      )}
    </div>
  )
}

function PhaseBadge() {
  return (
    <span className="rounded px-1.5 py-0.5 text-[10px] font-medium bg-muted text-muted-foreground">
      Fase 2
    </span>
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

// ── FlatTable ────────────────────────────────────────────────────────────────

function FlatTable({ data, globalData, onChange, disabled }: {
  data:       PlanningSettings['flat']
  globalData: PlanningSettings['flat']
  onChange:   (key: keyof PlanningSettings['flat'], field: keyof FlatCriterion, value: unknown) => void
  disabled?:  boolean
}) {
  const keys = Object.keys(FLAT_META) as (keyof PlanningSettings['flat'])[]

  return (
    <div className="rounded-lg border border-border overflow-hidden">
      <table className="w-full text-sm">
        <thead>
          <tr className="border-b border-border bg-muted/30">
            <th className="w-1.5" />
            <th className="px-3 py-2 text-left text-xs font-medium text-muted-foreground">Critério</th>
            <th className="px-3 py-2 text-center text-xs font-medium text-muted-foreground w-16">Ativo</th>
            <th className="px-3 py-2 text-center text-xs font-medium text-muted-foreground w-24">Direção</th>
            <th className="px-3 py-2 text-center text-xs font-medium text-muted-foreground w-24">Peso</th>
            <th className="px-3 py-2 text-center text-xs font-medium text-muted-foreground w-8" />
          </tr>
        </thead>
        <tbody className="divide-y divide-border">
          {keys.map((key) => {
            const meta      = FLAT_META[key]
            const row       = data[key]
            const globalRow = globalData[key]
            const isPhase2  = meta.phase === 2
            const isDiff    = !disabled && (
              row.active !== globalRow.active ||
              row.direction !== globalRow.direction ||
              row.weight !== globalRow.weight
            )
            const isDisabled = disabled || isPhase2

            return (
              <tr key={key} className={cn('group', isPhase2 && 'opacity-50')}>
                <td className="pl-2 pr-0">
                  <div className="flex items-center justify-center h-full py-3">
                    <DiffDot show={isDiff} />
                  </div>
                </td>
                <td className="px-3 py-2.5">
                  <div className="flex items-center gap-2">
                    <span className={cn(isPhase2 && 'text-muted-foreground')}>{meta.label}</span>
                    <span className="text-xs text-muted-foreground/50">{meta.unit}</span>
                    {isPhase2 && <PhaseBadge />}
                  </div>
                </td>
                <td className="px-3 py-2.5 text-center">
                  <div className="flex justify-center">
                    <Switch
                      checked={row.active}
                      onToggle={() => onChange(key, 'active', !row.active)}
                      disabled={isDisabled}
                    />
                  </div>
                </td>
                <td className="px-3 py-2.5 text-center text-xs text-muted-foreground">
                  {row.direction === 'minimize' ? 'Minimizar' : 'Maximizar'}
                </td>
                <td className="px-3 py-2.5 text-center">
                  <div className="flex justify-center">
                    <NumberInput
                      value={row.weight}
                      onChange={(v) => onChange(key, 'weight', v)}
                      min={0}
                      step={10}
                      disabled={isDisabled}
                    />
                  </div>
                </td>
                <td className="px-3 py-2.5 text-center">
                  <div className="flex justify-center">
                    <HintPopover hint={meta.hint} />
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
    <div className="rounded-lg border border-border overflow-hidden">
      <table className="w-full text-sm">
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
  const [schedule, setSchedule] = useState<ScheduleSettings | null>(null)

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

  const { data: globalSchedule } = useQuery<ScheduleSettings>({
    queryKey: ['transit', 'settings', 'schedule', 'global'],
    queryFn:  async () => {
      const res = await apiFetch('/transit/settings/schedule?scope=global')
      if (!res.ok) throw new Error()
      return res.json()
    },
  })

  const { data: serverSchedule } = useQuery<ScheduleSettings>({
    queryKey: ['transit', 'settings', 'schedule', scope],
    queryFn:  async () => {
      const res = await apiFetch(`/transit/settings/schedule?scope=${scope}`)
      if (!res.ok) throw new Error()
      return res.json()
    },
  })

  // ── sync server → form ─────────────────────────────────────────────────────

  useEffect(() => { if (serverGeneral)  setGeneral(serverGeneral)   }, [serverGeneral,  resetSignal])
  useEffect(() => { if (serverPlanning) setPlanning(serverPlanning) }, [serverPlanning, resetSignal])
  useEffect(() => { if (serverSchedule) setSchedule(serverSchedule) }, [serverSchedule, resetSignal])

  // ── save ───────────────────────────────────────────────────────────────────

  async function handleSave() {
    if (!general || !planning || !schedule) return
    setSaving(true)
    try {
      const [r1, r2, r3] = await Promise.all([
        apiFetch('/transit/settings/general', { method: 'PUT', body: JSON.stringify(general) }),
        apiFetch(`/transit/settings/planning?scope=${scope}`, { method: 'PUT', body: JSON.stringify(planning) }),
        apiFetch(`/transit/settings/schedule?scope=${scope}`, { method: 'PUT', body: JSON.stringify(schedule) }),
      ])
      if (!r1.ok || !r2.ok || !r3.ok) throw new Error()
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
  ], [general, planning, schedule, saving, scope])

  useShortcut('alt+g', handleSave, { desc: 'Salvar configurações', icon: Icons.Save, origin: 'TransitSettingsPage' })
  useShortcut('alt+v', () => router.push('/transit'), { desc: 'Voltar', icon: Icons.ArrowLeft, origin: 'TransitSettingsPage' })
  useShortcut('alt+l', () => setResetSignal((s) => s + 1), { display: false, origin: 'TransitSettingsPage' })

  // ── update helpers ─────────────────────────────────────────────────────────

  function updateFlat(key: keyof PlanningSettings['flat'], field: keyof FlatCriterion, value: unknown) {
    setPlanning((prev) => prev ? {
      ...prev,
      flat: { ...prev.flat, [key]: { ...prev.flat[key], [field]: value } },
    } : null)
  }

  function updatePlanningRange(key: keyof PlanningSettings['range'], field: keyof RangeCriterion, value: unknown) {
    setPlanning((prev) => prev ? {
      ...prev,
      range: { ...prev.range, [key]: { ...prev.range[key], [field]: value } },
    } : null)
  }

  function updateScheduleRange(key: keyof ScheduleSettings['range'], field: keyof RangeCriterion, value: unknown) {
    setSchedule((prev) => prev ? {
      ...prev,
      range: { ...prev.range, [key]: { ...prev.range[key], [field]: value } },
    } : null)
  }

  const isBranch   = scope !== 'global'
  const gPlanning  = globalPlanning ?? planning
  const gSchedule  = globalSchedule ?? schedule

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
              <span className="text-sm text-muted-foreground w-4">h</span>
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

        {/* Flat criteria */}
        {planning && gPlanning && (
          <div className="flex flex-col gap-3">
            <SectionHeader
              label="Critérios Globais"
              sub="Calculados sobre o plano. Peso × quantidade = custo no score final."
            />
            <div className='flex items-center gap-x-2 rounded-sm p-3 text-sm text-slate-50 bg-slate-500 dark:text-slate-300 dark:bg-slate-800/50'>
              <Icons.Info className="w-4 h-4 shrink-0" />
              <span className='tracking-wide'>Critérios globais definem a prioridade do algoritmo. Quanto maior o peso de um item <b>em relação aos demais</b>, mais o <dfn className='text-amber-200 cursor-help' title='Motor de otimização do sistema'>solver</dfn> focará em otimizá-lo</span>
            </div>
            <FlatTable
              data={planning.flat}
              globalData={isBranch ? gPlanning.flat : planning.flat}
              onChange={updateFlat}
            />
          </div>
        )}

        {/* Range criteria */}
        {planning && gPlanning && (
          <div className="flex flex-col gap-3 mt-4">
            <SectionHeader
              label="Critérios por Bloco"
              sub="Calculados em isolamento por bloco e somados ao score. Modifier = peso do critério no score do bloco."
            />
            <div className='flex items-center gap-x-2 rounded-sm py-3 px-4 text-sm text-slate-50 bg-slate-500 dark:text-slate-300 dark:bg-slate-800/50'>
              <Icons.Info className="w-4 h-4 shrink-0" />
              <span className='tracking-wide'>
                Modifier define o peso do item. Um valor '0.5' indica metade da importância de um item '1'. Como o modifier altera a pontuação em escala exponencial, pequenas variações causam forte impacto no direcionamento do <dfn className='text-amber-200 cursor-help' title='Motor de otimização do sistema'>solver</dfn>. Altere com cuidado.
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
      </section>      
      <hr className='mt-2' />

      {/* ── Escala ── */}
      <section className="flex flex-col gap-3 mb-20">
        <h1 className='text-2xl text-cyan-900 dark:text-cyan-700'>Etapa 02 - Escala de operadores</h1>
        {schedule && gSchedule && (
          <RangeTable
            data={schedule.range}
            globalData={isBranch ? gSchedule.range : schedule.range}
            meta={SCHEDULE_META}
            onChange={updateScheduleRange}
            disabled
          />
        )}
      </section>
    </div>
  )
}
