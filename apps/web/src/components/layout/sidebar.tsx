'use client'

import { useEffect, useState } from 'react'
import { useRouter, usePathname } from 'next/navigation'
import Link from 'next/link'
import * as DropdownMenu from '@radix-ui/react-dropdown-menu'
import * as Collapsible from '@radix-ui/react-collapsible'
import {
  LogOut, User, KeyRound, ChevronsUpDown, ChevronRight,
} from 'lucide-react'
import { cn, getUserFromToken } from '@/lib/utils'
import { clearToken } from '@/lib/auth'
import { useSidebar } from './sidebar-context'
import { domains } from '@/core/domains'

const SIDEBAR_WIDTH           = 240
const SIDEBAR_COLLAPSED_WIDTH = 56

const NAV = Object.entries(domains).map(([key, config]) => ({
  key,
  label: config.label,
  icon:  config.icon,
  href:  `/${key}`,
  items: config.resources.map((r) => ({
    label: r.label,
    href:  `/${key}/${r.key}`,
    icon:  r.icon,
  })),
}))

export function Sidebar() {
  const { isOpen } = useSidebar()

  const router   = useRouter()
  const pathname = usePathname()
  const [user, setUser]       = useState<{ username: string; role: string } | null>(null)
  const [mounted, setMounted] = useState(false)
  const [openModules, setOpenModules] = useState<Set<string>>(new Set())

  useEffect(() => {
    setMounted(true)
    setUser(getUserFromToken())
    const active = NAV.find((m) => pathname.startsWith(`/${m.key}`))
    if (active) setOpenModules(new Set([active.key]))
  }, [])

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

  return (
    <aside
      style={{ width: isOpen ? SIDEBAR_WIDTH : SIDEBAR_COLLAPSED_WIDTH }}
      className="flex flex-col h-screen bg-sidebar border-r border-sidebar-border text-sidebar-foreground overflow-hidden transition-[width] duration-200 ease-in-out shrink-0"
    >
      <div className="flex flex-col h-full" style={{ width: isOpen ? SIDEBAR_WIDTH : SIDEBAR_COLLAPSED_WIDTH }}>

        {/* Header */}
        <div className={cn(
          'flex h-12 shrink-0 items-center border-b border-sidebar-border',
          isOpen ? 'gap-2 px-4' : 'justify-center px-2',
        )}>
          <div className="flex h-7 w-7 shrink-0 items-center justify-center rounded-md bg-primary text-primary-foreground font-bold text-sm">
            N
          </div>
          {isOpen && <span className="font-semibold text-sm">Nyx <span className='text-fuchsia-400'>app</span></span>}
        </div>

        {/* Navigation */}
        <div className="flex-1 overflow-y-auto py-2">
          {isOpen ? (
            <nav className="flex flex-col gap-0.5 px-2">
              {NAV.map((mod) => {
                const isModActive = pathname.startsWith(`/${mod.key}`)
                const isExpanded  = openModules.has(mod.key)

                return (
                  <Collapsible.Root
                    key={mod.key}
                    open={isExpanded}
                    onOpenChange={() => toggleModule(mod.key)}
                  >
                    <div className={cn(
                      'flex items-center rounded-md overflow-hidden transition-colors',
                      isModActive
                        ? 'bg-sidebar-accent text-sidebar-accent-foreground'
                        : 'hover:bg-sidebar-accent hover:text-sidebar-accent-foreground',
                    )}>
                      <Link
                        href={mod.href}
                        className="flex flex-1 items-center gap-2 px-2 py-2 text-sm font-medium border-r border-sidebar-border"
                      >
                        <mod.icon className="h-4 w-4 shrink-0" />
                        <span>{mod.label}</span>
                      </Link>

                      <Collapsible.Trigger asChild>
                        <button className="flex w-7 shrink-0 self-stretch items-center justify-center focus:outline-none">
                          <ChevronRight className={cn(
                            'h-3.5 w-3.5 transition-transform duration-200',
                            isExpanded && 'rotate-90',
                          )} />
                        </button>
                      </Collapsible.Trigger>
                    </div>

                    <Collapsible.Content>
                      <div className="mt-0.5 mb-0.5 flex flex-col gap-0.5 pl-3">
                        {mod.items.map((item) => {
                          const isActive = pathname === item.href || pathname.startsWith(item.href + '/')
                          return (
                            <Link
                              key={item.href}
                              href={item.href}
                              className={cn(
                                'flex items-center gap-2 rounded-md px-2 py-2 text-sm',
                                'hover:bg-sidebar-accent hover:text-sidebar-accent-foreground transition-colors',
                                isActive
                                  ? 'bg-sidebar-accent text-sidebar-accent-foreground font-medium'
                                  : 'text-sidebar-foreground/70',
                              )}
                            >
                              <item.icon className="h-4 w-4 shrink-0" />
                              <span>{item.label}</span>
                            </Link>
                          )
                        })}
                      </div>
                    </Collapsible.Content>
                  </Collapsible.Root>
                )
              })}
            </nav>
          ) : (
            <nav className="flex flex-col items-center gap-1 px-2 py-1">
              {NAV.map((mod) => {
                const isModActive = pathname.startsWith(`/${mod.key}`)
                return (
                  <Link
                    key={mod.key}
                    href={mod.href}
                    className={cn(
                      'flex h-8 w-8 items-center justify-center rounded-md',
                      'hover:bg-sidebar-accent hover:text-sidebar-accent-foreground transition-colors',
                      isModActive && 'bg-sidebar-accent text-sidebar-accent-foreground',
                    )}
                  >
                    <mod.icon className="h-4 w-4" />
                  </Link>
                )
              })}
            </nav>
          )}
        </div>

        {/* Footer — user menu */}
        <div className="border-t border-sidebar-border p-2">
          <DropdownMenu.Root>
            <DropdownMenu.Trigger asChild>
              <button className={cn(
                'flex w-full items-center rounded-md px-2 py-2 text-sm',
                isOpen ? 'gap-3' : 'justify-center',
                'hover:bg-sidebar-accent hover:text-sidebar-accent-foreground',
                'focus:outline-none transition-colors',
              )}>
                <div className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-sidebar-accent text-xs font-medium uppercase">
                  {mounted ? (user?.username?.slice(0, 2) ?? '??') : '??'}
                </div>
                {isOpen && (
                  <>
                    <div className="flex-1 text-left leading-tight">
                      <p className="font-medium text-sm truncate">{mounted ? (user?.username ?? '—') : '—'}</p>
                      <p className="text-xs text-sidebar-foreground/60 truncate capitalize">{mounted ? (user?.role ?? '') : ''}</p>
                    </div>
                    <ChevronsUpDown className="h-4 w-4 shrink-0 text-sidebar-foreground/50" />
                  </>
                )}
              </button>
            </DropdownMenu.Trigger>

            <DropdownMenu.Portal>
              <DropdownMenu.Content
                side="right"
                align="end"
                sideOffset={8}
                className={cn(
                  'z-50 min-w-[200px] rounded-md border border-border bg-popover p-1 ms-1 shadow-lg',
                  'text-popover-foreground text-sm',
                  'data-[state=open]:animate-in data-[state=closed]:animate-out',
                  'data-[state=closed]:fade-out-0 data-[state=open]:fade-in-0',
                  'data-[state=closed]:zoom-out-95 data-[state=open]:zoom-in-95',
                )}
              >
                <DropdownMenu.Item className={cn(
                  'flex items-center gap-2 rounded-sm px-2 py-1.5 cursor-pointer',
                  'hover:bg-accent hover:text-accent-foreground focus:outline-none',
                )}>
                  <User className="h-4 w-4" />
                  Perfil
                </DropdownMenu.Item>

                <DropdownMenu.Item className={cn(
                  'flex items-center gap-2 rounded-sm px-2 py-1.5 cursor-pointer',
                  'hover:bg-accent hover:text-accent-foreground focus:outline-none',
                )}>
                  <KeyRound className="h-4 w-4" />
                  Alterar Senha
                </DropdownMenu.Item>

                <DropdownMenu.Separator className="my-1 h-px bg-border" />

                <DropdownMenu.Item
                  onClick={handleLogout}
                  className={cn(
                    'flex items-center gap-2 rounded-sm px-2 py-1.5 cursor-pointer',
                    'hover:bg-destructive/10 focus:outline-none',
                  )}
                >
                  <LogOut className="h-4 w-4" />
                  Sair
                </DropdownMenu.Item>
              </DropdownMenu.Content>
            </DropdownMenu.Portal>
          </DropdownMenu.Root>
        </div>

      </div>
    </aside>
  )
}
