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
import type { GeneralSettings, PlanningSettings, CrewSettings, CrewCostSettings, RosterSettings, RangeCriterion } from '@nyx/schemas'
import { SectionHeader, NumberInput, RangeTable } from './criteria-tables'
import { PlanningSettingsEditor } from './planning-settings-editor'
import { CrewSettingsEditor } from './crew-settings-editor'
import { CrewCostEditor } from './crew-cost-editor'

// ── UI metadata (not stored in settings) ────────────────────────────────────

const ROSTER_META: Record<keyof RosterSettings['range'], { label: string; unit: string; hint: string }> = {
  interShiftRest: { label: 'Descanso entre Jornadas', unit: 'min', hint: 'Descanso entre jornadas consecutivas da mesma pessoa.' },
  driverPrefLine: { label: 'Linha Preferencial',      unit: '%',   hint: '% de viagens da jornada nas linhas preferenciais da pessoa.' },
  driverPrefTech: { label: 'Tech Preferencial',       unit: '%',   hint: '% de viagens da jornada com tecnologia de veículo preferencial da pessoa.' },
}

// ── Types ────────────────────────────────────────────────────────────────────

interface TransitScope { id: string; name: string }
interface IntervalTypeOption { id: string; name: string }

// ── Page ─────────────────────────────────────────────────────────────────────

export default function TransitSettingsPage() {
  const router      = useRouter()
  const queryClient = useQueryClient()
  const { toast }   = useToast()

  // planning settings are keyed by transit Scope, like the crew rules below
  const [scope, setScope]       = useState<string>('global')
  const [saving, setSaving]     = useState(false)
  const [resetSignal, setResetSignal] = useState(0)

  // form state
  const [general,  setGeneral]  = useState<GeneralSettings  | null>(null)
  const [planning, setPlanning] = useState<PlanningSettings | null>(null)
  const [crew,     setCrew]     = useState<CrewSettings     | null>(null)
  const [roster,   setRoster]   = useState<RosterSettings   | null>(null)
  const [crewCost, setCrewCost] = useState<CrewCostSettings | null>(null)
  // crew rules are keyed by transit Scope (CCT), independent from the planning one above
  const [crewScope, setCrewScope] = useState<string>('global')

  // ── remote data ────────────────────────────────────────────────────────────

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

  function updateRosterRange(key: keyof RosterSettings['range'], field: keyof RangeCriterion, value: unknown) {
    setRoster((prev) => prev ? {
      ...prev,
      range: { ...prev.range, [key]: { ...prev.range[key], [field]: value } },
    } : null)
  }

  const isPlanningScoped = scope !== 'global'
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

        {/* Transit Scope selector — the vehicle plans of a Scope inherit these */}
        <div className="flex items-center gap-3">
          <span className="text-sm text-muted-foreground">Scope</span>
          <Select
            value={scope}
            onChange={(e) => setScope(e.target.value)}
            size="sm"
            className="w-56"
          >
            <option value="global">Global</option>
            {transitScopes?.map((s) => (
              <option key={s.id} value={s.id}>{s.name}</option>
            ))}
          </Select>
          {isPlanningScoped && (
            <span className="flex items-center gap-x-2 text-xs text-muted-foreground">
              <span className="w-1.5 h-1.5 rounded-full bg-amber-600 flex-shrink-0"></span>
              <span>Diferentes do Global</span>
            </span>
          )}
        </div>

        {planning && gPlanning && (
          <PlanningSettingsEditor
            value={planning}
            reference={isPlanningScoped ? gPlanning : null}
            onChange={setPlanning}
          />
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
