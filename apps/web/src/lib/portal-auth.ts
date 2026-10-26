import { extractError } from '@/lib/utils'

// The crew portal's session — its own token (never the staff one), kept on the device

const API_BASE = process.env.NEXT_PUBLIC_API_URL ?? '/api'
const KEY = 'portalToken'

export function getPortalToken(): string {
  if (typeof window === 'undefined') return ''
  return localStorage.getItem(KEY) ?? ''
}

export function clearPortalToken(): void {
  localStorage.removeItem(KEY)
}

// matrícula + PIN — throws with the server's message (wrong PIN, locked access…)
export async function portalLogin(code: string, pin: string): Promise<{ mustChangePin: boolean }> {
  const res = await fetch(`${API_BASE}/portal/auth/login`, {
    method:  'POST',
    headers: { 'Content-Type': 'application/json' },
    body:    JSON.stringify({ code, pin }),
  })
  const json = await res.json().catch(() => ({}))
  if (!res.ok) throw new Error(extractError(json, 'Matrícula ou PIN inválido'))
  localStorage.setItem(KEY, json.token)
  return { mustChangePin: !!json.mustChangePin }
}

// an authenticated portal call — the JSON answer, or throws with the server's message; a lost
// session goes back to the login
export async function portalFetch<T>(path: string, init: { method?: string; body?: unknown } = {}): Promise<T> {
  const res = await fetch(`${API_BASE}/portal${path}`, {
    method:  init.method ?? 'GET',
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${getPortalToken()}` },
    body:    init.body === undefined ? undefined : JSON.stringify(init.body),
  })
  if (res.status === 401) {
    clearPortalToken()
    window.location.replace('/login?acesso=operador')
  }
  if (res.status === 204) return undefined as T
  const json = await res.json().catch(() => ({}))
  if (!res.ok) throw new Error(extractError(json, 'Não foi possível concluir — tente de novo'))
  return json as T
}
