import { clsx, type ClassValue } from 'clsx'
import { twMerge } from 'tailwind-merge'

export function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs))
}

export function extractError(json: Record<string, unknown>): string {
  const outer   = json?.message
  const payload = (outer && typeof outer === 'object' && !Array.isArray(outer))
    ? (outer as Record<string, unknown>)
    : json
  const msg = payload?.message ?? payload
  if (typeof msg === 'string')  return msg
  if (Array.isArray(msg))       return msg.join(' ')
  return 'Erro desconhecido.'
}

export function getUserFromToken(): { username: string; role: string } | null {
  if (typeof window === 'undefined') return null
  const token = localStorage.getItem('token')
  if (!token) return null
  try {
    const payload = JSON.parse(atob(token.split('.')[1]))
    return { username: payload.username, role: payload.role }
  } catch {
    return null
  }
}
