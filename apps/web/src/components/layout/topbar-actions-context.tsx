'use client'

import { createContext, useContext, useState, useEffect, type ReactNode, type DependencyList } from 'react'

// { separator: true } draws a horizontal divider between groups of menu items
export type TopbarMenuItem =
  | { separator: true }
  | { separator?: never; label: string; icon?: React.ElementType; onClick: () => void; disabled?: boolean; checked?: boolean }

// A page's problem list behind one indicator (e.g. the vehicle plan's pendências) — the
// indicator's color follows the worst item, green when there's none, neutral while loading.
export interface TopbarStatusItem {
  label:    string
  detail?:  string
  severity: 'warning' | 'error'
  onClick?: () => void
}

export interface TopbarStatus {
  loading?: boolean
  groups:   { label: string; items: TopbarStatusItem[] }[]
}

export interface TopbarAction {
  // opcional só para { separator: true } — todo botão real precisa de label
  label?:    string
  icon?:     React.ElementType
  onClick?:  () => void
  type?:     'submit'
  form?:     string
  disabled?: boolean
  variant?:  'default' | 'outline' | 'ghost' | 'destructive'
  size?:     'sm' | 'default' | 'lg' | 'icon'
  keybind?:  string   // ex: 'Alt+F9' — exibido no title do botão
  // primary: sempre visível no mobile; false: colapsa no menu ⋯
  primary?:  boolean
  // overflow: sempre no dropdown ⋯, mesmo em desktop
  overflow?: boolean
  // position: 'start' alinha à esquerda antes do separador; 'end' (padrão) agrupa à direita
  position?: 'start' | 'end'
  // separator: divisor entre grupos — vertical numa fileira de botões, horizontal
  // dentro de um dropdown; a mesma declaração se adapta ao contexto (ver topbar.tsx)
  separator?: boolean
  // menu: quando presente, o botão vira um split-button — clique principal mantém
  // onClick normal, e um chevron ao lado abre um dropdown com estes itens
  // checked: when defined, the item is a toggle — rendered with a check circle and the
  // menu stays open on click
  menu?: TopbarMenuItem[]
  // menuOnly: the whole button opens the menu (no main action; onClick is ignored)
  menuOnly?: boolean
  // className: extra classes on the button itself (e.g. a fixed width for a toggle whose
  // label changes, so the topbar doesn't reflow)
  className?: string
  // status: renders the action as a problem indicator (count + color) whose dropdown lists
  // the items; label is the dropdown's title. Never collapses into the ⋯ menu.
  status?: TopbarStatus
}

interface TopbarActionsContextValue {
  actions:    TopbarAction[]
  setActions: (actions: TopbarAction[]) => void
}

const TopbarActionsContext = createContext<TopbarActionsContextValue>({
  actions:    [],
  setActions: () => {},
})

export function TopbarActionsProvider({ children }: { children: ReactNode }) {
  const [actions, setActions] = useState<TopbarAction[]>([])
  return (
    <TopbarActionsContext.Provider value={{ actions, setActions }}>
      {children}
    </TopbarActionsContext.Provider>
  )
}

export function useTopbarActionsContext() {
  return useContext(TopbarActionsContext)
}

export function useTopbarActions(actions: TopbarAction[], deps: DependencyList = []) {
  const { setActions } = useTopbarActionsContext()
  useEffect(() => { setActions(actions) }, deps)           // eslint-disable-line react-hooks/exhaustive-deps
  useEffect(() => () => { setActions([]) }, [])            // eslint-disable-line react-hooks/exhaustive-deps
}
