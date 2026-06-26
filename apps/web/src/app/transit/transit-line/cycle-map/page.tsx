'use client'

import { useState, useRef, useCallback } from 'react'
import { createPortal }                  from 'react-dom'
import { useRouter }                     from 'next/navigation'
import { Icons }                         from '@/lib/icons'
import { cn }                            from '@/lib/utils'
import { Button }                        from '@/components/ui/button'
import { Switch }                        from '@/components/ui/switch'
import { Select }                        from '@/components/ui/select'
import { Breadcrumb }                    from '@/components/ui/breadcrumb'
import { useTopbarActions }              from '@/components/layout/topbar-actions-context'
import { useShortcut }                   from '@/lib/keywatch'
import { apiFetch }                      from '@/lib/auth'
import { useToast }                      from '@/lib/toast-context'
import { parseCsv }                      from './csv-parser'
import { buildHourClusters, suggestCuts, computeWindows } from './cycle-utils'
import { CycleMapCanvas }                from './CycleMapCanvas'
import type { CsvData, Direction, DotCluster } from './types'

const DIRECTIONS: Direction[] = ['OUTBOUND', 'INBOUND', 'CIRCULAR']

interface DirState {
  hourClusters:    Map<number, DotCluster[]>
  cuts:            number[]
  intervalMinutes: number
}

interface LineRecord {
  id:      string
  code:    string
  metrics: {
    extensionKm?: Record<string, number>
    windows?:     Record<Direction, Array<{ intervalMinutes: number }>>
  } | null
}

interface SaveAllResult {
  saved:  string[]
  errors: Array<{ code: string; message: string }>
}

