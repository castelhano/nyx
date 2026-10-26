'use client'

// Painel de Escala — an adjustment of the crew (balance shifts, rest groups, lines, priority lines,
// new profiles): the server's suggestion (who, by the empresa's selection rule) → editable list
// (with the effective date when the action has one) → impact on the planning → confirm.
// Confirming only changes crew records; generated days stay as they were.

import { useEffect, useRef, useState } from 'react'
import Link from 'next/link'
import { useQuery } from '@tanstack/react-query'
import {
  CONSOLE_ACTION_DATED, CONSOLE_ACTION_LABEL, CONSOLE_NO_PLAN, REBALANCE_CRITERION_LABEL,
  type ConsoleActionKind, type ConsoleImpact, type ConsoleMove, type ConsoleSnapshot, type ConsoleSuggestion, type RebalanceRules, type RosterAdjustmentRow,
} from '@nyx/schemas'
import { Button } from '@/components/ui/button'
import { Icons } from '@/lib/icons'
import { apiFetch } from '@/lib/auth'
import { cn, extractError } from '@/lib/utils'
import { useShortcut, useShortcutContext } from '@/lib/keywatch'
import { localToday } from '@/lib/plan-vigence'
import { fmtDay, signed } from './sections'

const ORIGIN = 'apps/web/src/app/transit/console/AdjustModal.tsx'

const CONFIRM_TEXT: Record<ConsoleActionKind, (n: number, date: string) => string> = {
  shifts:   (n, d) => `Confirmar muda o turno de ${n} operador(es) a partir de ${d}.`,
  groups:   n => `Confirmar muda o grupo de folga de ${n} operador(es) — vale para a próxima geração.`,
  lines:    n => `Confirmar habilita a linha para ${n} operador(es).`,
  priority: n => `Confirmar torna a linha prioritária para ${n} operador(es).`,
  profiles: (n, d) => `Confirmar cria ${n} perfil(is) de operador, no turno a partir de ${d}.`,
}

// what to adjust — groups: a shift; lines / priority: a shift and a line
export interface ConsoleAction { kind: ConsoleActionKind; shiftId?: string; lineId?: string }

interface Props {
  action:     ConsoleAction
  snapshot:   ConsoleSnapshot
  rule:       RebalanceRules | null
  canApply:   boolean
  onEditRule: () => void
  onApplied:  (adjustment: RosterAdjustmentRow) => void
  onClose:    () => void
}

async function post<T>(path: string, body: unknown): Promise<T> {
  const res = await apiFetch(path, { method: 'POST', body: JSON.stringify(body) })
  const json = await res.json().catch(() => ({}))
  if (!res.ok) throw new Error(extractError(json))
  return json as T
}

