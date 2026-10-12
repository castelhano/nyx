'use client'

import { useQuery } from '@tanstack/react-query'
import type { RosterCompensation, RosterExtraStandby } from '@nyx/schemas'
import { ClockInput } from '@/components/ui/clock-input'
import { Select } from '@/components/ui/select'
import { apiFetch } from '@/lib/auth'
import { Icons } from '@/lib/icons'
import { cn } from '@/lib/utils'
import { addDays, fmtDay } from './board'

const hm = (m: number) => `${m < 0 ? '−' : ''}${Math.floor(Math.abs(m) / 60)}:${String(Math.abs(m) % 60).padStart(2, '0')}`

// "Plantões extras" of a generation: per row the day (or every day of the period), start–end,
// where to report and how many
export function ExtraStandbyEditor({ value, from, to, disabled, onChange }: {
  value: RosterExtraStandby[]; from: string; to: string; disabled?: boolean; onChange: (next: RosterExtraStandby[]) => void
}) {
  const { data: depots = [] } = useQuery({
    queryKey: ['transit', 'transit-locality', 'depots'],
    queryFn:  async () => {
      const res = await apiFetch('/transit/transit-locality?f_isDepot=true&pageSize=100')
      const json = await res.json().catch(() => ({}))
      return (json.data ?? []) as { id: string; name: string }[]
    },
    staleTime: 60_000,
  })
  const dates: string[] = []
  for (let d = from; d <= to && dates.length < 62; d = addDays(d, 1)) dates.push(d)
  const set = (i: number, patch: Partial<RosterExtraStandby>) => onChange(value.map((t, k) => (k === i ? { ...t, ...patch } : t)))
  const add = () => onChange([...value, { date: from === to ? from : null, startMinutes: 300, endMinutes: 780, localityId: depots[0]?.id ?? null, count: 1 }])
  const clock = 'h-7 w-14 border border-input rounded-sm text-xs bg-input-bg px-1 text-center'
  return (
    <div className="space-y-1">
      <div className="flex items-center">
        <span>Plantões extras</span>
        {!disabled && (
          <button type="button" onClick={add} className="ml-auto flex items-center gap-1 text-muted-foreground hover:text-foreground cursor-pointer">
            <Icons.Plus className="w-3.5 h-3.5" />Adicionar
          </button>
        )}
      </div>
      {!value.length && <p className="text-[11px] text-muted-foreground">Nenhum — só os plantões das metas da empresa.</p>}
      {value.map((t, i) => (
        <div key={i} className="flex flex-wrap items-center gap-1">
          <Select value={t.date ?? ''} onChange={e => set(i, { date: e.target.value || null })} size="sm" className="h-7 w-28 text-xs" disabled={disabled}>
            <option value="">Todos os dias</option>
            {dates.map(d => <option key={d} value={d}>{fmtDay(d)}</option>)}
          </Select>
          <ClockInput value={t.startMinutes} onChange={v => set(i, { startMinutes: v })} max={1439} className={clock} disabled={disabled} />
          <span className="text-muted-foreground">–</span>
          <ClockInput value={t.endMinutes} onChange={v => set(i, { endMinutes: v })} max={2879} className={clock} disabled={disabled} />
          <Select value={t.localityId ?? ''} onChange={e => set(i, { localityId: e.target.value || null })} size="sm" className="h-7 w-32 text-xs" disabled={disabled}>
            <option value="">— sem local</option>
            {depots.map(d => <option key={d.id} value={d.id}>{d.name}</option>)}
          </Select>
          <input type="number" min={1} max={99} value={t.count} disabled={disabled}
            onChange={e => set(i, { count: Math.max(1, Math.min(99, Math.round(Number(e.target.value) || 1))) })}
            className="h-7 w-12 border border-input rounded-sm text-xs bg-input-bg px-1 text-right" title="Quantidade" />
          {!disabled && (
            <button type="button" title="Remover" onClick={() => onChange(value.filter((_, k) => k !== i))} className="text-muted-foreground hover:text-foreground cursor-pointer">
              <Icons.Trash2 className="w-3.5 h-3.5" />
            </button>
          )}
          {t.endMinutes <= t.startMinutes && <span className="w-full text-[11px] text-red-600 dark:text-red-400">fim antes do início</span>}
        </div>
      ))}
    </div>
  )
}

// what the compensation did: folgas compensadas, hours off the bank, and the ones that left a
// crew member more than the tolerance below zero
export function CompensationSummary({ c }: { c: RosterCompensation }) {
  return (
    <div className="space-y-1 text-xs">
      <p className="text-[11px] text-muted-foreground">
        Sobra compensada: <span className="text-foreground font-medium">{c.days} folga(s)</span> · {hm(c.minutes)} abatidas do banco
        {c.idle > 0 && ` · ${c.idle} dia(s) livre(s) sem compensação (feriado ou fora do banco)`}
      </p>
      {c.alerts.length > 0 && (
        <div className="space-y-0.5">
          <p className={cn('font-medium text-amber-600 dark:text-amber-400')}>{c.alerts.length} compensação(ões) sem saldo suficiente</p>
          <ul className="max-h-32 overflow-y-auto text-[11px] text-muted-foreground">
            {c.alerts.map(a => (
              <li key={`${a.crewMemberId}|${a.date}`}>{a.code} {a.name} — {fmtDay(a.date)}: tinha {hm(a.before)}, ficou {hm(a.after)}</li>
            ))}
          </ul>
        </div>
      )}
    </div>
  )
}
