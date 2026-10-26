'use client'

// "Reparar" — the period's pendências fixed changing as little as possible: the server's proposal
// (per target: the option found, or the options to pick from when the crew is short) → editable
// list → summary per day (published days flagged with the crew notified) → confirm. Confirming
// sends the chosen options' steps; the server refuses (409) when the day changed since.

import { Fragment, useEffect, useMemo, useState } from 'react'
import { useQuery } from '@tanstack/react-query'
import {
  DAY_REPAIR_LABEL, REPAIR_OPTION_LABEL,
  type CrewRole, type DayRepairKind, type DayRepairProposal, type RepairItem,
} from '@nyx/schemas'
import { Button } from '@/components/ui/button'
import { Icons } from '@/lib/icons'
import { apiFetch } from '@/lib/auth'
import { cn, extractError } from '@/lib/utils'
import { useShortcut, useShortcutContext } from '@/lib/keywatch'
import { WEEKDAY, fmtDay, weekday } from './board'

const ORIGIN = 'apps/web/src/app/transit/daily-operation/workspace/RepairModal.tsx'

export interface RepairRequest { kind: DayRepairKind; from: string; to: string; onlyId?: string }

interface Props extends RepairRequest {
  branchId: string
  role:     CrewRole
  canApply: boolean
  onApplied: (changed: number) => void
  onClose:  () => void
}

async function post<T>(path: string, body: unknown): Promise<T> {
  const res = await apiFetch(path, { method: 'POST', body: JSON.stringify(body) })
  const json = await res.json().catch(() => ({}))
  if (!res.ok) throw new Error(extractError(json))
  return json as T
}

