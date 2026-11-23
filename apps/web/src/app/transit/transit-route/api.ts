import { apiFetch } from '@/lib/auth'

export async function apiPost(path: string, body?: unknown): Promise<unknown> {
  const res = await apiFetch(path, { method: 'POST', ...(body !== undefined ? { body: JSON.stringify(body) } : {}) })
  if (!res.ok) throw await res.json()
  return res.status === 204 ? undefined : res.json()
}

export async function apiPatch(path: string, body: unknown): Promise<unknown> {
  const res = await apiFetch(path, { method: 'PATCH', body: JSON.stringify(body) })
  if (!res.ok) throw await res.json()
  return res.json()
}

export async function apiDelete(path: string): Promise<void> {
  const res = await apiFetch(path, { method: 'DELETE' })
  if (!res.ok) throw await res.json()
}

// what POST /transit-route/:id/reprocess reports when the primary route's official km changed
export interface ExtensionChange { lineId: string; direction: string; fromKm: number | null; toKm: number }

export async function reprocessRoute(routeId: string, body?: { forceAll?: boolean }): Promise<ExtensionChange | null> {
  const res = await apiPost(`/transit/transit-route/${routeId}/reprocess`, body) as { extensionChange?: ExtensionChange | null }
  return res?.extensionChange ?? null
}
