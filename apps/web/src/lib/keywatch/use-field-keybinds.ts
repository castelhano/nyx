import { useEffect, useRef, type RefObject } from 'react'
import { useKeywatch } from './context'
import type { TabsHandle } from '@/components/ui/tabs'

export interface FieldKeybind {
  key:      string   // single letter, e.g. 'g'
  fieldId:  string   // matches the input's id attribute
  tabIndex?: number  // tab to switch to before focusing (requires tabsRef)
}

/**
 * Registers Ctrl+Shift+[key] shortcuts that focus form inputs by id.
 * Use this in custom pages that don't go through AutoForm.
 *
 * Pass `tabsRef` + `tabIndex` on each binding to mirror the AutoForm behaviour:
 * the shortcut switches to the correct tab before focusing the field.
 *
 * @param bindings - array of { key, fieldId, tabIndex? } pairs
 * @param origin   - unique string identifying the page/component (used as group id)
 * @param tabsRef  - ref to the Tabs component (required when any binding has tabIndex)
 */
export function useFieldKeybinds(
  bindings: FieldKeybind[],
  origin: string,
  tabsRef?: RefObject<TabsHandle | null>,
) {
  const { coreRef } = useKeywatch()
  const group = useRef(`field-keybinds-${origin}`)

  useEffect(() => {
    const core = coreRef.current
    if (!core || !bindings.length) return
    const g = group.current
    for (const { key, fieldId, tabIndex } of bindings) {
      core.bind(`ctrl+shift+${key}`, () => {
        if (tabIndex !== undefined && tabsRef?.current) {
          tabsRef.current.switchTo(tabIndex)
          requestAnimationFrame(() => document.getElementById(fieldId)?.focus())
        } else {
          ;(document.getElementById(fieldId) as HTMLElement | null)?.focus()
        }
      }, { group: g, display: false })
    }
    return () => { core.unbindGroup(g) }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])
}
