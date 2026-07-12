import type { RouteLocality, PendingPoint } from './types'

// Anchor key for ordering: an existing RouteLocality's id, a pending point's
// _pendingId, or null (insert as the very first stop, before the origin).
export type AnchorKey = string | null

export type OrderedItem =
  | { type: 'existing'; key: string; rl: RouteLocality }
  | { type: 'pending'; key: string; p: PendingPoint }

// Merges persisted stops and not-yet-saved pending points into a single
// ordered list, resolving pending points that anchor onto other pending
// points (a chain of additions made before saving). Pending points sharing
// the same anchor are kept in insertion order.
export function resolveOrder(existing: RouteLocality[], pending: PendingPoint[]): OrderedItem[] {
  const sorted = [...existing].sort((a, b) => a.sequence - b.sequence)

  const byAnchor = new Map<AnchorKey, PendingPoint[]>()
  for (const p of pending) {
    const list = byAnchor.get(p.insertAfterKey)
    if (list) list.push(p)
    else byAnchor.set(p.insertAfterKey, [p])
  }

  function expand(key: AnchorKey): OrderedItem[] {
    const chain = byAnchor.get(key) ?? []
    return chain.flatMap((p) => [{ type: 'pending', key: p._pendingId, p } as OrderedItem, ...expand(p._pendingId)])
  }

  const result: OrderedItem[] = [...expand(null)]
  for (const rl of sorted) {
    result.push({ type: 'existing', key: rl.id, rl })
    result.push(...expand(rl.id))
  }
  return result
}
