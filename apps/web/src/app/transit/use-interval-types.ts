'use client'

import { useQuery } from '@tanstack/react-query'
import { apiFetch } from '@/lib/auth'

// All IntervalTypes (a short list) — crew settings, break forms
export function useIntervalTypes() {
  return useQuery<{ id: string; name: string }[]>({
    queryKey: ['transit', 'interval-type', 'all'],
    queryFn:  async () => {
      const res = await apiFetch('/transit/interval-type?pageSize=999')
      if (!res.ok) return []
      const json = await res.json()
      return json.data ?? []
    },
    staleTime: 60_000,
  })
}
