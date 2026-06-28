'use client'

import { useEffect, useRef, useState } from 'react'
import { createPortal }                 from 'react-dom'
import { Button }                       from '@/components/ui/button'
import { apiFetch }                     from '@/lib/auth'
import { useToast }                     from '@/lib/toast-context'
import { extractError }                 from '@/lib/utils'

// JSON sentido → RouteDirection
const SENTIDO_MAP: Record<string, string> = {
  IDA:         'OUTBOUND',
  VOLTA:       'INBOUND',
  UNICO:       'CIRCULAR',
  SEM_SENTIDO: '',          // discard
}

interface DayType {
  id:   string
  code: string
  name: string
}

interface SystemLine {
  id:   string
  code: string
  name: string
}

// direction → { "5": 85, "17": 200, ... }
type LineDemand = Record<string, Record<string, number>>

interface MatchedRow {
  lineId:   string
  lineCode: string
  lineName: string
  demand:   LineDemand
  selected: boolean
}

interface Props {
  onClose:   () => void
  onApplied: () => void
}

// Accumulator: lineCode → direction → hour → { sum, count }
type Accum = Record<string, Record<string, Record<number, { sum: number; count: number }>>>

async function parseAndAggregate(files: File[]): Promise<Record<string, LineDemand>> {
  const parsed = await Promise.all(files.map((f) => f.text().then((t) => JSON.parse(t))))
  const accum: Accum = {}

  for (const data of parsed) {
    const linhas: Array<{ linha: string; sentido: string; faixas: Array<{ hora: number; passageiros: number }> }> =
      data.linhas ?? []

    for (const item of linhas) {
      const direction = SENTIDO_MAP[item.sentido]
      if (!direction) continue   // SEM_SENTIDO — skip

      const code = item.linha
      if (!accum[code])            accum[code] = {}
      if (!accum[code][direction]) accum[code][direction] = {}

      for (const f of item.faixas) {
        const slot = accum[code][direction][f.hora]
        if (slot) {
          slot.sum   += f.passageiros
          slot.count += 1
        } else {
          accum[code][direction][f.hora] = { sum: f.passageiros, count: 1 }
        }
      }
    }
  }

  const result: Record<string, LineDemand> = {}
  for (const [code, directions] of Object.entries(accum)) {
    result[code] = {}
    for (const [dir, horas] of Object.entries(directions)) {
      const hours: Record<string, number> = {}
      for (const [hora, { sum, count }] of Object.entries(horas)) {
        hours[hora] = Math.round(sum / count)
      }
      result[code][dir] = hours
    }
  }
  return result
}

