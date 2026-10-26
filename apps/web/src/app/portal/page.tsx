'use client'

// Crew portal — mobile first, its own session (lib/portal-auth.ts). The first access asks for a
// new PIN; unread changes to the roster block the rest until confirmed (the API locks the same).
// The tabs follow the crew member's portal permissions.

import { useEffect, useState } from 'react'
import { useRouter } from 'next/navigation'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import type { PortalMe, PortalNotification } from '@nyx/schemas'
import { Icons } from '@/lib/icons'
import { cn } from '@/lib/utils'
import { clearPortalToken, getPortalToken, portalFetch } from '@/lib/portal-auth'
import { Lines, Notices, Requests, Roster, WEEKDAY, ddmm, field, primary, weekday } from './sections'

type Tab = 'escala' | 'pedidos' | 'linhas' | 'avisos'
type TabDef = [Tab, string, typeof Icons.Bell]

export default function PortalPage() {
  const router = useRouter()
  const qc = useQueryClient()
  const [ready, setReady] = useState(false)
  const [tab, setTab] = useState<Tab | null>(null)
  const [toast, setToast] = useState<string | null>(null)
  const flash = (t: string) => { setToast(t); setTimeout(() => setToast(null), 2500) }

  useEffect(() => {
    if (!getPortalToken()) router.replace('/login?acesso=operador')
    // eslint-disable-next-line react-hooks/set-state-in-effect
    else setReady(true)
  }, [router])

  const { data: me } = useQuery({ queryKey: ['portal', 'me'], queryFn: () => portalFetch<PortalMe>('/me'), enabled: ready })
  const locked = !!me && !me.mustChangePin && me.unread > 0
  // REQUIRED mode: his preferred lines before anything else (after the changes to confirm)
  const pickLines = !!me && !me.mustChangePin && !locked && me.linesMissing > 0
  const { data: notices = [] } = useQuery({
    queryKey: ['portal', 'notifications'],
    queryFn:  () => portalFetch<PortalNotification[]>('/notifications'),
    enabled:  !!me && !me.mustChangePin,
  })

  const logout = () => {
    clearPortalToken()
    qc.removeQueries({ queryKey: ['portal'] })
    router.replace('/login?acesso=operador')
  }

  if (!me) {
    return <div className="flex h-dvh items-center justify-center bg-background"><Icons.Loader2 className="h-6 w-6 animate-spin text-muted-foreground" /></div>
  }
  if (me.mustChangePin) {
    return <ChangePin onDone={() => { void qc.invalidateQueries({ queryKey: ['portal'] }); flash('PIN alterado') }} />
  }

  const p = me.permissions
  const tabs: TabDef[] = [
    ...(p.viewRoster ? [['escala', 'Escala', Icons.CalendarDays] as TabDef] : []),
    ...(p.requestAbsence || p.requestTimeWindow ? [['pedidos', 'Pedidos', Icons.Send] as TabDef] : []),
    ['linhas', 'Linhas', Icons.Route],
    ['avisos', 'Avisos', Icons.Bell],
  ]
  const current = tab && tabs.some(t => t[0] === tab) ? tab : tabs[0][0]
  const unread = notices.filter(n => !n.readAt)

  return (
    <div className="relative mx-auto flex h-dvh max-w-md flex-col bg-background">
      <header className="flex items-center gap-3 border-b border-border px-4 py-3">
        <div className="flex h-9 w-9 items-center justify-center rounded-full bg-primary/15 text-sm font-semibold text-primary">
          {me.name.split(' ').filter(Boolean).map(w => w[0]).slice(0, 2).join('')}
        </div>
        <div className="min-w-0 me-auto">
          <p className="text-sm font-semibold leading-tight">{me.name}</p>
          <p className="text-xs text-muted-foreground">{me.code} · {me.branch}</p>
        </div>
        <button type="button" onClick={logout} className="p-2 text-muted-foreground hover:text-foreground cursor-pointer" title="Sair">
          <Icons.LogOut className="h-5 w-5" />
        </button>
      </header>

      <main className="flex-1 overflow-y-auto">
        {pickLines && <Lines first onSaved={() => { void qc.invalidateQueries({ queryKey: ['portal', 'me'] }); flash('Preferências salvas') }} />}
        {!locked && !pickLines && current === 'escala'  && <Roster />}
        {!locked && !pickLines && current === 'pedidos' && <Requests me={me} onSent={() => flash('Pedido enviado — aguarde a aprovação')} />}
        {!locked && !pickLines && current === 'linhas'  && <Lines onSaved={() => flash('Preferências salvas')} />}
        {!pickLines && current === 'avisos' && <Notices list={notices} />}
      </main>

      {!pickLines && <nav className="grid border-t border-border bg-card" style={{ gridTemplateColumns: `repeat(${tabs.length}, minmax(0, 1fr))` }}>
        {tabs.map(([key, label, Icon]) => (
          <button key={key} type="button" onClick={() => setTab(key)}
            className={cn('relative flex flex-col items-center gap-0.5 py-2.5 text-[11px] cursor-pointer', current === key ? 'text-primary font-medium' : 'text-muted-foreground')}>
            <Icon className="h-5 w-5" />
            {label}
            {key === 'avisos' && unread.length > 0 && <span className="absolute right-[30%] top-1.5 h-2 w-2 rounded-full bg-red-500" />}
          </button>
        ))}
      </nav>}

      {locked && unread.length > 0 && <Changes list={unread} />}

      {toast && (
        <div className="pointer-events-none absolute inset-x-4 bottom-20 rounded-lg bg-foreground px-4 py-2.5 text-center text-sm text-background shadow-lg">{toast}</div>
      )}
    </div>
  )
}

