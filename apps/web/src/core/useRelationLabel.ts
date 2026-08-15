'use client'

import { useQuery } from '@tanstack/react-query'
import { apiFetch } from '@/lib/auth'

/**
 * Resolves the display label of a single related record by id — for combobox
 * fields whose selected value may not be present in the current search
 * results (e.g. editing an existing record). Shares its query key with
 * FieldRenderer's LockedDisplay, so the cache is reused across widgets.
 */
export function useRelationLabel(
  domain: string,
  resource: string | undefined,
  id: string | null | undefined,
  labelField = 'name',
): string {
  const { data } = useQuery<Record<string, unknown>>({
    queryKey:  ['relation-single', domain, resource, id],
    queryFn:   async () => {
      const res = await apiFetch(`/${domain}/${resource}/${id}`)
      if (!res.ok) throw new Error('Not found')
      return res.json()
    },
    enabled:   !!resource && !!id,
    staleTime: 60_000,
  })

  return data ? String(data[labelField] ?? '') : ''
}
