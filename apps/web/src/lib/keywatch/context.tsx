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
import { Icons } from '@/lib/icons'
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

// Acesso ao core fora da subárvore do Provider (ex: ConfirmProvider, montado
// acima do AppLayout para sobreviver à ausência de KeywatchProvider em /login e no SSR)
let activeCore: KeywatchCore | null = null
export function getKeywatchCore(): KeywatchCore | null { return activeCore }

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
  const [isModalOpen,    setIsModalOpen]    = useState(false)
  const [currentContext, setCurrentContext] = useState('default')

  const openModal  = useCallback(() => setIsModalOpen(true),  [])
  const closeModal = useCallback(() => {
    setIsModalOpen(false)
    if (coreRef.current) coreRef.current.pressed = []
  }, [])

  // Inicialização lazy síncrona — core disponível antes de qualquer effect filho.
  // The documented React exception (react.dev/reference/react/useRef#avoiding-recreating-the-ref-contents):
  // guarded by `=== null`, safe under Strict Mode's double-render.
  const coreRef = useRef<KeywatchCore | null>(null)
  // eslint-disable-next-line react-hooks/refs
  if (coreRef.current === null) {
    const core = new KeywatchCore({
      ...options,
      onContextChange: (ctx) => setCurrentContext(ctx),
    })
    core.bind(shortcutMapKey, () => setIsModalOpen(true), {
      context: 'all',
      desc:    'Exibir atalhos disponíveis',
      icon:    Icons.Keyboard,
      origin:  'Keywatch',
      order:   0,
    })
    // eslint-disable-next-line react-hooks/refs, react-hooks/immutability
    coreRef.current = core
  }

  useEffect(() => {
    const core = coreRef.current!
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
  }, [])

  // Blocks the core while the modal is open — mutates the non-React
  // KeywatchCore instance from inside an effect, not during render
  useEffect(() => {
    // eslint-disable-next-line react-hooks/immutability
    if (coreRef.current) coreRef.current.locked = isModalOpen
  }, [isModalOpen])

  useEffect(() => {
    activeCore = coreRef.current
    return () => { activeCore = null }
  }, [])

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
