'use client'

import { useState, useEffect, useRef, type ReactNode } from 'react'
import { cn } from '@/lib/utils'

export interface TabItem {
  label:   string
  content: ReactNode
}

interface TabsProps {
  tabs:       TabItem[]
  className?: string
}

export function Tabs({ tabs, className }: TabsProps) {
  const [active, setActive]   = useState(0)
  const panelRefs             = useRef<(HTMLDivElement | null)[]>([])

  useEffect(() => {
    panelRefs.current[active]
      ?.querySelector<HTMLElement>(
        'input:not([type="hidden"]):not([disabled]):not([readonly]), select:not([disabled]), textarea:not([disabled]):not([readonly])',
      )
      ?.focus()
  }, [active])

  return (
    <div className={cn('', className)}>
      <div className="flex border-b mb-5">
        {tabs.map((tab, i) => (
          <button
            key={tab.label}
            type="button"
            onClick={() => setActive(i)}
            className={cn(
              'px-4 py-2 text-sm font-medium border-b-2 -mb-px transition-colors',
              i === active
                ? 'border-ring text-ring'
                : 'border-transparent text-muted-foreground hover:text-foreground',
            )}
          >
            {tab.label}
          </button>
        ))}
      </div>
      {tabs.map((tab, i) => (
        <div key={tab.label} ref={(el) => { panelRefs.current[i] = el }} hidden={i !== active}>
          {tab.content}
        </div>
      ))}
    </div>
  )
}
