'use client'

// A roster day in detail, full screen over the portal: per duty, the day's notes (the trips'
// markings) and the timeline — what matters most is when and where he shows up, takes and hands
// over the vehicle; the trips under each piece come second.

import { useState } from 'react'
import dynamic from 'next/dynamic'
import { useQuery } from '@tanstack/react-query'
import type { PortalDutyDetail, PortalDutyEvent, PortalDutyItem, PortalRosterDayDetail } from '@nyx/schemas'
import { Icons } from '@/lib/icons'
import { cn } from '@/lib/utils'
import { portalFetch } from '@/lib/portal-auth'

const WEEKDAY = ['Domingo', 'Segunda', 'Terça', 'Quarta', 'Quinta', 'Sexta', 'Sábado']
const clock = (m: number) => `${String(Math.floor(m / 60) % 24).padStart(2, '0')}:${String(m % 60).padStart(2, '0')}`
const hours = (m: number) => `${Math.floor(m / 60)}h${String(m % 60).padStart(2, '0')}`
const STOP_PATTERN = { LIMITED: 'Semiexpressa', EXPRESS: 'Expressa' } as const
// Leaflet touches window — client only
const TripMap = dynamic(() => import('./trip-map'), { ssr: false })

export function DayDetail({ date, onClose }: { date: string; onClose: () => void }) {
  const { data, isLoading, error } = useQuery({
    queryKey: ['portal', 'roster', date, 'detail'],
    queryFn:  () => portalFetch<PortalRosterDayDetail>(`/roster/${date}`),
  })
  const [trip, setTrip] = useState<string | null>(null)
  return (
    <div className="absolute inset-0 z-10 flex flex-col bg-background">
      <header className="flex items-center gap-2 border-b border-border px-2 py-3">
        <button type="button" onClick={onClose} className="rounded-lg p-2 hover:bg-muted cursor-pointer" title="Voltar"><Icons.ArrowLeft className="h-5 w-5" /></button>
        <p className="text-base font-semibold">
          {WEEKDAY[new Date(`${date}T00:00:00Z`).getUTCDay()]}, {date.slice(8, 10)}/{date.slice(5, 7)}
        </p>
      </header>
      <div className="flex-1 space-y-6 overflow-y-auto p-4">
        {isLoading && <div className="flex justify-center py-8"><Icons.Loader2 className="h-5 w-5 animate-spin text-muted-foreground" /></div>}
        {error && <p className="text-sm text-destructive">{error.message}</p>}
        {data?.window && <p className="flex items-center gap-1 text-sm text-amber-700 dark:text-amber-300"><Icons.Clock className="h-4 w-4" />Restrição aprovada: {data.window}</p>}
        {data && !data.duties.length && <p className="text-sm text-muted-foreground">Nenhuma tabela neste dia.</p>}
        {data?.duties.map((d, i) => <Duty key={i} d={d} onMap={setTrip} />)}
      </div>
      {trip && <TripMap date={date} eventId={trip} onClose={() => setTrip(null)} />}
    </div>
  )
}

type OnMap = (eventId: string) => void

function Duty({ d, onMap }: { d: PortalDutyDetail; onMap: OnMap }) {
  return (
    <section className="space-y-3">
      <div>
        <p className="text-lg font-semibold">{d.kind === 'STANDBY' ? 'Plantão' : `Tabela ${d.label}`}</p>
        {d.start != null && d.end != null && <p className="text-2xl font-semibold tabular-nums">{clock(d.start)} <span className="text-muted-foreground">–</span> {clock(d.end)}</p>}
        {d.totals && (
          <p className="text-xs text-muted-foreground">
            Jornada {hours(d.totals.spreadMinutes)} · trabalho {hours(d.totals.workMinutes)}{d.totals.breakMinutes > 0 && ` · intervalo ${hours(d.totals.breakMinutes)}`}
          </p>
        )}
      </div>
      {d.notes.length > 0 && (
        <div className="space-y-1 rounded-xl border border-amber-500/30 bg-amber-500/10 p-3">
          <p className="flex items-center gap-1.5 text-xs font-semibold uppercase tracking-wide text-amber-700 dark:text-amber-300"><Icons.Info className="h-4 w-4" />Observações</p>
          <ul className="space-y-0.5 text-sm">{d.notes.map(n => <li key={n}>{n}</li>)}</ul>
        </div>
      )}
      <ol className="relative space-y-1 border-s-2 border-border ps-4">
        {d.items.map((it, i) => <Item key={i} it={it} onMap={onMap} />)}
      </ol>
    </section>
  )
}

// a point of the timeline: the time and the place, big — what he does there, below
function Point({ minutes, place, children, icon: Icon = Icons.MapPin }: {
  minutes: number; place: string | null; children?: React.ReactNode; icon?: typeof Icons.MapPin
}) {
  return (
    <li className="relative py-2">
      <span className="absolute -start-[23px] top-3.5 h-3 w-3 rounded-full border-2 border-background bg-primary" />
      <p className="flex items-baseline gap-2 text-base">
        <span className="font-semibold tabular-nums">{clock(minutes)}</span>
        {place && <span className="flex min-w-0 items-center gap-1 font-semibold"><Icon className="h-4 w-4 shrink-0 self-center text-muted-foreground" />{place}</span>}
      </p>
      {children && <div className="text-sm text-muted-foreground">{children}</div>}
    </li>
  )
}

