'use client'

import { useQuery } from '@tanstack/react-query'
import type { ResourceMetadata } from '@nyx/types'
import { apiFetch } from '@/lib/auth'
import { httpError, httpRetry } from '@/lib/query'

export function useMetadata(domain: string, resource: string) {
  return useQuery<ResourceMetadata>({
    queryKey: ['metadata', domain, resource],
    queryFn: async () => {
      const res = await apiFetch(`/${domain}/${resource}/metadata`)
      if (!res.ok) throw httpError(res.status)
      const json = await res.json()
      return json
    },
    staleTime: process.env.NODE_ENV === 'production' ? Infinity : 0,
    retry:     httpRetry,
  })
}
