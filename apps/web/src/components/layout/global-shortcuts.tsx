'use client'

import { useRouter } from 'next/navigation'
import { Home, PanelLeft } from 'lucide-react'
import { useShortcut } from '@/lib/keywatch'
import { useSidebar } from './sidebar-context'

export function GlobalShortcuts() {
  const router = useRouter()
  const { toggle } = useSidebar()

  useShortcut('alt+i', () => router.push('/'), {
    desc:   'Ir para Início',
    icon:   Home,
    origin: 'apps/web/src/components/layout/global-shortcuts',
    order:  1,
  })

  useShortcut("ctrl+'", toggle, {
    desc:   'Toggle sidebar',
    icon:   PanelLeft,
    origin: 'apps/web/src/components/layout/global-shortcuts',
    order:  2,
  })

  return null
}