export function AdjustModal({ action, snapshot, rule, canApply, onEditRule, onApplied, onClose }: Props) {
  useShortcutContext('console_adjust_md', `Atalhos — ${CONSOLE_ACTION_LABEL[action.kind]}`)
  const ctx = { branchId: snapshot.branchId, role: snapshot.role, scopeId: snapshot.scopeId }
  const base = `/transit/console/actions/${action.kind}`
  const dated = CONSOLE_ACTION_DATED[action.kind]
  // no effective plan: nothing to suggest from — only new profiles go, by hand
  const noPlan = action.kind !== 'profiles' && !snapshot.plans.some(p => p.crewPlan)
  const { data: suggestion, error: suggestError, isFetching: suggesting } = useQuery<ConsoleSuggestion>({
    queryKey: ['transit', 'console', 'suggest', ctx, action],
    queryFn:  () => post(`${base}/suggest`, { ...ctx, shiftId: action.shiftId ?? null, lineId: action.lineId ?? null }),
    gcTime:   0,
    enabled:  !noPlan,
  })

  const [step, setStep]           = useState<'list' | 'preview'>('list')
  const [effective, setEffective] = useState(dated ? '' : localToday())
  // null = the suggestion as it came
  const [edit, setEdit]           = useState<{ rows: { move: ConsoleMove; on: boolean }[]; bench: ConsoleSuggestion['bench'] } | null>(null)
  const [impact, setImpact]       = useState<ConsoleImpact | null>(null)
  const [busy, setBusy]           = useState(false)
  const [error, setError]         = useState<string | null>(null)
  const [showExcluded, setShowExcluded] = useState(false)
  // profiles: shift / pattern / group for every selected row ('' = keep)
  const [bulk, setBulk]           = useState({ shiftId: '', patternId: '', offset: '' })
  const dateRef = useRef<HTMLInputElement>(null)

  const rows  = edit?.rows ?? suggestion?.moves.map(move => ({ move, on: true })) ?? []
  const bench = edit?.bench ?? suggestion?.bench ?? {}
  const chosen = rows.filter(r => r.on).map(r => r.move)
  const validDate = /^\d{4}-\d{2}-\d{2}$/.test(effective) && effective >= localToday()
  const shiftName = new Map(snapshot.shifts.map(s => [s.id, s.name]))
  // profiles: rows still without a shift (no duties to suggest one)
  const missing = chosen.filter(m => !m.to).length
  const items = chosen.map(m => ({ crewMemberId: m.crewMemberId, from: m.from, to: m.to, offset: m.offset, patternId: m.patternId ?? null, lineId: m.lineId ?? null }))

  async function next() {
    if (busy) return
    setError(null)
    if (step === 'list') {
      if (!validDate) { dateRef.current?.focus(); return }
      if (!chosen.length || missing) return
      setBusy(true)
      try {
        setImpact(await post<ConsoleImpact>(`${base}/preview`, { ...ctx, effective, items }))
        setStep('preview')
      } catch (err) { setError(err instanceof Error ? err.message : 'Erro na prévia') }
      finally { setBusy(false) }
    } else {
      if (!canApply) return
      setBusy(true)
      try {
        onApplied(await post<RosterAdjustmentRow>(`${base}/apply`, { ...ctx, effective, items }))
      } catch (err) { setError(err instanceof Error ? err.message : 'Erro ao aplicar'); setBusy(false) }
    }
  }
  const reset = () => { setEdit(null); setStep('list'); setImpact(null); setError(null) }

  useShortcut('alt+g', () => void next(), { desc: step === 'list' ? 'Prévia do impacto' : 'Confirmar ajuste', icon: Icons.Save, context: 'console_adjust_md', origin: ORIGIN })
  useShortcut('alt+l', reset, { desc: 'Voltar à sugestão', icon: Icons.RotateCcw, context: 'console_adjust_md', origin: ORIGIN, display: false })
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') onClose() }
    document.addEventListener('keydown', onKey)
    return () => document.removeEventListener('keydown', onKey)
  }, [onClose])

  const setRows = (next: typeof rows, nextBench = bench) => setEdit({ rows: next, bench: nextBench })
  function swap(i: number, memberId: string) {
    const cur = rows[i].move, key = `${cur.from}>${cur.to}`
    const pool = bench[key] ?? []
    const pick = pool.find(b => b.crewMemberId === memberId)
    if (!pick) return
    setRows(rows.map((r, k) => (k === i ? { move: pick, on: true } : r)), { ...bench, [key]: [cur, ...pool.filter(b => b !== pick)] })
  }
  const withOffset = (m: ConsoleMove, offset: number): ConsoleMove => ({ ...m, offset, groupLabel: m.groupOptions.find(g => g.offset === offset)?.label ?? null })
  // another rest pattern — its first group until one is picked
  const withPattern = (m: ConsoleMove, patternId: string): ConsoleMove => {
    const p = suggestion?.patterns?.find(x => x.id === patternId)
    if (!p) return m
    const g = p.groupOptions[0]
    return { ...m, patternId, patternName: p.name, groupOptions: p.groupOptions, offset: g?.offset ?? null, groupLabel: g?.label ?? null }
  }
  // profiles: another shift — its pattern and the group suggested there
  const withShift = (m: ConsoleMove, shiftId: string): ConsoleMove => {
    const o = m.shiftOptions?.find(x => x.shiftId === shiftId)
    if (!o) return m
    const p = suggestion?.patterns?.find(x => x.id === o.patternId)
    const groupOptions = p?.groupOptions ?? []
    return { ...m, from: shiftId, to: shiftId, patternId: null, patternName: p?.name ?? null, groupOptions, offset: o.offset, groupLabel: groupOptions.find(g => g.offset === o.offset)?.label ?? null }
  }
  const update = (i: number, f: (m: ConsoleMove) => ConsoleMove) => setRows(rows.map((r, k) => (k === i ? { ...r, move: f(r.move) } : r)))
  const setOffset  = (i: number, offset: number) => update(i, m => withOffset(m, offset))
  const setPattern = (i: number, patternId: string) => update(i, m => withPattern(m, patternId))
  const setShift   = (i: number, shiftId: string) => update(i, m => withShift(m, shiftId))
  // profiles: '' = the shift's pattern (and its suggested group)
  const setProfilePattern = (i: number, patternId: string) => update(i, m => (patternId ? withPattern(m, patternId) : withShift(m, m.to)))
  // the pattern the bulk group refers to: the one picked, else the picked shift's
  const shiftPatternId = (shiftId: string) => suggestion?.moves[0]?.shiftOptions?.find(o => o.shiftId === shiftId)?.patternId ?? null
  const bulkPattern = suggestion?.patterns?.find(p => p.id === (bulk.patternId || (bulk.shiftId ? shiftPatternId(bulk.shiftId) : null))) ?? null
  function applyBulk() {
    setRows(rows.map(r => {
      if (!r.on) return r
      let m = r.move
      if (bulk.shiftId) m = withShift(m, bulk.shiftId)
      if (bulk.patternId) m = withPattern(m, bulk.patternId)
      if (bulk.offset !== '' && m.groupOptions.some(g => g.offset === Number(bulk.offset))) m = withOffset(m, Number(bulk.offset))
      return { ...r, move: m }
    }))
  }
  const shiftPatternName = (m: ConsoleMove) => {
    const id = m.shiftOptions?.find(x => x.shiftId === m.to)?.patternId
    return suggestion?.patterns?.find(x => x.id === id)?.name ?? null
  }

  // crew entering (− leaving) the shift — shifts / profiles
  const netOf = (shiftId: string) => (action.kind === 'shifts' || action.kind === 'profiles')
    ? chosen.filter(m => m.to === shiftId && (action.kind === 'profiles' || m.from !== shiftId)).length - (action.kind === 'shifts' ? chosen.filter(m => m.from === shiftId && m.to !== shiftId).length : 0)
    : 0
  const hasGroups = action.kind === 'shifts' || action.kind === 'groups' || action.kind === 'profiles'
  const ruleText = rule?.criteria.filter(c => c.active).map(c => REBALANCE_CRITERION_LABEL[c.key].label).join(' › ') || 'nenhum critério ativo'
  const types = snapshot.dayTypes.filter(t => !!impact?.totals[t.id])

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center">
      <div className="absolute inset-0 bg-black/40" onClick={onClose} />
      <div className="relative z-10 bg-card border border-border rounded-lg shadow-xl w-full max-w-4xl mx-4 max-h-[88vh] flex flex-col">
        <header className="px-6 pt-5 pb-3 space-y-1 border-b border-border">
          <div className="flex items-center gap-2">
            <Icons.Sparkles className="w-4 h-4 text-muted-foreground" />
            <h2 className="text-base font-semibold">{suggestion?.title ?? CONSOLE_ACTION_LABEL[action.kind]}</h2>
            {suggestion && <span className="text-sm text-muted-foreground">— {suggestion.summary}</span>}
            <span className="ms-auto flex items-center gap-1.5 text-xs text-muted-foreground">
              <span className={cn(step === 'list' && 'text-foreground font-medium')}>1 Sugestão</span>
              <Icons.ChevronRight className="w-3 h-3" />
              <span className={cn(step === 'preview' && 'text-foreground font-medium')}>2 Impacto</span>
            </span>
          </div>
          <p className="text-xs text-muted-foreground flex items-center gap-1.5">
            Regra de seleção: <span className="text-foreground">{ruleText}</span>
            <button type="button" onClick={onEditRule} className="underline underline-offset-2 hover:text-foreground">editar</button>
          </p>
        </header>

        {step === 'list' ? (
          <div className="overflow-auto px-6 py-4 space-y-4">
            {noPlan && (
              <p className="flex gap-2 text-sm text-amber-600 dark:text-amber-400">
                <Icons.AlertCircle className="w-4 h-4 shrink-0 mt-0.5" />
                <span>{CONSOLE_NO_PLAN} <Link href="/transit/vehicle-plan" className="underline underline-offset-2 hover:text-foreground">Ir ao planejamento</Link></span>
              </p>
            )}
            {suggesting && <p className="text-sm text-muted-foreground">Calculando a sugestão…</p>}
            {suggestError && <p className="flex gap-2 text-sm text-destructive"><Icons.AlertCircle className="w-4 h-4 shrink-0 mt-0.5" />{suggestError instanceof Error ? suggestError.message : 'Erro'}</p>}
            {suggestion && (
              <>
                {dated ? (
                  <label className="flex items-center gap-3">
                    <span className="text-sm">Data de efeito</span>
                    <input
                      ref={dateRef} type="date" min={localToday()} value={effective} onChange={e => setEffective(e.target.value)} autoFocus
                      className={cn('h-8 border rounded-sm text-sm bg-input-bg px-2 focus:outline-none focus:ring-1 focus:ring-ring', validDate ? 'border-input' : 'border-amber-500/60')}
                    />
                    {!effective && <span className="text-xs text-muted-foreground">obrigatória — a partir de quando {action.kind === 'profiles' ? 'o perfil começa no turno' : 'o turno muda'}</span>}
                    {effective && !validDate && (
                      <span className="flex items-center gap-1 text-xs font-medium text-amber-600 dark:text-amber-400">
                        <Icons.AlertCircle className="w-3.5 h-3.5" />A data não pode ser retroativa — a partir de hoje
                      </span>
                    )}
                  </label>
                ) : (
                  <p className="text-xs text-muted-foreground">
                    {action.kind === 'groups' ? 'Sem data: o grupo novo vale para a próxima geração de escala.' : 'Sem data: vale já para a próxima geração de escala.'}
                  </p>
                )}

                {suggestion.notes?.map(n => (
                  <p key={n} className="flex gap-1.5 text-xs text-amber-600 dark:text-amber-400"><Icons.AlertCircle className="w-3.5 h-3.5 shrink-0 mt-px" />{n}</p>
                ))}

                {action.kind === 'profiles' && rows.length > 0 && suggestion.patterns && (
                  <div className="flex flex-wrap items-center gap-1.5 rounded-md border border-border bg-muted/30 px-3 py-2 text-xs">
                    <span className="me-1 text-muted-foreground">Aplicar aos selecionados:</span>
                    <select value={bulk.shiftId} onChange={e => setBulk({ ...bulk, shiftId: e.target.value, offset: '' })} className="h-7 border border-input rounded-sm bg-input-bg px-1.5" title="Turno">
                      <option value="">turno (manter)</option>
                      {snapshot.shifts.map(x => <option key={x.id} value={x.id}>{x.name}</option>)}
                    </select>
                    <select value={bulk.patternId} onChange={e => setBulk({ ...bulk, patternId: e.target.value, offset: '' })} className="h-7 border border-input rounded-sm bg-input-bg px-1.5" title="Regime de folga">
                      <option value="">{bulk.shiftId ? 'regime do turno' : 'regime (manter)'}</option>
                      {suggestion.patterns.map(p => <option key={p.id} value={p.id}>{p.name}</option>)}
                    </select>
                    {bulkPattern && (
                      <select value={bulk.offset} onChange={e => setBulk({ ...bulk, offset: e.target.value })} className="h-7 border border-input rounded-sm bg-input-bg px-1.5" title={bulkPattern.name}>
                        <option value="">grupo sugerido</option>
                        {bulkPattern.groupOptions.map(g => <option key={g.offset} value={g.offset}>{g.label}</option>)}
                      </select>
                    )}
                    <button type="button" onClick={applyBulk} disabled={!chosen.length || (!bulk.shiftId && !bulk.patternId && bulk.offset === '')}
                      className="h-7 px-2.5 rounded-sm border border-border hover:bg-muted disabled:opacity-40 disabled:cursor-not-allowed">
                      Aplicar a {chosen.length}
                    </button>
                  </div>
                )}

                {(action.kind === 'profiles' || action.kind === 'shifts') && chosen.length > 0 && (
                  <p className="flex flex-wrap gap-x-3 gap-y-1 text-xs text-muted-foreground">
                    <span>Por turno de destino:</span>
                    {snapshot.shifts.filter(x => chosen.some(m => m.to === x.id)).map(x => (
                      <span key={x.id}><b className="font-medium text-foreground">{x.name}</b> {chosen.filter(m => m.to === x.id).length}</span>
                    ))}
                  </p>
                )}

                <table className="w-full text-sm">
                  <thead className="text-xs text-muted-foreground">
                    <tr className="[&>th]:py-1.5 [&>th]:px-2 [&>th]:text-left [&>th]:font-medium border-b border-border">
                      <th className="w-8" /><th>{action.kind === 'profiles' ? 'Funcionário' : 'Operador'}</th><th>Mudança</th>
                      {hasGroups && <th>Grupo de folga</th>}<th>Por quê</th><th className="w-44" />
                    </tr>
                  </thead>
                  <tbody>
                    {rows.map((r, i) => {
                      const alts = bench[`${r.move.from}>${r.move.to}`] ?? []
                      return (
                        <tr key={r.move.crewMemberId} className={cn('border-b border-border/60 [&>td]:py-1.5 [&>td]:px-2 align-middle', !r.on && 'opacity-45')}>
                          <td><input type="checkbox" checked={r.on} onChange={() => setRows(rows.map((x, k) => (k === i ? { ...x, on: !x.on } : x)))} /></td>
                          <td className="whitespace-nowrap"><span className="font-mono text-xs text-muted-foreground me-2">{r.move.code}</span>{r.move.name}</td>
                          <td className="whitespace-nowrap">
                            {action.kind === 'shifts'
                              ? <>{shiftName.get(r.move.from)} <Icons.ArrowRight className="inline w-3.5 h-3.5 mx-1 text-muted-foreground" /> <b className="font-medium">{shiftName.get(r.move.to)}</b></>
                              : action.kind === 'profiles' ? <>{r.move.change.replace('criar perfil · ', '')} <Icons.ArrowRight className="inline w-3.5 h-3.5 mx-1 text-muted-foreground" />
                                <select value={r.move.to} onChange={e => setShift(i, e.target.value)} title="Turno"
                                  className={cn('h-7 border rounded-sm text-xs font-medium bg-input-bg px-1.5', r.move.to ? 'border-input' : 'border-amber-500/60 text-muted-foreground')}>
                                  {!r.move.to && <option value="">escolha o turno</option>}
                                  {snapshot.shifts.filter(x => r.move.shiftOptions?.some(o => o.shiftId === x.id)).map(x => <option key={x.id} value={x.id}>{x.name}</option>)}
                                </select></>
                              : <span className="font-medium">{r.move.change}</span>}
                          </td>
                          {hasGroups && (
                            <td className="whitespace-nowrap">
                              {action.kind === 'groups' && suggestion.patterns && suggestion.patterns.length > 1 && (
                                <select value={r.move.patternId ?? suggestion.patterns.find(p => p.name === r.move.patternName)?.id ?? ''} onChange={e => setPattern(i, e.target.value)}
                                  className="h-7 me-1 border border-input rounded-sm text-xs bg-input-bg px-1.5" title="Regime de folga">
                                  {suggestion.patterns.map(p => <option key={p.id} value={p.id}>{p.name}</option>)}
                                </select>
                              )}
                              {action.kind === 'profiles' && suggestion.patterns && (
                                <select value={r.move.patternId ?? ''} onChange={e => setProfilePattern(i, e.target.value)}
                                  className="h-7 me-1 border border-input rounded-sm text-xs bg-input-bg px-1.5" title="Regime de folga">
                                  <option value="">{shiftPatternName(r.move) ? `do turno (${shiftPatternName(r.move)})` : 'sem regime'}</option>
                                  {suggestion.patterns.map(p => <option key={p.id} value={p.id}>{p.name}</option>)}
                                </select>
                              )}
                              {r.move.groupOptions.length > (action.kind === 'profiles' ? 0 : 1) ? (
                                <select value={r.move.offset ?? ''} onChange={e => setOffset(i, Number(e.target.value))} className="h-7 border border-input rounded-sm text-xs bg-input-bg px-1.5" title={r.move.patternName ?? undefined}>
                                  {r.move.groupOptions.map(g => <option key={g.offset} value={g.offset}>{g.label}</option>)}
                                </select>
                              ) : <span className="text-xs text-muted-foreground">{r.move.groupLabel ?? 'sem regime'}</span>}
                            </td>
                          )}
                          <td>
                            <div className="flex flex-wrap gap-1">
                              {r.move.reasons.map(x => <span key={x} className="rounded-sm bg-muted px-1.5 py-0.5 text-[11px] text-muted-foreground">{x}</span>)}
                            </div>
                          </td>
                          <td>
                            {alts.length > 0 && (
                              <select value="" onChange={e => swap(i, e.target.value)} className="h-7 w-full border border-input rounded-sm text-xs bg-input-bg px-1.5 text-muted-foreground">
                                <option value="">Trocar por…</option>
                                {alts.map(a => <option key={a.crewMemberId} value={a.crewMemberId}>{a.code} {a.name}</option>)}
                              </select>
                            )}
                          </td>
                        </tr>
                      )
                    })}
                    {!rows.length && <tr><td colSpan={hasGroups ? 6 : 5} className="py-6 text-center text-sm text-muted-foreground">Nada a ajustar — {suggestion.summary.toLowerCase()}.</td></tr>}
                  </tbody>
                </table>

                {suggestion.excluded.length > 0 && (
                  <div className="text-xs">
                    <button type="button" onClick={() => setShowExcluded(v => !v)} className="flex items-center gap-1 text-muted-foreground hover:text-foreground">
                      {showExcluded ? <Icons.ChevronDown className="w-3.5 h-3.5" /> : <Icons.ChevronRight className="w-3.5 h-3.5" />}
                      {suggestion.excluded.length} não elegíveis para o destino
                    </button>
                    {showExcluded && (
                      <ul className="mt-1.5 ms-5 grid grid-cols-2 gap-x-6 gap-y-0.5 text-muted-foreground">
                        {suggestion.excluded.map(x => <li key={x.crewMemberId}><span className="font-mono">{x.code}</span> {x.name} — {x.reason}</li>)}
                      </ul>
                    )}
                  </div>
                )}
              </>
            )}
          </div>
        ) : impact && (
          <div className="overflow-auto px-6 py-4 space-y-4">
            <table className="w-full text-sm">
              <thead className="text-xs text-muted-foreground">
                <tr className="[&>th]:py-1.5 [&>th]:px-2 [&>th]:font-medium border-b border-border">
                  <th className="text-left">Saldo no pior dia</th>
                  {types.map(t => <th key={t.id} className="text-center">{t.name}</th>)}
                </tr>
              </thead>
              <tbody className="tabular-nums">
                {impact.rows.map(r => (
                  <tr key={r.shiftId} className="border-b border-border/60 [&>td]:py-1.5 [&>td]:px-2">
                    <td>
                      {shiftName.get(r.shiftId)}
                      {netOf(r.shiftId) !== 0 && (
                        <span className={cn('ms-2 rounded-sm px-1.5 py-0.5 text-[11px] font-medium', netOf(r.shiftId) > 0 ? 'bg-emerald-500/15 text-emerald-600 dark:text-emerald-400' : 'bg-amber-500/15 text-amber-600 dark:text-amber-400')}
                          title="Operadores que entram (−: saem) do turno">
                          {signed(netOf(r.shiftId))}
                        </span>
                      )}
                    </td>
                    {types.map(t => {
                      const c = r.cells[t.id]
                      if (!c) return <td key={t.id} className="text-center text-muted-foreground">—</td>
                      return (
                        <td key={t.id} className="text-center">
                          <span className="text-muted-foreground">{signed(c.before)}</span>
                          <Icons.ArrowRight className="inline w-3 h-3 mx-1.5 text-muted-foreground" />
                          <span className={cn('font-medium', c.after < 0 ? 'text-destructive' : c.after > c.before ? 'text-emerald-600 dark:text-emerald-400' : '')}>{signed(c.after)}</span>
                        </td>
                      )
                    })}
                  </tr>
                ))}
                <tr className="[&>td]:py-1.5 [&>td]:px-2 text-xs">
                  <td className="text-muted-foreground">Tabelas cobríveis (encaixe)</td>
                  {types.map(t => {
                    const x = impact.totals[t.id]
                    return (
                      <td key={t.id} className="text-center">
                        {x.before} <Icons.ArrowRight className="inline w-3 h-3 mx-1 text-muted-foreground" /> <b className="font-medium">{x.after}</b>
                        <span className="text-muted-foreground"> / {x.demand}</span>
                      </td>
                    )
                  })}
                </tr>
              </tbody>
            </table>
            <div className="space-y-1.5 text-sm">
              {impact.warnings.map(w => <p key={w} className="flex gap-2 text-amber-700 dark:text-amber-400"><Icons.AlertTriangle className="w-4 h-4 shrink-0 mt-0.5" />{w}</p>)}
              {impact.notes.map(n => <p key={n} className="flex gap-2 text-muted-foreground"><Icons.Info className="w-4 h-4 shrink-0 mt-0.5" />{n}</p>)}
              <p className="flex gap-2 text-muted-foreground">
                <Icons.ArrowRight className="w-4 h-4 shrink-0 mt-0.5" />
                {CONFIRM_TEXT[action.kind](chosen.length, fmtDay(effective))} Nenhuma escala é gerada ou alterada.
              </p>
            </div>
          </div>
        )}

        <footer className="flex items-center gap-2 px-6 py-3 border-t border-border">
          {error ? <span className="flex-1 flex gap-1.5 text-xs text-destructive"><Icons.AlertCircle className="w-3.5 h-3.5 shrink-0 mt-px" />{error}</span>
            : missing && step === 'list'
              ? <span className="flex-1 flex gap-1.5 text-xs text-amber-600 dark:text-amber-400"><Icons.AlertCircle className="w-3.5 h-3.5 shrink-0 mt-px" />{missing} selecionado(s) sem turno — escolha na lista ou em “Aplicar aos selecionados”</span>
              : <span className="text-xs text-muted-foreground me-auto">{chosen.length} de {rows.length} selecionados</span>}
          <Button type="button" variant="cancel" size="sm" onClick={step === 'list' ? onClose : () => { setStep('list'); setError(null) }}>
            {step === 'list' ? 'Cancelar' : 'Voltar'}
          </Button>
          {step === 'list'
            ? <Button type="button" size="sm" disabled={busy || !chosen.length || !validDate || !!missing} onClick={() => void next()}>{busy ? 'Calculando…' : 'Prévia do impacto'}</Button>
            : <Button type="button" variant="safeConfirm" size="sm" disabled={busy || !canApply} title={canApply ? undefined : 'Sem permissão para alterar operadores'} onClick={() => void next()}>{busy ? 'Aplicando…' : 'Confirmar ajuste'}</Button>}
        </footer>
      </div>
    </div>
  )
}
