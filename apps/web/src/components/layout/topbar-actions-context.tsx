'use client'

import { createContext, useContext, useState, useEffect, type ReactNode, type DependencyList } from 'react'

export interface TopbarAction {
  label:     string
  icon?:     React.ElementType
  onClick?:  () => void
  type?:     'submit'
  form?:     string
  disabled?: boolean
  variant?:  'default' | 'outline' | 'ghost'
  // primary: sempre visível no mobile; false: colapsa no menu ⋯
  primary?:  boolean
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
