'use client'

import { useState, useEffect, useRef, forwardRef, useImperativeHandle, type ReactNode } from 'react'
import { ChevronLeft, ChevronRight } from 'lucide-react'
import { cn } from '@/lib/utils'
import { useKeywatch } from '@/lib/keywatch/context'

export interface TabItem {
  label:   string
  content: ReactNode
}

export interface TabsHandle {
  switchTo: (index: number) => void
}

interface TabsProps {
  tabs:       TabItem[]
  className?: string
}

export const Tabs = forwardRef<TabsHandle, TabsProps>(function Tabs({ tabs, className }, ref) {
  const [active, setActive]  = useState(0)
  const panelRefs            = useRef<(HTMLDivElement | null)[]>([])
  const { coreRef }          = useKeywatch()
  const groupRef             = useRef(`tabs-${Math.random().toString(36).slice(2, 8)}`)
  const activeRef            = useRef(active)
  const skipAutoFocus        = useRef(false)

  useEffect(() => { activeRef.current = active })

  function activate(i: number) {
    if (i < 0 || i >= tabs.length) return
    setActive(i)
  }

  const activateRef = useRef(activate)
  useEffect(() => { activateRef.current = activate })

  useImperativeHandle(ref, () => ({
    switchTo(i: number) {
      if (i < 0 || i >= tabs.length || i === activeRef.current) return
      skipAutoFocus.current = true
      activate(i)
    },
  }))

  useEffect(() => {
    if (skipAutoFocus.current) {
      skipAutoFocus.current = false
      return
    }
    panelRefs.current[active]
      ?.querySelector<HTMLElement>(
        'input:not([type="hidden"]):not([disabled]):not([readonly]), select:not([disabled]), textarea:not([disabled]):not([readonly])',
      )
      ?.focus()
  }, [active])

  // Keyboard navigation
  useEffect(() => {
    const core = coreRef.current
    if (!core) return
    const group = groupRef.current

    core.bind('alt+[', () => {
      activateRef.current(Math.max(0, activeRef.current - 1))
    }, {
      desc:    'Tab - Aba anterior',
      icon:    ChevronLeft,
      group,
      origin:  'apps/web/src/components/ui/tabs',
    })

    core.bind('alt+]', () => {
      activateRef.current(Math.min(tabs.length - 1, activeRef.current + 1))
    }, {
      desc:    'Tab - Próxima aba',
      icon:    ChevronRight,
      group,
      origin:  'apps/web/src/components/ui/tabs',
    })

    return () => { core.unbindGroup(group) }
  }, [tabs.length]) // eslint-disable-line react-hooks/exhaustive-deps

  return (
    <div className={cn('', className)}>
      <div className="flex border-b mb-5">
        {tabs.map((tab, i) => (
          <button
            key={tab.label}
            type="button"
            onClick={() => activate(i)}
            className={cn(
              'flex items-center gap-1.5 px-4 py-2 text-sm font-medium border-b-2 -mb-px transition-colors',
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
})
