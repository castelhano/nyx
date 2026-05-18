'use client'

import { createContext, useContext, useEffect, useCallback } from 'react'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import { useRouter, usePathname } from 'next/navigation'
import { apiFetch, getToken } from '@/lib/auth'
import { type CurrentUser, type UserPreferences, defaultPreferences } from '@nyx/types'

interface AuthContextValue {
  user:              CurrentUser | null
  updatePreferences: (patch: Partial<UserPreferences>) => Promise<void>
}

const AuthContext = createContext<AuthContextValue>({
  user:              null,
  updatePreferences: async () => {},
})

export function useAuth() {
  return useContext(AuthContext)
}

function applyTheme(theme: string) {
  const html = document.documentElement
  html.classList.forEach((cls) => { if (cls.startsWith('theme-')) html.classList.remove(cls) })
  html.classList.add(`theme-${theme}`)
}

export function AuthProvider({ children }: { children: React.ReactNode }) {
  const queryClient = useQueryClient()
  const router      = useRouter()
  const pathname    = usePathname()

  const { data: user } = useQuery<CurrentUser | null>({
    queryKey: ['auth', 'me'],
    queryFn:  async () => {
      const res = await apiFetch('/auth/me')
      if (!res.ok) return null
      const data = await res.json()
      return {
        ...data,
        preferences: { ...defaultPreferences, ...(data.preferences ?? {}) },
      } as CurrentUser
    },
    enabled:   !!getToken(),
    staleTime: 300_000,
  })

  useEffect(() => {
    applyTheme(user?.preferences?.theme ?? defaultPreferences.theme)
  }, [user?.preferences?.theme])

  useEffect(() => {
    if (user?.forcePasswordChange && pathname !== '/core/user/password') {
      router.replace('/core/user/password')
    }
  }, [user?.forcePasswordChange, pathname])

  const updatePreferences = useCallback(async (patch: Partial<UserPreferences>) => {
    queryClient.setQueryData<CurrentUser | null>(['auth', 'me'], (prev) =>
      prev ? { ...prev, preferences: { ...prev.preferences, ...patch } } : prev,
    )
    await apiFetch('/auth/me/preferences', {
      method: 'PATCH',
      body:   JSON.stringify(patch),
    })
  }, [queryClient])

  return (
    <AuthContext.Provider value={{ user: user ?? null, updatePreferences }}>
      {children}
    </AuthContext.Provider>
  )
}
