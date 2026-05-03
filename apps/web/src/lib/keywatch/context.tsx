'use client'

import {
  createContext,
  useContext,
  useEffect,
  useRef,
  useState,
  useCallback,
  type RefObject,
} from 'react'
import { KeywatchCore, type CoreOptions } from './core'
import { ShortcutsModal } from './modal'

interface KeywatchContextValue {
  coreRef:        RefObject<KeywatchCore | null>
  isModalOpen:    boolean
  openModal:      () => void
  closeModal:     () => void
  currentContext: string
}

const KeywatchContext = createContext<KeywatchContextValue>({
  coreRef:        { current: null },
  isModalOpen:    false,
  openModal:      () => {},
  closeModal:     () => {},
  currentContext: 'default',
})

interface KeywatchProviderProps {
  children:       React.ReactNode
  options?:       CoreOptions
  shortcutMapKey?: string
}

export function KeywatchProvider({
  children,
  options,
  shortcutMapKey = 'alt+k',
}: KeywatchProviderProps) {
  const coreRef             = useRef<KeywatchCore | null>(null)
  const [isModalOpen,    setIsModalOpen]    = useState(false)
  const [currentContext, setCurrentContext] = useState('default')

  const openModal  = useCallback(() => setIsModalOpen(true),  [])
  const closeModal = useCallback(() => {
    setIsModalOpen(false)
    if (coreRef.current) coreRef.current.pressed = []
  }, [])

  useEffect(() => {
    const core = new KeywatchCore({
      ...options,
      onContextChange: (ctx) => setCurrentContext(ctx),
    })
    coreRef.current = core

    // Atalho para abrir o modal de atalhos
    core.bind(shortcutMapKey, () => setIsModalOpen(true), {
      context: 'all',
      desc:    'Exibir atalhos disponíveis',
      origin:  'Keywatch',
      order:   0,
    })

    const onKeyDown = (ev: KeyboardEvent) => core.handleEvent(ev)
    const onKeyUp   = (ev: KeyboardEvent) => core.handleEvent(ev)
    const onChange  = () => { core.pressed = [] }
    const onFocus   = () => { core.pressed = [] }

    document.addEventListener('keydown', onKeyDown, false)
    document.addEventListener('keyup',   onKeyUp,   false)
    document.addEventListener('change',  onChange,  false)
    window.addEventListener(  'focus',   onFocus,   false)

    return () => {
      document.removeEventListener('keydown', onKeyDown, false)
      document.removeEventListener('keyup',   onKeyUp,   false)
      document.removeEventListener('change',  onChange,  false)
      window.removeEventListener(  'focus',   onFocus,   false)
    }
  }, []) // eslint-disable-line react-hooks/exhaustive-deps

  // Bloqueia o core enquanto o modal estiver aberto
  useEffect(() => {
    if (coreRef.current) coreRef.current.locked = isModalOpen
  }, [isModalOpen])

  return (
    <KeywatchContext.Provider value={{ coreRef, isModalOpen, openModal, closeModal, currentContext }}>
      {children}
      {isModalOpen && <ShortcutsModal onClose={closeModal} />}
    </KeywatchContext.Provider>
  )
}

export function useKeywatch() {
  return useContext(KeywatchContext)
}
