'use client'

import type { RosterBoardGeneration } from '@nyx/schemas'
import { fmtDay } from './board'

// The accepted generations ("Gerar") covering a period or a day — when, who, which days and the
// proposal's figures then.
export function GenerationList({ list, title = 'Gerações aceitas' }: { list: RosterBoardGeneration[]; title?: string }) {
  if (!list.length) return null
  const when = (iso: string) => new Date(iso).toLocaleString('pt-BR', { day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit' })
  return (
    <div className="space-y-1 text-xs">
      <p className="font-medium">{title}</p>
      <ul className="space-y-1">
        {list.map(g => {
          const q = g.quality
          const kept = q?.keptTable.days ? `mantêm a tabela ${Math.round(q.keptTable.kept / q.keptTable.days * 100)}%` : null
          return (
            <li key={g.id} className="text-[11px]">
              <span className="tabular-nums">{when(g.acceptedAt)}</span>
              {g.user && <span className="text-muted-foreground"> · {g.user}</span>}
              <span className="text-muted-foreground"> · {g.from === g.to ? fmtDay(g.from) : `${fmtDay(g.from)}–${fmtDay(g.to)}`}</span>
              <span className="block text-muted-foreground tabular-nums">
                {[`${g.assigned}/${g.duties} escaladas`, kept, q && `${q.changes} troca(s)`, g.changed ? `${g.changed} alteração(ões) em publicados` : null].filter(Boolean).join(' · ')}
              </span>
            </li>
          )
        })}
      </ul>
    </div>
  )
}
