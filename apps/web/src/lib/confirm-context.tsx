'use client'

import { createContext, useContext, useState, useCallback, useEffect, type ReactNode } from 'react'
import { ConfirmModal, type ConfirmModalOptions } from '@/components/ui/confirm-modal'
import { getKeywatchCore } from './keywatch/context'

interface PendingConfirm {
  options:   ConfirmModalOptions
  resolve:   (confirmed: boolean) => void
}

interface ConfirmContextValue {
  confirm: (options: ConfirmModalOptions) => Promise<boolean>
}

const ConfirmContext = createContext<ConfirmContextValue | null>(null)

export function ConfirmProvider({ children }: { children: ReactNode }) {
  const [pending, setPending] = useState<PendingConfirm | null>(null)

  useEffect(() => {
    const core = getKeywatchCore()
    if (!core || !pending) return
    core.setContext('modal', 'Modal de confirmação')
    return () => { core.setContext() }
  }, [pending])

  const confirm = useCallback((options: ConfirmModalOptions): Promise<boolean> => {
    return new Promise((resolve) => {
      setPending({ options, resolve })
    })
  }, [])

  function handleConfirm() {
    pending?.resolve(true)
    setPending(null)
  }

  function handleCancel() {
    pending?.resolve(false)
    setPending(null)
  }

  return (
    <ConfirmContext.Provider value={{ confirm }}>
      {children}
      {pending && (
        <ConfirmModal
          {...pending.options}
          onConfirm={handleConfirm}
          onCancel={handleCancel}
        />
      )}
    </ConfirmContext.Provider>
  )
}

export function useConfirm() {
  const ctx = useContext(ConfirmContext)
  if (!ctx) throw new Error('useConfirm must be used inside ConfirmProvider')
  return ctx.confirm
}
