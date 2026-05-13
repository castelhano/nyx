'use client'

import { useQuery } from '@tanstack/react-query'
import type { DiscoveryDomain } from '@nyx/types'
import { apiFetch } from '@/lib/auth'

export function useDiscovery() {
  return useQuery<DiscoveryDomain[]>({
    queryKey: ['discovery'],
    queryFn: async () => {
      const res = await apiFetch('/discovery')
      if (!res.ok) throw new Error('Failed to fetch discovery')
      return res.json()
    },
    staleTime: process.env.NODE_ENV === 'production' ? Infinity : 0,
    initialData: [],
  })
}
