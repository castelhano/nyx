'use client'

import { useEffect, useState } from 'react'
import { useQuery } from '@tanstack/react-query'
import { apiFetch } from '@/lib/auth'
import type { PaginatedResult } from '@nyx/types'

function useDebounce<T>(value: T, delay: number): T {
  const [debounced, setDebounced] = useState(value)
  useEffect(() => {
    const id = setTimeout(() => setDebounced(value), delay)
    return () => clearTimeout(id)
  }, [value, delay])
  return debounced
}

/**
 * Debounced server-side search for a combobox — bounded to `pageSize` rows
 * instead of preloading the whole resource. Reused by RelationCombobox
 * (schema-driven forms) and ad-hoc combobox pickers outside the form system.
 */
export function useComboboxSearch(
  domain: string,
  resource: string | undefined,
  extraParams?: Record<string, string>,
  { pageSize = 20, enabled = true }: { pageSize?: number; enabled?: boolean } = {},
): { search: string; setSearch: (v: string) => void; rows: Record<string, unknown>[]; isLoading: boolean } {
  const [search, setSearch] = useState('')
  const debouncedSearch = useDebounce(search, 300)
  const extraKey = extraParams ? JSON.stringify(extraParams) : ''

  const { data, isFetching } = useQuery<PaginatedResult<Record<string, unknown>>>({
    queryKey: ['combobox-search', domain, resource, extraKey, debouncedSearch],
    queryFn: async () => {
      let url = `/${domain}/${resource}?pageSize=${pageSize}&search=${encodeURIComponent(debouncedSearch)}`
      if (extraParams) {
        for (const [k, v] of Object.entries(extraParams)) url += `&f_${k}=${encodeURIComponent(v)}`
      }
      const res = await apiFetch(url)
      if (!res.ok) throw new Error('Failed to fetch options')
      return res.json()
    },
    enabled: enabled && !!resource,
    staleTime: 10_000,
  })

  return { search, setSearch, rows: data?.data ?? [], isLoading: isFetching }
}
