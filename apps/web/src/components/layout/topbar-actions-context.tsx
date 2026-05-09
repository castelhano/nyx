'use client'

import { createContext, useContext, useState, useEffect, type ReactNode, type DependencyList } from 'react'

interface TopbarActionsContextValue {
  actions:    ReactNode
  setActions: (node: ReactNode) => void
}

const TopbarActionsContext = createContext<TopbarActionsContextValue>({
  actions:    null,
  setActions: () => {},
})

export function TopbarActionsProvider({ children }: { children: ReactNode }) {
  const [actions, setActions] = useState<ReactNode>(null)
  return (
    <TopbarActionsContext.Provider value={{ actions, setActions }}>
      {children}
    </TopbarActionsContext.Provider>
  )
}

export function useTopbarActionsContext() {
  return useContext(TopbarActionsContext)
}

export function useTopbarActions(node: ReactNode, deps: DependencyList = []) {
  const { setActions } = useTopbarActionsContext()

  // Update slot when deps change
  useEffect(() => {
    setActions(node)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, deps)

  // Clear slot on unmount
  useEffect(() => () => { setActions(null) }, []) // eslint-disable-line
}
