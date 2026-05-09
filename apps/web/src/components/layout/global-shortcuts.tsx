'use client'

import { useRouter } from 'next/navigation'
import { Home, PanelLeft, RefreshCw } from 'lucide-react'
import { useQueryClient } from '@tanstack/react-query'
import { useShortcut } from '@/lib/keywatch'
import { useSidebar } from './sidebar-context'

export function GlobalShortcuts() {
  const router      = useRouter()
  const { toggle }  = useSidebar()
  const queryClient = useQueryClient()

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

  useShortcut('alt+l', () => queryClient.invalidateQueries(), {
    desc:   'Atualizar página',
    icon:   RefreshCw,
    origin: 'apps/web/src/components/layout/global-shortcuts',
    order:  3,
  })

  return null
}