export function RepairModal({ kind, from, to, onlyId, branchId, role, canApply, onApplied, onClose }: Props) {
  useShortcutContext('day_repair_md', `Atalhos — ${DAY_REPAIR_LABEL[kind]}`)
  const ctx = { branchId, role, from, to }
  const { data, error: proposeError, isFetching } = useQuery<DayRepairProposal>({
    queryKey: ['transit', 'day-repair', kind, ctx],
    queryFn:  () => post(`/transit/day-repair/${kind}/propose`, ctx),
    gcTime:   0,
  })
  const items = useMemo(() => (data?.items ?? []).filter(i => !onlyId || i.id === onlyId), [data, onlyId])

  // the option chosen per item — undefined: as proposed
  const [chosen, setChosen] = useState<Record<string, number | null>>({})
  const [step, setStep]     = useState<'list' | 'preview'>('list')
  const [busy, setBusy]     = useState(false)
  const [error, setError]   = useState<string | null>(null)
  const pick = (it: RepairItem) => (it.id in chosen ? chosen[it.id] : it.proposed)
  const picked = items.flatMap(it => { const k = pick(it); return k == null ? [] : [{ it, option: it.options[k] }] })

  const days = [...new Set(items.map(i => i.date))].sort()
  // a crew member / car chosen twice on a day
  const clash = useMemo(() => {
    const seen = new Set<string>(), out = new Set<string>()
    for (const { it, option } of picked) {
      for (const s of option.steps) {
        const who = s.type === 'crew' ? s.to : s.type === 'vehicle' ? s.to : null
        if (!who) continue
        const k = `${it.date}|${who}`
        if (seen.has(k)) out.add(it.date)
        seen.add(k)
      }
    }
    return out
  }, [picked])

  async function next() {
    if (busy || !picked.length) return
    setError(null)
    if (step === 'list') { setStep('preview'); return }
    if (!canApply || clash.size) return
    setBusy(true)
    try {
      const res = await post<{ changed: number }>(`/transit/day-repair/${kind}/apply`, { ...ctx, steps: picked.flatMap(p => p.option.steps) })
      onApplied(res.changed)
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Erro ao aplicar')
      setBusy(false)
    }
  }
  const reset = () => { setChosen({}); setStep('list'); setError(null) }

  useShortcut('alt+g', () => void next(), { desc: step === 'list' ? 'Resumo' : 'Confirmar reparo', icon: Icons.Save, context: 'day_repair_md', origin: ORIGIN })
  useShortcut('alt+l', reset, { desc: 'Voltar à proposta', icon: Icons.RotateCcw, context: 'day_repair_md', origin: ORIGIN, display: false })
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') onClose() }
    document.addEventListener('keydown', onKey)
    return () => document.removeEventListener('keydown', onKey)
  }, [onClose])

  const solvedOn = (d: string) => picked.filter(p => p.it.date === d).length
  const affectedOn = (d: string) => new Set(picked.filter(p => p.it.date === d).flatMap(p => p.option.affected)).size
  const publishedDays = days.filter(d => items.some(i => i.date === d && i.published) && solvedOn(d) > 0)

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center">
      <div className="absolute inset-0 bg-black/40" onClick={onClose} />
      <div className="relative z-10 bg-card border border-border rounded-lg shadow-xl w-full max-w-5xl mx-4 max-h-[88vh] flex flex-col">
        <header className="px-6 pt-5 pb-3 space-y-1 border-b border-border">
          <div className="flex items-center gap-2">
            <Icons.Wrench className="w-4 h-4 text-muted-foreground" />
            <h2 className="text-base font-semibold">Reparar · {DAY_REPAIR_LABEL[kind]}</h2>
            <span className="text-sm text-muted-foreground">— {from === to ? fmtDay(from) : `${fmtDay(from)} a ${fmtDay(to)}`}</span>
            <span className="ms-auto flex items-center gap-1.5 text-xs text-muted-foreground">
              <span className={cn(step === 'list' && 'text-foreground font-medium')}>1 Proposta</span>
              <Icons.ChevronRight className="w-3 h-3" />
              <span className={cn(step === 'preview' && 'text-foreground font-medium')}>2 Resumo</span>
            </span>
          </div>
          <p className="text-xs text-muted-foreground">
            {kind === 'crew'
              ? 'Primeiro quem está livre; depois trocas com o mínimo de operadores; sem isso, as opções de quadro insuficiente para escolher. Tabelas travadas não mudam.'
              : 'Primeiro um carro livre do tipo certo; sem isso, um giro com um bloco que aceite o carro que sobrou.'}
          </p>
        </header>

        <div className="overflow-auto px-6 py-4 space-y-4">
          {isFetching && <p className="text-sm text-muted-foreground">Calculando a proposta…</p>}
          {proposeError && <p className="flex gap-2 text-sm text-destructive"><Icons.AlertCircle className="w-4 h-4 shrink-0 mt-0.5" />{proposeError instanceof Error ? proposeError.message : 'Erro'}</p>}
          {data && !items.length && <p className="text-sm text-muted-foreground">Nenhuma pendência a reparar no período.</p>}

          {step === 'list' && items.length > 0 && (
            <table className="w-full text-sm">
              <thead className="text-xs text-muted-foreground">
                <tr className="[&>th]:py-1.5 [&>th]:px-2 [&>th]:text-left [&>th]:font-medium border-b border-border">
                  <th>{kind === 'crew' ? 'Tabela' : 'Bloco'}</th><th>Pendência</th><th>Hoje</th><th className="w-[45%]">Solução</th>
                </tr>
              </thead>
              <tbody>
                {days.map(d => (
                  <Fragment key={d}>
                    {days.length > 1 && (
                      <tr><td colSpan={4} className="pt-3 pb-1 px-2 text-xs font-medium">
                        {WEEKDAY[weekday(d)]} {fmtDay(d)}
                        {items.some(i => i.date === d && i.published) && <PublishedBadge />}
                      </td></tr>
                    )}
                    {items.filter(i => i.date === d).map(it => {
                      const k = pick(it)
                      const option = k == null ? null : it.options[k]
                      return (
                        <tr key={it.id} className="border-b border-border/60 [&>td]:py-1.5 [&>td]:px-2 align-top">
                          <td className="whitespace-nowrap font-medium">{it.label}{days.length === 1 && it.published && <PublishedBadge />}</td>
                          <td className="text-xs text-muted-foreground">{it.reason}</td>
                          <td className="text-xs whitespace-nowrap">{it.current ?? <span className="text-muted-foreground">—</span>}</td>
                          <td>
                            {it.options.length ? (
                              <div className="space-y-1">
                                <select value={k ?? ''} onChange={e => setChosen({ ...chosen, [it.id]: e.target.value === '' ? null : Number(e.target.value) })}
                                  className={cn('h-7 w-full border rounded-sm text-xs bg-input-bg px-1.5', k == null ? 'border-amber-500/60 text-muted-foreground' : 'border-input')}>
                                  <option value="">{it.proposed == null ? '— escolher (quadro insuficiente) —' : '— não reparar —'}</option>
                                  {it.options.map((o, i) => <option key={i} value={i}>{REPAIR_OPTION_LABEL[o.kind]}: {o.text}</option>)}
                                </select>
                                {option && option.notes.length > 0 && (
                                  <div className="flex flex-wrap gap-1">
                                    {option.notes.map(n => <span key={n} className="rounded-sm bg-muted px-1.5 py-0.5 text-[11px] text-muted-foreground">{n}</span>)}
                                  </div>
                                )}
                              </div>
                            ) : <span className="text-xs text-muted-foreground">{it.unsolved ?? 'sem solução'}</span>}
                          </td>
                        </tr>
                      )
                    })}
                  </Fragment>
                ))}
              </tbody>
            </table>
          )}

          {step === 'preview' && (
            <div className="space-y-3">
              <table className="w-full text-sm tabular-nums">
                <thead className="text-xs text-muted-foreground">
                  <tr className="[&>th]:py-1.5 [&>th]:px-2 [&>th]:font-medium border-b border-border">
                    <th className="text-left">Dia</th><th className="text-right">Pendências</th><th className="text-right">Reparadas</th><th className="text-right">Restam</th><th className="text-right">Operadores afetados</th><th />
                  </tr>
                </thead>
                <tbody>
                  {days.map(d => {
                    const total = items.filter(i => i.date === d).length
                    return (
                      <tr key={d} className="border-b border-border/60 [&>td]:py-1.5 [&>td]:px-2">
                        <td>{WEEKDAY[weekday(d)]} {fmtDay(d)}</td>
                        <td className="text-right">{total}</td>
                        <td className="text-right text-emerald-600 dark:text-emerald-400">{solvedOn(d)}</td>
                        <td className="text-right">{total - solvedOn(d)}</td>
                        <td className="text-right">{kind === 'crew' ? affectedOn(d) : '—'}</td>
                        <td className="text-right">
                          {items.some(i => i.date === d && i.published) && solvedOn(d) > 0 && <PublishedBadge />}
                          {clash.has(d) && <span className="ms-2 text-xs text-destructive">mesmo {kind === 'crew' ? 'operador' : 'carro'} em duas opções</span>}
                        </td>
                      </tr>
                    )
                  })}
                </tbody>
              </table>
              {publishedDays.length > 0 && (
                <p className="flex gap-2 rounded-md border border-amber-500/40 bg-amber-500/10 px-3 py-2 text-xs text-amber-700 dark:text-amber-300">
                  <Icons.AlertTriangle className="w-4 h-4 shrink-0" />
                  {publishedDays.length} dia(s) já publicado(s): cada mudança fica no histórico do dia e chega aos operadores afetados.
                </p>
              )}
            </div>
          )}
        </div>

        <footer className="flex items-center gap-2 px-6 py-3 border-t border-border">
          {error ? <span className="flex-1 flex gap-1.5 text-xs text-destructive"><Icons.AlertCircle className="w-3.5 h-3.5 shrink-0 mt-px" />{error}</span>
            : <span className="text-xs text-muted-foreground me-auto">{picked.length} de {items.length} pendência(s) com solução escolhida</span>}
          <Button type="button" variant="cancel" size="sm" onClick={step === 'list' ? onClose : () => { setStep('list'); setError(null) }}>
            {step === 'list' ? 'Cancelar' : 'Voltar'}
          </Button>
          {step === 'list'
            ? <Button type="button" size="sm" disabled={!picked.length} onClick={() => void next()}>Resumo</Button>
            : <Button type="button" variant="safeConfirm" size="sm" disabled={busy || !canApply || clash.size > 0} onClick={() => void next()}>{busy ? 'Aplicando…' : 'Confirmar reparo'}</Button>}
        </footer>
      </div>
    </div>
  )
}

function PublishedBadge() {
  return <span className="ms-2 rounded-sm bg-amber-500/15 px-1.5 py-0.5 text-[10px] font-medium text-amber-700 dark:text-amber-300">publicado</span>
}
