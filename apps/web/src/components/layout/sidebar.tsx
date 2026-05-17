'use client'

import { useEffect, useRef, useState } from 'react'
import { useShortcut } from '@/lib/keywatch'
import { useRouter, usePathname } from 'next/navigation'
import Link from 'next/link'
import { LogOut, User, KeyRound, Settings, ChevronsUpDown, ChevronRight } from 'lucide-react'
import { cn, getUserFromToken } from '@/lib/utils'
import { clearToken } from '@/lib/auth'
import { resolveIcon } from '@/lib/icons'
import { useDiscovery } from '@/core/useDiscovery'
import { Dropdown, DropdownItem, DropdownSeparator } from '@/components/ui/dropdown'
import { useSidebar } from './sidebar-context'
import { useAuth } from '@/lib/auth-context'

export function Sidebar() {
  const { isOpen, open, close } = useSidebar()
  const { data: domains }       = useDiscovery()
  const { user }                = useAuth()

  const router   = useRouter()
  const pathname = usePathname()
  const [openModules, setOpenModules] = useState<Set<string>>(new Set())
  const prefApplied = useRef(false)

  // Expande o módulo activo ao carregar domains
  useEffect(() => {
    const initial = new Set<string>()
    const active  = domains.find((d) => pathname.startsWith(`/${d.key}`))
    if (active) initial.add(active.key)
    setOpenModules(initial)
  }, [domains]) // eslint-disable-line react-hooks/exhaustive-deps

  // Aplica sidebarCollapsed da preferência — apenas uma vez
  useEffect(() => {
    if (!user || prefApplied.current) return
    prefApplied.current = true
    if (user.preferences.sidebarCollapsed) close()
    else open()
  }, [user]) // eslint-disable-line react-hooks/exhaustive-deps

  // Fecha no mobile ao navegar
  useEffect(() => {
    if (window.innerWidth < 768) close()
  }, [pathname]) // eslint-disable-line react-hooks/exhaustive-deps

  // Fecha no mobile com Esc
  useEffect(() => {
    function onKeyDown(e: KeyboardEvent) {
      if (e.key === 'Escape' && window.innerWidth < 768) close()
    }
    document.addEventListener('keydown', onKeyDown)
    return () => document.removeEventListener('keydown', onKeyDown)
  }, []) // eslint-disable-line react-hooks/exhaustive-deps

  function toggleModule(key: string) {
    setOpenModules((prev) => {
      const next = new Set(prev)
      next.has(key) ? next.delete(key) : next.add(key)
      return next
    })
  }

  function handleLogout() {
    clearToken()
    router.push('/login')
  }

  useShortcut('alt+q', handleLogout, {
    desc:   'Sair da sessão',
    icon:   LogOut,
    origin: 'apps/web/src/components/layout/sidebar',
    order:  99,
  })

  // Fallback síncrono do JWT enquanto /auth/me não resolve
  const tokenUser   = user ? null : getUserFromToken()
  const displayName = user?.name ?? user?.username ?? tokenUser?.username ?? '—'
  const displayRole = user?.role ?? tokenUser?.role ?? ''
  // Iniciais sempre derivadas do username — 2 chars, previsível independente do auth estar carregado
  const displayUsername = user?.username ?? tokenUser?.username ?? '??'
  const initials        = displayUsername.slice(0, 2).toUpperCase()

  return (
    <>
      {/* Backdrop mobile */}
      {isOpen && (
        <div
          className="fixed inset-0 z-30 bg-black/50 md:hidden"
          onClick={close}
        />
      )}

      <aside className={cn(
        'flex flex-col h-screen bg-sidebar border-r border-sidebar-border text-sidebar-foreground overflow-hidden',
        'fixed inset-y-0 left-0 z-40 w-60 transition-transform duration-200 ease-in-out',
        isOpen ? 'translate-x-0' : '-translate-x-full',
        'md:relative md:z-auto md:translate-x-0 md:shrink-0 md:transition-[width]',
        isOpen ? 'md:w-60' : 'md:w-14',
      )}>
        <div className="flex flex-col h-full w-full">

          {/* Header */}
          <div className={cn(
            'flex h-12 shrink-0 items-center border-b border-sidebar-border',
            isOpen ? 'gap-2 px-4' : 'justify-center px-2',
          )}>
            <div className="flex h-7 w-7 shrink-0 items-center justify-center rounded-md bg-primary text-primary-foreground font-bold text-sm">
              N
            </div>
            {isOpen && <span className="font-semibold text-sm">Nyx <span className="text-fuchsia-400">app</span></span>}
          </div>

          {/* Navigation */}
          <div className="flex-1 overflow-y-auto py-2">
            {isOpen ? (
              <nav className="flex flex-col gap-0.5 px-2">
                {domains.map((mod) => {
                  const ModIcon     = resolveIcon(mod.icon)
                  const isModActive = pathname.startsWith(`/${mod.key}`)
                  const isExpanded  = openModules.has(mod.key)

                  return (
                    <div key={mod.key}>
                      <div className={cn(
                        'flex items-center rounded-md overflow-hidden transition-colors',
                        isModActive
                          ? 'bg-sidebar-accent text-sidebar-accent-foreground'
                          : 'hover:bg-sidebar-accent hover:text-sidebar-accent-foreground',
                      )}>
                        <Link
                          href={`/${mod.key}`}
                          className="flex flex-1 items-center gap-2 px-2 py-2 text-sm font-medium border-r border-sidebar-border"
                        >
                          <ModIcon className="h-4 w-4 shrink-0" />
                          <span>{mod.label}</span>
                        </Link>

                        <button
                          type="button"
                          onClick={() => toggleModule(mod.key)}
                          className="flex w-7 shrink-0 self-stretch items-center justify-center focus:outline-none"
                          aria-expanded={isExpanded}
                        >
                          <ChevronRight className={cn(
                            'h-3.5 w-3.5 transition-transform duration-200',
                            isExpanded && 'rotate-90',
                          )} />
                        </button>
                      </div>

                      {/* Collapsible — CSS transition, sem Radix */}
                      <div className={cn(
                        'overflow-hidden transition-all duration-200',
                        isExpanded ? 'max-h-96 opacity-100' : 'max-h-0 opacity-0',
                      )}>
                        <div className="mt-0.5 mb-0.5 flex flex-col gap-0.5 pl-3">
                          {mod.resources.map((item) => {
                            const ItemIcon = resolveIcon(item.icon)
                            const href     = `/${mod.key}/${item.key}`
                            const isActive = pathname === href || pathname.startsWith(href + '/')
                            return (
                              <Link
                                key={href}
                                href={href}
                                className={cn(
                                  'flex items-center gap-2 rounded-md px-2 py-2 text-sm',
                                  'hover:bg-sidebar-accent hover:text-sidebar-accent-foreground transition-colors',
                                  isActive
                                    ? 'bg-sidebar-accent text-sidebar-accent-foreground font-medium'
                                    : 'text-sidebar-foreground/70',
                                )}
                              >
                                <ItemIcon className="h-4 w-4 shrink-0" />
                                <span>{item.label}</span>
                              </Link>
                            )
                          })}
                        </div>
                      </div>
                    </div>
                  )
                })}
              </nav>
            ) : (
              <nav className="flex flex-col items-center gap-1 px-2 py-1">
                {domains.map((mod) => {
                  const ModIcon     = resolveIcon(mod.icon)
                  const isModActive = pathname.startsWith(`/${mod.key}`)
                  return (
                    <Link
                      key={mod.key}
                      href={`/${mod.key}`}
                      className={cn(
                        'flex h-8 w-8 items-center justify-center rounded-md',
                        'hover:bg-sidebar-accent hover:text-sidebar-accent-foreground transition-colors',
                        isModActive && 'bg-sidebar-accent text-sidebar-accent-foreground',
                      )}
                    >
                      <ModIcon className="h-4 w-4" />
                    </Link>
                  )
                })}
              </nav>
            )}
          </div>

          {/* Footer — user menu */}
          <div className="border-t border-sidebar-border p-2">
            <Dropdown
              side="right"
              align="end"
              sideOffset={10}
              trigger={
                <button className={cn(
                  'flex w-full items-center rounded-md px-2 py-2 text-sm',
                  isOpen ? 'gap-3' : 'justify-center',
                  'hover:bg-sidebar-accent hover:text-sidebar-accent-foreground',
                  'focus:outline-none transition-colors',
                )}>
                  <div className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-sidebar-accent text-xs font-medium uppercase">
                    {initials}
                  </div>
                  {isOpen && (
                    <>
                      <div className="flex-1 text-left leading-tight">
                        <p className="font-medium text-sm truncate capitalize">{displayName}</p>
                        <p className="text-xs text-sidebar-foreground/60 truncate capitalize">{displayRole}</p>
                      </div>
                      <ChevronsUpDown className="h-4 w-4 shrink-0 text-sidebar-foreground/50" />
                    </>
                  )}
                </button>
              }
            >
              <DropdownItem href="/core/user/preferences">
                <Settings className="h-4 w-4" />
                Preferências
              </DropdownItem>

              <DropdownItem href="/core/user/password">
                <KeyRound className="h-4 w-4" />
                Alterar Senha
              </DropdownItem>

              <DropdownSeparator />

              <DropdownItem onClick={handleLogout} destructive>
                <LogOut className="h-4 w-4" />
                Sair
              </DropdownItem>
            </Dropdown>
          </div>

        </div>
      </aside>
    </>
  )
}
