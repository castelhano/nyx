'use client'

import { useQuery } from '@tanstack/react-query'
import type { DiscoveryDomain } from '@nyx/types'
import { apiFetch } from '@/lib/auth'
import { useAuth } from '@/lib/auth-context'

// Referência estável — um literal inline em `initialData` mudaria de identidade
// a cada render enquanto a query não resolve, instabilizando memos downstream.
const EMPTY_DOMAINS: DiscoveryDomain[] = []

export function useDiscovery() {
  const { user } = useAuth()

  return useQuery<DiscoveryDomain[]>({
    queryKey:  ['discovery', user?.id],
    queryFn: async () => {
      const res = await apiFetch('/discovery')
      if (!res.ok) throw new Error('Failed to fetch discovery')
      return res.json()
    },
    staleTime:   process.env.NODE_ENV === 'production' ? Infinity : 0,
    initialData: EMPTY_DOMAINS,
    enabled:     !!user,
  })
}
