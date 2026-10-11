'use client'

import type { RosterShortage } from '@nyx/schemas'

// Why the duties without a crew member have none — grouped by reason and shift, with who could
// take them but is on his rest pattern's day off. A click goes to the group's first duty.
export function ShortageList({ groups, onSelectDuty }: { groups: RosterShortage[]; onSelectDuty?: (dutyId: string) => void }) {
  if (!groups.length) return null
  const total = groups.reduce((n, g) => n + g.dutyIds.length, 0)
  return (
    <div className="space-y-1.5">
      <p className="text-xs font-medium">{total} tabela(s) sem operador — por quê</p>
      {groups.map((g, i) => (
        <button
          key={i} type="button" onClick={() => onSelectDuty?.(g.dutyIds[0])}
          className="w-full rounded-sm px-1.5 py-1 text-left text-xs hover:bg-muted cursor-pointer"
        >
          <span className="tabular-nums font-medium">{g.dutyIds.length}</span>
          {g.shift && <span className="text-muted-foreground"> · turno {g.shift}</span>}
          <span> — {g.reason}</span>
          {g.couldCover.length > 0 && (
            <span className="block text-[11px] text-muted-foreground">Poderiam cobrir se não estivessem de folga: {g.couldCover.join(', ')}</span>
          )}
        </button>
      ))}
    </div>
  )
}