export function DemandImportModal({ onClose, onApplied }: Props) {
  const { toast } = useToast()

  const [dayTypes,      setDayTypes]      = useState<DayType[]>([])
  const [systemLines,   setSystemLines]   = useState<SystemLine[]>([])
  const [dayTypeCode,   setDayTypeCode]   = useState('')
  const [matched,       setMatched]       = useState<MatchedRow[]>([])
  const [unmatched,     setUnmatched]     = useState<string[]>([])
  const [loadingSetup,  setLoadingSetup]  = useState(true)
  const [parsing,       setParsing]       = useState(false)
  const [saving,        setSaving]        = useState(false)
  const [fileCount,     setFileCount]     = useState(0)

  const fileRef = useRef<HTMLInputElement>(null)

  useEffect(() => {
    Promise.all([
      apiFetch('/transit/day-type?pageSize=100').then((r) => r.json()),
      apiFetch('/transit/transit-line?pageSize=10000').then((r) => r.json()),
    ]).then(([dtData, lineData]) => {
      const dts   = dtData.data   ?? []
      const lines = lineData.data ?? []
      setDayTypes(dts)
      setSystemLines(lines)
      if (dts.length) setDayTypeCode(dts[0].code)
    }).finally(() => setLoadingSetup(false))
  }, [])

  useEffect(() => {
    function onKey(e: KeyboardEvent) { if (e.key === 'Escape') onClose() }
    document.addEventListener('keydown', onKey)
    return () => document.removeEventListener('keydown', onKey)
  }, [onClose])

  async function handleFiles(e: React.ChangeEvent<HTMLInputElement>) {
    const files = Array.from(e.target.files ?? [])
    if (!files.length) return
    setFileCount(files.length)
    setParsing(true)
    try {
      const demandByCode = await parseAndAggregate(files)
      const codeSet      = new Set(systemLines.map((l) => l.code))
      const lineByCode   = new Map(systemLines.map((l) => [l.code, l]))

      const newMatched:   MatchedRow[] = []
      const newUnmatched: string[]     = []

      for (const [code, demand] of Object.entries(demandByCode)) {
        const line = lineByCode.get(code)
        if (line) {
          newMatched.push({ lineId: line.id, lineCode: line.code, lineName: line.name, demand, selected: true })
        } else {
          newUnmatched.push(code)
        }
      }

      newMatched.sort((a, b) => a.lineCode.localeCompare(b.lineCode))
      newUnmatched.sort()
      setMatched(newMatched)
      setUnmatched(newUnmatched)
    } catch (err) {
      console.error('[DemandImportModal] parse error:', err)
      toast.error('Erro ao processar arquivo(s) JSON')
    } finally {
      setParsing(false)
    }
  }

  function toggleAll(value: boolean) {
    setMatched((prev) => prev.map((r) => ({ ...r, selected: value })))
  }

  function toggleRow(lineId: string) {
    setMatched((prev) => prev.map((r) => r.lineId === lineId ? { ...r, selected: !r.selected } : r))
  }

  const selected   = matched.filter((r) => r.selected)
  const allChecked = matched.length > 0 && matched.every((r) => r.selected)
  const someChecked = matched.some((r) => r.selected)

  async function handleApply() {
    if (!dayTypeCode || selected.length === 0) return
    setSaving(true)
    try {
      const res = await apiFetch('/transit/transit-line/demand/apply', {
        method:  'POST',
        headers: { 'Content-Type': 'application/json' },
        body:    JSON.stringify({
          dayTypeCode,
          updates: selected.map(({ lineId, demand }) => ({ lineId, demand })),
        }),
      })
      if (!res.ok) {
        const json = await res.json().catch(() => ({}))
        throw new Error(extractError(json))
      }
      const { updated } = await res.json() as { updated: number }
      toast.success(`Demanda atualizada em ${updated} linha${updated !== 1 ? 's' : ''}`)
      onApplied()
      onClose()
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Erro ao aplicar demanda')
    } finally {
      setSaving(false)
    }
  }

  function totalPax(demand: LineDemand) {
    return Object.values(demand).reduce((s, horas) => s + Object.values(horas).reduce((ss, v) => ss + v, 0), 0)
  }

  const DIR_LABEL: Record<string, string> = { OUTBOUND: 'Ida', INBOUND: 'Volta', CIRCULAR: 'Circular' }

  const hasFiles = matched.length > 0 || unmatched.length > 0

  return createPortal(
    <div className="fixed inset-0 z-50 flex items-start justify-center pt-20">
      <div className="absolute inset-0 bg-black/50" onClick={onClose} />

      <div className="relative z-10 w-full max-w-3xl mx-4 bg-card border border-border rounded-lg shadow-xl flex flex-col max-h-[80vh]">
        {/* Header */}
        <div className="flex items-center justify-between px-5 py-4 border-b border-border">
          <div>
            <h2 className="text-base font-semibold">Importar Demanda</h2>
            <p className="text-xs text-muted-foreground mt-0.5">
              Carregue arquivos JSON de contagem e atualize a demanda por faixa horária
            </p>
          </div>
        </div>

        {/* Controls */}
        <div className="px-5 py-3 border-b border-border flex flex-wrap items-end gap-4">
          <div className="flex flex-col gap-1">
            <label className="text-xs text-muted-foreground">Tipo de Dia</label>
            {loadingSetup ? (
              <div className="h-8 w-40 rounded-sm bg-muted animate-pulse" />
            ) : (
              <select
                value={dayTypeCode}
                onChange={(e) => setDayTypeCode(e.target.value)}
                className="h-8 rounded-sm border border-input bg-background px-2 text-sm focus:outline-none focus:ring-2 focus:ring-ring"
              >
                {dayTypes.map((dt) => (
                  <option key={dt.id} value={dt.code}>{dt.name} ({dt.code})</option>
                ))}
              </select>
            )}
          </div>

          <div className="flex flex-col gap-1">
            <label className="text-xs text-muted-foreground">Arquivos JSON</label>
            <Button
              size="sm"
              variant="ghost"
              onClick={() => fileRef.current?.click()}
              disabled={parsing || loadingSetup}
            >
              {parsing
                ? 'Processando…'
                : fileCount > 0
                  ? `${fileCount} arquivo${fileCount !== 1 ? 's' : ''} carregado${fileCount !== 1 ? 's' : ''}`
                  : 'Selecionar arquivos'}
            </Button>
            <input ref={fileRef} type="file" accept=".json" multiple className="hidden" onChange={handleFiles} />
          </div>
        </div>

        {/* Summary bar */}
        {hasFiles && (
          <div className="px-5 py-2 text-xs text-muted-foreground border-b border-border bg-muted/30 flex gap-4">
            <span>{matched.length} linha{matched.length !== 1 ? 's' : ''} identificada{matched.length !== 1 ? 's' : ''}</span>
            {unmatched.length > 0 && (
              <span className="text-amber-600 dark:text-amber-400">
                {unmatched.length} não identificada{unmatched.length !== 1 ? 's' : ''}: {unmatched.join(', ')}
              </span>
            )}
            <span className="ml-auto">{selected.length} selecionada{selected.length !== 1 ? 's' : ''} — tipo: <strong>{dayTypeCode}</strong></span>
          </div>
        )}

        {/* Table */}
        <div className="overflow-auto flex-1">
          {!hasFiles ? (
            <div className="p-8 text-center text-sm text-muted-foreground">
              {parsing || loadingSetup
                ? 'Carregando…'
                : 'Selecione um ou mais arquivos JSON para visualizar as linhas'}
            </div>
          ) : (
            <table className="w-full text-sm">
              <thead className="sticky top-0 z-10 border-b border-border">
                <tr>
                  <th className="bg-card px-3 py-2 text-left w-8">
                    <input
                      type="checkbox"
                      checked={allChecked}
                      ref={(el) => { if (el) el.indeterminate = !allChecked && someChecked }}
                      onChange={(e) => toggleAll(e.target.checked)}
                      className="accent-ring w-4 h-4"
                    />
                  </th>
                  <th className="bg-card px-3 py-2 text-left text-xs font-medium text-muted-foreground uppercase tracking-wider">Código</th>
                  <th className="bg-card px-3 py-2 text-left text-xs font-medium text-muted-foreground uppercase tracking-wider">Nome</th>
                  <th className="bg-card px-3 py-2 text-left text-xs font-medium text-muted-foreground uppercase tracking-wider">Sentidos</th>
                  <th className="bg-card px-3 py-2 text-right text-xs font-medium text-muted-foreground uppercase tracking-wider">Total pax</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-border">
                {matched.map((r) => (
                  <tr
                    key={r.lineId}
                    className={`cursor-pointer transition-colors ${r.selected ? 'bg-accent/20' : 'hover:bg-muted/40'}`}
                    onClick={() => toggleRow(r.lineId)}
                  >
                    <td className="px-3 py-2" onClick={(e) => e.stopPropagation()}>
                      <input
                        type="checkbox"
                        checked={r.selected}
                        onChange={() => toggleRow(r.lineId)}
                        className="accent-ring w-4 h-4"
                      />
                    </td>
                    <td className="px-3 py-2 font-mono text-xs">{r.lineCode}</td>
                    <td className="px-3 py-2 text-xs">{r.lineName}</td>
                    <td className="px-3 py-2 text-xs text-muted-foreground">
                      {Object.keys(r.demand).map((d) => DIR_LABEL[d] ?? d).join(', ')}
                    </td>
                    <td className="px-3 py-2 text-right font-mono text-xs">
                      {totalPax(r.demand).toLocaleString('pt-BR')}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </div>

        {/* Footer */}
        <div className="flex justify-end gap-2 px-5 py-4 border-t border-border">
          <Button variant="cancel" size="sm" onClick={onClose} disabled={saving}>
            Cancelar
          </Button>
          <Button
            size="sm"
            onClick={handleApply}
            disabled={saving || selected.length === 0 || !dayTypeCode}
          >
            {saving ? 'Aplicando…' : `Aplicar (${selected.length})`}
          </Button>
        </div>
      </div>
    </div>,
    document.body,
  )
}
