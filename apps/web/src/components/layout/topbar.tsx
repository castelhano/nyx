'use client'

import { Icons } from '@/lib/icons'
import { useTheme } from 'next-themes'
import { cn } from '@/lib/utils'
import { Button } from '@/components/ui/button'
import { Dropdown, DropdownItem, DropdownLabel, DropdownSeparator } from '@/components/ui/dropdown'
import { useSidebar } from './sidebar-context'
import { useTopbarActionsContext, type TopbarAction } from './topbar-actions-context'
import { BackgroundJobs } from './background-jobs'

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
      className={action.className}
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

// Toggle marker for checkable menu items — muted ring when off, filled with the theme's
// accent (plus its foreground as border, so it stays visible on the hovered row) when on.
function CheckCircle({ checked }: { checked: boolean }) {
  return (
    <span
      aria-hidden
      className={cn(
        'w-3.5 h-3.5 shrink-0 rounded-full border',
        checked ? 'bg-accent border-accent-foreground' : 'border-muted-foreground/50',
      )}
    />
  )
}

function MenuItems({ action }: { action: TopbarAction }) {
  const itemTextSize = menuTextSize[action.size ?? 'sm']
  return (
    <>
      {action.menu!.map((item, i) => {
        if (item.separator) return <DropdownSeparator key={i} />
        const ItemIcon  = item.icon
        const checkable = item.checked !== undefined
        return (
          <DropdownItem
            key={i} onClick={item.onClick} disabled={item.disabled} className={itemTextSize}
            keepOpen={checkable}
          >
            {checkable ? <CheckCircle checked={!!item.checked} /> : ItemIcon && <ItemIcon className="w-4 h-4" />}
            {item.label}
          </DropdownItem>
        )
      })}
    </>
  )
}

// Menu-only button — the whole button (label + chevron) opens the dropdown.
function MenuActionButton({ action }: { action: TopbarAction }) {
  const Icon = action.icon
  return (
    <Dropdown
      align="end"
      side="bottom"
      trigger={
        <Button
          type="button"
          variant={action.variant ?? 'default'}
          size={action.size ?? 'sm'}
          disabled={action.disabled}
          title={action.label}
          className={action.className}
        >
          {Icon && <Icon className="w-3.5 h-3.5" />}
          <span className="hidden md:inline">{action.label}</span>
          <Icons.ChevronDown className="w-3.5 h-3.5" />
        </Button>
      }
    >
      <MenuItems action={action} />
    </Dropdown>
  )
}

function SplitActionButton({ action }: { action: TopbarAction }) {
  const Icon = action.icon
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
            disabled={action.menu!.every((item) => item.separator || item.disabled)}
            className="rounded-l-none border-l border-background/20 px-1.5 focus:ring-1 focus:ring-offset-0"
            aria-label="Mais opções"
          >
            <Icons.ChevronDown className="w-3.5 h-3.5" />
          </Button>
        }
      >
        <MenuItems action={action} />
      </Dropdown>
    </div>
  )
}

const STATUS_TONE = {
  loading: 'text-muted-foreground',
  ok:      'text-emerald-600 dark:text-emerald-400',
  warning: 'text-amber-600 dark:text-amber-400',
  error:   'text-red-600 dark:text-red-400',
} as const

function StatusActionButton({ action }: { action: TopbarAction }) {
  const { loading, groups } = action.status!
  const items = groups.flatMap(g => g.items)
  const tone  = loading ? 'loading'
    : items.some(i => i.severity === 'error') ? 'error'
    : items.length > 0 ? 'warning'
    : 'ok'
  const Icon  = tone === 'loading' ? Icons.Loader2 : tone === 'ok' ? Icons.CheckCircle : Icons.AlertCircle
  const title = loading ? `${action.label} — verificando…`
    : items.length ? `${action.label} (${items.length})`
    : `${action.label} — nenhuma`

  return (
    <Dropdown
      align="start"
      side="bottom"
      className="w-96 max-h-[70vh] overflow-y-auto"
      trigger={
        <button
          type="button"
          title={title}
          aria-label={title}
          className={cn(
            'flex h-8 items-center gap-1 rounded-md px-2 hover:bg-accent transition-colors focus:outline-none',
            STATUS_TONE[tone],
          )}
        >
          <Icon className={cn('h-4 w-4', tone === 'loading' && 'animate-spin')} />
          {!loading && items.length > 0 && <span className="text-xs font-medium tabular-nums">{items.length}</span>}
        </button>
      }
    >
      {loading || items.length === 0 ? (
        <p className="px-2 py-1.5 text-sm text-muted-foreground">{loading ? 'Verificando…' : `${action.label}: nenhuma`}</p>
      ) : groups.filter(g => g.items.length > 0).map((g, gi) => [
        <DropdownLabel key={`l${gi}`}>{g.label}</DropdownLabel>,
        ...g.items.map((item, ii) => (
          <DropdownItem key={`${gi}:${ii}`} onClick={item.onClick} disabled={!item.onClick}>
            <Icons.AlertCircle className={cn('h-3.5 w-3.5 shrink-0 self-start mt-0.5', STATUS_TONE[item.severity])} />
            <span className="flex flex-col min-w-0">
              <span>{item.label}</span>
              {item.detail && <span className="text-xs text-muted-foreground">{item.detail}</span>}
            </span>
          </DropdownItem>
        )),
      ])}
    </Dropdown>
  )
}

// Um mesmo action.separator se adapta ao contexto onde é renderizado: barra
// vertical numa fileira de botões (desktop inline, ícones do mobile), traço
// horizontal dentro de uma lista de dropdown (overflow ou menu secundário do
// mobile) — o autor da página declara uma vez só, sem se preocupar com tela.
function renderRowAction(action: TopbarAction, key: number) {
  if (action.separator) return <div key={key} className="w-px h-5 bg-border shrink-0" />
  if (action.status) return <StatusActionButton key={key} action={action} />
  if (action.menu && action.menuOnly) return <MenuActionButton key={key} action={action} />
  return action.menu
    ? <SplitActionButton key={key} action={action} />
    : <ActionButton key={key} action={action} />
}

function renderListAction(action: TopbarAction, key: number) {
  if (action.separator) return <DropdownSeparator key={key} />
  // a menu-only action has no action of its own — list its items instead
  if (action.menu && action.menuOnly) return <MenuItems key={key} action={action} />
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

  const mobilePrimary   = endInline.filter((a) => a.primary !== false || a.status)
  const mobileSecondary = [...endInline.filter((a) => a.primary === false && !a.status), ...overflow]

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
        <Icons.PanelLeft className="h-4 w-4" />
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
                  <Icons.MoreHorizontal className="w-3.5 h-3.5" />
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
                  <Icons.MoreHorizontal className="w-3.5 h-3.5" />
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
        <BackgroundJobs />
        <button
          onClick={() => setTheme(theme === 'dark' ? 'light' : 'dark')}
          className={cn(
            'flex h-8 w-8 items-center justify-center rounded-md',
            'text-muted-foreground hover:bg-accent hover:text-accent-foreground',
            'transition-colors focus:outline-none',
          )}
          aria-label="Toggle theme"
        >
          {theme === 'dark' ? <Icons.Sun className="h-4 w-4" /> : <Icons.Moon className="h-4 w-4" />}
        </button>

        <button
          className={cn(
            'flex h-8 w-8 items-center justify-center rounded-md',
            'text-muted-foreground hover:bg-accent hover:text-accent-foreground',
            'transition-colors focus:outline-none',
          )}
          aria-label="Notificações"
        >
          <Icons.Bell className="h-4 w-4" />
        </button>
      </div>

    </header>
  )
}
