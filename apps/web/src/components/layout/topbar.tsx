'use client'

import { PanelLeft, Bell, Sun, Moon, MoreHorizontal } from 'lucide-react'
import { useTheme } from 'next-themes'
import * as DropdownMenu from '@radix-ui/react-dropdown-menu'
import { cn } from '@/lib/utils'
import { Button } from '@/components/ui/button'
import { useSidebar } from './sidebar-context'
import { useTopbarActionsContext, type TopbarAction } from './topbar-actions-context'

function ActionButton({ action }: { action: TopbarAction }) {
  const Icon = action.icon
  return (
    <Button
      type={action.type ?? 'button'}
      form={action.form}
      variant={action.variant ?? 'default'}
      size="sm"
      disabled={action.disabled}
      onClick={action.onClick}
    >
      {Icon && <Icon className="w-3.5 h-3.5" />}
      <span className="hidden md:inline">{action.label}</span>
    </Button>
  )
}

export function Topbar() {
  const { toggle } = useSidebar()
  const { theme, setTheme } = useTheme()
  const { actions } = useTopbarActionsContext()

  const primary   = actions.filter((a) => a.primary !== false)
  const secondary = actions.filter((a) => a.primary === false)

  return (
    <header className="flex h-12 shrink-0 items-center border-b border-border bg-background px-3 gap-2">

      {/* Left — sidebar toggle */}
      <button
        onClick={toggle}
        className={cn(
          'flex h-8 w-8 items-center justify-center rounded-md',
          'text-muted-foreground hover:bg-accent hover:text-accent-foreground',
          'transition-colors focus:outline-none',
        )}
        aria-label="Toggle sidebar"
      >
        <PanelLeft className="h-4 w-4" />
      </button>

      {/* Center — page-injected actions */}
      <div className="flex flex-1 items-center justify-end gap-2 pr-1">

        {/* Desktop: todos os botões com ícone + label */}
        <div className="hidden md:flex items-center gap-2">
          {actions.map((action, i) => <ActionButton key={i} action={action} />)}
        </div>

        {/* Mobile: primários (ícone-only) + overflow ⋯ para secundários */}
        <div className="flex md:hidden items-center gap-2">
          {primary.map((action, i) => <ActionButton key={i} action={action} />)}

          {secondary.length > 0 && (
            <DropdownMenu.Root>
              <DropdownMenu.Trigger asChild>
                <Button variant="outline" size="sm" aria-label="Mais ações">
                  <MoreHorizontal className="w-3.5 h-3.5" />
                </Button>
              </DropdownMenu.Trigger>
              <DropdownMenu.Portal>
                <DropdownMenu.Content
                  align="end"
                  sideOffset={6}
                  className={cn(
                    'z-50 min-w-[160px] rounded-md border border-border bg-popover p-1 shadow-lg',
                    'text-popover-foreground text-sm',
                    'data-[state=open]:animate-in data-[state=closed]:animate-out',
                    'data-[state=closed]:fade-out-0 data-[state=open]:fade-in-0',
                    'data-[state=closed]:zoom-out-95 data-[state=open]:zoom-in-95',
                  )}
                >
                  {secondary.map((action, i) => {
                    const Icon = action.icon
                    return (
                      <DropdownMenu.Item
                        key={i}
                        onClick={action.onClick}
                        className={cn(
                          'flex items-center gap-2 rounded-sm px-2 py-1.5 cursor-pointer',
                          'hover:bg-accent hover:text-accent-foreground focus:outline-none',
                        )}
                      >
                        {Icon && <Icon className="w-4 h-4" />}
                        {action.label}
                      </DropdownMenu.Item>
                    )
                  })}
                </DropdownMenu.Content>
              </DropdownMenu.Portal>
            </DropdownMenu.Root>
          )}
        </div>
      </div>

      {/* Right — system controls */}
      <div className="flex items-center gap-1">
        <button
          onClick={() => setTheme(theme === 'dark' ? 'light' : 'dark')}
          className={cn(
            'flex h-8 w-8 items-center justify-center rounded-md',
            'text-muted-foreground hover:bg-accent hover:text-accent-foreground',
            'transition-colors focus:outline-none',
          )}
          aria-label="Toggle theme"
        >
          {theme === 'dark' ? <Sun className="h-4 w-4" /> : <Moon className="h-4 w-4" />}
        </button>

        <button
          className={cn(
            'flex h-8 w-8 items-center justify-center rounded-md',
            'text-muted-foreground hover:bg-accent hover:text-accent-foreground',
            'transition-colors focus:outline-none',
          )}
          aria-label="Notificações"
        >
          <Bell className="h-4 w-4" />
        </button>
      </div>

    </header>
  )
}
