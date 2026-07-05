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
