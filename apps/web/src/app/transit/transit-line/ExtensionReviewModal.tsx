'use client'

import { useEffect, useMemo, useRef, useState } from 'react'
import { createPortal } from 'react-dom'
import { Button }       from '@/components/ui/button'
import { apiFetch }     from '@/lib/auth'
import { useToast }     from '@/lib/toast-context'
import { extractError } from '@/lib/utils'

interface DivergenceRow {
  lineId:      string
  lineCode:    string
  lineName:    string
  direction:   string
  storedKm:    number
  computedKm:  number
  diffKm:      number
  diffPercent: number
}

const DIR_LABEL: Record<string, string> = {
  OUTBOUND: 'Ida',
  INBOUND:  'Volta',
  CIRCULAR: 'Circular',
}

type FilterMode = 'km' | 'pct'

interface Props {
  onClose:   () => void
  onApplied: () => void
}

function rowKey(r: DivergenceRow) {
  return `${r.lineId}:${r.direction}`
}

export function ExtensionReviewModal({ onClose, onApplied }: Props) {
  const { toast } = useToast()

  const [rows,       setRows]       = useState<DivergenceRow[]>([])
  const [loading,    setLoading]    = useState(true)
  const [saving,     setSaving]     = useState(false)
  const [filterMode, setFilterMode] = useState<FilterMode>('km')
  const [threshold,  setThreshold]  = useState('')
  const [selected,   setSelected]   = useState<Set<string>>(new Set())

  const thresholdVal = threshold === '' ? 0 : Math.max(0, Number(threshold))

  useEffect(() => {
    apiFetch('/transit/transit-line/extension-review')
      .then((r) => r.json())
      .then((data: DivergenceRow[]) => {
        setRows(data)
        setSelected(new Set(data.map(rowKey)))
      })
      .finally(() => setLoading(false))
  }, [])

  const visible = useMemo(
    () => rows.filter((r) => (filterMode === 'km' ? r.diffKm : r.diffPercent) > thresholdVal),
    [rows, filterMode, thresholdVal],
  )

  const allChecked  = visible.length > 0 && visible.every((r) => selected.has(rowKey(r)))
  const someChecked = visible.some((r) => selected.has(rowKey(r)))

  function toggleAll() {
    setSelected((prev) => {
      const next = new Set(prev)
      if (allChecked) visible.forEach((r) => next.delete(rowKey(r)))
      else            visible.forEach((r) => next.add(rowKey(r)))
      return next
    })
  }

  function toggle(key: string) {
    setSelected((prev) => {
      const next = new Set(prev)
      next.has(key) ? next.delete(key) : next.add(key)
      return next
    })
  }

  const selectedInView = visible.filter((r) => selected.has(rowKey(r)))

  async function handleApply() {
    if (selectedInView.length === 0) return
    setSaving(true)
    try {
      const res = await apiFetch('/transit/transit-line/extension-review/apply', {
        method:  'POST',
        headers: { 'Content-Type': 'application/json' },
        body:    JSON.stringify({
          updates: selectedInView.map((r) => ({
            lineId:     r.lineId,
            direction:  r.direction,
            computedKm: r.computedKm,
          })),
        }),
      })
      if (!res.ok) {
        const json = await res.json().catch(() => ({}))
        throw new Error(extractError(json))
      }
      const { updated } = await res.json() as { updated: number }
      toast.success(`${updated} extensão${updated !== 1 ? 'ões' : ''} atualizada${updated !== 1 ? 's' : ''}`)
      onApplied()
      onClose()
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Erro ao aplicar extensões')
    } finally {
      setSaving(false)
    }
  }

  const inputRef = useRef<HTMLInputElement>(null)
  useEffect(() => { inputRef.current?.focus() }, [])

  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      if (e.key === 'Escape') onClose()
    }
    document.addEventListener('keydown', onKey)
    return () => document.removeEventListener('keydown', onKey)
  }, [onClose])

  const filterLabel = filterMode === 'km' ? 'Variação mínima (km)' : 'Variação mínima (%)'
  const filterStep  = filterMode === 'km' ? '0.1' : '1'

  return createPortal(
    <div className="fixed inset-0 z-50 flex items-start justify-center pt-20">
      <div className="absolute inset-0 bg-black/50" onClick={onClose} />

      <div className="relative z-10 w-full max-w-4xl mx-4 bg-card border border-border rounded-lg shadow-xl flex flex-col max-h-[80vh]">
        {/* Header */}
        <div className="flex items-center justify-between px-5 py-4 border-b border-border">
          <div>
            <h2 className="text-base font-semibold">Revisão de Extensões</h2>
            <p className="text-xs text-muted-foreground mt-0.5">
              Trajetos com divergência entre extensão armazenada e a trajetória gerada (sentido principal)
            </p>
          </div>
          <div className="flex items-center gap-3">
            {/* Filter mode toggle */}
            <div className="flex rounded-sm border border-input overflow-hidden text-xs">
              <button
                className={`px-2.5 py-1.5 transition-colors ${filterMode === 'km' ? 'bg-accent text-accent-foreground' : 'bg-background text-muted-foreground hover:bg-muted'}`}
                onClick={() => setFilterMode('km')}
              >km</button>
              <button
                className={`px-2.5 py-1.5 transition-colors ${filterMode === 'pct' ? 'bg-accent text-accent-foreground' : 'bg-background text-muted-foreground hover:bg-muted'}`}
                onClick={() => setFilterMode('pct')}
              >%</button>
            </div>
            <label className="text-xs text-muted-foreground whitespace-nowrap">{filterLabel}</label>
            <input
              ref={inputRef}
              type="number"
              min="0"
              step={filterStep}
              value={threshold}
              onChange={(e) => setThreshold(e.target.value)}
              placeholder="0"
              className="w-20 h-8 rounded-sm border border-input bg-background px-2 text-sm focus:outline-none focus:ring-2 focus:ring-ring"
            />
          </div>
        </div>

        {/* Summary */}
        <div className="px-5 py-2 text-xs text-muted-foreground border-b border-border bg-muted/30">
          {loading
            ? 'Calculando…'
            : `${rows.length} divergência${rows.length !== 1 ? 's' : ''} encontrada${rows.length !== 1 ? 's' : ''} — ${visible.length} com variação > ${thresholdVal}${filterMode === 'pct' ? '%' : ' km'} — ${selectedInView.length} selecionada${selectedInView.length !== 1 ? 's' : ''}`
          }
        </div>

        {/* Table */}
        <div className="overflow-auto flex-1">
          {loading ? (
            <div className="p-8 text-center text-sm text-muted-foreground">Calculando divergências…</div>
          ) : visible.length === 0 ? (
            <div className="p-8 text-center text-sm text-muted-foreground">
              {rows.length === 0
                ? 'Nenhuma divergência encontrada — extensões alinhadas com a trajetória gerada'
                : `Nenhuma divergência com variação > ${thresholdVal}${filterMode === 'pct' ? '%' : ' km'}`
              }
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
                      onChange={toggleAll}
                      className="accent-ring w-4 h-4"
                    />
                  </th>
                  <th className="bg-card px-3 py-2 text-left text-xs font-medium text-muted-foreground uppercase tracking-wider">Código</th>
                  <th className="bg-card px-3 py-2 text-left text-xs font-medium text-muted-foreground uppercase tracking-wider">Nome</th>
                  <th className="bg-card px-3 py-2 text-left text-xs font-medium text-muted-foreground uppercase tracking-wider">Sentido</th>
                  <th className="bg-card px-3 py-2 text-right text-xs font-medium text-muted-foreground uppercase tracking-wider">Armazenado</th>
                  <th className="bg-card px-3 py-2 text-right text-xs font-medium text-muted-foreground uppercase tracking-wider">Calculado</th>
                  <th className="bg-card px-3 py-2 text-right text-xs font-medium text-muted-foreground uppercase tracking-wider">Δ km</th>
                  <th className="bg-card px-3 py-2 text-right text-xs font-medium text-muted-foreground uppercase tracking-wider">Δ %</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-border">
                {visible.map((r) => {
                  const key     = rowKey(r)
                  const isSel   = selected.has(key)
                  const isLarge = r.diffKm >= 1 || r.diffPercent >= 5
                  return (
                    <tr
                      key={key}
                      className={`cursor-pointer transition-colors ${isSel ? 'bg-accent/20' : 'hover:bg-muted/40'}`}
                      onClick={() => toggle(key)}
                    >
                      <td className="px-3 py-2" onClick={(e) => e.stopPropagation()}>
                        <input
                          type="checkbox"
                          checked={isSel}
                          onChange={() => toggle(key)}
                          className="accent-ring w-4 h-4"
                        />
                      </td>
                      <td className="px-3 py-2 font-mono text-xs">{r.lineCode}</td>
                      <td className="px-3 py-2 text-xs">{r.lineName}</td>
                      <td className="px-3 py-2 text-xs text-muted-foreground">{DIR_LABEL[r.direction] ?? r.direction}</td>
                      <td className="px-3 py-2 text-right font-mono text-xs text-muted-foreground">{r.storedKm.toFixed(2)}</td>
                      <td className="px-3 py-2 text-right font-mono text-xs">{r.computedKm.toFixed(2)}</td>
                      <td className={`px-3 py-2 text-right font-mono text-xs font-medium ${isLarge ? 'text-amber-600 dark:text-amber-400' : 'text-muted-foreground'}`}>
                        {r.diffKm.toFixed(2)}
                      </td>
                      <td className={`px-3 py-2 text-right font-mono text-xs font-medium ${isLarge ? 'text-amber-600 dark:text-amber-400' : 'text-muted-foreground'}`}>
                        {r.diffPercent.toFixed(1)}%
                      </td>
                    </tr>
                  )
                })}
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
            disabled={saving || selectedInView.length === 0}
          >
            {saving ? 'Aplicando…' : `Aplicar (${selectedInView.length})`}
          </Button>
        </div>
      </div>
    </div>,
    document.body,
  )
}
