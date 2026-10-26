'use client'

// The empresa's selection rule — who the Painel suggests moving once it knows how many
// (transit.roster.rebalanceRules, edited only here). The fixed filters (window, lines, vehicle
// types) always apply; the criteria break ties in order, matrícula last.

import { useEffect, useState } from 'react'
import { REBALANCE_CRITERION_LABEL, type RebalanceRules } from '@nyx/schemas'
import { Button } from '@/components/ui/button'
import { Icons } from '@/lib/icons'
import { apiFetch } from '@/lib/auth'
import { cn, extractError } from '@/lib/utils'
import { useShortcut, useShortcutContext } from '@/lib/keywatch'

const ORIGIN = 'apps/web/src/app/transit/console/RuleModal.tsx'

export function RuleModal({ branchId, rule, canEdit, onSaved, onClose }: {
  branchId: string; rule: RebalanceRules; canEdit: boolean; onSaved: (r: RebalanceRules) => void; onClose: () => void
}) {
  useShortcutContext('console_rule_md', 'Atalhos — Regra de seleção')
  const [draft, setDraft]   = useState(rule)
  const [saving, setSaving] = useState(false)
  const [error, setError]   = useState<string | null>(null)

  async function save() {
    if (!canEdit || saving) return
    setSaving(true)
    try {
      const res = await apiFetch(`/transit/console/rule?branchId=${branchId}`, { method: 'PUT', body: JSON.stringify(draft) })
      const json = await res.json().catch(() => ({}))
      if (!res.ok) throw new Error(extractError(json))
      onSaved(json as RebalanceRules)
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Erro ao gravar')
      setSaving(false)
    }
  }

  useShortcut('alt+g', () => void save(), { desc: 'Salvar regra', icon: Icons.Save, context: 'console_rule_md', origin: ORIGIN })
  useShortcut('alt+l', () => setDraft(rule), { desc: 'Descartar alterações', icon: Icons.RotateCcw, context: 'console_rule_md', origin: ORIGIN, display: false })
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') onClose() }
    document.addEventListener('keydown', onKey)
    return () => document.removeEventListener('keydown', onKey)
  }, [onClose])

  function move(i: number, d: -1 | 1) {
    const criteria = [...draft.criteria]
    const j = i + d
    if (j < 0 || j >= criteria.length) return
    ;[criteria[i], criteria[j]] = [criteria[j], criteria[i]]
    setDraft({ criteria })
  }
  const toggle = (i: number) => setDraft({ criteria: draft.criteria.map((c, k) => (k === i ? { ...c, active: !c.active } : c)) })

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center">
      <div className="absolute inset-0 bg-black/40" onClick={onClose} />
      <div className="relative z-10 bg-card border border-border rounded-lg shadow-xl w-full max-w-md mx-4 p-6 space-y-4">
        <div>
          <h2 className="text-base font-semibold">Regra de seleção</h2>
          <p className="text-xs text-muted-foreground mt-1">
            Quem muda primeiro quando o Painel sugere um ajuste. Os critérios valem em ordem — cada um desempata o anterior, a
            matrícula por último. Quem não cabe no horário do destino ou não opera a maioria das suas tabelas nunca é sugerido.
          </p>
        </div>
        <ol className="space-y-1.5">
          {draft.criteria.map((c, i) => (
            <li key={c.key} className={cn('flex items-center gap-2 rounded-md border border-border px-3 py-2', !c.active && 'opacity-55')}>
              <span className="w-4 text-xs text-muted-foreground tabular-nums">{i + 1}</span>
              <input type="checkbox" checked={c.active} disabled={!canEdit} onChange={() => toggle(i)} />
              <div className="flex-1 min-w-0">
                <div className="text-sm">{REBALANCE_CRITERION_LABEL[c.key].label}</div>
                <div className="text-[11px] text-muted-foreground">{REBALANCE_CRITERION_LABEL[c.key].hint}</div>
              </div>
              {canEdit && (
                <div className="flex flex-col">
                  <button type="button" onClick={() => move(i, -1)} disabled={i === 0} className="text-muted-foreground hover:text-foreground disabled:opacity-30"><Icons.ChevronUp className="w-4 h-4" /></button>
                  <button type="button" onClick={() => move(i, 1)} disabled={i === draft.criteria.length - 1} className="text-muted-foreground hover:text-foreground disabled:opacity-30"><Icons.ChevronDown className="w-4 h-4" /></button>
                </div>
              )}
            </li>
          ))}
        </ol>
        {error && <p className="flex gap-2 text-xs text-destructive"><Icons.AlertCircle className="w-3.5 h-3.5 shrink-0 mt-px" />{error}</p>}
        <div className="flex justify-end gap-2">
          <Button type="button" variant="cancel" size="sm" onClick={onClose}>{canEdit ? 'Cancelar' : 'Fechar'}</Button>
          {canEdit && <Button type="button" size="sm" disabled={saving} onClick={() => void save()}>{saving ? 'Gravando…' : 'Salvar regra'}</Button>}
        </div>
      </div>
    </div>
  )
}
