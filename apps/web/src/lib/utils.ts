import { clsx, type ClassValue } from 'clsx'
import { twMerge } from 'tailwind-merge'
import { apiErrorMessages } from './messages'

export function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs))
}

export function extractError(json: Record<string, unknown>, fallback?: string): string {
  const outer   = json?.message
  const payload = (outer && typeof outer === 'object' && !Array.isArray(outer))
    ? (outer as Record<string, unknown>)
    : json

  // Structured error code from AllExceptionsFilter — resolve via message catalog
  if (typeof payload?.code === 'string') {
    const mapped = apiErrorMessages[payload.code]
    if (mapped) {
      const fields = Array.isArray(payload.fields) ? (payload.fields as string[]) : []
      return typeof mapped === 'function' ? mapped(fields) : mapped
    }
  }

  const msg = payload?.message ?? payload
  if (typeof msg === 'string')  return msg
  if (Array.isArray(msg))       return msg.join(' ')
  return fallback ?? 'Erro desconhecido.'
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
