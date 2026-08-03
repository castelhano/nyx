'use client'

import { Fragment, useEffect, useMemo, useState } from 'react'
import {
  ResponsiveContainer, ComposedChart, Bar, Line, XAxis, YAxis,
  Tooltip, Legend, CartesianGrid,
} from 'recharts'
import { Button }              from '@/components/ui/button'
import { Switch }               from '@/components/ui/switch'
import { Icons }                from '@/lib/icons'
import { useShortcutContext }   from '@/lib/keywatch'
import {
  MOCK_LINE, MOCK_DEPOTS, MOCK_INTERVAL_TYPES, type Direction,
} from './mock-data'
import {
  buildUnifiedWindows, mergeWithNext, splitWindow, closeFrequency, totalCycleMinutes,
  computeOfertaSeries, estimateGeneration,
  minutesToLabel, labelToMinutes, hourToLabel, labelToHour, type GenWindow,
} from './generator-logic'

const DIR_LABEL: Record<Direction, string> = { OUTBOUND: 'Ida', INBOUND: 'Volta', CIRCULAR: 'Circular' }

const TABS = [
  { key: 'janelas', label: 'Janelas' },
  { key: 'ajuste',  label: 'Ajuste' },
  { key: 'frota',   label: 'Frota' },
  { key: 'oferta',  label: 'Oferta × Demanda' },
] as const
type TabKey = (typeof TABS)[number]['key']

interface DepotAllocation { id: string; depotId: string; count: number }

interface Props {
  onClose: () => void
}

