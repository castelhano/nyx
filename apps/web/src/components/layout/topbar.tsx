'use client'

import { PanelLeft, Bell, Sun, Moon, MoreHorizontal, ChevronDown } from 'lucide-react'
import { useTheme } from 'next-themes'
import { cn } from '@/lib/utils'
import { Button } from '@/components/ui/button'
import { Dropdown, DropdownItem, DropdownSeparator } from '@/components/ui/dropdown'
import { useSidebar } from './sidebar-context'
import { useTopbarActionsContext, type TopbarAction } from './topbar-actions-context'

function ActionButton({ action }: { action: TopbarAction }) {
  const Icon     = action.icon
  const iconOnly = action.size === 'icon'
  const title    = action.keybind ? `${action.label} (${action.keybind})` : action.label
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
      {!iconOnly && <span className="hidden md:inline">{action.label}</span>}
    </Button>
  )
}

// Split-button — mesmo botão de ação principal + um chevron que abre um dropdown
// com itens extras (action.menu). Usado quando uma ação de topbar precisa oferecer
// opções relacionadas sem virar vários botões separados.
// Espelha o mapeamento de tamanho→fonte do Button (sizes.sm/default/lg em button.tsx)
// para que os itens do dropdown herdem o mesmo tamanho de texto do botão que os abre.
const menuTextSize: Record<NonNullable<TopbarAction['size']>, string> = {
  sm:      'text-xs',
  default: 'text-sm',
  lg:      'text-sm',
  icon:    'text-xs',
}

function SplitActionButton({ action }: { action: TopbarAction }) {
  const Icon = action.icon
  const itemTextSize = menuTextSize[action.size ?? 'sm']
  return (
    <div className="inline-flex items-stretch rounded-md overflow-hidden">
      <Button
        type={action.type ?? 'button'}
        form={action.form}
        variant={action.variant ?? 'default'}
        size={action.size ?? 'sm'}
        disabled={action.disabled}
        onClick={action.onClick}
        title={action.keybind ? `${action.label} (${action.keybind})` : action.label}
        className="rounded-r-none"
      >
        {Icon && <Icon className="w-3.5 h-3.5" />}
        <span className="hidden md:inline">{action.label}</span>
      </Button>
      <Dropdown
        align="end"
        side="bottom"
        trigger={
          <Button
            type="button"
            variant={action.variant ?? 'default'}
            size={action.size ?? 'sm'}
            disabled={action.menu!.every((item) => item.disabled)}
            className="rounded-l-none border-l border-background/20 px-1.5 focus:ring-1 focus:ring-offset-0"
            aria-label="Mais opções"
          >
            <ChevronDown className="w-3.5 h-3.5" />
          </Button>
        }
      >
        {action.menu!.map((item, i) => {
          const ItemIcon = item.icon
          return (
            <DropdownItem key={i} onClick={item.onClick} disabled={item.disabled} className={itemTextSize}>
              {ItemIcon && <ItemIcon className="w-4 h-4" />}
              {item.label}
            </DropdownItem>
          )
        })}
      </Dropdown>
    </div>
  )
}

// Um mesmo action.separator se adapta ao contexto onde é renderizado: barra
// vertical numa fileira de botões (desktop inline, ícones do mobile), traço
// horizontal dentro de uma lista de dropdown (overflow ou menu secundário do
// mobile) — o autor da página declara uma vez só, sem se preocupar com tela.
function renderRowAction(action: TopbarAction, key: number) {
  if (action.separator) return <div key={key} className="w-px h-5 bg-border shrink-0" />
  return action.menu
    ? <SplitActionButton key={key} action={action} />
    : <ActionButton key={key} action={action} />
}

function renderListAction(action: TopbarAction, key: number) {
  if (action.separator) return <DropdownSeparator key={key} />
  const Icon = action.icon
  return (
    <DropdownItem key={key} onClick={action.onClick} disabled={action.disabled}>
      {Icon && <Icon className="w-4 h-4" />}
      {action.label}
    </DropdownItem>
  )
}

export function Topbar() {
  const { toggle } = useSidebar()
  const { theme, setTheme } = useTheme()
  const { actions } = useTopbarActionsContext()

  const startActions = actions.filter((a) => a.position === 'start' && !a.overflow)
  const endInline    = actions.filter((a) => a.position !== 'start' && !a.overflow)
  const overflow     = actions.filter((a) => a.overflow)

  const mobilePrimary   = endInline.filter((a) => a.primary !== false)
  const mobileSecondary = [...endInline.filter((a) => a.primary === false), ...overflow]

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
      <div className="flex flex-1 items-center gap-2 pr-1">

        {/* Start zone — left-aligned, separado do grupo principal */}
        {startActions.length > 0 && (
          <>
            <div className="flex items-center gap-1">
              {startActions.map((action, i) => renderRowAction(action, i))}
            </div>
            <div className="w-px h-5 bg-border shrink-0" />
          </>
        )}

        {/* End zone — desktop: inline + overflow dropdown */}
        <div className="hidden md:flex flex-1 items-center justify-end gap-2">
          {endInline.map((action, i) => renderRowAction(action, i))}

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
              {overflow.map((action, i) => renderListAction(action, i))}
            </Dropdown>
          )}
        </div>

        {/* Mobile: primários (ícone-only) + dropdown ⋯ para secundários e overflow */}
        <div className="flex md:hidden flex-1 items-center justify-end gap-2">
          {mobilePrimary.map((action, i) => renderRowAction(action, i))}

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
              {mobileSecondary.map((action, i) => renderListAction(action, i))}
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