// a lesser entry: trips, deadruns, intervals and the off-vehicle time
function Minor({ children, dot = 'top-3' }: { children: React.ReactNode; dot?: string }) {
  return (
    <li className="relative">
      <span className={cn('absolute -start-[21px] h-2 w-2 rounded-full bg-muted-foreground/50', dot)} />
      {children}
    </li>
  )
}

function Item({ it, onMap }: { it: PortalDutyItem; onMap: OnMap }) {
  switch (it.type) {
    case 'SIGN_ON':  return <Point minutes={it.minutes} place={it.locality}>Apresentação</Point>
    case 'SIGN_OFF': return <Point minutes={it.minutes} place={it.locality}>Fim da jornada</Point>
    case 'BREAK':
      return <Minor><Line start={it.start} end={it.end} icon={Icons.Coffee}>{it.label}{it.locality && ` · ${it.locality}`}</Line></Minor>
    case 'TRAVEL':
      return <Minor><Line start={it.start} end={it.end}>Deslocamento{it.from && ` ${it.from}`}{it.to && ` → ${it.to}`}</Line></Minor>
    case 'STANDBY':
      return <Minor><Line start={it.start} end={it.end}>Plantão{it.from && ` · ${it.from}`}</Line></Minor>
    case 'PIECE': {
      const trips = it.events.filter(e => e.type === 'TRIP')
      const midStart = trips[0]?.joinsAt != null
      const midEnd = trips.at(-1)?.leavesAt != null
      const car = it.vehicle && <span className="text-muted-foreground"> · carro {it.vehicle}</span>
      return (
        <>
          <Point minutes={it.start} place={it.from} icon={it.fromDepot ? Icons.Warehouse : Icons.MapPin}>
            <span className="flex items-center gap-1"><Icons.Bus className="h-3.5 w-3.5" />{it.fromDepot ? 'Saída garagem' : `Assume o carro${midStart ? ' em andamento' : ''}`}{car}</span>
          </Point>
          {it.events.map((e, i) => <Event key={i} e={e} onMap={onMap} />)}
          <Point minutes={it.end} place={it.to} icon={it.toDepot ? Icons.Warehouse : Icons.MapPin}>
            {it.toDepot ? 'Recolhe na garagem' : `Entrega o carro${midEnd ? ' em andamento' : ''}`}
          </Point>
        </>
      )
    }
  }
}

// start–end and a text, small
function Line({ start, end, icon: Icon, children }: { start: number; end: number; icon?: typeof Icons.MapPin; children: React.ReactNode }) {
  return (
    <p className="flex items-center gap-1.5 py-1.5 text-sm text-muted-foreground">
      {Icon && <Icon className="h-3.5 w-3.5 shrink-0" />}
      <span className="tabular-nums">{clock(start)}–{clock(end)}</span>
      <span className="min-w-0">{children}</span>
    </p>
  )
}

function Event({ e, onMap }: { e: PortalDutyEvent; onMap: OnMap }) {
  if (e.type === 'DEADRUN') return <Minor><Line start={e.start} end={e.end}>Ociosa · {e.from} → {e.to}</Line></Minor>
  if (e.type === 'INTERVAL') return <Minor><Line start={e.start} end={e.end}>{e.label}</Line></Minor>
  const body = (
    <div className="min-w-0 flex-1">
      <p className={cn('flex flex-wrap items-baseline gap-x-2', e.cancelled && 'text-muted-foreground line-through')}>
        <span className="font-semibold tabular-nums">{clock(e.start)}</span>
        <span className="text-sm text-muted-foreground tabular-nums">até {clock(e.end)}</span>
        <span className="font-semibold">{e.line}</span>
      </p>
      <p className={cn('text-sm', e.cancelled ? 'text-muted-foreground line-through' : 'text-foreground/80')}>{e.from} → {e.to}</p>
      <div className="mt-0.5 flex flex-wrap gap-1.5 empty:hidden">
        {e.cancelled && <span className="rounded bg-red-500/15 px-1.5 py-0.5 text-[11px] font-medium text-red-700 dark:text-red-300">Suprimida</span>}
        {e.stopPattern && e.stopPattern !== 'LOCAL' && <span className="rounded bg-sky-500/15 px-1.5 py-0.5 text-[11px] font-medium text-sky-700 dark:text-sky-300">{STOP_PATTERN[e.stopPattern]}</span>}
        {e.joinsAt != null && <span className="text-xs text-muted-foreground">assume às {clock(e.joinsAt)}</span>}
        {e.leavesAt != null && <span className="text-xs text-muted-foreground">entrega às {clock(e.leavesAt)}</span>}
      </div>
      {e.notes.map(n => <p key={n} className="text-xs italic text-amber-700 dark:text-amber-300">{n}</p>)}
    </div>
  )
  // the whole row opens the map — a big target on the phone
  return (
    <Minor dot="top-4">
      {e.cancelled ? <div className="flex py-2">{body}</div> : (
        <button type="button" onClick={() => onMap(e.id)} className="-ms-2 flex w-[calc(100%+0.5rem)] items-center gap-3 rounded-lg px-2 py-2 text-left hover:bg-muted active:bg-muted cursor-pointer">
          {body}
          <Icons.Map className="h-5 w-5 shrink-0 text-primary" />
        </button>
      )}
    </Minor>
  )
}