export default function CycleMapPage() {
  const router       = useRouter()
  const { toast }    = useToast()
  const fileInputRef = useRef<HTMLInputElement>(null)

  const [csvData,        setCsvData]        = useState<CsvData | null>(null)
  const [linesMap,       setLinesMap]       = useState<Map<string, LineRecord>>(new Map())
  const [lineIndex,      setLineIndex]      = useState(0)
  const [includeEdited,  setIncludeEdited]  = useState(true)
  const [saving,         setSaving]         = useState(false)
  const [savingAll,      setSavingAll]      = useState(false)
  const [saveAllResult,  setSaveAllResult]  = useState<SaveAllResult | null>(null)
  const [dirStates,      setDirStates]      = useState<Map<Direction, DirState>>(new Map())

  // ──────────────── Topbar ──────────────────────────

  useTopbarActions([
    ...(csvData ? [{
      label:    saving ? 'Salvando…' : 'Salvar',
      icon:     Icons.Save,
      onClick:  handleSave,
      primary:  true,
      disabled: saving || savingAll,
      keybind:  'ALT+G',
    }, {
      label:    savingAll ? 'Salvando…' : 'Salvar todos',
      icon:     Icons.Layers,
      onClick:  handleSaveAll,
      disabled: saving || savingAll,
      overflow: true,
    }] : []),
    ...(csvData && csvData.lines.length > 1 ? [{
      label:   'Próxima',
      icon:    Icons.ArrowRight,
      onClick: advanceLine,
      variant: 'ghost' as const,
    }] : []),
  ], [csvData, saving, savingAll, lineIndex])

  useShortcut('alt+g', handleSave, { desc: 'Salvar e avançar linha', icon: Icons.Save })
  useShortcut('alt+v', () => router.push('/transit/transit-line'), { desc: 'Voltar', icon: Icons.ArrowLeft, order: 2 })

  // ──────────────── CSV load ──────────────────────────

  function handleFileChange(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0]
    if (!file) return

    const reader = new FileReader()
    reader.onload = async (ev) => {
      const text = ev.target?.result as string
      const data = parseCsv(text)
      if (data.lines.length === 0) {
        toast.error('CSV sem viagens realizadas')
        return
      }

      // fetch all lines once to get IDs and existing metrics
      let map: Map<string, LineRecord> = new Map()
      try {
        const res = await apiFetch('/transit/transit-line?pageSize=9999')
        if (res.ok) {
          const { data: lines } = await res.json() as { data: LineRecord[] }
          map = new Map(lines.map(l => [l.code, l]))
        }
      } catch { /* fallback: no pre-fill */ }

      setCsvData(data)
      setLinesMap(map)
      setLineIndex(0)
      loadLineData(data, 0, includeEdited, map)
    }
    reader.readAsText(file, 'latin1')
  }

  function loadLineData(
    data:        CsvData,
    idx:         number,
    withEdited:  boolean,
    map:         Map<string, LineRecord>,
  ) {
    const lineCode = data.lines[idx]
    const dirMap   = data.byLine.get(lineCode)
    if (!dirMap) return

    const existing = map.get(lineCode)
    const next     = new Map<Direction, DirState>()

    for (const dir of DIRECTIONS) {
      const trips = dirMap.get(dir)
      if (!trips || trips.length === 0) continue

      const hc              = buildHourClusters(trips, withEdited)
      const cuts            = suggestCuts(trips)
      const existingWindows = existing?.metrics?.windows?.[dir]
      const intervalMinutes = existingWindows?.[0]?.intervalMinutes ?? 5

      next.set(dir, { hourClusters: hc, cuts, intervalMinutes })
    }
    setDirStates(next)
  }

  // ──────────────── includeEdited toggle ──────────────────────────

  function toggleIncludeEdited() {
    if (!csvData) return
    const next     = !includeEdited
    const lineCode = csvData.lines[lineIndex]
    const dirMap   = csvData.byLine.get(lineCode)
    setIncludeEdited(next)
    if (!dirMap) return

    setDirStates(prev => {
      const updated = new Map(prev)
      for (const dir of DIRECTIONS) {
        const trips    = dirMap.get(dir)
        const existing = prev.get(dir)
        if (!trips || !existing) continue
        updated.set(dir, { ...existing, hourClusters: buildHourClusters(trips, next) })
      }
      return updated
    })
  }

  // ──────────────── line navigation ──────────────────────────

  function advanceLine() {
    if (!csvData) return
    const next = lineIndex + 1
    if (next >= csvData.lines.length) {
      toast.success('Todas as linhas foram processadas')
      router.push('/transit/transit-line')
      return
    }
    setLineIndex(next)
    loadLineData(csvData, next, includeEdited, linesMap)
  }

  // ──────────────── save ──────────────────────────

  async function handleSave() {
    if (!csvData || saving) return
    const lineCode = csvData.lines[lineIndex]
    const lineRec  = linesMap.get(lineCode)

    if (!lineRec) {
      toast.error(`Linha ${lineCode} não encontrada no sistema`)
      return
    }

    setSaving(true)
    try {
      const windows: Record<string, Array<{ from: number; to: number; minutes: number; intervalMinutes: number }>> = {}
      for (const [dir, state] of dirStates) {
        const w = computeWindows(state.hourClusters, state.cuts, state.intervalMinutes)
        if (w.length > 0) windows[dir] = w
      }

      const res = await apiFetch(`/transit/transit-line/${lineRec.id}`, {
        method: 'PATCH',
        body:   JSON.stringify({ metrics: { ...lineRec.metrics, windows } }),
      })

      if (!res.ok) {
        const err = await res.json().catch(() => ({}))
        toast.error(err?.message?.message ?? 'Erro ao salvar')
        return
      }

      toast.success(`Linha ${lineCode} salva`)
      advanceLine()
    } finally {
      setSaving(false)
    }
  }

  // ──────────────── save all ──────────────────────────

  async function handleSaveAll() {
    if (!csvData || saving || savingAll) return
    setSavingAll(true)

    const saved:  string[]                            = []
    const errors: Array<{ code: string; message: string }> = []

    for (let i = 0; i < csvData.lines.length; i++) {
      const lineCode = csvData.lines[i]
      const lineRec  = linesMap.get(lineCode)

      if (!lineRec) {
        errors.push({ code: lineCode, message: 'Não encontrada no sistema' })
        continue
      }

      try {
        const windows: Record<string, Array<{ from: number; to: number; minutes: number; intervalMinutes: number }>> = {}

        if (i === lineIndex) {
          for (const [dir, state] of dirStates) {
            const w = computeWindows(state.hourClusters, state.cuts, state.intervalMinutes)
            if (w.length > 0) windows[dir] = w
          }
        } else {
          const dirMap = csvData.byLine.get(lineCode)
          if (dirMap) {
            for (const dir of DIRECTIONS) {
              const trips = dirMap.get(dir)
              if (!trips || trips.length === 0) continue
              const hc              = buildHourClusters(trips, includeEdited)
              const cuts            = suggestCuts(trips)
              const existingWindows = lineRec.metrics?.windows?.[dir]
              const intervalMinutes = existingWindows?.[0]?.intervalMinutes ?? 5
              const w = computeWindows(hc, cuts, intervalMinutes)
              if (w.length > 0) windows[dir] = w
            }
          }
        }

        const res = await apiFetch(`/transit/transit-line/${lineRec.id}`, {
          method: 'PATCH',
          body:   JSON.stringify({ metrics: { ...lineRec.metrics, windows } }),
        })

        if (!res.ok) {
          const err = await res.json().catch(() => ({}))
          errors.push({ code: lineCode, message: err?.message?.message ?? 'Erro ao salvar' })
        } else {
          saved.push(lineCode)
        }
      } catch (e: unknown) {
        errors.push({ code: lineCode, message: (e as Error)?.message ?? 'Erro desconhecido' })
      }
    }

    setSavingAll(false)
    setSaveAllResult({ saved, errors })
  }

  // ──────────────── canvas callbacks ──────────────────────────

  const handleCutsChange = useCallback((dir: Direction, cuts: number[]) => {
    setDirStates(prev => {
      const next = new Map(prev)
      const s    = next.get(dir)
      if (s) next.set(dir, { ...s, cuts })
      return next
    })
  }, [])

  const handleHourClustersChange = useCallback((dir: Direction, hc: Map<number, DotCluster[]>) => {
    setDirStates(prev => {
      const next = new Map(prev)
      const s    = next.get(dir)
      if (s) next.set(dir, { ...s, hourClusters: hc })
      return next
    })
  }, [])

  const handleIntervalChange = useCallback((dir: Direction, val: number) => {
    setDirStates(prev => {
      const next = new Map(prev)
      const s    = next.get(dir)
      if (s) next.set(dir, { ...s, intervalMinutes: val })
      return next
    })
  }, [])

  // ──────────────── render ──────────────────────────

  const currentLine = csvData ? csvData.lines[lineIndex] : null
  const totalLines  = csvData?.lines.length ?? 0

  return (
    <div className="flex flex-col h-full overflow-hidden">
      <div className="px-6 pt-4 pb-2 shrink-0">
        <Breadcrumb segments={[
          { label: 'Transit',          href: '/transit' },
          { label: 'Linhas',           href: '/transit/transit-line' },
          { label: 'Atualizar Ciclos' },
        ]} />
      </div>

      <div className="flex-1 overflow-y-auto px-6 pb-6 space-y-6">

        {/* upload prompt */}
        {!csvData && (
          <div className="flex flex-col items-center justify-center gap-4 py-24 border-2 border-dashed border-border rounded-lg">
            <Icons.Upload className="w-10 h-10 text-muted-foreground" />
            <p className="text-muted-foreground text-sm">Selecione o arquivo CSV do GPS para iniciar</p>
            <button
              type="button"
              onClick={() => fileInputRef.current?.click()}
              className="px-4 py-2 bg-accent text-accent-foreground rounded text-sm font-medium hover:opacity-90 transition-opacity"
            >
              Escolher arquivo
            </button>
            <input
              ref={fileInputRef}
              type="file"
              accept=".csv,.txt"
              className="hidden"
              onChange={handleFileChange}
            />
          </div>
        )}

        {/* editing UI */}
        {csvData && currentLine && (
          <>
            {/* controls */}
            <div className="flex flex-wrap items-center gap-4">
              <div className="flex items-center gap-2">
                <span className="text-sm text-muted-foreground">Linha</span>
                <Select
                  value={lineIndex}
                  onChange={e => {
                    const idx = Number(e.target.value)
                    setLineIndex(idx)
                    loadLineData(csvData, idx, includeEdited, linesMap)
                  }}
                  size="sm"
                  className="w-36"
                >
                  {csvData.lines.map((code, i) => (
                    <option key={code} value={i}>{code}</option>
                  ))}
                </Select>
                <span className="text-xs text-muted-foreground">{lineIndex + 1} de {totalLines} no CSV</span>
              </div>

              <label className="flex items-center gap-2 text-sm cursor-pointer select-none">
                <Switch checked={includeEdited} onToggle={toggleIncludeEdited} />
                Considerar editadas
              </label>

              <div className="flex items-center gap-3 text-xs text-muted-foreground ml-auto">
                <span className="flex items-center gap-1.5">
                  <span className="w-3 h-3 rounded-full bg-blue-500 inline-block" /> Ativo
                </span>
                <span className="flex items-center gap-1.5">
                  <span className="w-3 h-3 rounded-full bg-red-500 inline-block" /> Outlier
                </span>
                <span className="flex items-center gap-1.5">
                  <span className="w-3 h-3 rounded-full bg-gray-400 inline-block" /> Desativado
                </span>
                <span className="flex items-center gap-1.5">
                  <span className="w-3 h-3 rounded-full border-2 border-orange-500 inline-block" /> Editada
                </span>
              </div>
            </div>

            {/* direction panels */}
            {DIRECTIONS.map(dir => {
              const state = dirStates.get(dir)
              if (!state) return null
              return (
                <div key={dir} className="space-y-2">
                  <CycleMapCanvas
                    direction={dir}
                    hourClusters={state.hourClusters}
                    cuts={state.cuts}
                    onCutsChange={cuts => handleCutsChange(dir, cuts)}
                    onHourClustersChange={hc => handleHourClustersChange(dir, hc)}
                  />
                  <div className="flex items-center gap-2 pl-1">
                    <span className="text-xs text-muted-foreground">Intervalo entre viagens</span>
                    <input
                      type="number"
                      min={1}
                      max={120}
                      value={state.intervalMinutes}
                      onChange={e => handleIntervalChange(dir, Math.max(1, Number(e.target.value)))}
                      className="w-16 px-2 py-1 text-sm border border-input rounded-sm bg-input-bg focus:outline-none focus:ring-1 focus:ring-ring"
                    />
                    <span className="text-xs text-muted-foreground">min (aplicado em todas as janelas)</span>
                  </div>
                </div>
              )
            })}
          </>
        )}
      </div>

      {/* save-all result modal */}
      {saveAllResult && typeof window !== 'undefined' && createPortal(
        <div
          className="fixed inset-0 z-50 flex items-center justify-center p-4"
          onPointerDown={(e) => { if (e.target === e.currentTarget) setSaveAllResult(null) }}
        >
          <div className="absolute inset-0 bg-black/50" />
          <div className="relative bg-background border border-border rounded-lg shadow-xl w-full max-w-md flex flex-col max-h-[90vh]">
            <div className="flex items-center justify-between px-5 py-4 border-b border-border shrink-0">
              <h2 className="font-semibold text-base">Resultado — Salvar todos</h2>
              <button
                type="button"
                onClick={() => setSaveAllResult(null)}
                className="text-muted-foreground hover:text-foreground transition-colors"
              >
                <Icons.X className="w-4 h-4" />
              </button>
            </div>

            <div className="px-5 py-4 space-y-4 overflow-y-auto">
              <div className="grid grid-cols-2 gap-2 text-center">
                <div className="rounded-sm p-3 bg-muted">
                  <div className="text-2xl font-bold">{saveAllResult.saved.length}</div>
                  <div className="text-xs text-muted-foreground">Salvas</div>
                </div>
                <div className={cn('rounded-sm p-3', saveAllResult.errors.length > 0 ? 'bg-destructive/10' : 'bg-muted')}>
                  <div className={cn('text-2xl font-bold', saveAllResult.errors.length > 0 && 'text-destructive')}>
                    {saveAllResult.errors.length}
                  </div>
                  <div className="text-xs text-muted-foreground">Erros</div>
                </div>
              </div>

              {saveAllResult.errors.length > 0 && (
                <div className="space-y-2">
                  <p className="text-xs font-medium text-destructive">
                    {saveAllResult.errors.length} erro{saveAllResult.errors.length !== 1 ? 's' : ''}
                  </p>
                  <div className="max-h-48 overflow-y-auto rounded-sm border border-border text-xs">
                    <table className="w-full">
                      <thead className="sticky top-0 bg-muted">
                        <tr>
                          <th className="text-left px-2 py-1 font-medium text-muted-foreground w-24">Linha</th>
                          <th className="text-left px-2 py-1 font-medium text-muted-foreground">Mensagem</th>
                        </tr>
                      </thead>
                      <tbody>
                        {saveAllResult.errors.map((err, i) => (
                          <tr key={i} className="border-t border-border">
                            <td className="px-2 py-1 font-mono">{err.code}</td>
                            <td className="px-2 py-1 text-destructive">{err.message}</td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                </div>
              )}

              {saveAllResult.saved.length > 0 && (
                <p className="text-xs text-muted-foreground">
                  Linhas salvas: {saveAllResult.saved.join(', ')}
                </p>
              )}
            </div>

            <div className="flex items-center justify-end px-5 py-3 border-t border-border shrink-0">
              <Button onClick={() => setSaveAllResult(null)}>Fechar</Button>
            </div>
          </div>
        </div>,
        document.body,
      )}
    </div>
  )
}
