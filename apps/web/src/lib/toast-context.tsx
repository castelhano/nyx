'use client'

import { createContext, useContext, useState, useCallback, type ReactNode } from 'react'

export type Position =
  | 'bottom-right' | 'bottom-left'
  | 'top-right'    | 'top-left'
  | 'top-center'   | 'bottom-center'

export type Variant = 'success' | 'error' | 'info' | 'warning'

export interface ToastOptions {
  autoDismiss?:      boolean
  autoDismissDelay?: number
  position?:         Position
}

export interface ToastItem {
  id:               string
  message:          string
  variant:          Variant
  autoDismiss:      boolean
  autoDismissDelay: number
  position?:        Position   // undefined → usa o default do provider
}

interface ToastContextValue {
  toasts:                ToastItem[]
  add:                   (message: string, variant: Variant, options?: ToastOptions) => void
  remove:                (id: string) => void
  defaultPosition:       Position
  defaultPositionMobile: Position
}

const ToastContext = createContext<ToastContextValue | null>(null)

interface ToastProviderProps {
  children:               ReactNode
  defaultPosition?:       Position
  defaultPositionMobile?: Position
}

let _counter = 0
function nextId() { return `toast-${++_counter}` }

const VARIANT_DEFAULTS: Record<Variant, Pick<ToastItem, 'autoDismiss' | 'autoDismissDelay'>> = {
  success: { autoDismiss: true,  autoDismissDelay: 6000 },
  info:    { autoDismiss: true,  autoDismissDelay: 6000 },
  warning: { autoDismiss: true,  autoDismissDelay: 10000 },
  error:   { autoDismiss: false, autoDismissDelay: 10000 },
}

export function ToastProvider({
  children,
  defaultPosition       = 'bottom-right',
  defaultPositionMobile = 'bottom-center',
}: ToastProviderProps) {
  const [toasts, setToasts] = useState<ToastItem[]>([])

  const add = useCallback((message: string, variant: Variant, options?: ToastOptions) => {
    const defaults = VARIANT_DEFAULTS[variant]
    const item: ToastItem = {
      id:               nextId(),
      message,
      variant,
      autoDismiss:      options?.autoDismiss      ?? defaults.autoDismiss,
      autoDismissDelay: options?.autoDismissDelay ?? defaults.autoDismissDelay,
      position:         options?.position,
    }
    setToasts((prev) => [...prev.slice(-9), item])
  }, [])

  const remove = useCallback((id: string) => {
    setToasts((prev) => prev.filter((t) => t.id !== id))
  }, [])

  return (
    <ToastContext.Provider value={{ toasts, add, remove, defaultPosition, defaultPositionMobile }}>
      {children}
    </ToastContext.Provider>
  )
}

export function useToastContext() {
  const ctx = useContext(ToastContext)
  if (!ctx) throw new Error('useToastContext deve ser usado dentro de ToastProvider')
  return ctx
}

export function useToast() {
  const { add } = useToastContext()

  const toast = {
    success: (message: string, options?: ToastOptions) => add(message, 'success', options),
    error:   (message: string, options?: ToastOptions) => add(message, 'error',   options),
    info:    (message: string, options?: ToastOptions) => add(message, 'info',    options),
    warning: (message: string, options?: ToastOptions) => add(message, 'warning', options),
  }

  return { toast }
}
