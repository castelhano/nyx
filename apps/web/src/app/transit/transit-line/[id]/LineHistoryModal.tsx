'use client'

import { useEffect }    from 'react'
import { createPortal } from 'react-dom'
import { useQuery }     from '@tanstack/react-query'
import { apiFetch }     from '@/lib/auth'
import { Icons }        from '@/lib/icons'
import { cn }           from '@/lib/utils'

type Direction = 'OUTBOUND' | 'INBOUND' | 'CIRCULAR'
const DIR_LABEL: Record<Direction, string> = { OUTBOUND: 'Ida', INBOUND: 'Volta', CIRCULAR: 'Circular' }

interface RevisionRow {
  id:          string
  validFrom:   string
  description: string
  approvalRef: string | null
  extensionKm: Partial<Record<Direction, { from: number | null; to: number }>> | null
}

interface ScheduleRow {
  id:          string
  validFrom:   string | null
  validTo:     string | null
  status:      string
  approvalRef: string
  notes:       string | null
  dayType:     { name: string } | null
}

type Entry =
  | { kind: 'revision'; day: string; key: string; row: RevisionRow }
  | { kind: 'oso'; day: string; key: string; approvalRef: string; dayTypes: string[]; notes: string[]; current: boolean }

// @db.Date columns arrive as UTC midnights — read the date part, never through local time
const dayOf = (iso: string) => iso.slice(0, 10)
const fmtDay = (day: string) => day.split('-').reverse().join('/')
const fmtKm  = (v: number | null) => v == null ? '—' : v.toLocaleString('pt-BR', { minimumFractionDigits: 2, maximumFractionDigits: 2 })

async function fetchRows<T>(path: string): Promise<T[]> {
  const res = await apiFetch(path)
  if (!res.ok) return []
  return ((await res.json()) as { data?: T[] }).data ?? []
}

// The line's timeline: trajectory changes (LineRevision) and the OSOs that took effect
// (LineSchedule, grouped by OSO number + start date across day types), newest first
export function LineHistoryModal({ lineId, onClose }: { lineId: string; onClose: () => void }) {
  useEffect(() => {
    function onKey(e: KeyboardEvent) { if (e.key === 'Escape') onClose() }
    document.addEventListener('keydown', onKey)
    return () => document.removeEventListener('keydown', onKey)
  }, [onClose])

  const { data: revisions = [], isLoading: loadingRevisions } = useQuery({
    queryKey: ['transit', 'line-revision', { lineId }],
    queryFn:  () => fetchRows<RevisionRow>(`/transit/line-revision?lineId=${lineId}&pageSize=200`),
  })
  const { data: schedules = [], isLoading: loadingSchedules } = useQuery({
    queryKey: ['transit', 'line-schedule', { lineId, history: true }],
    queryFn:  () => fetchRows<ScheduleRow>(`/transit/line-schedule?lineId=${lineId}&pageSize=500`),
  })

  const today = new Date().toISOString().slice(0, 10)
  const osoGroups = new Map<string, Extract<Entry, { kind: 'oso' }>>()
  for (const s of schedules) {
    if (s.status === 'DRAFT' || !s.validFrom) continue
    const day = dayOf(s.validFrom)
    const key = `${s.approvalRef}|${day}`
    const g = osoGroups.get(key) ?? { kind: 'oso' as const, day, key, approvalRef: s.approvalRef, dayTypes: [], notes: [], current: false }
    if (s.dayType?.name) g.dayTypes.push(s.dayType.name)
    if (s.notes && !g.notes.includes(s.notes)) g.notes.push(s.notes)
    if (!s.validTo || dayOf(s.validTo) >= today) g.current = true
    osoGroups.set(key, g)
  }

  const entries: Entry[] = [
    ...revisions.map(r => ({ kind: 'revision' as const, day: dayOf(r.validFrom), key: r.id, row: r })),
    ...osoGroups.values(),
  ].sort((a, b) => b.day.localeCompare(a.day))

  const isLoading = loadingRevisions || loadingSchedules

  return createPortal(
    <div className="fixed inset-0 z-50 flex items-start justify-center pt-20">
      <div className="absolute inset-0 bg-black/50" onClick={onClose} />

      <div className="relative z-10 w-full max-w-2xl mx-4 bg-card border border-border rounded-lg shadow-xl flex flex-col max-h-[80vh]">
        <div className="flex items-center justify-between px-5 py-4 border-b border-border">
          <div>
            <h2 className="text-base font-semibold">Histórico da Linha</h2>
            <p className="text-xs text-muted-foreground mt-0.5">Alterações de trajeto e OSOs, da mais recente para a mais antiga</p>
          </div>
          <button type="button" onClick={onClose} className="text-muted-foreground hover:text-foreground transition-colors text-lg leading-none">✕</button>
        </div>

        <div className="overflow-y-auto px-5 py-4">
          {isLoading ? (
            <p className="text-sm text-muted-foreground">Carregando…</p>
          ) : entries.length === 0 ? (
            <p className="text-sm text-muted-foreground">Nenhuma alteração registrada.</p>
          ) : (
            <ol className="relative border-l border-border ml-2 space-y-5">
              {entries.map((e) => (
                <li key={e.key} className="pl-5 relative">
                  <span className={cn(
                    'absolute -left-[7px] top-1 w-3 h-3 rounded-full border-2 border-card',
                    e.kind === 'revision' ? 'bg-sky-500' : 'bg-emerald-500',
                  )} />
                  <div className="flex items-baseline gap-2 flex-wrap">
                    <span className="text-xs font-medium tabular-nums text-muted-foreground">{fmtDay(e.day)}</span>
                    <span className={cn(
                      'inline-flex items-center gap-1 px-1.5 rounded-sm text-[11px] font-medium',
                      e.kind === 'revision'
                        ? 'bg-sky-100 text-sky-700 dark:bg-sky-950/50 dark:text-sky-300'
                        : 'bg-emerald-100 text-emerald-700 dark:bg-emerald-950/50 dark:text-emerald-300',
                    )}>
                      {e.kind === 'revision' ? <><Icons.Route className="w-3 h-3" /> Trajeto</> : <><Icons.CalendarSync className="w-3 h-3" /> OSO {e.approvalRef}</>}
                    </span>
                    {e.kind === 'revision' && e.row.approvalRef && (
                      <span className="text-xs text-muted-foreground">N Controle {e.row.approvalRef}</span>
                    )}
                    {e.kind === 'oso' && e.current && (
                      <span className="text-[11px] text-muted-foreground">vigente</span>
                    )}
                  </div>

                  {e.kind === 'revision' ? (
                    <>
                      <p className="text-sm mt-0.5">{e.row.description}</p>
                      {e.row.extensionKm && Object.keys(e.row.extensionKm).length > 0 && (
                        <p className="text-xs text-muted-foreground tabular-nums mt-0.5">
                          {(Object.entries(e.row.extensionKm) as [Direction, { from: number | null; to: number }][])
                            .map(([dir, km]) => `${DIR_LABEL[dir]} ${fmtKm(km.from)} → ${fmtKm(km.to)} km`).join(' · ')}
                        </p>
                      )}
                    </>
                  ) : (
                    <>
                      <p className="text-sm mt-0.5">{e.dayTypes.join(', ')}</p>
                      {e.notes.map((n) => <p key={n} className="text-xs text-muted-foreground mt-0.5">{n}</p>)}
                    </>
                  )}
                </li>
              ))}
            </ol>
          )}
        </div>
      </div>
    </div>,
    document.body,
  )
}
