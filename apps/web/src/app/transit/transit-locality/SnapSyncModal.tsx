'use client'

import { useEffect, useMemo, useRef, useState } from 'react'
import { createPortal } from 'react-dom'
import { Button } from '@/components/ui/button'
import { apiFetch } from '@/lib/auth'
import { useToast } from '@/lib/toast-context'
import { extractError } from '@/lib/utils'
import type { SnapInfo } from '@nyx/schemas'

interface LocalityRow {
  id:       string
  code:     string
  name:     string
  lat:      number | null
  lng:      number | null
  snapInfo: SnapInfo | null
}

interface Props {
  onClose:   () => void
  onApplied: () => void
}

function fmtCoord(v: number | null | undefined) {
  return v == null ? '—' : v.toFixed(6)
}

function fmtDistance(m: number) {
  return m < 1000 ? `${Math.round(m)}m` : `${(m / 1000).toFixed(2)}km`
}

export function SnapSyncModal({ onClose, onApplied }: Props) {
  const { toast } = useToast()

  const [localities, setLocalities] = useState<LocalityRow[]>([])
  const [loading,    setLoading]    = useState(true)
  const [saving,     setSaving]     = useState(false)
  const [threshold,  setThreshold]  = useState('')
  const [selected,   setSelected]   = useState<Set<string>>(new Set())

  const thresholdM = threshold === '' ? 0 : Math.max(0, Number(threshold))

  useEffect(() => {
    apiFetch('/transit/transit-locality?page=1&pageSize=9999')
      .then((r) => r.json())
      .then(({ data }: { data: LocalityRow[] }) => {
        const withSnap = data.filter((l) => l.snapInfo != null)
        setLocalities(withSnap)
        setSelected(new Set(withSnap.map((l) => l.id)))
      })
      .finally(() => setLoading(false))
  }, [])

  const visible = useMemo(
    () => localities.filter((l) => (l.snapInfo?.distanceM ?? 0) >= thresholdM),
    [localities, thresholdM],
  )

  const allChecked  = visible.length > 0 && visible.every((l) => selected.has(l.id))
  const someChecked = visible.some((l) => selected.has(l.id))

  function toggleAll() {
    setSelected((prev) => {
      const next = new Set(prev)
      if (allChecked) {
        visible.forEach((l) => next.delete(l.id))
      } else {
        visible.forEach((l) => next.add(l.id))
      }
      return next
    })
  }

  function toggle(id: string) {
    setSelected((prev) => {
      const next = new Set(prev)
      next.has(id) ? next.delete(id) : next.add(id)
      return next
    })
  }

  const selectedInView = visible.filter((l) => selected.has(l.id))

  async function handleApply() {
    if (selectedInView.length === 0) return
    setSaving(true)
    try {
      const res = await apiFetch('/transit/transit-locality/snap-sync', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ ids: selectedInView.map((l) => l.id) }),
      })
      if (!res.ok) {
        const json = await res.json().catch(() => ({}))
        throw new Error(extractError(json))
      }
      const { updated } = await res.json() as { updated: number; skipped: number }
      toast.success(`${updated} localidade${updated !== 1 ? 's' : ''} atualizada${updated !== 1 ? 's' : ''}`)
      onApplied()
      onClose()
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Erro ao aplicar snap')
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

  return createPortal(
    <div className="fixed inset-0 z-50 flex items-start justify-center pt-20">
      <div className="absolute inset-0 bg-black/50" onClick={onClose} />

      <div className="relative z-10 w-full max-w-3xl mx-4 bg-card border border-border rounded-lg shadow-xl flex flex-col max-h-[80vh]">
        {/* Header */}
        <div className="flex items-center justify-between px-5 py-4 border-b border-border">
          <div>
            <h2 className="text-base font-semibold">Sync de Coordenadas por Snap</h2>
            <p className="text-xs text-muted-foreground mt-0.5">
              Aplica as coordenadas snapped pelo OSRM ao lat/lng de cada localidade
            </p>
          </div>
          <div className="flex items-center gap-2">
            <label className="text-xs text-muted-foreground whitespace-nowrap">Variação mínima (m)</label>
            <input
              ref={inputRef}
              type="number"
              min="0"
              value={threshold}
              onChange={(e) => setThreshold(e.target.value)}
              placeholder="0"
              className="w-24 h-8 rounded-sm border border-input bg-background px-2 text-sm focus:outline-none focus:ring-2 focus:ring-ring"
            />
          </div>
        </div>

        {/* Summary */}
        <div className="px-5 py-2 text-xs text-muted-foreground border-b border-border bg-muted/30">
          {loading
            ? 'Carregando…'
            : `${localities.length} com snap disponível — ${visible.length} com variação ≥ ${fmtDistance(thresholdM)} — ${selectedInView.length} selecionada${selectedInView.length !== 1 ? 's' : ''}`
          }
        </div>

        {/* Table */}
        <div className="overflow-auto flex-1">
          {loading ? (
            <div className="p-8 text-center text-sm text-muted-foreground">Carregando localidades…</div>
          ) : visible.length === 0 ? (
            <div className="p-8 text-center text-sm text-muted-foreground">
              Nenhuma localidade com variação ≥ {fmtDistance(thresholdM)}
            </div>
          ) : (
            <table className="w-full text-sm">
              <thead className="sticky top-0 bg-card border-b border-border">
                <tr>
                  <th className="px-3 py-2 text-left w-8">
                    <input
                      type="checkbox"
                      checked={allChecked}
                      ref={(el) => { if (el) el.indeterminate = !allChecked && someChecked }}
                      onChange={toggleAll}
                      className="accent-ring w-4 h-4"
                    />
                  </th>
                  <th className="px-3 py-2 text-left text-xs font-medium text-muted-foreground uppercase tracking-wider">Código</th>
                  <th className="px-3 py-2 text-left text-xs font-medium text-muted-foreground uppercase tracking-wider">Nome</th>
                  <th className="px-3 py-2 text-right text-xs font-medium text-muted-foreground uppercase tracking-wider">Lat atual</th>
                  <th className="px-3 py-2 text-right text-xs font-medium text-muted-foreground uppercase tracking-wider">Lng atual</th>
                  <th className="px-3 py-2 text-right text-xs font-medium text-muted-foreground uppercase tracking-wider">Lat snap</th>
                  <th className="px-3 py-2 text-right text-xs font-medium text-muted-foreground uppercase tracking-wider">Lng snap</th>
                  <th className="px-3 py-2 text-right text-xs font-medium text-muted-foreground uppercase tracking-wider">Variação</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-border">
                {visible.map((l) => {
                  const snap     = l.snapInfo!
                  const isLarge  = snap.distanceM >= 100
                  const isSel    = selected.has(l.id)
                  return (
                    <tr
                      key={l.id}
                      className={`cursor-pointer transition-colors ${isSel ? 'bg-accent/20' : 'hover:bg-muted/40'}`}
                      onClick={() => toggle(l.id)}
                    >
                      <td className="px-3 py-2" onClick={(e) => e.stopPropagation()}>
                        <input
                          type="checkbox"
                          checked={isSel}
                          onChange={() => toggle(l.id)}
                          className="accent-ring w-4 h-4"
                        />
                      </td>
                      <td className="px-3 py-2 font-mono text-xs">{l.code}</td>
                      <td className="px-3 py-2">{l.name}</td>
                      <td className="px-3 py-2 text-right font-mono text-xs text-muted-foreground">{fmtCoord(l.lat)}</td>
                      <td className="px-3 py-2 text-right font-mono text-xs text-muted-foreground">{fmtCoord(l.lng)}</td>
                      <td className="px-3 py-2 text-right font-mono text-xs">{fmtCoord(snap.lat)}</td>
                      <td className="px-3 py-2 text-right font-mono text-xs">{fmtCoord(snap.lng)}</td>
                      <td className={`px-3 py-2 text-right font-mono text-xs font-medium ${isLarge ? 'text-amber-600 dark:text-amber-400' : 'text-muted-foreground'}`}>
                        {fmtDistance(snap.distanceM)}
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
