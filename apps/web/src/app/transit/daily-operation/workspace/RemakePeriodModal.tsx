'use client'

// "Refazer período" (Gerar ▾): the empresa's PLANNED days of a period, from today on, discarded
// and copied again from the plans in force — the server counts first (dryRun) what is remade,
// what stays (published / closed) and the locked allocations lost, shown before confirming.

import { useEffect, useState } from 'react'
import { useQuery } from '@tanstack/react-query'
import type { RemakePeriodResult } from '@nyx/schemas'
import { Button } from '@/components/ui/button'
import { Icons } from '@/lib/icons'
import { apiFetch } from '@/lib/auth'
import { localToday } from '@/lib/plan-vigence'
import { extractError } from '@/lib/utils'
import { useShortcut, useShortcutContext } from '@/lib/keywatch'
import { fmtDay } from './board'

const ORIGIN = 'apps/web/src/app/transit/daily-operation/workspace/RemakePeriodModal.tsx'

interface Props {
  branchId: string
  // the view's period — the default
  from:     string
  to:       string
  onDone:   (r: RemakePeriodResult) => void
  onClose:  () => void
}

async function remake(body: unknown): Promise<RemakePeriodResult> {
  const res = await apiFetch('/transit/daily-operation/remake-period', { method: 'POST', body: JSON.stringify(body) })
  const json = await res.json().catch(() => ({}))
  if (!res.ok) throw new Error(extractError(json))
  return json as RemakePeriodResult
}

export function RemakePeriodModal({ branchId, from: viewFrom, to: viewTo, onDone, onClose }: Props) {
  useShortcutContext('remake_period_md', 'Atalhos — Refazer período')
  const today = localToday()
  const [from, setFrom] = useState(viewFrom < today ? today : viewFrom)
  const [to, setTo] = useState(viewTo)
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const periodError = to < today ? 'Período já passou — dias anteriores a hoje não são refeitos' : from > to ? 'Início depois do fim' : null

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') onClose() }
    document.addEventListener('keydown', onKey)
    return () => document.removeEventListener('keydown', onKey)
  }, [onClose])

  const { data: preview, isFetching, error: previewError } = useQuery({
    queryKey: ['transit', 'remake-period', branchId, from, to],
    queryFn:  () => remake({ branchId, from, to, dryRun: true }),
    enabled:  !periodError,
    staleTime: 0,
  })

  async function confirm() {
    if (periodError || !preview?.days) return
    setSaving(true); setError(null)
    try { onDone(await remake({ branchId, from, to })) }
    catch (e) { setError(e instanceof Error ? e.message : 'Erro') }
    finally { setSaving(false) }
  }
  useShortcut('alt+g', () => void confirm(), { desc: 'Refazer', icon: Icons.RotateCcw, context: 'remake_period_md', origin: ORIGIN })

  const input = 'h-8 border border-input rounded-sm text-sm bg-input-bg px-2'
  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center">
      <div className="absolute inset-0 bg-black/40" onClick={onClose} />
      <div className="relative z-10 bg-card border border-border rounded-lg shadow-xl w-full max-w-md mx-4 p-5 space-y-4">
        <div className="flex items-center gap-2">
          <Icons.RotateCcw className="w-4 h-4 text-muted-foreground" />
          <h2 className="text-base font-semibold">Refazer período</h2>
        </div>
        <p className="text-xs text-muted-foreground">
          Copia de novo os dias planejados a partir dos planejamentos em vigor. Alocações são perdidas; folgas lançadas, publicados e encerrados ficam.
        </p>

        <div className="flex items-center gap-2 text-sm">
          <input type="date" value={from} min={today} max={to} onChange={e => e.target.value && setFrom(e.target.value)} className={input} />
          <span className="text-muted-foreground">a</span>
          <input type="date" value={to} min={from} onChange={e => e.target.value && setTo(e.target.value)} className={input} />
        </div>

        <div className="text-sm space-y-1.5 min-h-12">
          {periodError && <p className="text-destructive">{periodError}</p>}
          {!periodError && isFetching && <p className="text-muted-foreground">Contando os dias…</p>}
          {!periodError && previewError && <p className="text-destructive">{previewError instanceof Error ? previewError.message : 'Erro'}</p>}
          {!periodError && preview && !isFetching && (
            <>
              <p>
                {preview.days ? <><span className="font-medium">{preview.days} dia(s)</span> refeitos de {fmtDay(preview.from)} a {fmtDay(preview.to)}</> : 'Nenhum dia planejado no período.'}
                {preview.skipped > 0 && <span className="text-muted-foreground"> · {preview.skipped} publicado(s)/encerrado(s) ficam</span>}
              </p>
              {preview.days > 0 && preview.branches.length > 1 && (
                <p className="flex gap-2 rounded-sm border border-amber-500/50 bg-amber-500/10 px-2.5 py-2 text-amber-700 dark:text-amber-300">
                  <Icons.AlertTriangle className="w-4 h-4 shrink-0 mt-0.5" />
                  <span>O dia é do escopo: <span className="font-semibold">todas as empresas ({preview.branches.join(', ')})</span> são refeitas.</span>
                </p>
              )}
              {preview.locked > 0 && (
                <p className="flex gap-2 rounded-sm border border-destructive/50 bg-destructive/10 px-2.5 py-2 text-destructive">
                  <Icons.AlertTriangle className="w-4 h-4 shrink-0 mt-0.5" />
                  <span><span className="font-semibold">{preview.locked} alocação(ões) travada(s)</span> serão perdidas.</span>
                </p>
              )}
            </>
          )}
          {error && <p className="text-destructive">{error}</p>}
        </div>

        <div className="flex justify-end gap-2">
          <Button variant="ghost" onClick={onClose}>Voltar</Button>
          <Button variant="destructive" disabled={!!periodError || !preview?.days || isFetching || saving} onClick={() => void confirm()} title="ALT+G">
            {saving ? <Icons.Loader2 className="w-4 h-4 animate-spin" /> : <Icons.RotateCcw className="w-4 h-4" />}Refazer
          </Button>
        </div>
      </div>
    </div>
  )
}
