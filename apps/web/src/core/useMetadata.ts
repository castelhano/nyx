'use client'

import { useQuery } from '@tanstack/react-query'
import type { ResourceMetadata } from '@nyx/types'
import { apiFetch } from '@/lib/auth'

export function useMetadata(domain: string, resource: string) {
  return useQuery<ResourceMetadata>({
    queryKey: ['metadata', domain, resource],
    queryFn: async () => {
      const res = await apiFetch(`/${domain}/${resource}s/metadata`)
      if (!res.ok) throw new Error('Failed to fetch metadata')
      return res.json()
    },
    staleTime: Infinity,
  })
}
