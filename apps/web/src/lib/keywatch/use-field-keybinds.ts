import { useEffect, useRef } from 'react'
import { useKeywatch } from './context'

export interface FieldKeybind {
  key:     string  // single letter, e.g. 'g'
  fieldId: string  // matches the input's id attribute
}

/**
 * Registers Ctrl+Shift+[key] shortcuts that focus form inputs by id.
 * Use this in custom pages that don't go through AutoForm.
 *
 * @param bindings - array of { key, fieldId } pairs
 * @param origin   - unique string identifying the page/component (used as group id)
 */
export function useFieldKeybinds(bindings: FieldKeybind[], origin: string) {
  const { coreRef } = useKeywatch()
  const group = useRef(`field-keybinds-${origin}`)

  useEffect(() => {
    const core = coreRef.current
    if (!core || !bindings.length) return
    const g = group.current
    for (const { key, fieldId } of bindings) {
      core.bind(`ctrl+shift+${key}`, () => {
        ;(document.getElementById(fieldId) as HTMLElement | null)?.focus()
      }, { group: g })
    }
    return () => { core.unbindGroup(g) }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])
}
