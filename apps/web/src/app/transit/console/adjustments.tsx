'use client'

// Painel de Escala — the adjustments made by it, for later reference (no undo: reverting is a new
// adjustment the other way). Each one lists its crew members with the shift and rest group before → after.

import { useState } from 'react'
import { useQuery } from '@tanstack/react-query'
import { CONSOLE_ACTION_LABEL, type ConsoleSnapshot, type RosterAdjustmentRow, type RosterAdjustmentState } from '@nyx/schemas'
import { Icons } from '@/lib/icons'
import { apiFetch } from '@/lib/auth'
import { extractError } from '@/lib/utils'
import { Card, fmtDay } from './sections'

// a line's state on a crew member: access and priority, in words
const lineState = (l: RosterAdjustmentState['line']) =>
  !l ? '—' : [l.access === 'ENABLED' ? 'habilitada' : l.access === 'BLOCKED' ? 'bloqueada' : 'sem acesso marcado', l.priority && 'prioritária'].filter(Boolean).join(', ')

export function AdjustmentsSection({ snapshot }: { snapshot: ConsoleSnapshot }) {
  const { data = [], error, isLoading } = useQuery<RosterAdjustmentRow[]>({
    queryKey: ['transit', 'console', 'adjustments', snapshot.branchId, snapshot.role],
    queryFn:  async () => {
      const res = await apiFetch(`/transit/console/adjustments?${new URLSearchParams({ branchId: snapshot.branchId, role: snapshot.role })}`)
      const json = await res.json().catch(() => ({}))
      if (!res.ok) throw new Error(extractError(json))
      return json
    },
  })
  const [open, setOpen] = useState<string | null>(null)
  const shiftName = new Map(snapshot.shifts.map(s => [s.id, s.name]))
  const when = (iso: string) => new Date(iso).toLocaleString('pt-BR', { day: '2-digit', month: '2-digit', year: '2-digit', hour: '2-digit', minute: '2-digit' })

  return (
    <Card title="Ajustes" icon={Icons.ClipboardList} aside={<span className="text-xs text-muted-foreground">lista apenas ajustes feitos pelo Painel</span>}>
      {isLoading && <p className="text-muted-foreground">Carregando…</p>}
      {error && <p className="text-destructive">{error instanceof Error ? error.message : 'Erro'}</p>}
      {!isLoading && !data.length && <p className="text-muted-foreground">Nenhum ajuste feito pelo Painel ainda.</p>}
      <ul className="divide-y divide-border">
        {data.map(a => (
          <li key={a.id} className="py-2">
            <button type="button" onClick={() => setOpen(open === a.id ? null : a.id)} className="w-full flex items-start gap-3 text-left">
              {open === a.id ? <Icons.ChevronDown className="w-4 h-4 mt-0.5 text-muted-foreground" /> : <Icons.ChevronRight className="w-4 h-4 mt-0.5 text-muted-foreground" />}
              <div className="flex-1">
                <div className="font-medium">{CONSOLE_ACTION_LABEL[a.kind as keyof typeof CONSOLE_ACTION_LABEL] ?? a.kind} · {a.items.length} operador(es)</div>
                <div className="text-xs text-muted-foreground">a partir de {fmtDay(a.effective)} · {when(a.createdAt)}{a.user ? ` · ${a.user}` : ''}</div>
              </div>
            </button>
            {open === a.id && (
              <table className="mt-2 ms-7 text-xs">
                <tbody>
                  {a.items.map(i => (
                    <tr key={i.crewMemberId} className="[&>td]:py-0.5 [&>td]:pe-4">
                      <td className="font-mono text-muted-foreground">{i.code}</td>
                      <td>{i.name}</td>
                      {i.after.line ? (
                        <td colSpan={2}>linha {i.after.line.code}: {lineState(i.before.line)} <Icons.ArrowRight className="inline w-3 h-3 mx-1 text-muted-foreground" /> {lineState(i.after.line)}</td>
                      ) : (
                        <>
                          <td>{shiftName.get(i.before.shiftId ?? '') ?? (a.kind === 'profiles' ? 'novo perfil' : '—')} <Icons.ArrowRight className="inline w-3 h-3 mx-1 text-muted-foreground" /> {shiftName.get(i.after.shiftId ?? '') ?? '—'}</td>
                          <td className="text-muted-foreground">
                            {[i.before.restOffset !== i.after.restOffset && 'grupo de folga alterado', i.before.restPatternId !== i.after.restPatternId && 'regime alterado'].filter(Boolean).join(' · ')}
                          </td>
                        </>
                      )}
                    </tr>
                  ))}
                </tbody>
              </table>
            )}
          </li>
        ))}
      </ul>
    </Card>
  )
}
