'use client'

import { useEffect, useRef } from 'react'
import { useRouter } from 'next/navigation'
import { Home, PanelLeft, RefreshCw } from 'lucide-react'
import { useQueryClient } from '@tanstack/react-query'
import { useShortcut } from '@/lib/keywatch'
import { useToastContext } from '@/lib/toast-context'
import { useSidebar } from './sidebar-context'

function toYMD(d: Date): string {
  return d.toISOString().split('T')[0]
}

function dateFromField(value: string): Date {
  if (!value) return new Date()
  const d = new Date(value + 'T00:00:00')
  return isNaN(d.getTime()) ? new Date() : d
}

export function GlobalShortcuts() {
  const router      = useRouter()
  const { toggle }  = useSidebar()
  const queryClient = useQueryClient()
  const { toasts, remove } = useToastContext()
  const toastsRef   = useRef(toasts)
  useEffect(() => { toastsRef.current = toasts }, [toasts])

  useEffect(() => {
    function onKeyDown(e: KeyboardEvent) {
      if (e.ctrlKey || e.metaKey || e.altKey) return
      if (!(e.target instanceof HTMLInputElement) || e.target.type !== 'date') return

      const key = e.key
      if (key !== 't' && key !== '-' && key !== '+') return

      const input = e.target
      e.preventDefault()

      const base = dateFromField(input.value)
      if (key === '-') base.setDate(base.getDate() - 1)
      if (key === '+') base.setDate(base.getDate() + 1)

      const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')?.set
      setter?.call(input, toYMD(key === 't' ? new Date() : base))
      input.dispatchEvent(new Event('input', { bubbles: true }))
    }

    document.addEventListener('keydown', onKeyDown)
    return () => document.removeEventListener('keydown', onKeyDown)
  }, [])

  // duplo-esc: perde foco do controle (se houver) e fecha toasts persistentes
  // (autoDismiss: false, ex. erros) — não passa por useShortcut de propósito,
  // pra não poluir o modal de atalhos
  useEffect(() => {
    let lastEsc = 0

    function onEscDouble(e: KeyboardEvent) {
      if (e.key !== 'Escape') return

      const now = Date.now()
      const isDouble = now - lastEsc < 300
      lastEsc = isDouble ? 0 : now
      if (!isDouble) return

      const target = e.target
      if (target instanceof HTMLElement) {
        const tag = target.nodeName.toLowerCase()
        if (['input', 'textarea', 'select'].includes(tag)) target.blur()
      }

      for (const t of toastsRef.current) {
        if (!t.autoDismiss) remove(t.id)
      }
    }

    document.addEventListener('keydown', onEscDouble)
    return () => document.removeEventListener('keydown', onEscDouble)
  }, [remove])

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