export function LineScheduleGeneratorModal({ onClose }: Props) {
  useShortcutContext('modal')
  const line = MOCK_LINE

  const [activeTab, setActiveTab] = useState<TabKey>('janelas')

  const [windows, setWindows] = useState<GenWindow[]>(
    () => buildUnifiedWindows(line.windows.OUTBOUND ?? [], line.windows.INBOUND ?? []),
  )
  const [opStart,             setOpStart]             = useState(240)  // 04:00
  const [opEnd,               setOpEnd]               = useState(1410) // 23:30
  const [vehicleCapacity,     setVehicleCapacity]      = useState(80)
  const [renewalIndex,        setRenewalIndex]         = useState<Partial<Record<Direction, number>>>(line.renewalIndex)
  const [includeAccessReturn, setIncludeAccessReturn]  = useState(false)
  const [insertInterval,      setInsertInterval]       = useState(true)
  const [intervalTypeId,      setIntervalTypeId]       = useState(MOCK_INTERVAL_TYPES[0].id)
  const [depotAllocations,    setDepotAllocations]     = useState<DepotAllocation[]>(
    [{ id: crypto.randomUUID(), depotId: MOCK_DEPOTS[0].id, count: 0 }],
  )
  const [activeDir, setActiveDir] = useState<Direction>('OUTBOUND')
  const [result,    setResult]    = useState<{ trips: number; peakFleet: number } | null>(null)

  useEffect(() => {
    function onKey(e: KeyboardEvent) { if (e.key === 'Escape') onClose() }
    document.addEventListener('keydown', onKey)
    return () => document.removeEventListener('keydown', onKey)
  }, [onClose])

  const peakFleet = useMemo(() => windows.reduce((m, w) => Math.max(m, w.fleetCount), 0), [windows])
  const depotSum  = useMemo(() => depotAllocations.reduce((s, d) => s + d.count, 0), [depotAllocations])

  // Seed the (initially empty) first depot row with the whole peak fleet once
  // it's known — keeps the single-depot case a zero-effort default.
  useEffect(() => {
    setDepotAllocations(prev => (prev.length === 1 && prev[0].count === 0 && peakFleet > 0)
      ? [{ ...prev[0], count: peakFleet }]
      : prev)
  }, [peakFleet])

  const ofertaSeries = useMemo(
    () => computeOfertaSeries(windows, vehicleCapacity, renewalIndex, opStart, opEnd),
    [windows, vehicleCapacity, renewalIndex, opStart, opEnd],
  )

  const chartData = useMemo(() => Array.from({ length: 24 }, (_, hour) => ({
    hour:    hourToLabel(hour),
    oferta:  ofertaSeries[activeDir]?.[hour] ?? 0,
    demanda: line.demand[activeDir]?.[hour]  ?? 0,
  })), [ofertaSeries, activeDir, line])

  function updateWindow(index: number, patch: Partial<GenWindow>) {
    setResult(null)
    setWindows(rows => rows.map((r, i) => i === index ? { ...r, ...patch } : r))
  }
  function removeWindow(index: number) {
    setResult(null)
    setWindows(rows => rows.length > 1 ? rows.filter((_, i) => i !== index) : rows)
  }
  function doMerge(index: number) {
    setResult(null)
    setWindows(rows => mergeWithNext(rows, index))
  }
  function doSplit(index: number) {
    setResult(null)
    setWindows(rows => splitWindow(rows, index))
  }
  function doCloseFrequency(index: number) {
    setResult(null)
    setWindows(rows => closeFrequency(rows, index))
  }
  function resetWindows() {
    setResult(null)
    setWindows(buildUnifiedWindows(line.windows.OUTBOUND ?? [], line.windows.INBOUND ?? []))
  }
  function addDepotRow() {
    const used = new Set(depotAllocations.map(d => d.depotId))
    const next = MOCK_DEPOTS.find(d => !used.has(d.id)) ?? MOCK_DEPOTS[0]
    setDepotAllocations(prev => [...prev, { id: crypto.randomUUID(), depotId: next.id, count: 0 }])
  }
  function removeDepotRow(id: string) {
    setDepotAllocations(prev => prev.length > 1 ? prev.filter(d => d.id !== id) : prev)
  }
  function updateDepotRow(id: string, patch: Partial<DepotAllocation>) {
    setDepotAllocations(prev => prev.map(d => d.id === id ? { ...d, ...patch } : d))
  }

  function handleGenerate() {
    setResult(estimateGeneration(windows, opStart, opEnd))
  }

  const depotMismatch = includeAccessReturn && depotSum !== peakFleet

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center">
      <div className="absolute inset-0 bg-black/40" onClick={onClose} />
      <div className="relative z-10 bg-card border border-border rounded-lg shadow-xl w-full max-w-5xl mx-4 max-h-[92vh] flex flex-col">

        {/* header */}
        <div className="flex items-center justify-between px-6 py-4 border-b border-border shrink-0">
          <div>
            <h2 className="text-base font-semibold">Gerar Proposta de Atendimento</h2>
            <p className="text-xs text-muted-foreground mt-0.5">
              <span className="font-mono font-medium">{line.code}</span> — {line.name} · Tipo de dia: {line.dayTypeCode}
            </p>
          </div>
          <button onClick={onClose} className="p-1 rounded hover:bg-accent text-muted-foreground hover:text-foreground">
            <Icons.X className="w-4 h-4" />
          </button>
        </div>

        {/* tabs */}
        <div className="flex items-center gap-1 px-6 border-b border-border shrink-0">
          {TABS.map(tab => (
            <button
              key={tab.key}
              type="button"
              onClick={() => setActiveTab(tab.key)}
              className={`px-3 py-2.5 text-sm font-medium border-b-2 -mb-px transition-colors ${
                activeTab === tab.key
                  ? 'border-ring text-foreground'
                  : 'border-transparent text-muted-foreground hover:text-foreground'
              }`}
            >
              {tab.label}
            </button>
          ))}
        </div>

        {/* body */}
        <div className="flex-1 overflow-y-auto px-6 py-5 space-y-6">

          {activeTab === 'janelas' && (
            <>
              {/* operation window */}
              <section className="space-y-2">
                <h3 className="text-xs font-medium text-muted-foreground uppercase tracking-wider">Janela de Operação</h3>
                <div className="flex items-center gap-4">
                  <label className="flex items-center gap-2 text-sm">
                    Início
                    <input
                      type="time"
                      value={minutesToLabel(opStart)}
                      onChange={e => setOpStart(labelToMinutes(e.target.value))}
                      className="rounded-sm border border-input bg-input-bg px-2 py-1 text-sm focus:outline-none focus:ring-1 focus:ring-ring"
                    />
                  </label>
                  <label className="flex items-center gap-2 text-sm">
                    Fim
                    <input
                      type="time"
                      value={minutesToLabel(opEnd)}
                      onChange={e => setOpEnd(labelToMinutes(e.target.value))}
                      className="rounded-sm border border-input bg-input-bg px-2 py-1 text-sm focus:outline-none focus:ring-1 focus:ring-ring"
                    />
                  </label>
                </div>
              </section>

              {/* generation windows */}
              <section className="space-y-2">
                <div className="flex items-center justify-between">
                  <h3 className="text-xs font-medium text-muted-foreground uppercase tracking-wider">
                    Janelas de Geração
                  </h3>
                  <button
                    type="button"
                    onClick={resetWindows}
                    className="flex items-center gap-1 text-xs text-muted-foreground hover:text-foreground"
                  >
                    <Icons.RefreshCw className="w-3 h-3" /> Restaurar do ciclo
                  </button>
                </div>
                <div className="border border-border rounded-md overflow-hidden">
                  <table className="w-full text-sm">
                    <thead className="bg-muted/40 text-muted-foreground text-xs">
                      <tr>
                        <th className="px-2 py-2 text-left font-medium">De</th>
                        <th className="px-2 py-2 text-left font-medium">Até</th>
                        <th className="px-2 py-2 text-left font-medium">Ciclo + Intervalo (Ida)</th>
                        <th className="px-2 py-2 text-left font-medium">Ciclo + Intervalo (Volta)</th>
                        <th className="px-2 py-2 text-left font-medium">Frota</th>
                        <th className="px-2 py-2 text-left font-medium">Frequência</th>
                        <th className="px-2 py-2 text-right font-medium">Ações</th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-border">
                      {windows.map((w, i) => {
                        const cycleTotal = totalCycleMinutes(w)
                        const freqMin    = w.fleetCount > 0 ? cycleTotal / w.fleetCount : 0
                        return (
                          <tr key={w.id} className="hover:bg-muted/20">
                            <td className="px-2 py-2">
                              <input
                                type="time"
                                value={hourToLabel(w.from)}
                                onChange={e => updateWindow(i, { from: labelToHour(e.target.value) })}
                                className="w-24 rounded-sm border border-input bg-input-bg px-1.5 py-1 focus:outline-none focus:ring-1 focus:ring-ring"
                              />
                            </td>
                            <td className="px-2 py-2">
                              <input
                                type="time"
                                value={hourToLabel(w.to)}
                                onChange={e => updateWindow(i, { to: labelToHour(e.target.value) })}
                                className="w-24 rounded-sm border border-input bg-input-bg px-1.5 py-1 focus:outline-none focus:ring-1 focus:ring-ring"
                              />
                            </td>
                            <td className="px-2 py-2">
                              <div className="inline-flex items-center rounded-sm border border-input bg-input-bg focus-within:ring-1 focus-within:ring-ring">
                                <input
                                  type="number" min={1} title="Ciclo (min)"
                                  value={w.outboundMinutes}
                                  onChange={e => updateWindow(i, { outboundMinutes: Number(e.target.value) || 0 })}
                                  className="w-14 bg-transparent px-1.5 py-1 text-right focus:outline-none"
                                />
                                <span className="text-muted-foreground px-0.5 select-none">+</span>
                                <input
                                  type="number" min={0} title="Intervalo de parada (min)"
                                  value={w.outboundInterval}
                                  onChange={e => updateWindow(i, { outboundInterval: Number(e.target.value) || 0 })}
                                  className="w-12 bg-transparent px-1.5 py-1 text-right focus:outline-none border-l border-input"
                                />
                              </div>
                            </td>
                            <td className="px-2 py-2">
                              <div className="inline-flex items-center rounded-sm border border-input bg-input-bg focus-within:ring-1 focus-within:ring-ring">
                                <input
                                  type="number" min={1} title="Ciclo (min)"
                                  value={w.inboundMinutes}
                                  onChange={e => updateWindow(i, { inboundMinutes: Number(e.target.value) || 0 })}
                                  className="w-14 bg-transparent px-1.5 py-1 text-right focus:outline-none"
                                />
                                <span className="text-muted-foreground px-0.5 select-none">+</span>
                                <input
                                  type="number" min={0} title="Intervalo de parada (min)"
                                  value={w.inboundInterval}
                                  onChange={e => updateWindow(i, { inboundInterval: Number(e.target.value) || 0 })}
                                  className="w-12 bg-transparent px-1.5 py-1 text-right focus:outline-none border-l border-input"
                                />
                              </div>
                            </td>
                            <td className="px-2 py-2">
                              <input
                                type="number" min={1}
                                value={w.fleetCount}
                                onChange={e => updateWindow(i, { fleetCount: Math.max(1, Number(e.target.value) || 1) })}
                                className="w-14 rounded-sm border border-input bg-input-bg px-1.5 py-1 focus:outline-none focus:ring-1 focus:ring-ring"
                              />
                            </td>
                            <td className="px-2 py-2 whitespace-nowrap text-muted-foreground">
                              {freqMin.toFixed(1)} min / {cycleTotal}&apos;
                            </td>
                            <td className="px-2 py-2">
                              <div className="flex items-center justify-end gap-1">
                                <button
                                  type="button" title="Fechar frequência (ajusta o ciclo de volta até fechar)"
                                  onClick={() => doCloseFrequency(i)}
                                  className="p-1 rounded hover:bg-accent text-muted-foreground hover:text-foreground"
                                >
                                  <Icons.Sparkles className="w-4 h-4" />
                                </button>
                                <button
                                  type="button" title="Dividir faixa"
                                  onClick={() => doSplit(i)}
                                  className="p-1 rounded hover:bg-accent text-muted-foreground hover:text-foreground"
                                >
                                  <Icons.Scissors className="w-4 h-4" />
                                </button>
                                <button
                                  type="button" title="Unir com a próxima"
                                  disabled={i === windows.length - 1}
                                  onClick={() => doMerge(i)}
                                  className="p-1 rounded hover:bg-accent text-muted-foreground hover:text-foreground disabled:opacity-30 disabled:pointer-events-none"
                                >
                                  <Icons.ArrowRightLeft className="w-4 h-4" />
                                </button>
                                <button
                                  type="button" title="Remover faixa"
                                  disabled={windows.length === 1}
                                  onClick={() => removeWindow(i)}
                                  className="p-1 rounded hover:bg-destructive/10 text-muted-foreground hover:text-destructive disabled:opacity-30 disabled:pointer-events-none"
                                >
                                  <Icons.Trash2 className="w-4 h-4" />
                                </button>
                              </div>
                            </td>
                          </tr>
                        )
                      })}
                    </tbody>
                  </table>
                </div>
              </section>
            </>
          )}

          {activeTab === 'ajuste' && (
            <div className="grid grid-cols-[6rem_1fr_14rem] gap-x-4 gap-y-4 items-center max-w-3xl">

              {/* row: intervalo — control column holds the switch */}
              <Switch checked={insertInterval} onToggle={() => setInsertInterval(v => !v)} />
              <span
                className="text-sm cursor-pointer select-none"
                onClick={() => setInsertInterval(v => !v)}
              >
                Inserir intervalo entre ciclos
              </span>
              <select
                value={intervalTypeId}
                onChange={e => setIntervalTypeId(e.target.value)}
                disabled={!insertInterval}
                className="w-full appearance-none text-sm rounded-sm border border-input bg-input-bg px-2 py-1.5 focus:outline-none focus:ring-1 focus:ring-ring disabled:opacity-40"
              >
                {MOCK_INTERVAL_TYPES.map(it => (
                  <option key={it.id} value={it.id}>{it.name} ({it.code}) — {it.isPaid ? 'pago' : 'não pago'}</option>
                ))}
              </select>

              {/* row: acesso e recolhida */}
              <Switch checked={includeAccessReturn} onToggle={() => setIncludeAccessReturn(v => !v)} />
              <span
                className="text-sm cursor-pointer select-none"
                onClick={() => setIncludeAccessReturn(v => !v)}
              >
                Incluir acesso e recolhida
              </span>
              <span />

              {/* rows: índice de renovação — one per route the line actually has (1 to 3
                  directions), driven by line.routes rather than a fixed OUTBOUND/INBOUND pair.
                  Control column holds the input, same alignment as the switches above. */}
              {line.routes.map(route => (
                <Fragment key={route.direction}>
                  <div className="flex items-center gap-1.5">
                    <input
                      type="number" min={0}
                      value={renewalIndex[route.direction] ?? 0}
                      onChange={e => setRenewalIndex(r => ({ ...r, [route.direction]: Number(e.target.value) || 0 }))}
                      className="w-14 rounded-sm border border-input bg-input-bg px-2 py-1 text-sm focus:outline-none focus:ring-1 focus:ring-ring"
                    />
                    <span className="text-sm text-muted-foreground">%</span>
                  </div>
                  <span className="text-sm">
                    Índice de renovação {DIR_LABEL[route.direction]}{' '}
                    <span className="text-muted-foreground">({route.originName} x {route.destinationName})</span>
                  </span>
                  <span />
                </Fragment>
              ))}
            </div>
          )}

          {activeTab === 'frota' && (
            <section className="space-y-3">
              <h3 className="text-xs font-medium text-muted-foreground uppercase tracking-wider">Frota &amp; Depósitos</h3>

              <div className="flex items-center gap-4">
                <label className="flex items-center gap-2 text-sm">
                  Capacidade/veículo
                  <input
                    type="number" min={1}
                    value={vehicleCapacity}
                    onChange={e => setVehicleCapacity(Number(e.target.value) || 0)}
                    className="w-20 rounded-sm border border-input bg-input-bg px-2 py-1 text-sm focus:outline-none focus:ring-1 focus:ring-ring"
                  />
                </label>
                <span className="text-xs text-muted-foreground">
                  Pico da frota: <strong className="text-foreground">{peakFleet}</strong> veículos
                </span>
              </div>

              <p className="text-xs text-muted-foreground">
                Distribuição da frota por depósito (única empresa/garagem, ou dividida entre várias).
              </p>

              <div className="space-y-1.5 max-w-md">
                {depotAllocations.map(d => (
                  <div key={d.id} className="flex items-center gap-1.5">
                    <select
                      value={d.depotId}
                      onChange={e => updateDepotRow(d.id, { depotId: e.target.value })}
                      className="flex-1 appearance-none text-xs rounded-sm border border-input bg-input-bg px-2 py-1 focus:outline-none focus:ring-1 focus:ring-ring"
                    >
                      {MOCK_DEPOTS.map(dep => <option key={dep.id} value={dep.id}>{dep.name}</option>)}
                    </select>
                    <input
                      type="number" min={0}
                      value={d.count}
                      onChange={e => updateDepotRow(d.id, { count: Number(e.target.value) || 0 })}
                      className="w-16 text-xs rounded-sm border border-input bg-input-bg px-2 py-1 focus:outline-none focus:ring-1 focus:ring-ring"
                    />
                    <button
                      type="button"
                      disabled={depotAllocations.length === 1}
                      onClick={() => removeDepotRow(d.id)}
                      className="p-1 rounded hover:bg-destructive/10 text-muted-foreground hover:text-destructive disabled:opacity-30 disabled:pointer-events-none"
                    >
                      <Icons.Trash2 className="w-3.5 h-3.5" />
                    </button>
                  </div>
                ))}
                <button
                  type="button"
                  onClick={addDepotRow}
                  disabled={depotAllocations.length >= MOCK_DEPOTS.length}
                  className="flex items-center gap-1 text-xs text-muted-foreground hover:text-foreground disabled:opacity-30 disabled:pointer-events-none"
                >
                  <Icons.Plus className="w-3 h-3" /> Adicionar depósito
                </button>
              </div>

              <div className={`text-xs ${depotMismatch ? 'text-amber-600 dark:text-amber-400' : 'text-muted-foreground'}`}>
                {depotSum} / {peakFleet} veículos alocados
                {includeAccessReturn && (
                  <span className="ml-1">— obrigatório (acesso/recolhida ligado na aba Ajuste)</span>
                )}
              </div>
            </section>
          )}

          {activeTab === 'oferta' && (
            <section className="space-y-2">
              <div className="flex items-center justify-between">
                <h3 className="text-xs font-medium text-muted-foreground uppercase tracking-wider">Oferta × Demanda</h3>
                <div className="flex gap-1">
                  {(['OUTBOUND', 'INBOUND'] as Direction[]).map(dir => (
                    <button
                      key={dir}
                      type="button"
                      onClick={() => setActiveDir(dir)}
                      className={`px-3 py-1 rounded-full text-xs font-medium transition-colors ${
                        dir === activeDir ? 'bg-ring text-white' : 'bg-muted text-muted-foreground hover:text-foreground'
                      }`}
                    >
                      {DIR_LABEL[dir]}
                    </button>
                  ))}
                </div>
              </div>

              <style>{`
                .line-gen-chart { --series-oferta: #2a78d6; --series-demanda: #eb6834; }
                .dark .line-gen-chart { --series-oferta: #3987e5; --series-demanda: #d95926; }
              `}</style>
              <div className="line-gen-chart border border-border rounded-md p-2" style={{ height: 320 }}>
                <ResponsiveContainer width="100%" height="100%">
                  <ComposedChart data={chartData} margin={{ top: 8, right: 12, bottom: 4, left: 0 }}>
                    <CartesianGrid strokeDasharray="3 3" stroke="hsl(var(--border))" vertical={false} />
                    <XAxis
                      dataKey="hour"
                      tick={{ fontSize: 10, fill: 'hsl(var(--muted-foreground))' }}
                      axisLine={false}
                      tickLine={false}
                      interval={1}
                    />
                    <YAxis
                      tick={{ fontSize: 11, fill: 'hsl(var(--muted-foreground))' }}
                      axisLine={false}
                      tickLine={false}
                      width={44}
                      label={{ value: 'pax/h', angle: -90, position: 'insideLeft', fontSize: 10, fill: 'hsl(var(--muted-foreground))' }}
                    />
                    <Tooltip
                      contentStyle={{
                        background:   'hsl(var(--card))',
                        border:       '1px solid hsl(var(--border))',
                        borderRadius: '6px',
                        fontSize:     12,
                      }}
                    />
                    <Legend wrapperStyle={{ fontSize: 11 }} />
                    <Bar
                      dataKey="oferta" name="Oferta" fill="var(--series-oferta)"
                      radius={[4, 4, 0, 0]} maxBarSize={20}
                    />
                    <Line
                      dataKey="demanda" name="Demanda" stroke="var(--series-demanda)"
                      strokeWidth={2} dot={{ r: 4, fill: 'var(--series-demanda)' }}
                      activeDot={{ r: 5 }}
                    />
                  </ComposedChart>
                </ResponsiveContainer>
              </div>
            </section>
          )}
        </div>

        {/* footer */}
        <div className="flex items-center justify-between px-6 py-4 border-t border-border shrink-0">
          <div className="text-xs text-muted-foreground">
            {result && (
              <span>
                Prévia: <strong className="text-foreground">~{result.trips}</strong> viagens para{' '}
                <strong className="text-foreground">{result.peakFleet}</strong> veículos (estimativa, não é o
                algoritmo de geração final)
              </span>
            )}
          </div>
          <div className="flex gap-2">
            <Button type="button" variant="cancel" size="sm" tabIndex={-1} onClick={onClose}>
              Cancelar
            </Button>
            <Button type="button" size="sm" onClick={handleGenerate}>
              Gerar
            </Button>
          </div>
        </div>
      </div>
    </div>
  )
}
