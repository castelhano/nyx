'use client'

import { PanelLeft, Bell, Sun, Moon, MoreHorizontal } from 'lucide-react'
import { useTheme } from 'next-themes'
import { cn } from '@/lib/utils'
import { Button } from '@/components/ui/button'
import { Dropdown, DropdownItem } from '@/components/ui/dropdown'
import { useSidebar } from './sidebar-context'
import { useTopbarActionsContext, type TopbarAction } from './topbar-actions-context'

function ActionButton({ action }: { action: TopbarAction }) {
  const Icon  = action.icon
  const title = action.keybind ? `${action.label} (${action.keybind})` : action.label
  return (
    <Button
      type={action.type ?? 'button'}
      form={action.form}
      variant={action.variant ?? 'default'}
      size={action.size ?? 'sm'}
      disabled={action.disabled}
      onClick={action.onClick}
      title={title}
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

  const inline   = actions.filter((a) => !a.overflow)
  const overflow = actions.filter((a) =>  a.overflow)

  const mobilePrimary   = inline.filter((a) => a.primary !== false)
  const mobileSecondary = [...inline.filter((a) => a.primary === false), ...overflow]

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

        {/* Desktop: inline como botões + dropdown ⋯ para overflow */}
        <div className="hidden md:flex items-center gap-2">
          {inline.map((action, i) => <ActionButton key={i} action={action} />)}

          {overflow.length > 0 && (
            <Dropdown
              align="end"
              side="bottom"
              trigger={
                <Button variant="outline" size="sm" aria-label="Mais ações">
                  <MoreHorizontal className="w-3.5 h-3.5" />
                </Button>
              }
            >
              {overflow.map((action, i) => {
                const Icon = action.icon
                return (
                  <DropdownItem key={i} onClick={action.onClick} disabled={action.disabled}>
                    {Icon && <Icon className="w-4 h-4" />}
                    {action.label}
                  </DropdownItem>
                )
              })}
            </Dropdown>
          )}
        </div>

        {/* Mobile: primários (ícone-only) + dropdown ⋯ para secundários e overflow */}
        <div className="flex md:hidden items-center gap-2">
          {mobilePrimary.map((action, i) => <ActionButton key={i} action={action} />)}

          {mobileSecondary.length > 0 && (
            <Dropdown
              align="end"
              side="bottom"
              trigger={
                <Button variant="outline" size="sm" aria-label="Mais ações">
                  <MoreHorizontal className="w-3.5 h-3.5" />
                </Button>
              }
            >
              {mobileSecondary.map((action, i) => {
                const Icon = action.icon
                return (
                  <DropdownItem key={i} onClick={action.onClick} disabled={action.disabled}>
                    {Icon && <Icon className="w-4 h-4" />}
                    {action.label}
                  </DropdownItem>
                )
              })}
            </Dropdown>
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
