'use client'

import { useEffect, useState } from 'react'
import { useRouter } from 'next/navigation'
import * as DropdownMenu from '@radix-ui/react-dropdown-menu'
import { LogOut, User, KeyRound, ChevronsUpDown } from 'lucide-react'
import { cn, getUserFromToken } from '@/lib/utils'
import { clearToken } from '@/lib/auth'
import { useSidebar } from './sidebar-context'

const SIDEBAR_WIDTH = 240

export function Sidebar() {
  const { isOpen } = useSidebar()
  const router = useRouter()
  const [user, setUser] = useState<{ username: string; role: string } | null>(null)

  useEffect(() => {
    setUser(getUserFromToken())
  }, [])

  function handleLogout() {
    clearToken()
    router.push('/login')
  }

  return (
    <aside
      style={{ width: isOpen ? SIDEBAR_WIDTH : 0 }}
      className="flex flex-col h-screen bg-sidebar border-r border-sidebar-border text-sidebar-foreground overflow-hidden transition-[width] duration-200 ease-in-out shrink-0"
    >
      <div className="flex flex-col h-full w-[240px]">

        {/* Header */}
        <div className="flex items-center gap-2 px-4 py-4 border-b border-sidebar-border">
          <div className="flex h-8 w-8 items-center justify-center rounded-md bg-primary text-primary-foreground font-bold text-sm">
            N
          </div>
          <span className="font-semibold text-sm">Nyx ERP</span>
        </div>

        {/* Content */}
        <div className="flex-1 overflow-y-auto px-2 py-3">
          <p className="px-2 text-xs text-sidebar-foreground/50 select-none">
            Navegação em breve
          </p>
        </div>

        {/* Footer — user menu */}
        <div className="border-t border-sidebar-border p-2">
          <DropdownMenu.Root>
            <DropdownMenu.Trigger asChild>
              <button className={cn(
                'flex w-full items-center gap-3 rounded-md px-2 py-2 text-sm',
                'hover:bg-sidebar-accent hover:text-sidebar-accent-foreground',
                'focus:outline-none transition-colors',
              )}>
                <div className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-sidebar-accent text-xs font-medium uppercase">
                  {user?.username?.slice(0, 2) ?? '??'}
                </div>
                <div className="flex-1 text-left leading-tight">
                  <p className="font-medium text-sm truncate">{user?.username ?? '—'}</p>
                  <p className="text-xs text-sidebar-foreground/60 truncate capitalize">{user?.role ?? ''}</p>
                </div>
                <ChevronsUpDown className="h-4 w-4 shrink-0 text-sidebar-foreground/50" />
              </button>
            </DropdownMenu.Trigger>

            <DropdownMenu.Portal>
              <DropdownMenu.Content
                side="top"
                align="start"
                sideOffset={8}
                className={cn(
                  'z-50 min-w-[200px] rounded-md border border-border bg-popover p-1 shadow-lg',
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
                    'text-destructive hover:bg-destructive/10 focus:outline-none',
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
