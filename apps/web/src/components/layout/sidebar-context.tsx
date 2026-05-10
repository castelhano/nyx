'use client'

import { createContext, useContext, useState } from 'react'

interface SidebarContextValue {
  isOpen: boolean
  toggle: () => void
  close:  () => void
}

const SidebarContext = createContext<SidebarContextValue>({ isOpen: true, toggle: () => {}, close: () => {} })

export function SidebarProvider({ children }: { children: React.ReactNode }) {
  const [isOpen, setIsOpen] = useState(true)
  return (
    <SidebarContext.Provider value={{ isOpen, toggle: () => setIsOpen((p) => !p), close: () => setIsOpen(false) }}>
      {children}
    </SidebarContext.Provider>
  )
}

export const useSidebar = () => useContext(SidebarContext)
