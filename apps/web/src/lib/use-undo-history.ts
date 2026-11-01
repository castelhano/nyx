import { useCallback, useMemo, useRef } from 'react'

/**
 * Snapshot-based undo/redo stack for a page's pending (unsaved) edits.
 *
 * Callers `push()` the state as it was right *before* a change, then hand the
 * current state to `undo()`/`redo()` and apply whatever comes back. Snapshots are
 * kept in refs — nothing re-renders when the stacks change.
 */
export function useUndoHistory<T>(limit = 50) {
  const past   = useRef<T[]>([])
  const future = useRef<T[]>([])

  const push = useCallback((snapshot: T) => {
    past.current.push(snapshot)
    if (past.current.length > limit) past.current.shift()
    // a new change invalidates the redo branch
    future.current = []
  }, [limit])

  const undo = useCallback((current: T): T | null => {
    const prev = past.current.pop()
    if (prev === undefined) return null
    future.current.push(current)
    return prev
  }, [])

  const redo = useCallback((current: T): T | null => {
    const next = future.current.pop()
    if (next === undefined) return null
    past.current.push(current)
    return next
  }, [])

  const clear = useCallback(() => {
    past.current   = []
    future.current = []
  }, [])

  return useMemo(() => ({ push, undo, redo, clear }), [push, undo, redo, clear])
}

/**
 * Keywatch fires ctrl shortcuts even with a form field focused — undo/redo
 * handlers bail out there so the field keeps its native ctrl+z.
 */
export function isEditableTarget(ev: KeyboardEvent) {
  const el = ev.target as HTMLElement | null
  if (!el) return false
  return ['INPUT', 'TEXTAREA', 'SELECT'].includes(el.nodeName) || el.isContentEditable
}