// ── first access ────────────────────────────────────────────────────────────

function ChangePin({ onDone }: { onDone: () => void }) {
  const [current, setCurrent] = useState('')
  const [next, setNext] = useState('')
  const [again, setAgain] = useState('')
  const save = useMutation({
    mutationFn: () => portalFetch<void>('/auth/change-pin', { method: 'POST', body: { current, next } }),
    onSuccess:  onDone,
  })
  const digits = (v: string) => v.replace(/\D/g, '').slice(0, 6)
  const error = next.length === 6 && next === current ? 'O PIN novo deve ser diferente do atual'
    : again.length === 6 && again !== next ? 'Os PINs não conferem' : save.error?.message ?? null
  const ok = current.length === 6 && next.length === 6 && again === next && next !== current
  return (
    <form
      onSubmit={e => { e.preventDefault(); if (ok) save.mutate() }}
      className="mx-auto flex h-dvh max-w-md flex-col justify-center gap-6 bg-background px-6"
    >
      <div className="space-y-2 text-center">
        <div className="mx-auto flex h-12 w-12 items-center justify-center rounded-full bg-primary/15 text-primary"><Icons.KeyRound className="h-6 w-6" /></div>
        <p className="text-lg font-semibold">Crie seu PIN</p>
        <p className="text-sm text-muted-foreground">No primeiro acesso, troque o PIN inicial (os 6 primeiros dígitos do CPF) por um só seu.</p>
      </div>
      <div className="space-y-3">
        <input className={field} type="password" inputMode="numeric" autoComplete="current-password" placeholder="PIN atual" value={current} onChange={e => setCurrent(digits(e.target.value))} />
        <input className={field} type="password" inputMode="numeric" autoComplete="new-password" placeholder="PIN novo (6 dígitos)" value={next} onChange={e => setNext(digits(e.target.value))} />
        <input className={field} type="password" inputMode="numeric" autoComplete="new-password" placeholder="Repita o PIN novo" value={again} onChange={e => setAgain(digits(e.target.value))} />
        {error && <p className="text-sm text-destructive">{error}</p>}
      </div>
      <button type="submit" disabled={!ok || save.isPending} className={primary}>{save.isPending ? 'Salvando…' : 'Salvar PIN'}</button>
    </form>
  )
}

// ── changes to confirm ──────────────────────────────────────────────────────

function Changes({ list }: { list: PortalNotification[] }) {
  const qc = useQueryClient()
  const ack = useMutation({
    mutationFn: () => portalFetch('/notifications/ack', { method: 'POST', body: { ids: list.map(n => n.id) } }),
    onSuccess:  () => qc.invalidateQueries({ queryKey: ['portal'] }),
  })
  return (
    <div className="absolute inset-0 z-10 flex items-end bg-black/50">
      <div className="max-h-[85%] w-full space-y-4 overflow-y-auto rounded-t-2xl bg-card px-5 pb-6 pt-5">
        <div className="flex items-center gap-2">
          <Icons.Bell className="h-5 w-5 text-amber-500" />
          <p className="text-base font-semibold">Sua escala mudou</p>
        </div>
        <p className="text-sm text-muted-foreground">Confirme que viu as mudanças para continuar.</p>
        <ul className="space-y-2">
          {list.map(n => (
            <li key={n.id} className="rounded-lg border border-border bg-background px-3 py-2.5 text-sm">
              <span className="me-2 rounded bg-amber-500/15 px-1.5 py-0.5 text-[11px] font-medium text-amber-700 dark:text-amber-300">{WEEKDAY[weekday(n.date)]} {ddmm(n.date)}</span>
              {n.message}
            </li>
          ))}
        </ul>
        {ack.error && <p className="text-sm text-destructive">{ack.error.message}</p>}
        <button type="button" disabled={ack.isPending} onClick={() => ack.mutate()} className={primary}>{ack.isPending ? 'Confirmando…' : 'Li e confirmo'}</button>
      </div>
    </div>
  )
}
