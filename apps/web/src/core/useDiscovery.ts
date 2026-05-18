'use client'

import { useQuery } from '@tanstack/react-query'
import type { DiscoveryDomain } from '@nyx/types'
import { apiFetch } from '@/lib/auth'
import { useAuth } from '@/lib/auth-context'

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
    initialData: [],
    enabled:     !!user,
  })
}
