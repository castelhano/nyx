const API_BASE = process.env.NEXT_PUBLIC_API_URL ?? 'http://localhost:3001/api'

export function getToken(): string {
  if (typeof window === 'undefined') return ''
  return localStorage.getItem('token') ?? sessionStorage.getItem('token') ?? ''
}

export function setToken(token: string, persistent = true) {
  if (persistent) {
    localStorage.setItem('token', token)
    document.cookie = `token=${token}; path=/; max-age=${60 * 60 * 24 * 7}; SameSite=Lax`
  } else {
    sessionStorage.setItem('token', token)
    document.cookie = `token=${token}; path=/; SameSite=Lax`
  }
}

export function clearToken() {
  localStorage.removeItem('token')
  sessionStorage.removeItem('token')
  document.cookie = 'token=; path=/; max-age=0'
}

export async function apiFetch(path: string, options: RequestInit = {}): Promise<Response> {
  const res = await fetch(`${API_BASE}${path}`, {
    ...options,
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${getToken()}`,
      ...options.headers,
    },
  })

  if (res.status === 401 && typeof window !== 'undefined') {
    clearToken()
    window.location.href = '/login'
  }

  return res
}

export async function login(username: string, password: string, persistent = true): Promise<void> {
  const res = await fetch(`${API_BASE}/auth/login`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ username, password }),
  })

  if (!res.ok) throw new Error('Invalid credentials')

  const { accessToken } = await res.json()
  setToken(accessToken, persistent)
}
