'use client'

import { createContext, useContext, useState } from 'react'

interface SidebarContextValue {
  isOpen: boolean
  toggle: () => void
  open:   () => void
  close:  () => void
}

const SidebarContext = createContext<SidebarContextValue>({ isOpen: true, toggle: () => {}, open: () => {}, close: () => {} })

export function SidebarProvider({ children }: { children: React.ReactNode }) {
  const [isOpen, setIsOpen] = useState(true)
  return (
    <SidebarContext.Provider value={{
      isOpen,
      toggle: () => setIsOpen((p) => !p),
      open:   () => setIsOpen(true),
      close:  () => setIsOpen(false),
    }}>
      {children}
    </SidebarContext.Provider>
  )
}

export const useSidebar = () => useContext(SidebarContext)
