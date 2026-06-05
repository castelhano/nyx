'use client'

import { useQuery } from '@tanstack/react-query'
import { apiFetch } from '@/lib/auth'
import type { MetadataField, PaginatedResult } from '@nyx/types'

/**
 * Fetches select options for a relation field.
 *
 * When the field declares `dependsOn`:
 * - Fetches filtered with `?f_<dependsOn>=<dependsOnValue>` when the parent has a value.
 * - Fetches unfiltered (all options) when the child already has a value but the parent is
 *   not yet selected — covers edit mode where the virtual parent field starts empty.
 * - Query is disabled when neither parent nor child has a value (blank creation form).
 */
export function useFieldOptions(
  field: Pick<MetadataField, 'resource' | 'domain' | 'dependsOn' | 'relatedWhere'>,
  dependsOnValue?: string,
  { hasCurrentValue = false }: { hasCurrentValue?: boolean } = {},
): { options: Record<string, unknown>[]; isLoading: boolean } {
  const hasDependency = !!field.dependsOn
  const enabled = !!field.resource && (!hasDependency || !!dependsOnValue || hasCurrentValue)

  const relatedWhereKey = field.relatedWhere ? JSON.stringify(field.relatedWhere) : ''

  const queryKey = hasDependency
    ? ['relation', field.resource, field.dependsOn, dependsOnValue ?? '', relatedWhereKey]
    : ['relation', field.resource, relatedWhereKey]

  const { data, isLoading } = useQuery<PaginatedResult<Record<string, unknown>>>({
    queryKey,
    queryFn: async () => {
      let url = `/${field.domain ?? 'core'}/${field.resource}?pageSize=999`
      if (hasDependency && dependsOnValue) {
        url += `&f_${field.dependsOn}=${encodeURIComponent(dependsOnValue)}`
      }
      if (field.relatedWhere) {
        for (const [k, v] of Object.entries(field.relatedWhere)) {
          url += `&f_${k}=${encodeURIComponent(String(v))}`
        }
      }
      const res = await apiFetch(url)
      if (!res.ok) throw new Error('Failed to fetch relation options')
      return res.json()
    },
    enabled,
    staleTime: hasDependency ? 0 : 30_000,
  })

  return { options: data?.data ?? [], isLoading }
}
