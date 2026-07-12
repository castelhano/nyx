'use client'

import { useState, useMemo, useEffect, useRef } from 'react'
import { useRouter } from 'next/navigation'
import { useQuery } from '@tanstack/react-query'
import { Search } from 'lucide-react'
import { useDiscovery } from '@/core/useDiscovery'
import { resolveIcon } from '@/lib/icons'
import { useShortcut } from '@/lib/keywatch'
import { apiFetch } from '@/lib/auth'
import { httpError, httpRetry } from '@/lib/query'
import { cn } from '@/lib/utils'

interface Result {
  domain:      string
  domainLabel: string
  resource:    string
  label:       string
  labelPlural: string
  icon?:       string
  nameField:   string
}

export function GlobalSearch() {
  const [open,   setOpen]   = useState(false)
  const [query,  setQuery]  = useState('')
  const [cursor, setCursor] = useState(0)
  const inputRef = useRef<HTMLInputElement>(null)
  const listRef  = useRef<HTMLUListElement>(null)
  const router   = useRouter()
  const { data: domains } = useDiscovery()

  // "linha:301" → prefix resolve o resource (como antes), valor após ':' vira lookup exato pelo nameField
  const colonIdx   = query.indexOf(':')
  const hasLookup  = colonIdx !== -1
  const prefix     = hasLookup ? query.slice(0, colonIdx) : query
  const lookupRaw  = hasLookup ? query.slice(colonIdx + 1) : ''

  const results = useMemo<Result[]>(() => {
    const all = (domains ?? []).flatMap((d) =>
      d.resources.map((r) => ({
        domain:      d.key,
        domainLabel: d.label,
        resource:    r.key,
        label:       r.label,
        labelPlural: r.labelPlural,
        icon:        r.icon,
        nameField:   r.nameField,
      })),
    )
    const q = prefix.toLowerCase().trim()
    if (!q) return []
    return all.filter((r) =>
      r.labelPlural.toLowerCase().includes(q) ||
      r.label.toLowerCase().includes(q) ||
      r.resource.toLowerCase().includes(q),
    )
  }, [domains, prefix])

  const target = results[cursor]

  const [debouncedLookup, setDebouncedLookup] = useState('')
  useEffect(() => {
    if (!hasLookup) { setDebouncedLookup(''); return }
    const t = setTimeout(() => setDebouncedLookup(lookupRaw.trim()), 250)
    return () => clearTimeout(t)
  }, [hasLookup, lookupRaw])

  const { data: lookupResult, isFetching: lookupLoading } = useQuery<Record<string, unknown> | null>({
    queryKey: ['global-search-lookup', target?.domain, target?.resource, debouncedLookup],
    queryFn: async () => {
      const res = await apiFetch(`/${target!.domain}/${target!.resource}/lookup?value=${encodeURIComponent(debouncedLookup)}`)
      if (!res.ok) throw httpError(res.status)
      const text = await res.text()
      return text ? JSON.parse(text) : null
    },
    enabled: hasLookup && !!target && debouncedLookup.length > 0,
    retry:   httpRetry,
  })

  useShortcut('f3', () => setOpen((v) => !v), {
    desc:    'Busca global',
    icon:    Search,
    origin:  'apps/web/src/components/layout/global-search',
    context: 'default',
    order: 1
  })

  useEffect(() => { setCursor(0) }, [results])

  useEffect(() => {
    if (!open) return
    setQuery('')
    setCursor(0)
    requestAnimationFrame(() => inputRef.current?.focus())
  }, [open])

  // Keep active item in view on arrow navigation
  useEffect(() => {
    const el = listRef.current?.children[cursor] as HTMLElement | undefined
    el?.scrollIntoView({ block: 'nearest' })
  }, [cursor])

  function navigate(r: Result) {
    router.push(`/${r.domain}/${r.resource}`)
    setOpen(false)
  }

  function navigateToRecord(r: Result, id: string) {
    router.push(`/${r.domain}/${r.resource}/${id}`)
    setOpen(false)
  }

  function onKeyDown(e: React.KeyboardEvent) {
    if (e.key === 'Escape')    { setOpen(false); return }
    if (e.key === 'ArrowDown') { e.preventDefault(); setCursor((c) => Math.min(c + 1, results.length - 1)); return }
    if (e.key === 'ArrowUp')   { e.preventDefault(); setCursor((c) => Math.max(c - 1, 0)); return }
    if (e.key !== 'Enter' || !results[cursor]) return
    const r = results[cursor]
    if (hasLookup) {
      if (lookupResult) navigateToRecord(r, lookupResult.id as string)
      return
    }
    navigate(r)
  }

  if (!open) return null

  return (
    <div
      className="fixed inset-0 z-50 bg-background/70 backdrop-blur-sm"
      onPointerDown={() => setOpen(false)}
    >
      <div
        className="fixed left-1/2 top-[8vh] -translate-x-1/2 w-full max-w-lg px-4"
        onPointerDown={(e) => e.stopPropagation()}
      >
        <div className="rounded-(--radius) border border-border bg-card shadow-xl overflow-hidden">

          <div className="flex items-center gap-3 px-4 py-3 border-b border-border">
            <Search className="w-4 h-4 text-muted-foreground flex-shrink-0" />
            <input
              ref={inputRef}
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              onKeyDown={onKeyDown}
              placeholder="Buscar recurso…"
              className="flex-1 bg-transparent text-sm outline-none placeholder:text-muted-foreground"
            />
            <kbd className="hidden sm:inline-flex items-center rounded-(--radius) border border-border px-1.5 py-0.5 text-[10px] font-mono text-muted-foreground">
              ESC
            </kbd>
          </div>

          {!query.trim() ? null : results.length > 0 ? (
            <ul ref={listRef} className="max-h-72 overflow-y-auto py-1">
              {results.map((r, i) => {
                const Icon   = resolveIcon(r.icon)
                const active = i === cursor && hasLookup
                const status = active
                  ? debouncedLookup === ''
                    ? `Digite o ${r.nameField}…`
                    : lookupLoading
                      ? 'Buscando…'
                      : lookupResult
                        ? 'Enter para abrir'
                        : 'Não encontrado'
                  : r.domainLabel
                return (
                  <li key={`${r.domain}/${r.resource}`}>
                    <button
                      type="button"
                      onPointerDown={() => {
                        if (hasLookup) {
                          if (i === cursor && lookupResult) navigateToRecord(r, lookupResult.id as string)
                          else setCursor(i)
                          return
                        }
                        navigate(r)
                      }}
                      onMouseEnter={() => setCursor(i)}
                      className={cn(
                        'w-full flex items-center gap-3 px-4 py-2.5 text-left transition-colors',
                        i === cursor ? 'bg-accent text-accent-foreground' : 'hover:bg-accent/50',
                      )}
                    >
                      <Icon className="w-4 h-4 flex-shrink-0 text-muted-foreground" />
                      <span className="flex-1 text-sm font-medium">{r.labelPlural}</span>
                      <span className={cn('text-xs', active && lookupResult ? 'text-primary' : 'text-muted-foreground')}>
                        {status}
                      </span>
                    </button>
                  </li>
                )
              })}
            </ul>
          ) : (
            <p className="px-4 py-8 text-center text-sm text-muted-foreground">
              Nenhum recurso encontrado.
            </p>
          )}

        </div>
      </div>
    </div>
  )
}
