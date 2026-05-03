'use client'

import { useEffect, useRef, type DependencyList, type RefObject } from 'react'
import { useKeywatch } from './context'
import type { HandlerOptions } from './core'

/**
 * Registra um atalho de teclado no contexto da página atual.
 * Faz bind no mount e unbind automático no unmount.
 *
 * @example
 *   useShortcut('ctrl+s', () => save(), { desc: 'Salvar', group: 'form-cliente' })
 *   useShortcut('alt+n',  () => openNew(), { desc: 'Novo registro', context: 'default' })
 */
export function useShortcut(
  scope:   string,
  handler: (ev: KeyboardEvent) => void,
  options: HandlerOptions & { enabled?: boolean } = {},
) {
  const { coreRef }          = useKeywatch()
  const handlerRef           = useRef(handler)
  const { enabled = true, ...opts } = options

  // Mantém o callback sempre atualizado sem re-registrar
  useEffect(() => { handlerRef.current = handler })

  // Grupo único por instância do hook para cleanup cirúrgico
  const groupRef = useRef(`_hook_${Math.random().toString(36).slice(2, 9)}`)

  useEffect(() => {
    const core = coreRef.current
    if (!core || !enabled) return

    const wrapped = (ev: KeyboardEvent) => handlerRef.current(ev)

    core.bind(scope, wrapped, {
      ...opts,
      group: opts.group ?? groupRef.current,
    })

    return () => { core.unbindGroup(groupRef.current) }
  }, [scope, enabled]) // eslint-disable-line react-hooks/exhaustive-deps
}

/**
 * Controla o contexto ativo do Keywatch para uma seção da UI.
 * Empilha o contexto no mount e restaura o anterior no unmount.
 *
 * @example
 *   useShortcutContext('modal', 'Atalhos do modal')
 */
export function useShortcutContext(context: string, desc = '') {
  const { coreRef } = useKeywatch()

  useEffect(() => {
    const core = coreRef.current
    if (!core) return
    core.setContext(context, desc)
    return () => { core.setContext() }
  }, [context]) // eslint-disable-line react-hooks/exhaustive-deps
}
