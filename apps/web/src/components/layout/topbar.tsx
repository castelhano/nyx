'use client'

import { PanelLeft, Bell, Sun, Moon } from 'lucide-react'
import { useTheme } from 'next-themes'
import { cn } from '@/lib/utils'
import { useSidebar } from './sidebar-context'

export function Topbar() {
  const { toggle } = useSidebar()
  const { theme, setTheme } = useTheme()

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

      {/* Center — reserved for page controls */}
      <div id="topbar-center" className="flex-1" />

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
